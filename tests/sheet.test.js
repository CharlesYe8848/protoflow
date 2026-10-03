import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import * as sheetStore from "../products/sheet/store.js";
import { createSheet, buildSheet, validateSheetContent, matchImageCell } from "../products/sheet/sheet.js";

const CTX = { now: () => 1700000000000, author: "Charles" };

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-sheet-"));
  const proj = store.createProject(ws, "招聘", CTX);
  return { ws, proj };
}

function writeSheetJson(ws, pid, sheetId, content) {
  fs.writeFileSync(path.join(sheetStore.sheetDir(ws, pid, sheetId), "sheet.json"), JSON.stringify(content, null, 2));
}

const basicContent = (overrides = {}) => ({
  schemaVersion: 1,
  title: "销售数据",
  sheets: [{ name: "销售明细", rows: [["姓名", "部门"], ["张三", "华东"]], styles: {}, ...overrides }],
});

test("createSheet：scaffold sheet.json + doc.json，sheetId 不合法或已存在时报错", () => {
  const { ws, proj } = setup();
  const r = createSheet(ws, proj.id, { sheetId: "sales", title: "销售数据" }, CTX);
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(r.sheetJsonPath));
  assert.equal(JSON.parse(fs.readFileSync(r.sheetJsonPath, "utf8")).title, "销售数据");

  const dup = createSheet(ws, proj.id, { sheetId: "sales" }, CTX);
  assert.equal(dup.ok, false);
  assert.equal(dup.error.code, "SHEET_EXISTS");

  const bad = createSheet(ws, proj.id, { sheetId: "a/b" }, CTX);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "BAD_SHEET_ID");
});

test("validateSheetContent：结构校验——sheets 非空、name 不重复、rows 是二维数组且等长", () => {
  assert.equal(validateSheetContent({}).ok, false);
  assert.deepEqual(validateSheetContent({ sheets: [] }).errors, ["sheets 必须是非空数组"]);

  const dupNames = validateSheetContent({ sheets: [{ name: "A", rows: [[1]] }, { name: "A", rows: [[1]] }] });
  assert.equal(dupNames.ok, false);
  assert.ok(dupNames.errors.some((e) => e.includes("名称重复")));

  const ragged = validateSheetContent({ sheets: [{ name: "A", rows: [[1, 2], [1]] }] });
  assert.equal(ragged.ok, false);
  assert.ok(ragged.errors.some((e) => e.includes("长度是 1")));

  assert.equal(validateSheetContent(basicContent()).ok, true);
});

test("validateSheetContent：styles 的行/列/单元格下标越界要报错，带具体 key", () => {
  const r = validateSheetContent(basicContent({ styles: { rows: { "5": "x" }, columns: { "9": "x" }, cells: { "9:9": "x" } } }));
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 3);
  assert.ok(r.errors.some((e) => e.includes('styles.rows["5"]')));
  assert.ok(r.errors.some((e) => e.includes('styles.columns["9"]')));
  assert.ok(r.errors.some((e) => e.includes('styles.cells["9:9"]')));
});

test("validateSheetContent：merges——越界、重叠、覆盖格非空都要报错", () => {
  const rows = [["标题", "", "", ""], ["姓名", "部门", "销售额", "完成率"], ["张三", "华东", 120000, "120%"]];

  const ok = validateSheetContent({ sheets: [{ name: "A", rows, merges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 3 }] }] });
  assert.equal(ok.ok, true);

  const outOfBounds = validateSheetContent({ sheets: [{ name: "A", rows, merges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 9 }] }] });
  assert.equal(outOfBounds.ok, false);
  assert.ok(outOfBounds.errors.some((e) => e.includes("超出")));

  const overlap = validateSheetContent({
    sheets: [{ name: "A", rows, merges: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }, { startRow: 1, startCol: 1, endRow: 2, endCol: 2 }] }],
  });
  assert.equal(overlap.ok, false);
  assert.ok(overlap.errors.some((e) => e.includes("重叠")));

  const nonEmptyCovered = validateSheetContent({
    sheets: [{ name: "A", rows: [["标题", "不该有值", "", ""], ["姓名", "部门", "销售额", "完成率"], ["张三", "华东", 120000, "120%"]],
      merges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 3 }] }],
  });
  assert.equal(nonEmptyCovered.ok, false);
  assert.ok(nonEmptyCovered.errors.some((e) => e.includes("必须是空字符串")));
});

test("buildSheet：读草稿 → 校验 → 冻结版本 → 生成预览；note 必填、不合法 JSON 报清晰错误", async () => {
  const { ws, proj } = setup();
  createSheet(ws, proj.id, { sheetId: "sales" }, CTX);
  writeSheetJson(ws, proj.id, "sales", basicContent());

  const noNote = await buildSheet(ws, proj.id, "sales", {}, CTX);
  assert.equal(noNote.ok, false);
  assert.equal(noNote.error.code, "NOTE_REQUIRED");

  const r1 = await buildSheet(ws, proj.id, "sales", { note: "首版" }, CTX);
  assert.equal(r1.ok, true);
  assert.equal(r1.version, 1);
  assert.ok(fs.existsSync(r1.headPreviewPath));
  const dj = sheetStore.readSheetJson(ws, proj.id, "sales");
  assert.equal(dj.head, 1);
  assert.equal(dj.versions.length, 1);
  assert.equal(dj.versions[0].note, "首版");

  // 冻结版本不可变：versions/1/sheet.json 内容不会因为草稿之后又改而变化
  const frozen = JSON.parse(sheetStore.openSheetVersion(ws, proj.id, "sales", 1).readText("sheet.json"));
  assert.deepEqual(frozen, basicContent());

  fs.writeFileSync(path.join(sheetStore.sheetDir(ws, proj.id, "sales"), "sheet.json"), "{ 不是合法 JSON");
  const badJson = await buildSheet(ws, proj.id, "sales", { note: "坏了" }, CTX);
  assert.equal(badJson.ok, false);
  assert.equal(badJson.error.code, "SHEET_JSON_INVALID");
  // 解析失败不产生新版本，也不动已冻结的版本
  assert.equal(sheetStore.readSheetJson(ws, proj.id, "sales").head, 1);
});

