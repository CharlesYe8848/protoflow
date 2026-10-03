// core/exportSheetXlsx.js — 把一份表格的当前（head）版本尽力导出成 .xlsx。能对应到 Excel 能力的
// 样式（加粗/斜体/字色/背景色/边框/对齐/自动换行）尽量还原，Excel 没有的效果（圆角/阴影/渐变等）
// 直接丢弃，不报错——这是数据模型故意保持"CSS 自由表达"、导出时再做取舍的设计结果。
//
// 单元格值整体是 ![]() 图片引用时（core/sheet.js 的 matchImageCell），改成用 ExcelJS 的
// addImage() 把真实图片锚定到那个格子上，不写markdown文本——读图失败（文件丢了、格式不支持）
// 就原样把 ![]() 文本写进单元格，不让一张坏图挡住整份导出。
//
// 样式合并原则："先合并、再转换"：core/sheetStyle.js 的 resolveCellFlatStyle() 先把 table→row→
// column→cell 四层 CSS 文本合并成一份扁平属性表，这里只做一次"扁平表 → ExcelJS 嵌套样式对象"的
// 转换（flatStyleToExceljsStyle）。不能反过来对已经转换成嵌套对象的中间结果做 Object.assign 合并
// ——那样会用浅合并整体替换掉上一层的兄弟属性（比如行加粗、格变红，合并完加粗会丢）。
import ExcelJS from "exceljs";
import { imageSize } from "image-size";
import { resolveCellFlatStyle } from "./sheetStyle.js";
import { matchImageCell } from "./sheet.js";
import { safeFileName } from "protoflow/sdk";
import { readSheetJson, openSheetVersion } from "./store.js";

// 表格导出共用的第一步：只认 head 版本，取它解析后的内容对象。
// 返回 null（表格没有任何版本，调用方直接回 null 表示"这个导出目标不存在"）。
function loadSheetHead(ws, projectId, sheetId) {
  const dj = readSheetJson(ws, projectId, sheetId);
  if (!dj || !(dj.versions || []).length) return null;
  const head = dj.head;
  const v = dj.versions.find((x) => x.n === head) || dj.versions[dj.versions.length - 1];
  const version = openSheetVersion(ws, projectId, sheetId, v.n);
  const raw = version && version.readText("sheet.json");
  if (raw == null) throw new Error(`表格 ${sheetId} 的第 ${v.n} 版内容缺失`);
  const content = JSON.parse(raw);
  return { dj, v, version, content, name: safeFileName(dj.title || sheetId, sheetId) };
}


const MAX_IMG_W = 200, MAX_IMG_H = 150;

