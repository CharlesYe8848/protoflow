// ⌘/Ctrl+A 在各产品页面上只选当前视图里的内容，不让浏览器把整页的界面文字（标题、侧边栏、按钮、
// 页面标签）一起选上；正在输入框里打字时保留原生全选。绘图选中当前页全部节点，文档选中正文，表格选中
// 整张工作表，画布把当前页的画板放进元素引用。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { launch } from "puppeteer-core";
import { renderDiagramPreviewHtml } from "../products/diagram/preview.js";
import { diagramLibs } from "../products/diagram/libs.js";
import { renderDocPreviewHtml } from "../products/doc/docPreview.js";
import { DOC_LIBS } from "../products/doc/libs.js";
import { renderSheetPreviewHtml } from "../products/sheet/sheetPreview.js";
import { buildCanvasHtml } from "../products/canvas/canvas.js";
import { buildPreviewHtml } from "../products/canvas/preview.js";
import { copyLibs } from "../core/libs.js";
import { CANVAS_LIBS, PREVIEW_LIB_FILES } from "../products/canvas/libs.js";
import { resolveBrowserExecutable } from "../skills/protoflow-product-dev/scripts/lib/headlessBrowser.js";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const selectAll = async (p) => { await p.keyboard.down(MOD); await p.keyboard.press("a"); await p.keyboard.up(MOD); };
const nativeText = (p) => p.evaluate(() => String(window.getSelection()));

