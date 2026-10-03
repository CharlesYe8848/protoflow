import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import * as store from "../core/store.js";
import * as sheetStore from "../products/sheet/store.js";
import { createSheet, buildSheet } from "../products/sheet/sheet.js";
import { buildSheetExportXlsx } from "../products/sheet/exportSheetXlsx.js";
import { flatStyleToExceljsStyle } from "../products/sheet/exportSheetXlsx.js";
import { runProjectExport } from "../products/index.js";

const CTX = { now: () => 1700000000000, author: "Charles" };

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-sheetxlsx-"));
  const proj = store.createProject(ws, "招聘", CTX);
  return { ws, proj };
}
function writeSheetJson(ws, pid, sheetId, content) {
  fs.writeFileSync(path.join(sheetStore.sheetDir(ws, pid, sheetId), "sheet.json"), JSON.stringify(content, null, 2));
}
async function readBackXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

test("flatStyleToExceljsStyle：某属性被下层覆盖时，同层其它属性保留（不是浅合并丢兄弟属性）", () => {
  // 模拟"先合并扁平表、再转换"：行样式要求加粗，单元格样式只要求变红——扁平表在这一步已经是
  // Object.assign 合并完的结果，转换只做一次。
  const flat = Object.assign({}, { "font-weight": "600" }, { color: "#dc2626" });
  const style = flatStyleToExceljsStyle(flat);
  assert.equal(style.font.bold, true, "加粗没有因为后面只设了颜色就丢掉");
  assert.equal(style.font.color.argb, "FFDC2626");
});

test("buildSheetExportXlsx：真实写出 .xlsx 再读回，校验值、样式、合并、边框", async () => {
  const { ws, proj } = setup();
  createSheet(ws, proj.id, { sheetId: "sales" }, CTX);
  writeSheetJson(ws, proj.id, "sales", {
    schemaVersion: 1, title: "销售报表",
    sheets: [{
      name: "销售报表",
      rows: [
        ["2026年销售业绩", "", "", ""],
        ["姓名", "部门", "销售额", "完成率"],
        ["张三", "华东", 120000, "120%"],
      ],
      merges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 3 }],
      styles: {
        rows: { "1": "font-weight:600;background:#f5f5f5;" },
        cells: { "0:0": "font-weight:bold;text-align:center;background:#e8f0fe;border:1px solid #334155;" },
      },
    }],
  });
  await buildSheet(ws, proj.id, "sales", { note: "首版" }, CTX);

  const out = await buildSheetExportXlsx(ws, proj.id, "sales");
  assert.equal(out.filename, "销售报表.xlsx");
  const wb = await readBackXlsx(out.buffer);
  const sheet = wb.getWorksheet("销售报表");
  assert.ok(sheet, "worksheet 名字保留");

  assert.equal(sheet.getCell(3, 1).value, "张三");
  assert.equal(sheet.getCell(3, 3).value, 120000);
  assert.equal(sheet.getCell(3, 4).value, "120%");

  // 合并
  assert.deepEqual(wb.getWorksheet("销售报表").model.merges, ["A1:D1"]);

  // 表头行加粗 + 背景，兄弟单元格样式互不覆盖
  const headerCell = sheet.getCell(2, 1);
  assert.equal(headerCell.font.bold, true);
  assert.equal(headerCell.fill.fgColor.argb, "FFF5F5F5");

  // 合并区域左上角本身的样式
  const topLeft = sheet.getCell(1, 1);
  assert.equal(topLeft.font.bold, true);
  assert.equal(topLeft.alignment.horizontal, "center");
  assert.equal(topLeft.fill.fgColor.argb, "FFE8F0FE");

  // ExcelJS 的合并单元格会让范围内所有格子共享左上角那一份 style（源码 Cell#merge 直接把其它
  // 格子的 style 指到 master 上）——只要左上角四边都设了边框，合并范围内读任何一个格子出来都是
  // 同一份完整边框；Excel 本身也不会在合并区域内部画格线，视觉上就是一圈干净的框，不需要、也没
  // 办法给范围内不同格子分别设不同的边（实测过 exceljs 的行为，见 core/exportSheetXlsx.js 注释）。
  for (const [r, c] of [[1, 1], [1, 2], [1, 3], [1, 4]]) {
    const b = sheet.getCell(r, c).border;
    assert.equal(b.top.style, "thin", `(${r},${c}) 应该有上边框`);
    assert.equal(b.right.style, "thin", `(${r},${c}) 应该有右边框`);
    assert.equal(b.bottom.style, "thin", `(${r},${c}) 应该有下边框`);
    assert.equal(b.left.style, "thin", `(${r},${c}) 应该有左边框`);
  }
});

