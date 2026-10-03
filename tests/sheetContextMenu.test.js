import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { launch } from "puppeteer-core";
import { renderSheetPreviewHtml } from "../products/sheet/sheetPreview.js";
import { resolveBrowserExecutable } from "../skills/protoflow-product-dev/scripts/lib/headlessBrowser.js";

const rows = [
  ["姓名", "部门", "销售额", "状态"],
  ["张三", "华东", 120000, "完成"],
  ["李四", "华北", 98000, "跟进"],
  ["王五", "华南", 135000, "完成"],
];
const SELECT_ALL_MODIFIER = process.platform === "darwin" ? "Meta" : "Control";

function localHtml() {
  return renderSheetPreviewHtml({
    sheetId: "sales", title: "销售数据", head: 2,
    versions: [
      { n: 1, note: "首版", content: { sheets: [{ name: "销售明细", rows }] } },
      { n: 2, note: "更新状态", content: { sheets: [
        { name: "销售明细", rows, styles: { rows: { "0": "font-weight:600" }, columns: { "2": "text-align:right" } } },
        { name: "合并示例", rows: [["合并", "", "C"], ["", "", "F"], ["G", "H", "I"]], merges: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }] },
      ] } },
    ],
  });
}

function standaloneHtml() {
  return renderSheetPreviewHtml({
    standalone: true, sheetId: "must-still-be-disabled", head: 1,
    versions: [{ n: 1, content: { sheets: [{ name: "A", rows: [["x"]] }] } }],
  });
}

