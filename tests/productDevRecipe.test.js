// 产品研发流程 skill（skills/protoflow-product-dev）的检查和关系体检脚本。它们只用公开接口：检查读 AGENTS.md 写明的
// 文件布局，体检调 CLI 的 get_project（项目图谱）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import * as canvasStore from "../products/canvas/store.js";
import * as docStore from "../products/doc/store.js";
import { buildCanvas } from "../products/canvas/canvasVersion.js";
import { createDoc, buildDoc } from "../products/doc/doc.js";
import { run as check, docType } from "../skills/protoflow-product-dev/scripts/check.mjs";
import { run as status } from "../skills/protoflow-product-dev/scripts/status.mjs";
import { tpl } from "./helpers/productDevTemplate.js";

const CTX = { now: () => 1700000000000, author: "T" };

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-pd-"));
  const proj = store.createProject(ws, "研发", CTX);
  const pg = canvasStore.upsertPage(ws, proj.id, { name: "首页" }, CTX);
  const ab = canvasStore.upsertArtboard(ws, proj.id, pg.id, { name: "列表" }, CTX);
  canvasStore.saveArtboardSource(ws, proj.id, ab.id, "function Component(){ return <div>A1</div>; }");
  return { ws, pid: proj.id, ab: ab.id, projectDir: store.projectDir(ws, proj.id) };
}
const writeMd = (ws, pid, docId, md) => fs.writeFileSync(path.join(docStore.docDir(ws, pid, docId), "doc.md"), md);

test("check.mjs：PRD 的开放问题报 error、修改记录表标记重复报 error；上线公告查 FAQ 数量和标题格式", async () => {
  const { ws, pid, projectDir } = setup();
  createDoc(ws, pid, { docId: "prd", ...tpl("prd") }, CTX);
  writeMd(ws, pid, "prd", "# 考核\n\n<!-- protoflow:changelog -->\n<!-- protoflow:changelog -->\n\n某边界 **需要与研发确认**。\n");
  const r = await check([projectDir, "prd"]);
  assert.equal(r.type, "prd");
  assert.equal(r.ok, false);
  assert.deepEqual(r.findings.map((f) => f.code).sort(), ["CHANGELOG_MARKER_DUP", "OPEN_QUESTION"]);

  createDoc(ws, pid, { docId: "release-note", ...tpl("release-note") }, CTX);
  writeMd(ws, pid, "release-note", "# 考核上线了\n\n**Q：一**\nA：a\n");
  const rn = await check([projectDir, "release-note"]);
  assert.equal(rn.ok, true, "只有 warn，不算不能发布");
  assert.deepEqual(rn.findings.map((f) => f.code).sort(), ["FAQ_TOO_FEW", "TITLE_NO_MODULE", "TITLE_NO_SUFFIX"]);

  const forced = await check([projectDir, "release-note", "--type", "prd"]);
  assert.equal(forced.type, "prd", "--type 覆盖 doc.json 里的类型");
  await assert.rejects(check([projectDir, "nope"]), (e) => e.code === "DOC_NOT_FOUND");
});

test("check.mjs 认文档类型：标签 product-dev/<类型>、--type 覆盖", () => {
  assert.equal(docType(["product-dev/prd"]), "prd");
  assert.equal(docType(["别的流程/x", "product-dev/release-note"]), "release-note");
  assert.equal(docType(["别的流程/x"]), null);
  assert.equal(docType(undefined), null);
  assert.equal(docType(["product-dev/prd"], "release-note"), "release-note");
});

test("status.mjs：PRD 没关联原型、公告没基于 PRD、引用的原型之后改过，都报出来", async () => {
  const { ws, pid, ab, projectDir } = setup();
  buildCanvas(ws, pid, { note: "v1" }, CTX);

  // 没关联原型的 PRD
  createDoc(ws, pid, { docId: "prd", ...tpl("prd"), docId: "prd-a" }, CTX);
  writeMd(ws, pid, "prd-a", "# A\n");
  await buildDoc(ws, pid, "prd-a", undefined, { note: "首版" }, CTX);
  // 截图带出处、关联了原型的 PRD
  createDoc(ws, pid, { docId: "prd", ...tpl("prd"), docId: "prd-b" }, CTX);
  const assets = path.join(docStore.docDir(ws, pid, "prd-b"), "assets");
  fs.writeFileSync(path.join(assets, "cap.png"), "png");
  fs.writeFileSync(path.join(assets, "cap.png.source.json"), JSON.stringify({ ref: `canvas:main@1#${ab}` }));
  writeMd(ws, pid, "prd-b", "# B\n\n![](assets/cap.png)\n");
  await buildDoc(ws, pid, "prd-b", undefined, { note: "首版" }, CTX);
  // 没基于 PRD 的公告
  createDoc(ws, pid, { docId: "release-note", ...tpl("release-note") }, CTX);
  writeMd(ws, pid, "release-note", "# 【考核】上线\n");
  await buildDoc(ws, pid, "release-note", undefined, { note: "首版" }, CTX);

  let r = await status([projectDir]);
  const codes = (x) => x.findings.map((f) => `${f.code}@${f.target}`).sort();
  assert.deepEqual(codes(r), ["PRD_NO_CANVAS@doc:prd-a", "RELEASE_NOTE_NO_PRD@doc:release-note"]);

  canvasStore.saveArtboardSource(ws, pid, ab, "function Component(){ return <div>A2</div>; }");
  buildCanvas(ws, pid, { note: "v2 改了列表" }, CTX);
  r = await status([projectDir]);
  assert.ok(codes(r).includes("SOURCE_STALE@doc:prd-b"), JSON.stringify(r.findings));
});
