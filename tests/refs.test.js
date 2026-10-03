import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import * as canvasStore from "../products/canvas/store.js";
import * as docStore from "../products/doc/store.js";
import * as sheetStore from "../products/sheet/store.js";
import { parseRef, formatRef, pinRefs, evaluateSource, versionSources, assetSources } from "../core/refs.js";
import { referenceFindings } from "../core/chain.js";
import { projectGraph, GRAPH_SCHEMA_VERSION } from "../core/projectGraph.js";
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

// ---- 纯函数：用一个假产品，说明框架只按解析器的形状办事 ----

// widget:w1 最新 v3；子部位 a 在 v1、v2 是 "x"，v3 起是 "y"；子部位 b 一直是 "z"。
const fake = {
  type: "widget", label: "部件",
  head: (_ws, _pid, id) => (id === "w1" ? 3 : null),
  fingerprint: (_ws, _pid, id, n, part) => {
    if (id !== "w1") return null;
    const v = n ?? 3;
    if (part === "a") return v >= 3 ? "y" : "x";
    if (part === "b") return "z";
    return null;
  },
  describe: (_ws, _pid, id, part) => `部件 ${id}${part ? `/${part}` : ""}`,
};
const R = { widget: fake };

test("parseRef / formatRef：版本和子部位都可省", () => {
  assert.deepEqual(parseRef("canvas:main@3#ab_1"), { type: "canvas", id: "main", version: 3, part: "ab_1" });
  assert.deepEqual(parseRef("doc:prd@5"), { type: "doc", id: "prd", version: 5, part: null });
  assert.deepEqual(parseRef("sheet:销售@2#汇总"), { type: "sheet", id: "销售", version: 2, part: "汇总" });
  assert.deepEqual(parseRef("canvas:main#ab_1"), { type: "canvas", id: "main", version: null, part: "ab_1" });
  for (const bad of ["", "prd", "doc:", "doc:prd@0", "doc:prd@x", "Doc:prd", "doc:p rd"]) assert.equal(parseRef(bad), null, bad);
  assert.equal(formatRef(parseRef("canvas:main@3#ab_1")), "canvas:main@3#ab_1");
});
test("evaluateSource：有子部位比指纹，没子部位比版本号，目标或子部位没了算 missing", () => {
  const ev = (ref, fp) => evaluateSource("", "", { ref, via: "declared", ...(fp ? { fp } : {}) }, R).status;
  assert.equal(ev("widget:w1@1#b"), "fresh", "对方从 v1 到了 v3，但 b 没变");
  assert.equal(ev("widget:w1@1#a"), "stale", "a 在 v3 变了");
  assert.equal(ev("widget:w1@3#a"), "fresh");
  assert.equal(ev("widget:w1@2"), "stale", "不带子部位：head 比引用的版本新就算过期");
  assert.equal(ev("widget:w1@3"), "fresh");
  assert.equal(ev("widget:w1#a", "x"), "stale", "不带版本号：比引用时记下的指纹");
  assert.equal(ev("widget:w1#a", "y"), "fresh");
  assert.equal(ev("widget:w1@1#gone"), "missing");
  assert.equal(ev("widget:w9@1"), "missing");
  assert.equal(ev("gadget:w1@1"), "missing", "产品被拆掉了");
});

test("pinRefs：不带版本号固定到最新版；不认识的类型、不存在的目标/版本/子部位都拒绝", () => {
  assert.deepEqual(pinRefs("", "", ["widget:w1#a", "widget:w1@2", "widget:w1@2"], R).sources,
    [{ ref: "widget:w1@3#a", via: "declared" }, { ref: "widget:w1@2", via: "declared" }], "去重");
  for (const bad of ["nope", "gadget:w1", "widget:w9", "widget:w1@4", "widget:w1@1#gone"]) {
    assert.equal(pinRefs("", "", [bad], R).error.code, "BAD_SOURCE", bad);
  }
});

test("versionSources：声明的沿用到重新声明为止，素材带来的每次重新收集", () => {
  const prev = [{ ref: "doc:prd@5", via: "declared" }, { ref: "canvas:main@1#ab", via: "asset" }];
  const derived = [{ ref: "canvas:main@2#ab", via: "asset" }];
  assert.deepEqual(versionSources({ declared: undefined, previous: prev, derived }), [{ ref: "doc:prd@5", via: "declared" }, ...derived]);
  assert.deepEqual(versionSources({ declared: [{ ref: "doc:prd@6", via: "declared" }], previous: prev, derived: [] }), [{ ref: "doc:prd@6", via: "declared" }]);
  assert.deepEqual(versionSources({ declared: [], previous: prev, derived: [] }), [], "传 [] 清空");
});