test("buildSheetExportXlsx：多 sheet 各自成一个 worksheet", async () => {
  const { ws, proj } = setup();
  createSheet(ws, proj.id, { sheetId: "report" }, CTX);
  writeSheetJson(ws, proj.id, "report", {
    schemaVersion: 1, title: "季度报告",
    sheets: [
      { name: "汇总", rows: [["指标", "值"], ["营收", 100]] },
      { name: "明细", rows: [["姓名", "销售额"], ["张三", 50]] },
    ],
  });
  await buildSheet(ws, proj.id, "report", { note: "首版" }, CTX);
  const out = await buildSheetExportXlsx(ws, proj.id, "report");
  const wb = await readBackXlsx(out.buffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["汇总", "明细"]);
  assert.equal(wb.getWorksheet("明细").getCell(2, 1).value, "张三");
});

test("buildSheetExportXlsx：没有任何版本时返回 null", async () => {
  const { ws, proj } = setup();
  createSheet(ws, proj.id, { sheetId: "empty" }, CTX);
  assert.equal(await buildSheetExportXlsx(ws, proj.id, "empty"), null);
});

test("buildSheetExportXlsx：![]() 图片格嵌真实图片，不写 markdown 文本；坏图退回原样文本", async () => {
  const { ws, proj } = setup();
  createSheet(ws, proj.id, { sheetId: "sales" }, CTX);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWo0AAAAASUVORK5CYII=", "base64");
  const assetsDir = path.join(sheetStore.sheetDir(ws, proj.id, "sales"), "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, "home.png"), png);
  // 文件存在（过得了 IMAGE_REF_MISSING 校验）但内容不是真图片——模拟"引用没写错、但图片本身
  // 读不出尺寸/格式"的导出期失败，跟"压根没这个文件"是两种不同阶段的失败，不能用同一个场景测。
  fs.writeFileSync(path.join(assetsDir, "corrupt.png"), "not a real png");
  writeSheetJson(ws, proj.id, "sales", {
    schemaVersion: 1, title: "台账",
    sheets: [{ name: "A", rows: [
      ["项目", "截图", "坏图"],
      ["首页", "![首页截图](assets/home.png)", "![](assets/corrupt.png)"],
    ] }],
  });
  const built = await buildSheet(ws, proj.id, "sales", { note: "首版" }, CTX);
  assert.equal(built.ok, true, JSON.stringify(built));

  const out = await buildSheetExportXlsx(ws, proj.id, "sales");
  const wb = await readBackXlsx(out.buffer);
  const sheet = wb.getWorksheet("A");

  assert.equal(sheet.getCell(2, 2).value, null, "图片格不写 markdown 文本进单元格值");
  const images = sheet.getImages();
  assert.equal(images.length, 1);
  assert.equal(images[0].range.tl.col, 1, "图片锚定在 0-based 列 1（第二列）");
  assert.equal(images[0].range.tl.row, 1, "图片锚定在 0-based 行 1（第二行）");
  assert.deepEqual(wb.model.media[0].buffer, png, "嵌入的就是真实图片字节，不是别的");

  assert.equal(sheet.getCell(2, 3).value, "![](assets/corrupt.png)", "读不出的图片退回原样文本，不挡住整份导出");
});

test("runProjectExport('sheet/<id>/xlsx') 走这条路由，返回 { filename, buffer, mime }", async () => {
  const { ws, proj } = setup();
  createSheet(ws, proj.id, { sheetId: "sales" }, CTX);
  writeSheetJson(ws, proj.id, "sales", { schemaVersion: 1, title: "销售数据", sheets: [{ name: "A", rows: [["a"]] }] });
  await buildSheet(ws, proj.id, "sales", { note: "首版" }, CTX);
  const out = await runProjectExport(path.join(ws, proj.id), "sheet/sales/xlsx");
  assert.equal(out.filename, "销售数据.xlsx");
  assert.equal(out.mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  // 省略 format 段时默认 xlsx（表格只有这一种导出格式，不像 doc 要兼容历史的 zip 默认值）
  const out2 = await runProjectExport(path.join(ws, proj.id), "sheet/sales");
  assert.equal(out2.filename, "销售数据.xlsx");
});
