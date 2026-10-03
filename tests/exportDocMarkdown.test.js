import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import * as canvasStore from "../products/canvas/store.js";
import * as docStore from "../products/doc/store.js";
import { buildDoc, createDoc } from "../products/doc/doc.js";
import { buildCanvas } from "../products/canvas/canvasVersion.js";
import { buildDocExportMarkdown } from "../products/doc/exportDocMarkdown.js";
import { runProjectExport } from "../products/index.js";
import { readZipEntries } from "../core/zip.js";
import { tpl } from "./helpers/productDevTemplate.js";

const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1`, author: "Charles" };

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-expmd-"));
  const proj = store.createProject(ws, "招聘", CTX);
  const pg = canvasStore.upsertPage(ws, proj.id, { name: "流程" }, CTX);
  const ab = canvasStore.upsertArtboard(ws, proj.id, pg.id, { name: "列表页" }, CTX);
  canvasStore.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="l">列表</div>; }`);
  return { ws, proj, ab };
}
const ddir = (ws, pid, docId = "prd") => docStore.docDir(ws, pid, docId);
function writeMd(ws, pid, md, docId = "prd") {
  fs.writeFileSync(path.join(ddir(ws, pid, docId), "doc.md"), md);
}
// 截图脚本的产物（skills/protoflow-product-dev/scripts/capture.mjs）：画布先定一版，assets/ 里放图片和出处文件。
function placeCapture(ws, pid, ab, docId = "prd", bytes = "PNGBYTES") {
  if (!canvasStore.canvasHead(ws, pid, "main")) buildCanvas(ws, pid, { note: "v1" }, CTX);
  const a = path.join(ddir(ws, pid, docId), "assets");
  fs.mkdirSync(a, { recursive: true });
  fs.writeFileSync(path.join(a, "cap-a.png"), bytes);
  fs.writeFileSync(path.join(a, "cap-a.png.source.json"), JSON.stringify({ ref: `canvas:main@${canvasStore.canvasHead(ws, pid, "main")}#${ab.id}` }));
}

test("exportDocMarkdown：不落盘到项目目录——只回 { filename, buffer }，文件名 = 标题 + .zip", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd"), title: "结账 PRD" }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 结账 PRD\n\n正文\n\n![截图](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);

  const before = fs.existsSync(path.join(ws, proj.id, ".export"));
  const out = buildDocExportMarkdown(ws, proj.id, "prd");
  assert.equal(before, false);
  assert.equal(fs.existsSync(path.join(ws, proj.id, ".export")), false, "导出过程不在项目目录留任何痕迹");
  assert.equal(out.filename, "结账 PRD.zip");
});

test("exportDocMarkdown：zip 里是 <标题>.md + assets/ 真实文件，图片引用保持相对路径，不转 data URI；mermaid 代码块原样保留", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd"), title: "结账 PRD" }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(
    ws,
    proj.id,
    "# 结账 PRD\n\n正文\n\n![截图](assets/cap-a.png)\n\n```mermaid\nsequenceDiagram\nA->>B: hi\n```\n",
  );
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);

  const out = buildDocExportMarkdown(ws, proj.id, "prd");
  const entries = readZipEntries(out.buffer);
  const byName = Object.fromEntries(entries.map((e) => [e.name, e.data]));
  const md = byName["结账 PRD/结账 PRD.md"]?.toString("utf8");
  assert.ok(md, "zip 顶层是「结账 PRD/」文件夹，里面是「结账 PRD.md」");
  assert.ok(md.includes("](assets/cap-a.png)"), "图片引用保持相对路径，不改写");
  assert.ok(!md.includes("data:image"), "不再转 data URI");
  assert.ok(byName["结账 PRD/assets/cap-a.png"], "图片是 zip 里的真实文件");
  assert.ok(md.includes("```mermaid\nsequenceDiagram"), "mermaid 代码块原样保留，不转图片");
});

test("exportDocMarkdown：正文里的 <!-- protoflow:changelog --> 标记原地展开成表（正文只带当前版本，但表要带上全部历史版本，跟在线预览页一致）；没有标记就原样不动", async () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd"), title: "结账 PRD" }, CTX);
  writeMd(ws, proj.id, "# 结账 PRD\n\n<!-- protoflow:changelog -->\n\n正文\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  writeMd(ws, proj.id, "# 结账 PRD\n\n<!-- protoflow:changelog -->\n\n正文 v2\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "第二版" }, CTX);

  const out = buildDocExportMarkdown(ws, proj.id, "prd");
  const entries = readZipEntries(out.buffer);
  const md = entries.find((e) => e.name === "结账 PRD/结账 PRD.md").data.toString("utf8");
  assert.ok(!md.includes("<!-- protoflow:changelog -->"), "标记被替换掉了");
  assert.ok(md.includes("| 版本 | 修改日期 | 修改人 | 修改内容 |"), "原地展开成表");
  assert.ok(md.includes("| v2 | ") && md.includes("第二版"), "带上当前版本这一行");
  assert.ok(md.includes("| v1 | ") && md.includes("首版"), "也带上历史版本（v1），不是只有当前这一版");

  createDoc(ws, proj.id, { docId: "release-note", ...tpl("release-note"), title: "结账上线公告" }, CTX);
  writeMd(ws, proj.id, "# 结账上线公告\n\n正文，不放标记\n", "release-note");
  await buildDoc(ws, proj.id, "release-note", "finalize", { note: "首版" }, CTX);
  const rnOut = buildDocExportMarkdown(ws, proj.id, "release-note");
  const rnEntries = readZipEntries(rnOut.buffer);
  const rnMd = rnEntries.find((e) => e.name === "结账上线公告/结账上线公告.md").data.toString("utf8");
  assert.ok(!rnMd.includes("| 版本 | 修改日期"), "没有标记，正文原样不动，不出现这张表");
});

test("exportDocMarkdown：没有图片时不生成 assets/ 目录", async () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd"), title: "无图 PRD" }, CTX);
  writeMd(ws, proj.id, "# 无图 PRD\n\n正文，没有图片\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);

  const out = buildDocExportMarkdown(ws, proj.id, "prd");
  const entries = readZipEntries(out.buffer);
  assert.ok(!entries.some((e) => e.name.startsWith("无图 PRD/assets/")), "没有图片就不打包 assets/");
});

test("exportDocMarkdown：文档没有任何版本时返回 null", () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  assert.equal(buildDocExportMarkdown(ws, proj.id, "prd"), null);
});

test("exportDocMarkdown：runProjectExport('doc/<id>/markdown') 走这条路由，mime 取自 exportFormats 登记表", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd"), title: "结账 PRD" }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 结账 PRD\n\n正文\n\n![截图](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);

  const routed = runProjectExport(path.join(ws, proj.id), "doc/prd/markdown");
  assert.equal(routed.filename, "结账 PRD.zip");
  assert.equal(routed.mime, "application/zip");
});
