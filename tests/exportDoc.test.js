import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import { buildDoc, createDoc } from "../core/doc.js";
import { buildPublishPack } from "../core/publishPack.js";
import { buildDocExportZip } from "../core/exportDoc.js";
import { runProjectExport } from "../core/exportService.js";
import { readZipEntries } from "../core/zip.js";

const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1`, author: "Charles" };

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-exp-"));
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

test("exportDoc：不落盘到项目目录——只回 { filename, buffer }，只带当前（head）版本，不带历史版本/版本切换", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd", title: "结账 PRD" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 结账 PRD\n\n<!-- protoflow:changelog -->\n\n正文\n\n![截图](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  writeMd(ws, proj.id, "# 结账 PRD\n\n<!-- protoflow:changelog -->\n\n正文改改\n\n![截图](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "二版" }, CTX);

  const before = fs.existsSync(path.join(ws, proj.id, ".export"));
  const out = buildDocExportZip(ws, proj.id, "prd");
  assert.equal(before, false);
  assert.equal(fs.existsSync(path.join(ws, proj.id, ".export")), false, "导出过程不在项目目录留任何痕迹");
  assert.equal(out.filename, "结账 PRD.zip");

  const entries = readZipEntries(out.buffer);
  const byName = Object.fromEntries(entries.map((e) => [e.name, e.data]));
  const h = byName["结账 PRD/preview.html"]?.toString("utf8");
  assert.ok(h, "zip 顶层是「结账 PRD/」文件夹");
  assert.ok(h.includes('<script src="lib/marked.min.js">'), "marked 是 lib/ 真实文件，不内联");
  assert.ok(!h.includes("](data:image"), "图片不转 data-URI，用真实文件");
  assert.ok(h.includes("](assets/cap-a.png)"), "图片引用保持相对路径 assets/x（只有一版，不用 versions/<n>/ 前缀）");
  assert.ok(byName["结账 PRD/assets/cap-a.png"], "图片是 zip 里的真实文件");
  assert.ok(!h.includes('class="pf-hdr-home"') && !h.includes("返回画布"), "去掉「返回画布」");
  assert.ok(!h.includes('class="pf-hdr-share"'), "导出目录里不放「导出」按钮");
  assert.ok(h.includes("var __PF_SIBLINGS__ = [];"), "没有同项目其它文档的跳转");
  const vArr = JSON.parse(h.match(/var __PF_VERSIONS__ = (\[[\s\S]*?\]);\n/)[1]);
  assert.deepEqual(vArr.map((v) => v.n), [2], "只带 head 这一版，不带历史版本 v1");
  assert.equal(JSON.parse(h.match(/var __PF_HEAD__ = (\d+);/)[1]), 2);
});

test("exportDoc：head 版本用到 mermaid 时引 lib/mermaid.min.js（真实文件），不用则不拷", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n```mermaid\nflowchart TD\n A-->B\n```\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  const withM = buildDocExportZip(ws, proj.id, "prd");
  const entriesM = readZipEntries(withM.buffer);
  const byNameM = Object.fromEntries(entriesM.map((e) => [e.name, e.data]));
  assert.ok(byNameM["t/preview.html"].toString("utf8").includes("var __PF_ANY_MERMAID__ = true;"));
  assert.ok(byNameM["t/lib/mermaid.min.js"]);

  const { ws: ws2, proj: p2, ab: ab2 } = setup();
  createDoc(ws2, p2.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws2, p2.id, ab2);
  writeMd(ws2, p2.id, "# t\n\n无图\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws2, p2.id, "prd", "finalize", { note: "首版" }, CTX);
  const noM = buildDocExportZip(ws2, p2.id, "prd");
  const entriesNoM = readZipEntries(noM.buffer);
  const byNameNoM = Object.fromEntries(entriesNoM.map((e) => [e.name, e.data]));
  assert.ok(byNameNoM["t/preview.html"].toString("utf8").includes("var __PF_ANY_MERMAID__ = false;"));
  assert.ok(!byNameNoM["t/lib/mermaid.min.js"]);
});

test("exportDoc：只导当前版本——finalize 到 v2 后再导出，不含 v1 的改动痕迹", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n<!-- protoflow:changelog -->\n\n v1 正文\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "v1 备注" }, CTX);
  writeMd(ws, proj.id, "# t\n\n<!-- protoflow:changelog -->\n\n v2 正文\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "v2 备注" }, CTX);

  const out = buildDocExportZip(ws, proj.id, "prd");
  const entries = readZipEntries(out.buffer);
  const h = entries.find((e) => e.name === "t/preview.html").data.toString("utf8");
  assert.ok(h.includes("v2 正文") && !h.includes("v1 正文"), "只带当前版本的正文");
});

test("exportDoc：runProjectExport('doc/<id>/zip') 走这条路由，返回 { filename, buffer, mime }", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd", title: "结账 PRD" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 结账 PRD\n\n正文\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);

  const projectRoot = path.join(ws, proj.id);
  const routed = runProjectExport(projectRoot, "doc/prd/zip");
  assert.equal(routed.filename, "结账 PRD.zip");
  assert.ok(Buffer.isBuffer(routed.buffer));
  assert.equal(routed.mime, "application/zip");

  // 向后兼容：doc 的 preview.html 是 build_doc 时冻结的静态快照，不带格式段的旧 URL（"doc/<id>"，
  // 加格式段之前生成的旧快照里「导出」按钮点出来就是这个）要继续认得出来，默认当 zip 处理——
  // 回归测试：用户反馈过旧文档点「导出」直接报"导出失败"，根因就是这里没兜底不带格式段的旧 URL。
  const legacy = runProjectExport(projectRoot, "doc/prd");
  assert.equal(legacy.filename, "结账 PRD.zip");
  assert.equal(legacy.mime, "application/zip");
});

test("exportDoc：文档无版本 → null", () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  assert.equal(buildDocExportZip(ws, proj.id, "prd"), null);
});