test("assetSources：只认 .source.json，格式不对的跳过", () => {
  const files = [
    { path: "assets/a.png", data: "png" },
    { path: "assets/a.png.source.json", data: JSON.stringify({ ref: "canvas:main@3#ab_1" }) },
    { path: "assets/b.png.source.json", data: "{坏" },
    { path: "assets/c.png.source.json", data: JSON.stringify({ ref: "不是引用" }) },
  ];
  assert.deepEqual(assetSources(files), [{ ref: "canvas:main@3#ab_1", via: "asset" }]);
});

test("referenceFindings：最新版引用变了报 ref_stale，没了报 ref_missing，已发布版本落后报 publish_lagging", () => {
  const artifacts = [{
    type: "widget", id: "w1", title: "W", head: 2,
    versions: [
      { n: 1, sources: [{ ref: "widget:w1@1#a" }], publishedTo: [{ channel: "dingtalk", channelDocId: "d1" }] },
      { n: 2, sources: [{ ref: "widget:w1@1#a" }, { ref: "widget:w1@1#gone" }, { ref: "widget:w1@1#b" }], publishedTo: [] },
    ],
  }];
  const codes = referenceFindings("", "", artifacts, R).map((f) => `${f.code}:${f.level}`);
  assert.deepEqual(codes.sort(), ["publish_lagging:lagging", "ref_missing:broken", "ref_stale:drifted"]);
});

// ---- 真实产品：画布、文档、表格互相引用 ----

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-refs-"));
  const proj = store.createProject(ws, "引用", CTX);
  const pg = canvasStore.upsertPage(ws, proj.id, { name: "首页" }, CTX);
  const a = canvasStore.upsertArtboard(ws, proj.id, pg.id, { name: "列表" }, { now: () => 1 });
  const b = canvasStore.upsertArtboard(ws, proj.id, pg.id, { name: "详情" }, { now: () => 2 });
  canvasStore.saveArtboardSource(ws, proj.id, a.id, "function Component(){ return <div>A1</div>; }");
  canvasStore.saveArtboardSource(ws, proj.id, b.id, "function Component(){ return <div>B1</div>; }");
  return { ws, pid: proj.id, a: a.id, b: b.id };
}
const status = (ws, pid, ref) => evaluateSource(ws, pid, { ref }, RESOLVERS).status;

function writeSheet(ws, pid, id, sheets) {
  fs.writeFileSync(path.join(sheetStore.sheetDir(ws, pid, id), "sheet.json"), JSON.stringify({ schemaVersion: 1, title: id, sheets }));
}

test("画布：引用按画板比较——改了别的画板不算过期；没定过版的画布比工作副本", () => {
  const { ws, pid, a, b } = setup();
  const pinned = pinRefs(ws, pid, [`canvas:main#${a}`], RESOLVERS).sources;
  assert.equal(pinned[0].ref, `canvas:main#${a}`, "画布没定过版：不带版本号，记下画板此刻的指纹");
  assert.ok(pinned[0].fp);
  assert.equal(evaluateSource(ws, pid, pinned[0], RESOLVERS).status, "fresh");
  canvasStore.saveArtboardSource(ws, pid, a, "function Component(){ return <div>A2</div>; }");
  assert.equal(evaluateSource(ws, pid, pinned[0], RESOLVERS).status, "stale");

  buildCanvas(ws, pid, { note: "v1" }, CTX);
  assert.equal(pinRefs(ws, pid, [`canvas:main#${a}`], RESOLVERS).sources[0].ref, `canvas:main@1#${a}`, "定过版就固定到最新版");
  canvasStore.saveArtboardSource(ws, pid, b, "function Component(){ return <div>B2</div>; }");
  buildCanvas(ws, pid, { note: "v2 改了详情" }, CTX);
  assert.equal(status(ws, pid, `canvas:main@1#${a}`), "fresh", "只改了详情，引用列表的不过期");
  assert.equal(status(ws, pid, `canvas:main@1#${b}`), "stale");
  canvasStore.saveArtboardSource(ws, pid, a, "function Component(){ return <div>A3</div>; }");
  assert.equal(status(ws, pid, `canvas:main@1#${a}`), "fresh", "定过版之后比的是最新版，没定版的改动不算");
  canvasStore.deleteTarget(ws, pid, b);
  buildCanvas(ws, pid, { note: "v3 删了详情" }, CTX);
  assert.equal(status(ws, pid, `canvas:main@1#${b}`), "missing");
});