// 只读这个冻结版本 assets/ 下的文件，不认外部 URL、不允许路径穿越（版本句柄只认清单里的路径）——
// 跟 core/exportDocWord.js 的 image() 是同一条安全规则。读不到/不是支持的图片格式就返回 null，
// 调用方原样把 ![]() 文本写进单元格，不让一张坏图挡住整份导出。
function readCellImage(version, file) {
  try {
    const buffer = version.read(`assets/${file}`);
    if (!buffer) return null;
    const size = imageSize(buffer);
    const extension = size.type === "jpg" ? "jpeg" : size.type;
    if (!["png", "jpeg", "gif"].includes(extension)) return null;
    const scale = Math.min(1, MAX_IMG_W / size.width, MAX_IMG_H / size.height);
    return { buffer, extension, width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
  } catch {
    return null;
  }
}

const BORDER_STYLE_WORDS = ["dashed", "dotted", "double", "solid"];
const BORDER_STYLE_MAP = { solid: "thin", dashed: "dashed", dotted: "dotted", double: "double" };

// #rgb / #rrggbb / rgb(...) / rgba(...) → ExcelJS 的 ARGB 十六进制（"FFrrggbb"）。不认识的颜色
// （比如命名色 red、CSS 变量）返回 null，调用方直接跳过这条样式，不报错。
function cssColorToArgb(value) {
  const v = String(value).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return "FF" + m[1].split("").map((c) => c + c).join("").toUpperCase();
  m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return "FF" + m[1].toUpperCase();
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(v);
  if (m) return "FF" + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  return null;
}

// "1px solid #334155" 之类的 border 简写 → { style, color }，找不到颜色/样式关键字就用默认值。
function parseBorderShorthand(value) {
  const tokens = String(value).trim().split(/\s+/);
  const widthTok = tokens.find((t) => /^\d/.test(t));
  const styleTok = tokens.find((t) => BORDER_STYLE_WORDS.includes(t.toLowerCase()));
  const colorTok = tokens.find((t) => cssColorToArgb(t) || /^rgba?\(/i.test(t));
  const width = widthTok ? parseFloat(widthTok) : 1;
  const style = BORDER_STYLE_MAP[(styleTok || "solid").toLowerCase()] || (width >= 2 ? "medium" : "thin");
  const argb = colorTok ? cssColorToArgb(colorTok) : "FF000000";
  return { style, color: { argb } };
}

const ALIGN_H = new Set(["left", "center", "right", "justify"]);
const ALIGN_V = { top: "top", middle: "middle", bottom: "bottom" };

// 扁平 CSS 属性表 → ExcelJS 单元格样式对象，只认识这几个属性，不认识的直接跳过。
export function flatStyleToExceljsStyle(flat) {
  const style = {};
  const font = {};
  if (/^(bold|[6-9]00)$/i.test(flat["font-weight"] || "")) font.bold = true;
  if (/^italic$/i.test(flat["font-style"] || "")) font.italic = true;
  const fontColor = cssColorToArgb(flat.color);
  if (fontColor) font.color = { argb: fontColor };
  if (Object.keys(font).length) style.font = font;

  const bg = cssColorToArgb(flat.background || flat["background-color"]);
  if (bg) style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };

  const alignment = {};
  if (ALIGN_H.has((flat["text-align"] || "").toLowerCase())) alignment.horizontal = flat["text-align"].toLowerCase();
  if (ALIGN_V[(flat["vertical-align"] || "").toLowerCase()]) alignment.vertical = ALIGN_V[flat["vertical-align"].toLowerCase()];
  if (flat["white-space"] && flat["white-space"].toLowerCase() !== "nowrap") alignment.wrapText = true;
  if (Object.keys(alignment).length) style.alignment = alignment;

  if (flat.border) {
    const b = parseBorderShorthand(flat.border);
    style.border = { top: b, left: b, bottom: b, right: b };
  }
  return style;
}

export async function buildSheetExportXlsx(ws, projectId, sheetId) {
  const head = loadSheetHead(ws, projectId, sheetId);
  if (!head) return null;
  const workbook = new ExcelJS.Workbook();

  const imageIdByFile = {};
  for (const sheet of head.content.sheets || []) {
    const worksheet = workbook.addWorksheet(sheet.name);
    const rows = sheet.rows || [];
    rows.forEach((row, r) => {
      row.forEach((value, c) => {
        const cell = worksheet.getCell(r + 1, c + 1);
        const img = matchImageCell(value);
        const asset = img && readCellImage(head.version, img.file);
        if (asset) {
          if (!(img.file in imageIdByFile)) {
            imageIdByFile[img.file] = workbook.addImage({ buffer: asset.buffer, extension: asset.extension });
          }
          worksheet.addImage(imageIdByFile[img.file], { tl: { col: c, row: r }, ext: { width: asset.width, height: asset.height } });
          const wantRowHeight = asset.height * 0.75; // px → Excel 行高单位的粗略换算，够看就行
          const rowEl = worksheet.getRow(r + 1);
          if (!rowEl.height || rowEl.height < wantRowHeight) rowEl.height = wantRowHeight;
        } else {
          cell.value = value == null ? "" : value;
        }
        Object.assign(cell, flatStyleToExceljsStyle(resolveCellFlatStyle(sheet, r, c)));
      });
    });
    // ExcelJS 的合并单元格实现（lib/doc/cell.js Cell#merge）会把范围内其它格子的 .style 直接
    // 指向左上角格子的同一个 style 对象——读写任意一个被合并的格子都是在读写左上角那一份，没有
    // "每个物理格子各管自己一段边框"这回事，实测验证过（node_modules/exceljs 源码 + 手写脚本）。
    // 这意味着不需要、也没办法把边框分别设到合并范围的外沿格子上：只要左上角的样式里四边都设了
    // 边框，合并后所有格子读出来都是同一份完整边框，而 Excel 本身也不会在一个激活的合并区域内部
    // 画格线，视觉上就是一整圈干净的框，不需要额外处理。
    for (const merge of sheet.merges || []) {
      worksheet.mergeCells(merge.startRow + 1, merge.startCol + 1, merge.endRow + 1, merge.endCol + 1);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return { filename: `${head.name}.xlsx`, buffer };
}