test("buildSheet：重复 finalize 相同内容——正常生成新版本号（预期行为，不做去重），旧版本从不被覆盖", async () => {
  const { ws, proj } = setup();
  createSheet(ws, proj.id, { sheetId: "sales" }, CTX);
  writeSheetJson(ws, proj.id, "sales", basicContent());
  const r1 = await buildSheet(ws, proj.id, "sales", { note: "首版" }, CTX);
  const r2 = await buildSheet(ws, proj.id, "sales", { note: "复核确认无需改动" }, CTX);
  assert.equal(r1.version, 1);
  assert.equal(r2.version, 2);
  assert.equal(r1.sheetHash, r2.sheetHash, "内容没变，哈希应该一样");

  const v1 = JSON.parse(sheetStore.openSheetVersion(ws, proj.id, "sales", 1).readText("sheet.json"));
  assert.deepEqual(v1, basicContent(), "版本 1 没有被版本 2 的 finalize 动过");

  const dj = sheetStore.readSheetJson(ws, proj.id, "sales");
  assert.equal(dj.head, 2);
  assert.equal(dj.versions.length, 2);
});

test("buildSheet：validation 失败时报 SHEET_VALIDATION_FAILED，汇总所有问题", async () => {
  const { ws, proj } = setup();
  createSheet(ws, proj.id, { sheetId: "sales" }, CTX);
  writeSheetJson(ws, proj.id, "sales", { sheets: [{ name: "A", rows: [[1, 2], [1]] }] });
  const r = await buildSheet(ws, proj.id, "sales", { note: "x" }, CTX);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "SHEET_VALIDATION_FAILED");
  assert.match(r.error.message, /长度是 1/);
});

test("多 sheet：schema 从第一天就是数组，第二个 sheet 正常生效", async () => {
  const { ws, proj } = setup();
  createSheet(ws, proj.id, { sheetId: "report" }, CTX);
  writeSheetJson(ws, proj.id, "report", {
    schemaVersion: 1, title: "季度报告",
    sheets: [
      { name: "汇总", rows: [["指标", "值"], ["营收", 100]] },
      { name: "明细", rows: [["姓名", "销售额"], ["张三", 50]] },
    ],
  });
  const r = await buildSheet(ws, proj.id, "report", { note: "首版" }, CTX);
  assert.equal(r.ok, true);
  const html = fs.readFileSync(r.headPreviewPath, "utf8");
  assert.match(html, /"name":"汇总"/);
  assert.match(html, /"name":"明细"/);
});

test("matchImageCell：整格是 ![]() 才算图片，图文混排/非字符串都不算", () => {
  assert.deepEqual(matchImageCell("![截图](assets/a.png)"), { alt: "截图", file: "a.png" });
  assert.deepEqual(matchImageCell("![](assets/a%20b.png)"), { alt: "", file: "a b.png" });
  assert.equal(matchImageCell("张三 ![](assets/a.png)"), null, "图文混排不算——单元格是原子值");
  assert.equal(matchImageCell("a.png"), null, "纯文件名不算，必须是 ![]() 写法");
  assert.equal(matchImageCell(120000), null);
  assert.equal(matchImageCell(null), null);
});

test("createSheet：scaffold 时带一个空的 assets/ 目录", () => {
  const { ws, proj } = setup();
  createSheet(ws, proj.id, { sheetId: "sales" }, CTX);
  assert.ok(fs.existsSync(path.join(sheetStore.sheetDir(ws, proj.id, "sales"), "assets")));
});

test("buildSheet：![]() 引用的图片必须存在于 assets/，否则报 IMAGE_REF_MISSING；存在时随版本一起冻结", async () => {
  const { ws, proj } = setup();
  createSheet(ws, proj.id, { sheetId: "sales" }, CTX);
  const contentWithImage = {
    schemaVersion: 1, title: "台账",
    sheets: [{ name: "A", rows: [["项目", "截图"], ["首页", "![首页截图](assets/home.png)"]] }],
  };
  writeSheetJson(ws, proj.id, "sales", contentWithImage);

  const missing = await buildSheet(ws, proj.id, "sales", { note: "首版" }, CTX);
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "IMAGE_REF_MISSING");
  assert.match(missing.error.message, /home\.png/);

  const assetsDir = path.join(sheetStore.sheetDir(ws, proj.id, "sales"), "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, "home.png"), "fake-png-bytes");

  const r = await buildSheet(ws, proj.id, "sales", { note: "首版" }, CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(sheetStore.openSheetVersion(ws, proj.id, "sales", 1).readText("assets/home.png"), "fake-png-bytes");
});