test("表格：引用按 sheet 比较；文档：引用按版本号比较", async () => {
  const { ws, pid } = setup();
  createSheet(ws, pid, { sheetId: "matrix" }, CTX);
  writeSheet(ws, pid, "matrix", [{ name: "汇总", rows: [["1"]] }, { name: "明细", rows: [["a"]] }]);
  await buildSheet(ws, pid, "matrix", { note: "v1" }, CTX);
  writeSheet(ws, pid, "matrix", [{ name: "汇总", rows: [["1"]] }, { name: "明细", rows: [["b"]] }]);
  await buildSheet(ws, pid, "matrix", { note: "v2 改明细" }, CTX);
  assert.equal(status(ws, pid, "sheet:matrix@1#汇总"), "fresh");
  assert.equal(status(ws, pid, "sheet:matrix@1#明细"), "stale");
  assert.equal(status(ws, pid, "sheet:matrix@1"), "stale");
  assert.equal(pinRefs(ws, pid, ["sheet:matrix#不存在"], RESOLVERS).error.code, "BAD_SOURCE");

  createDoc(ws, pid, { docId: "release-note", ...tpl("release-note"), docId: "prd" }, CTX);
  assert.equal(pinRefs(ws, pid, ["doc:prd"], RESOLVERS).error.code, "BAD_SOURCE", "没定过版的文档不能引用");
  fs.writeFileSync(path.join(docStore.docDir(ws, pid, "prd"), "doc.md"), "# PRD\n");
  await buildDoc(ws, pid, "prd", "finalize", { note: "v1" }, CTX);
  assert.equal(status(ws, pid, "doc:prd@1"), "fresh");
  await buildDoc(ws, pid, "prd", "finalize", { note: "v2" }, CTX);
  assert.equal(status(ws, pid, "doc:prd@1"), "stale");
});

test("定版时声明的引用存进版本，后续版本沿用；图谱报出每条引用的状态", async () => {
  const { ws, pid, a } = setup();
  createSheet(ws, pid, { sheetId: "matrix" }, CTX);
  writeSheet(ws, pid, "matrix", [{ name: "汇总", rows: [["1"]] }]);
  await buildSheet(ws, pid, "matrix", { note: "v1" }, CTX);

  // 画布基于表格画的
  buildCanvas(ws, pid, { note: "按表格画", sources: pinRefs(ws, pid, ["sheet:matrix#汇总"], RESOLVERS).sources }, CTX);
  canvasStore.saveArtboardSource(ws, pid, a, "function Component(){ return <div>A2</div>; }");
  buildCanvas(ws, pid, { note: "只改了样式" }, CTX);
  const cj = canvasStore.readCanvasJson(ws, pid, "main");
  assert.deepEqual(cj.versions.map((v) => v.sources.map((s) => s.ref)), [["sheet:matrix@1#汇总"], ["sheet:matrix@1#汇总"]], "没重新声明就沿用");

  writeSheet(ws, pid, "matrix", [{ name: "汇总", rows: [["2"]] }]);
  await buildSheet(ws, pid, "matrix", { note: "v2 数据更新" }, CTX);
  const graph = projectGraph(ws, pid, PRODUCTS, RESOLVERS);
  assert.equal(graph.schemaVersion, GRAPH_SCHEMA_VERSION);
  const canvas = graph.artifacts.find((x) => x.type === "canvas");
  assert.equal(canvas.head, 2);
  assert.equal(canvas.sources[0].status, "stale");
  assert.match(canvas.sources[0].reason, /表格「matrix」的 sheet「汇总」/);
  assert.ok(graph.artifacts.some((x) => x.type === "sheet" && x.id === "matrix" && x.head === 2 && x.sources.length === 0));
});

test("素材自带出处：文件旁边的 .source.json 在定版时自动成为引用", async () => {
  const { ws, pid, a } = setup();
  buildCanvas(ws, pid, { note: "v1" }, CTX);
  createSheet(ws, pid, { sheetId: "shots" }, CTX);
  const assets = path.join(sheetStore.sheetDir(ws, pid, "shots"), "assets");
  fs.writeFileSync(path.join(assets, "a.png"), "png");
  fs.writeFileSync(path.join(assets, "a.png.source.json"), JSON.stringify({ ref: `canvas:main@1#${a}` }));
  writeSheet(ws, pid, "shots", [{ name: "图", rows: [["![a](assets/a.png)"]] }]);
  await buildSheet(ws, pid, "shots", { note: "v1" }, CTX);
  assert.deepEqual(sheetStore.readSheetJson(ws, pid, "shots").versions[0].sources, [{ ref: `canvas:main@1#${a}`, via: "asset" }]);
});
