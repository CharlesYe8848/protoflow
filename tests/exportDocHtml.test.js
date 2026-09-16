import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import { buildDoc, createDoc } from "../core/doc.js";
import { buildPublishPack } from "../core/publishPack.js";
import { buildDocExportHtml } from "../core/exportDocHtml.js";
import { runProjectExport } from "../core/exportService.js";

const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1`, author: "Charles" };

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-exphtml-"));
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

test("exportDocHtml：不落盘到项目目录——只回 { filename, buffer, mime }，文件名 = 标题 + .html", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd", title: "结账 PRD" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 结账 PRD\n\n正文\n\n![截图](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);

  const before = fs.existsSync(path.join(ws, proj.id, ".export"));
  const out = buildDocExportHtml(ws, proj.id, "prd");
  assert.equal(before, false);
  assert.equal(fs.existsSync(path.join(ws, proj.id, ".export")), false, "导出过程不在项目目录留任何痕迹");
  assert.equal(out.filename, "结账 PRD.html");
  assert.equal(out.mime, "text/html");
});

test("exportDocHtml：marked 压缩后内嵌成一份 JSON（不引用 lib/ 真实文件，也不是明文源码直接塞进 <script>），图片改写成 data URI（不带 assets/ 目录，也不需要运行时补丁）", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd", title: "结账 PRD" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 结账 PRD\n\n正文\n\n![截图](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);

  const out = buildDocExportHtml(ws, proj.id, "prd");
  const html = out.buffer.toString("utf8");
  assert.ok(!html.includes('<script src="'), "不引用任何外部文件（marked/mermaid 全内联）");
  const libsEl = html.match(/<script type="application\/json" id="pf-compressed-libs">([\s\S]*?)<\/script>/);
  assert.ok(libsEl, "压缩库源码整体嵌成一份 JSON");
  const libs = JSON.parse(libsEl[1]);
  assert.ok(libs["marked.min.js"] && libs["marked.min.js"].format && libs["marked.min.js"].base64, "marked.min.js 带 format/base64，是压缩过的，不是明文源码");
  assert.ok(html.includes("__pfDecompressLibs"), "启动脚本里带了解压函数");
  assert.ok(html.includes("](data:image/png;base64,"), "markdown 原文里的图片引用被改写成 data URI");
  assert.ok(!html.includes("](assets/"), "不再留 assets/ 相对路径引用");
  assert.ok(!html.includes('class="pf-hdr-share"'), "单 HTML 导出（standalone）也不带「导出」按钮，跟 zip 导出一样");
});

test("exportDocHtml：没用到 mermaid 时不内联 mermaid.min.js 源码（省掉 3.5MB；页面自带的 mermaid 相关 CSS 类名/JS 钩子不算——那些本来就是静态模板的一部分，不会被真的触发）", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd", title: "结账 PRD" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 结账 PRD\n\n正文，没有 mermaid 图\n\n![截图](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  const out = buildDocExportHtml(ws, proj.id, "prd");
  assert.ok(out.buffer.length < 200_000, `没用到 mermaid，文件不该带上 3.5MB 的库源码，实际 ${out.buffer.length} 字节`);
  const libs = JSON.parse(out.buffer.toString("utf8").match(/id="pf-compressed-libs">([\s\S]*?)<\/script>/)[1]);
  assert.ok(!libs["mermaid.min.js"], "没用到 mermaid 的文档，压缩库列表里不该有它");
});

test("exportDocHtml：文档没有任何版本时返回 null", () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  assert.equal(buildDocExportHtml(ws, proj.id, "prd"), null);
});

test("exportDocHtml：runProjectExport('doc/<id>/html') 走这条路由，返回 { filename, buffer, mime }", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd", title: "结账 PRD" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 结账 PRD\n\n正文\n\n![截图](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);

  const routed = runProjectExport(path.join(ws, proj.id), "doc/prd/html");
  assert.equal(routed.filename, "结账 PRD.html");
  assert.equal(routed.mime, "text/html");
});
