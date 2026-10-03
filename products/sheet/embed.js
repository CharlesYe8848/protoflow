// products/sheet/embed.js — 表格被别的产品嵌入（docs/product-architecture.md §4.11 跨产品嵌入）。
// 子部位是 sheet 名，不带子部位给第一个 sheet。两种形式：
//   data  { rows }：原始单元格值（Word 里生成原生表格、Markdown 里生成表格）
//   html  自包含的 <table>：样式按表格自己的级联算好写进 style 属性（同 .xlsx 导出那一侧的
//         sheetStyle.js，危险值已过滤），合并单元格用 colspan/rowspan；嵌入方当黑盒展示。
// 图片格嵌进别处时显示成 [图片：说明]——图片地址是相对表格自己的版本目录的，在别人的页面里不成立。
import * as sheetStore from "./store.js";
import { matchImageCell } from "./sheet.js";
import { resolveCellFlatStyle, flatStyleToCssText } from "./sheetStyle.js";

export const SHEET_EMBED_FORMATS = ["html", "data"];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cellText = (v) => {
  const img = matchImageCell(v);
  return img ? `[图片：${img.alt || img.file}]` : v == null ? "" : String(v);
};

function readSheet(ws, pid, ref) {
  const dj = sheetStore.readSheetJson(ws, pid, ref.id);
  const n = ref.version ?? (dj && dj.head);
  if (!n) return null;
  const v = sheetStore.openSheetVersion(ws, pid, ref.id, n);
  const raw = v && v.readText("sheet.json");
  if (!raw) return null;
  const sheets = JSON.parse(raw).sheets || [];
  return (ref.part ? sheets.find((s) => s.name === ref.part) : sheets[0]) || null;
}

function sheetHtml(sheet) {
  const rows = sheet.rows || [];
  const covered = new Set();
  const spans = {};
  for (const m of sheet.merges || []) {
    spans[`${m.startRow}:${m.startCol}`] = { rowspan: m.endRow - m.startRow + 1, colspan: m.endCol - m.startCol + 1 };
    for (let r = m.startRow; r <= m.endRow; r++) for (let c = m.startCol; c <= m.endCol; c++) {
      if (r !== m.startRow || c !== m.startCol) covered.add(`${r}:${c}`);
    }
  }
  const base = "border:1px solid #e2e8f0;padding:4px 8px;";
  const body = rows.map((row, r) => "<tr>" + row.map((v, c) => {
    if (covered.has(`${r}:${c}`)) return "";
    const span = spans[`${r}:${c}`];
    const attrs = span ? `${span.rowspan > 1 ? ` rowspan="${span.rowspan}"` : ""}${span.colspan > 1 ? ` colspan="${span.colspan}"` : ""}` : "";
    return `<td${attrs} style="${esc(base + flatStyleToCssText(resolveCellFlatStyle(sheet, r, c)))}">${esc(cellText(v))}</td>`;
  }).join("") + "</tr>").join("");
  // 不写字号：嵌进哪里就跟哪里的正文一样大（文档里是正文字号，幻灯片里是幻灯片字号）
  return `<table style="border-collapse:collapse">${body}</table>`;
}

export function embedSheet(ws, pid, ref, { as }) {
  const sheet = readSheet(ws, pid, ref);
  if (!sheet) return null;
  if (as === "data") return { data: { rows: (sheet.rows || []).map((row) => row.map(cellText)) } };
  if (as === "html") return { html: sheetHtml(sheet) };
  return null;
}
