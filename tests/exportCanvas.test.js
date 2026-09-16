import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import { buildCanvasExportZip } from "../core/exportCanvas.js";
import { runProjectExport } from "../core/exportService.js";
import { readZipEntries } from "../core/zip.js";

const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1`, author: "Charles" };
let seq = 0;
function seqCtx() { return { now: () => 1700000000000 + (++seq), genId: (p) => `${p}_${1700000000000 + seq}`, author: "Charles" }; }

function setup(projectName = "招聘") {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-expcv-"));
  const proj = store.createProject(ws, projectName, CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "流程" }, CTX);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "列表页" }, CTX);
  store.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="l">列表 {1+1}</div>; }`);
  return { ws, proj, pg, ab };
}

test("exportCanvas：不落盘到项目目录——只回 { filename, buffer }，是一份真实合法的 zip", () => {
  const { ws, proj } = setup();
  const before = fs.existsSync(path.join(ws, proj.id, ".export"));
  const out = buildCanvasExportZip(ws, proj.id);
  assert.equal(before, false);
  assert.equal(fs.existsSync(path.join(ws, proj.id, ".export")), false, "导出过程不在项目目录留任何痕迹");
  assert.equal(out.filename, "招聘.zip");
  assert.ok(Buffer.isBuffer(out.buffer) && out.buffer.length > 0);
});

test("exportCanvas：zip 顶层是跟项目同名的文件夹，index.html 用 exportBundle 渲染，画板 preview.html 跟实时预览逐字节一样，lib/ 是真实文件", () => {
  const { ws, proj, ab } = setup();
  const tree = store.loadProjectTree(ws, proj.id);
  const pgId = tree.pages[0].id;
  const out = buildCanvasExportZip(ws, proj.id);
  const entries = readZipEntries(out.buffer);
  const byName = Object.fromEntries(entries.map((e) => [e.name, e.data]));

  const index = byName[`招聘/index.html`]?.toString("utf8");
  assert.ok(index, "zip 顶层是「招聘/」文件夹");
  assert.ok(index.includes('<meta name="generator" content="protoflow-canvas-export"/>'));
  assert.ok(index.includes(`<iframe src="pages/${pgId}/artboards/${ab.id}/preview.html"`), "画布外壳引用画板的相对路径");
  assert.ok(!index.includes('class="pf-canvas-export"'), "导出的外壳不带导出按钮");
  assert.ok(index.includes('<div class="pf-mode-toolbar">') && index.includes('class="pf-sidebar-toggle-btn"'), "顶部小工具栏还在，但只剩侧边栏收起/展开按钮");
  assert.ok(!index.includes('class="pf-mode-interact') && !index.includes('class="pf-mode-select'), "取元素/模式切换按钮不出（需要活的预览服务）");

  const abHtml = byName[`招聘/pages/${pgId}/artboards/${ab.id}/preview.html`]?.toString("utf8");
  const liveHtml = store.artboardPreviewHtml(ws, proj.id, ab.id);
  assert.equal(abHtml, liveHtml, "导出的画板 preview.html 跟实时预览函数产出逐字节一样");
  assert.ok(abHtml.includes('<script type="text/babel"'), "浏览器端编译 JSX，没有 Node 端预编译");
  assert.ok(abHtml.includes('src="../../../../lib/react.production.min.js"'), "画板引用 lib/ 的相对路径没变");

  for (const f of ["react.production.min.js", "react-dom.production.min.js", "babel.min.js", "mermaid.min.js", "marked.min.js"]) {
    assert.ok(byName[`招聘/lib/${f}`], `lib/${f} 是 zip 里的真实文件`);
  }
});

test("exportCanvas：无源码的画板不生成 preview.html，画布外壳里显示空态", () => {
  const { ws, proj, pg } = setup();
  store.upsertArtboard(ws, proj.id, pg.id, { name: "空画板" }, seqCtx());
  const out = buildCanvasExportZip(ws, proj.id);
  const entries = readZipEntries(out.buffer);
  const index = entries.find((e) => e.name === "招聘/index.html").data.toString("utf8");
  assert.ok(index.includes("尚无内容"));
  const emptyAbId = store.loadProjectTree(ws, proj.id).pages[0].artboards[1].id;
  assert.ok(!entries.some((e) => e.name.includes(emptyAbId)));
});

test("exportCanvas：runProjectExport('canvas/zip') 走这条路由，返回 { filename, buffer, mime }", () => {
  const { ws, proj } = setup();
  const projectRoot = path.join(ws, proj.id);
  const routed = runProjectExport(projectRoot, "canvas/zip");
  assert.equal(routed.filename, "招聘.zip");
  assert.ok(Buffer.isBuffer(routed.buffer));
  assert.equal(routed.mime, "application/zip");
  assert.equal(runProjectExport(projectRoot, "canvas/bogus"), null, "不认识的格式 → null");
  assert.equal(runProjectExport(projectRoot, "bogus/thing"), null, "不认识的 subPath → null");
});

test("exportCanvas：runProjectExport('canvas')（不带格式段）向后兼容，默认当 zip 处理——回归测试：doc 的 preview.html 是 build_doc 时冻结的静态快照，加格式段之前生成的旧快照里「导出」按钮点出来还是旧的不带格式段 URL，不能指望用户先重新 build_doc 一遍才能用导出", () => {
  const { ws, proj } = setup();
  const routed = runProjectExport(path.join(ws, proj.id), "canvas");
  assert.equal(routed.filename, "招聘.zip");
  assert.equal(routed.mime, "application/zip");
});
