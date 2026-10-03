// 各产品自己的健康规则（core/canvasProduct.js、docProduct.js、sheetProduct.js 的 health），以及
// 组装后的排序（core/projectGraph.js 的 projectHealth）。跨产品的引用规则见 tests/refs.test.js。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import * as canvasStore from "../products/canvas/store.js";
import * as docStore from "../products/doc/store.js";
import * as sheetStore from "../products/sheet/store.js";
import { projectHealth } from "../core/projectGraph.js";
import * as canvasProduct from "../products/canvas/canvasProduct.js";
import * as docProduct from "../products/doc/docProduct.js";
import * as sheetProduct from "../products/sheet/sheetProduct.js";
import { buildCanvas } from "../products/canvas/canvasVersion.js";
import { createSheet, buildSheet } from "../products/sheet/sheet.js";
import { createDoc, buildDoc } from "../products/doc/doc.js";
import { tpl } from "./helpers/productDevTemplate.js";

const CTX = { now: () => 1700000000000, author: "T" };
const PRODUCTS = [canvasProduct, docProduct, sheetProduct];
const RESOLVERS = Object.fromEntries(PRODUCTS.map((p) => [p.resolver.type, p.resolver]));
const SRC = `function Component(){ return <div id="btn">按钮</div>; }`;

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-health-"));
  const proj = store.createProject(ws, "健康", CTX);
  const pg = canvasStore.upsertPage(ws, proj.id, { name: "首页" }, CTX);
  const ab = canvasStore.upsertArtboard(ws, proj.id, pg.id, { name: "列表页" }, CTX);
  const hash = canvasStore.saveArtboardSource(ws, proj.id, ab.id, SRC);
  canvasStore.writeAnnotationsMd(ws, proj.id, ab.id, "点 [按钮](#el/btn)", {}, hash);
  return { ws, pid: proj.id, ab: ab.id };
}
const codes = (ws, pid) => projectHealth(ws, pid, PRODUCTS, RESOLVERS).map((f) => f.code);

test("全绿：画板已校验、标注已核对、没有文档表格", () => {
  const { ws, pid } = setup();
  assert.deepEqual(codes(ws, pid), []);
});

test("画布：源码外部修改未校验", () => {
  const { ws, pid, ab } = setup();
  fs.writeFileSync(path.join(canvasStore.artboardDir(ws, pid, ab), "source.jsx"), SRC.replace("按钮", "改"));
  assert.ok(codes(ws, pid).includes("unvalidated"));
});

test("画布：源码变了标注待核对；引用的元素没了则标注失效（优先于待核对）", () => {
  const { ws, pid, ab } = setup();
  canvasStore.saveArtboardSource(ws, pid, ab, SRC.replace("按钮", "改"));
  assert.deepEqual(codes(ws, pid), ["annotation_review"]);
  canvasStore.saveArtboardSource(ws, pid, ab, `function Component(){ return <div id="other"/>; }`);
  assert.deepEqual(codes(ws, pid), ["annotation_broken"]);
});

test("画布：定过版后有没定版的改动才提醒", () => {
  const { ws, pid, ab } = setup();
  assert.ok(!codes(ws, pid).includes("canvas_uncommitted"), "从没定过版不提醒");
  buildCanvas(ws, pid, { note: "v1" }, CTX);
  assert.ok(!codes(ws, pid).includes("canvas_uncommitted"));
  const hash = canvasStore.saveArtboardSource(ws, pid, ab, SRC.replace("按钮", "改"));
  canvasStore.writeAnnotationsMd(ws, pid, ab, "点 [按钮](#el/btn)", {}, hash);
  assert.deepEqual(codes(ws, pid), ["canvas_uncommitted"]);
});

test("画布：画板里画了 Mermaid 给一条建议，排在最后，不写具体的画图产品名", () => {
  const { ws, pid, ab } = setup();
  const hash = canvasStore.saveArtboardSource(ws, pid, ab, `function Component(){ return <div id="btn"><pre className="mermaid">{"flowchart TD\\n a-->b"}</pre></div>; }`);
  canvasStore.writeAnnotationsMd(ws, pid, ab, "点 [按钮](#el/btn)", {}, hash);
  const found = projectHealth(ws, pid, PRODUCTS, RESOLVERS);
  assert.deepEqual(found.map((f) => [f.code, f.level]), [["artboard_diagram", "advice"]]);
  assert.ok(!/绘图|diagram/.test(found[0].reason + found[0].suggestedAction), "画布不在文字里依赖别的产品");
});

test("文档、表格：草稿从未定版、有没定版的改动", async () => {
  const { ws, pid } = setup();
  createDoc(ws, pid, { docId: "release-note", ...tpl("release-note") }, CTX);
  createSheet(ws, pid, { sheetId: "s" }, CTX);
  const sheetJson = path.join(sheetStore.sheetDir(ws, pid, "s"), "sheet.json");
  fs.writeFileSync(sheetJson, JSON.stringify({ schemaVersion: 1, title: "s", sheets: [{ name: "A", rows: [["1"]] }] }));
  assert.deepEqual(codes(ws, pid).sort(), ["doc_uncommitted", "sheet_uncommitted"]);

  fs.writeFileSync(path.join(docStore.docDir(ws, pid, "release-note"), "doc.md"), "# 公告\n");
  await buildDoc(ws, pid, "release-note", "finalize", { note: "v1" }, CTX);
  await buildSheet(ws, pid, "s", { note: "v1" }, CTX);
  assert.deepEqual(codes(ws, pid), []);

  fs.writeFileSync(path.join(docStore.docDir(ws, pid, "release-note"), "doc.md"), "# 公告 改\n");
  fs.writeFileSync(sheetJson, JSON.stringify({ schemaVersion: 1, title: "s", sheets: [{ name: "A", rows: [["2"]] }] }));
  assert.deepEqual(codes(ws, pid).sort(), ["doc_uncommitted", "sheet_uncommitted"]);
});

test("发现项按严重度排序且都带 reason / suggestedAction", async () => {
  const { ws, pid, ab } = setup();
  createDoc(ws, pid, { docId: "release-note", ...tpl("release-note") }, CTX);
  fs.writeFileSync(path.join(canvasStore.artboardDir(ws, pid, ab), "source.jsx"), `function Component(){ return <div/>; }`);
  const fs2 = projectHealth(ws, pid, PRODUCTS, RESOLVERS);
  assert.ok(fs2.length >= 3);
  assert.ok(fs2.every((f) => f.level && f.target && f.reason && f.suggestedAction));
  const order = ["broken", "unvalidated", "review", "uncommitted", "drifted", "lagging"];
  const levels = fs2.map((f) => f.level);
  assert.deepEqual([...levels].sort((x, y) => order.indexOf(x) - order.indexOf(y)), levels);
});
