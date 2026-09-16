import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import { buildDoc, createDoc } from "../core/doc.js";
import { buildPublishPack } from "../core/publishPack.js";
import { buildDocExportMarkdown } from "../core/exportDocMarkdown.js";
import { runProjectExport } from "../core/exportService.js";

const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1`, author: "Charles" };

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-expmd-"));
  const proj = store.createProject(ws, "招聘", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "流程" }, CTX);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "列表页" }, CTX);
  store.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="l">列表</div>; }`);
  return { ws, proj, ab };
}
const ddir = (ws, pid, docId = "prd") => store.docDir(ws, pid, docId);
function writeMd(ws, pid, md, docId = "prd") {
  fs.writeFileSync(path.join(ddir(ws, pid, docId), "doc.md"), md);
}
async function sealOneCapture(ws, pid, ab, docId = "prd") {
  const d = path.join(ddir(ws, pid, docId), ".build");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "captures.json"), JSON.stringify({ captures: [{ id: "cap-a", artboardId: ab.id, title: "A", annotationIds: [] }] }));
  await buildDoc(ws, pid, docId, "snapshot", {}, CTX);
  await buildPublishPack(ws, pid, docId, "previews", CTX);
  fs.writeFileSync(path.join(d, "exported-images", "cap-a.png"), "PNGBYTES");
  await buildPublishPack(ws, pid, docId, "seal", CTX);
}

test("exportDocMarkdown：不落盘到项目目录——只回 { filename, buffer }，文件名 = 标题 + .md", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd", title: "结账 PRD" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 结账 PRD\n\n正文\n\n![截图](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);

  const before = fs.existsSync(path.join(ws, proj.id, ".export"));
  const out = buildDocExportMarkdown(ws, proj.id, "prd");
  assert.equal(before, false);
  assert.equal(fs.existsSync(path.join(ws, proj.id, ".export")), false, "导出过程不在项目目录留任何痕迹");
  assert.equal(out.filename, "结账 PRD.md");
});

test("exportDocMarkdown：图片改写成 data URI（不依赖 assets/ 目录），mermaid 代码块原样保留", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd", title: "结账 PRD" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(
    ws,
    proj.id,
    "# 结账 PRD\n\n正文\n\n![截图](assets/cap-a.png)\n\n```mermaid\nsequenceDiagram\nA->>B: hi\n```\n",
  );
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);

  const out = buildDocExportMarkdown(ws, proj.id, "prd");
  const md = out.buffer.toString("utf8");
  assert.ok(md.includes("](data:image/png;base64,"), "图片引用被改写成 data URI");
  assert.ok(!md.includes("](assets/"), "不再留 assets/ 相对路径引用");
  assert.ok(md.includes("```mermaid\nsequenceDiagram"), "mermaid 代码块原样保留，不转图片");
});

test("exportDocMarkdown：正文里的 <!-- protoflow:changelog --> 标记原地展开成表（只有当前这一版，跟 zip/html 导出一致不带历史版本）；没有标记就原样不动", async () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { kind: "prd", title: "结账 PRD" }, CTX);
  writeMd(ws, proj.id, "# 结账 PRD\n\n<!-- protoflow:changelog -->\n\n正文\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);

  const out = buildDocExportMarkdown(ws, proj.id, "prd");
  const md = out.buffer.toString("utf8");
  assert.ok(!md.includes("<!-- protoflow:changelog -->"), "标记被替换掉了");
  assert.ok(md.includes("| 版本 | 修改日期 | 修改人 | 修改内容 |"), "原地展开成表");
  assert.ok(md.includes("| v1 | "), "带上当前版本这一行");

  createDoc(ws, proj.id, { kind: "release-note", title: "结账上线公告" }, CTX);
  writeMd(ws, proj.id, "# 结账上线公告\n\n正文，不放标记\n", "release-note");
  await buildDoc(ws, proj.id, "release-note", "finalize", { note: "首版" }, CTX);
  const rnOut = buildDocExportMarkdown(ws, proj.id, "release-note");
  const rnMd = rnOut.buffer.toString("utf8");
  assert.ok(!rnMd.includes("| 版本 | 修改日期"), "没有标记，正文原样不动，不出现这张表");
});

test("exportDocMarkdown：文档没有任何版本时返回 null", () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  assert.equal(buildDocExportMarkdown(ws, proj.id, "prd"), null);
});

test("exportDocMarkdown：runProjectExport('doc/<id>/markdown') 走这条路由，mime 取自 exportFormats 登记表", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd", title: "结账 PRD" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 结账 PRD\n\n正文\n\n![截图](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);

  const routed = runProjectExport(path.join(ws, proj.id), "doc/prd/markdown");
  assert.equal(routed.filename, "结账 PRD.md");
  assert.equal(routed.mime, "text/markdown");
});