async function serve(routes, fn) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    for (const [re, handler] of routes) {
      const m = re.exec(url);
      if (m) { const [type, body] = handler(m); res.setHeader("Content-Type", type); res.end(body); return; }
    }
    res.statusCode = 404; res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await launch({ executablePath: (await resolveBrowserExecutable()).path, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const p = await browser.newPage();
    await p.setViewport({ width: 1200, height: 760 });
    await fn(p, `http://127.0.0.1:${server.address().port}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
const js = (table) => [/^\/lib\/(.+)$/, (m) => ["application/javascript", table[m[1]] ? fs.readFileSync(table[m[1]]()) : ""]];

test("⌘A · 绘图：选中当前页全部节点；源码视图只选源码", { timeout: 30000 }, async () => {
  const pages = [{ id: "f", name: "流程", file: "f.mmd", kind: "mermaid", source: "flowchart LR\n  a[开始] --> b[结束]\n" }];
  const html = renderDiagramPreviewHtml({ versions: [{ n: 1, pages }], head: 1, title: "绘图标题", diagramId: "d", libRelPath: "/lib" });
  await serve([js(diagramLibs()), [/preview\.html$/, () => ["text/html; charset=utf-8", html]]], async (p, base) => {
    await p.goto(`${base}/p/demo/diagrams/d/preview.html`);
    await p.waitForFunction(() => window.__pfDiagram && window.__pfDiagram.ready);
    await selectAll(p);
    assert.deepEqual((await p.evaluate(() => window.__pfDiagram.selection.map((i) => i.label))).sort(), ["a → b", "开始", "结束"].sort());
    assert.equal(await nativeText(p), "", "界面文字不跟着选上");
    await p.click('.pf-toggle-btn[data-view="source"]');
    await selectAll(p);
    const text = await nativeText(p);
    assert.ok(text.includes("a[开始] --> b[结束]") && !text.includes("绘图标题"), text);
  });
});

test("⌘A · 文档：只选正文，不选顶栏和目录", { timeout: 30000 }, async () => {
  const md = "# 文档主题\n\n## 第一节\n\n正文第一段。\n\n## 第二节\n\n正文第二段。\n";
  const html = renderDocPreviewHtml({ versions: [{ n: 1, md, note: "首版" }], head: 1, title: "顶栏标题", libRelPath: "/lib" });
  await serve([js(DOC_LIBS), [/preview\.html$/, () => ["text/html; charset=utf-8", html]]], async (p, base) => {
    await p.goto(`${base}/p/demo/docs/x/preview.html`);
    await p.waitForFunction(() => document.querySelector("#doc h2"));
    await selectAll(p);
    const text = await nativeText(p);
    assert.ok(text.includes("正文第一段") && text.includes("正文第二段"), text);
    assert.ok(!text.includes("顶栏标题") && !text.includes("首版"), "顶栏的标题和版本说明不在选区里");
  });
});

test("⌘A · 表格：没有选区时也选中整张工作表", { timeout: 30000 }, async () => {
  const html = renderSheetPreviewHtml({ sheetId: "s", title: "销售", head: 1, versions: [{ n: 1, content: { sheets: [{ name: "明细", rows: [["a", "b"], ["c", "d"]] }] } }] });
  await serve([[/\.js$/, () => ["application/javascript", "window.InlineStyleParser=function(){return []}"]], [/preview\.html$/, () => ["text/html; charset=utf-8", html]]], async (p, base) => {
    await p.goto(`${base}/p/demo/sheets/s/preview.html`);
    await p.waitForSelector("[data-r]");
    await selectAll(p);
    assert.deepEqual(await p.evaluate(() => [window.__pfSheet.selection.range, window.__pfSheet.selection.mode]), ["A1:B2", "all"]);
    assert.equal(await nativeText(p), "");
  });
});

test("⌘A · 画布：当前页的画板放进元素引用，不选界面文字；焦点在画板里也一样，不重复放", { timeout: 40000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-canvas-selectall-"));
  let browser, server;
  try {
    copyLibs(path.join(dir, "lib"), CANVAS_LIBS, PREVIEW_LIB_FILES);
    const pages = [
      { id: "pg_a", name: "首页", artboards: [
        { id: "ab_1", name: "列表", hasSource: true, canvasWidth: 400 },
        { id: "ab_2", name: "详情", hasSource: true, canvasWidth: 400 },
      ] },
      { id: "pg_b", name: "其他", artboards: [{ id: "ab_3", name: "设置", hasSource: true, canvasWidth: 400 }] },
    ];
    for (const pg of pages) for (const ab of pg.artboards) {
      const d = path.join(dir, "pages", pg.id, "artboards", ab.id);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "preview.html"), buildPreviewHtml({
        artboardId: ab.id, libRelPath: "../../../../lib",
        source: `function Component(){ return <div id="box_${ab.id}"><h3>${ab.name}</h3><input id="field_${ab.id}" /></div>; }`,
      }));
    }
    fs.writeFileSync(path.join(dir, "canvas.html"), buildCanvasHtml({ projectName: "选择", pages }));
    // 画布读画板 iframe 的内容要求同源（实际由本地预览服务提供）；file:// 下每个文件是不同的源，所以起个静态服务。
    server = http.createServer((req, res) => {
      const file = path.join(dir, decodeURIComponent(req.url.split("?")[0]));
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return; }
      res.setHeader("Content-Type", file.endsWith(".html") ? "text/html; charset=utf-8" : "application/javascript");
      res.end(fs.readFileSync(file));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    browser = await launch({ executablePath: (await resolveBrowserExecutable()).path, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 800 });
    await p.goto(`http://127.0.0.1:${server.address().port}/canvas.html`);
    const frames = () => p.frames().filter((f) => /ab_[12]\/preview\.html$/.test(f.url()));
    await p.waitForFunction(() => document.querySelectorAll('.pf-page-canvas:not([hidden]) .pf-frame[data-artboard] iframe').length === 2);
    for (const f of frames()) await f.waitForSelector("h3");

    await p.mouse.click(5, 790); // 焦点放在画布页上
    await selectAll(p);
    const picked = () => p.evaluate(() => window.__pfCanvas.selections.map((s) => s.artboardId).sort());
    assert.deepEqual(await picked(), ["ab_1", "ab_2"], "只放当前页的画板");
    assert.equal(await p.$eval(".pf-mode-select", (b) => b.classList.contains("pf-mode-active")), true, "切到了选择模式");
    assert.equal(await nativeText(p), "", "界面文字不跟着选上");

    // 焦点在画板里按 ⌘A：转发给画布，已经放进去的不重复放
    const f1 = frames().find((f) => f.url().includes("ab_1"));
    await p.evaluate(() => document.querySelector('.pf-frame[data-artboard="ab_1"] iframe').focus());
    await f1.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
    await selectAll(p);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(await picked(), ["ab_1", "ab_2"]);
    assert.equal(await f1.evaluate(() => String(window.getSelection())), "", "画板里的文字也不被原生全选");

    // 画板里的输入框正在打字：原生全选，只选打的字
    await p.click(".pf-mode-interact");
    await f1.type(`#field_ab_1`, "输入的字");
    // （无头浏览器按 ⌘A 不会真的执行原生全选，这里检查我们没有拦下这次按键）
    const prevented = await f1.$eval("#field_ab_1", (el) => {
      el.focus();
      const ev = new KeyboardEvent("keydown", { key: "a", metaKey: true, ctrlKey: true, bubbles: true, cancelable: true });
      el.dispatchEvent(ev); return ev.defaultPrevented;
    });
    assert.equal(prevented, false);
    assert.deepEqual(await picked(), ["ab_1", "ab_2"], "输入框里按 ⌘A 不会再放画板");
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
