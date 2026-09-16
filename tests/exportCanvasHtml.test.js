import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import { buildCanvasExportHtml } from "../core/exportCanvasHtml.js";
import { runProjectExport } from "../core/exportService.js";

const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1`, author: "Charles" };
let seq = 0;
function seqCtx() { return { now: () => 1700000000000 + (++seq), genId: (p) => `${p}_${1700000000000 + seq}`, author: "Charles" }; }

function setup(projectName = "招聘") {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-expcvhtml-"));
  const proj = store.createProject(ws, projectName, CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "流程" }, CTX);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "列表页" }, CTX);
  store.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="l">列表 {1+1}</div>; }`);
  return { ws, proj, pg, ab };
}

test("exportCanvasHtml：不落盘到项目目录——只回 { filename, buffer, mime }，文件名 = 项目名 + .html", () => {
  const { ws, proj } = setup();
  const before = fs.existsSync(path.join(ws, proj.id, ".export"));
  const out = buildCanvasExportHtml(ws, proj.id);
  assert.equal(before, false);
  assert.equal(fs.existsSync(path.join(ws, proj.id, ".export")), false, "导出过程不在项目目录留任何痕迹");
  assert.equal(out.filename, "招聘.html");
  assert.equal(out.mime, "text/html");
  assert.ok(Buffer.isBuffer(out.buffer) && out.buffer.length > 0);
});

test("exportCanvasHtml：画板 iframe 先留空（不是 srcdoc 属性），画板 HTML 连同 __PF_LIB__ 占位路径整体嵌成 JSON，库源码单独压缩嵌一份 JSON——画板自己的渲染（JSX + 浏览器端 Babel 编译）跟实时预览一致，只是库代码从哪儿来这一步变了", () => {
  const { ws, proj, ab } = setup();
  const out = buildCanvasExportHtml(ws, proj.id);
  const html = out.buffer.toString("utf8");

  assert.ok(!html.includes('<iframe src="pages/'), "不再引用目录树路径");
  assert.ok(!/class="pf-frame__box"><iframe[^>]*\bsrcdoc=/.test(html), "画板 iframe 标签本身不带 srcdoc，运行时才填");
  assert.ok(!/<script src="[^"]*\/(react\.production\.min\.js|react-dom\.production\.min\.js|babel\.min\.js|marked\.min\.js)">/.test(html), "不留任何指向真实文件的 <script src>");

  const artboardHtmlEl = html.match(/<script type="application\/json" id="pf-artboard-html">([\s\S]*?)<\/script>/);
  assert.ok(artboardHtmlEl, "画板 HTML 整体嵌成一份 JSON");
  const artboardHtmlMap = JSON.parse(artboardHtmlEl[1]);
  assert.ok(artboardHtmlMap[ab.id].includes("列表"), "画板正文内容在里面");
  assert.ok(artboardHtmlMap[ab.id].includes('src="__PF_LIB__/react.production.min.js"'), "画板 HTML 里库的引用是占位路径，不是内联源码，也不是真实相对路径");
  assert.ok(artboardHtmlMap[ab.id].includes('data-presets="env,react"'), "画板自己的 <script type=text/babel> 原样保留（JSON 编码，不用手动转义属性值）");

  const libsEl = html.match(/<script type="application\/json" id="pf-compressed-libs">([\s\S]*?)<\/script>/);
  assert.ok(libsEl, "压缩库源码整体嵌成一份 JSON");
  const libs = JSON.parse(libsEl[1]);
  for (const name of ["react.production.min.js", "react-dom.production.min.js", "babel.min.js", "marked.min.js"]) {
    assert.ok(libs[name] && libs[name].format && libs[name].base64, `${name} 应该在压缩库列表里，且带 format/base64`);
  }
  assert.ok(html.includes("__pfDecompressLibs"), "启动脚本里带了解压函数");
});

test("exportCanvasHtml：库源码只压缩内联一份，不会跟着画板数量重复——多加一块内容类似的画板，文件大小只多一点点，不是翻倍", () => {
  const { ws, proj, pg } = setup();
  const out1 = buildCanvasExportHtml(ws, proj.id);

  const ab2 = store.upsertArtboard(ws, proj.id, pg.id, { name: "列表页2" }, seqCtx());
  store.saveArtboardSource(ws, proj.id, ab2.id, `function Component(){ return <div id="l2">列表2 {2+2}</div>; }`);
  const out2 = buildCanvasExportHtml(ws, proj.id);

  // 每块画板除了正文，还各自带一份标注/尺寸上报/手势转发/取元素这几段脚本的样板代码（几 KB
  // 到十几 KB，跟去重与否无关，本来每份画板 HTML 都要有）——这里只验证"没有把 react/react-dom/
  // babel 这几个大件也复制了一份"：库源码压缩后大概几百 KB 到 1MB+，真复制一份的话增量会跳到
  // 那个量级；样板代码增量则是几万字节以内。
  const grew = out2.buffer.length - out1.buffer.length;
  assert.ok(grew < 50_000, `多一块内容差不多大的画板，体积增量应该是"每块画板自带的样板代码"这个量级（几万字节以内），实际多了 ${grew} 字节——如果库又被复制了一份，这里会跳到几十万甚至上百万字节`);
});

test("exportCanvasHtml：没用到 mermaid 时不内联 mermaid（省掉 3.5MB）；用到了才内联", () => {
  const { ws, proj, pg } = setup();
  const out = buildCanvasExportHtml(ws, proj.id);
  const libs1 = JSON.parse(out.buffer.toString("utf8").match(/id="pf-compressed-libs">([\s\S]*?)<\/script>/)[1]);
  assert.ok(!libs1["mermaid.min.js"], "没用到 mermaid 的项目，压缩库列表里不该有它");

  const ab2 = store.upsertArtboard(ws, proj.id, pg.id, { name: "图表页" }, seqCtx());
  store.saveArtboardSource(ws, proj.id, ab2.id, `function Component(){ return <div className="mermaid">graph TD; A-->B</div>; }`);
  const out2 = buildCanvasExportHtml(ws, proj.id);
  const libs2 = JSON.parse(out2.buffer.toString("utf8").match(/id="pf-compressed-libs">([\s\S]*?)<\/script>/)[1]);
  assert.ok(libs2["mermaid.min.js"], "用到 mermaid 的画板，压缩库列表里该有它");
});

test("exportCanvasHtml：无源码的画板不生成 srcdoc，画布外壳里显示空态", () => {
  const { ws, proj, pg } = setup();
  store.upsertArtboard(ws, proj.id, pg.id, { name: "空画板" }, seqCtx());
  const out = buildCanvasExportHtml(ws, proj.id);
  const html = out.buffer.toString("utf8");
  assert.ok(html.includes("尚无内容"));
});

test("exportCanvasHtml：runProjectExport('canvas/html') 走这条路由，返回 { filename, buffer, mime }", () => {
  const { ws, proj } = setup();
  const projectRoot = path.join(ws, proj.id);
  const routed = runProjectExport(projectRoot, "canvas/html");
  assert.equal(routed.filename, "招聘.html");
  assert.equal(routed.mime, "text/html");
  assert.ok(Buffer.isBuffer(routed.buffer));
});