test("表格选区右键标注：真实浏览器里保留/切换选区、复制 agent 上下文，并兼容行列/合并/版本/导出", { timeout: 30000 }, async () => {
  const server = http.createServer((req, res) => {
    if (req.url.endsWith(".js")) {
      res.setHeader("Content-Type", "application/javascript");
      res.end("window.InlineStyleParser=function(){return []}");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(req.url.startsWith("/standalone") ? standaloneHtml() : localHtml());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await launch({ executablePath: (await resolveBrowserExecutable()).path, headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 700 });
    await page.goto(`http://127.0.0.1:${server.address().port}/p/demo/sheets/sales/preview.html`);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
      configurable: true, value: { writeText: async (text) => { window.__copied = text; } },
    }));

    const center = (selector) => page.$eval(selector, (el) => {
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const cell = (r, c) => `[data-r="${r}"][data-c="${c}"]`;

    // 百分比菜单可缩放；触控板捏合（Ctrl/Cmd+wheel）被接管，普通滚轮仍交给表格滚动。
    assert.equal(await page.$eval(".pf-sheet-zoom__label", (el) => el.textContent), "100%");
    assert.equal(await page.$eval(".pf-sheet-bottom", (el) => el.lastElementChild.classList.contains("pf-sheet-zoom")), true, "缩放控件位于工作表底栏最右侧");
    const initialWidths = await page.$$eval(".pf-grid thead th", (els) => els.map((el) => el.getBoundingClientRect().width));
    await page.click(".pf-sheet-zoom__label");
    await page.click(".pf-sheet-zoom__in");
    assert.deepEqual(await page.evaluate(() => ({ zoom: window.__pfSheet.zoom, css: document.querySelector(".pf-grid").style.zoom })), { zoom: 1.2, css: "1.2" });
    assert.deepEqual(await page.$eval("#pfSheetWrap", (el) => ({ left: el.scrollLeft, top: el.scrollTop })), { left: 0, top: 0 }, "底部按钮放大时 A/1 不应自动漂出视口");
    const scaledWidths = await page.$$eval(".pf-grid thead th", (els) => els.map((el) => el.getBoundingClientRect().width));
    scaledWidths.forEach((width, i) => assert.ok(Math.abs(width / initialWidths[i] - 1.2) < 0.02, `第 ${i + 1} 列应等比缩放，不重新分配列宽`));
    const wheelResult = await page.$eval("#pfSheetWrap", (el) => {
      const before = window.__pfSheet.zoom;
      const ordinary = new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true });
      el.dispatchEvent(ordinary);
      const afterOrdinary = window.__pfSheet.zoom;
      const pinch = new WheelEvent("wheel", { deltaY: -10, ctrlKey: true, bubbles: true, cancelable: true, clientX: 300, clientY: 220 });
      el.dispatchEvent(pinch);
      return { before, ordinaryPrevented: ordinary.defaultPrevented, afterOrdinary, pinchPrevented: pinch.defaultPrevented, afterPinch: window.__pfSheet.zoom };
    });
    assert.equal(wheelResult.ordinaryPrevented, false);
    assert.equal(wheelResult.afterOrdinary, wheelResult.before);
    assert.equal(wheelResult.pinchPrevented, true);
    assert.ok(wheelResult.afterPinch > wheelResult.before);
    await page.click(".pf-sheet-zoom__label");
    await page.click(".pf-sheet-zoom__reset");
    assert.equal(await page.evaluate(() => window.__pfSheet.zoom), 1);

    // B2:C3 拖选；选区内右键保持原范围。
    const a = await center(cell(1, 1)); const b = await center(cell(2, 2));
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__pfSheet.selection.range), "B2:C3");
    await page.mouse.click(b.x, b.y, { button: "right" });
    assert.equal(await page.evaluate(() => window.__pfSheet.selection.range), "B2:C3");
    assert.equal(await page.$eval(".pf-context", (el) => el.hidden), false);

    // Escape 关闭菜单，并把键盘焦点还给触发菜单的格子。
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-r") + ":" + document.activeElement?.getAttribute("data-c")), "2:2");
    await page.mouse.click(b.x, b.y, { button: "right" });
    await page.click('[data-action="annotate"]');
    await page.type(".pf-note__input", "把低于 10 万的销售额标为重点跟进");
    const inputPrevented = await page.$eval(".pf-note__input", (el) => {
      el.focus();
      const event = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true });
      el.dispatchEvent(event); return event.defaultPrevented;
    });
    assert.equal(inputPrevented, false, "输入框 Ctrl/Cmd+A 不被表格快捷键接管");
    assert.equal(await page.evaluate(() => window.__pfSheet.selection.range), "B2:C3", "输入框 Ctrl+A 不改变表格选区");
    await page.click(".pf-note__copy");
    const copied = await page.evaluate(() => window.__copied);
    for (const expected of [
      "把低于 10 万", "source: sheets/sales/sheet.json", "worksheet: 销售明细",
      "version: v2 (head)", "kind: sheet", "[Protoflow 标注]", "selection: B2:C3 (range)", "coordinates0Based",
      "120000", "98000", "relatedStyles",
    ]) assert.ok(copied.includes(expected), `复制上下文缺少 ${expected}`);

    // 选区外右键切换为目标单格；列、行、全选都公开正确 mode/range。
    const d4 = await center(cell(3, 3)); await page.mouse.click(d4.x, d4.y, { button: "right" });
    assert.deepEqual(await page.evaluate(() => ({ range: window.__pfSheet.selection.range, mode: window.__pfSheet.selection.mode })), { range: "D4", mode: "cell" });
    await page.click('[data-col-select="2"]');
    assert.deepEqual(await page.evaluate(() => ({ range: window.__pfSheet.selection.range, mode: window.__pfSheet.selection.mode })), { range: "C1:C4", mode: "column" });
    await page.click('[data-row-select="1"]');
    assert.deepEqual(await page.evaluate(() => ({ range: window.__pfSheet.selection.range, mode: window.__pfSheet.selection.mode })), { range: "A2:D2", mode: "row" });
    await page.keyboard.down(SELECT_ALL_MODIFIER); await page.keyboard.press("a"); await page.keyboard.up(SELECT_ALL_MODIFIER);
    assert.deepEqual(await page.evaluate(() => ({ range: window.__pfSheet.selection.range, mode: window.__pfSheet.selection.mode, nativeText: window.getSelection().toString() })), { range: "A1:D4", mode: "all", nativeText: "" });

    // 切工作表后选中一个合并格，公开的范围扩展到整个合并区域。
    await page.$$eval(".pf-sheet-tab", (tabs) => tabs.find((x) => x.textContent === "合并示例").click());
    await page.click(cell(0, 0));
    assert.deepEqual(await page.evaluate(() => ({ worksheet: window.__pfSheet.selection.worksheet, range: window.__pfSheet.selection.range })), { worksheet: "合并示例", range: "A1:B2" });

    // 切历史版本后，复制上下文明确标成 historical。
    await page.click(".pf-vsel-btn");
    await page.$$eval(".pf-vsel-item", (items) => items.find((x) => x.textContent.includes("首版")).click());
    await page.click(cell(0, 0));
    assert.equal(await page.evaluate(() => window.__pfSheet.selection.previewVersion), 1);
    await page.mouse.click((await center(cell(0, 0))).x, (await center(cell(0, 0))).y, { button: "right" });
    await page.click('[data-action="annotate"]'); await page.click(".pf-note__copy");
    assert.ok((await page.evaluate(() => window.__copied)).includes("version: v1 (historical)"));

    // 独立导出即使调用者误传 sheetId，也不接管原生右键。
    await page.goto(`http://127.0.0.1:${server.address().port}/standalone`);
    const prevented = await page.$eval(cell(0, 0), (el) => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); el.dispatchEvent(event); return event.defaultPrevented;
    });
    assert.equal(prevented, false);
    assert.equal(await page.$(".pf-context"), null);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
