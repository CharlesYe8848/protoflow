// 渲染确定性：同一路径、同样的源文件，渲染两次结果必须完全相同。页面实时刷新（core/liveReload.js）
// 靠比较渲染结果的 hash 判断要不要刷新——有人往 HTML 里写时间戳、随机 id，项目里任何一次文件变化
// 都会让所有开着的页面刷新。这条约定对导出、发布比对也有价值，拆掉实时刷新时这个测试保留。
//
// 覆盖面按产品注册表走：每个带 render() 的产品在示例项目里都必须至少有一个页面，新加的产品没补
// 示例会直接失败，提醒补上。页面里嵌的 iframe（画布的画板）一并检查。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { PRODUCTS, renderProjectView } from "../products/index.js";
import { createSheet, buildSheet } from "../products/sheet/sheet.js";
import * as sheetStore from "../products/sheet/store.js";
import { createDiagram, buildDiagram } from "../products/diagram/diagram.js";
import { createDeck, buildDeck } from "../products/deck/deck.js";

const EXAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples", "checkout");
const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1700000000000` };

// 示例项目没有表格、绘图、幻灯片：复制一份，各补一个定过版的（幻灯片里嵌那张表格）。
async function fixture() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-determinism-"));
  const pid = "checkout";
  fs.cpSync(EXAMPLE, path.join(ws, pid), { recursive: true });
  createSheet(ws, pid, { sheetId: "matrix" }, CTX);
  fs.writeFileSync(path.join(sheetStore.sheetDir(ws, pid, "matrix"), "sheet.json"),
    JSON.stringify({ schemaVersion: 1, title: "权限矩阵", sheets: [{ name: "汇总", rows: [["角色", "权限"], ["管理员", "全部"]] }] }));
  await buildSheet(ws, pid, "matrix", { note: "v1" }, CTX);
  const d = createDiagram(ws, pid, { diagramId: "flow", title: "结账梳理" }, CTX);
  fs.writeFileSync(path.join(d.pagesDir, "mind.md"), "# 结账\n\n## 支付方式\n- 微信\n- 支付宝\n");
  fs.writeFileSync(path.join(d.pagesDir, "pay.mmd"), "flowchart TD\n  cart[购物车] --> pay{选支付方式}\n  pay --> done[完成]\n");
  await buildDiagram(ws, pid, "flow", { note: "v1" }, CTX);
  createDeck(ws, pid, { deckId: "pitch", title: "结账改版" }, CTX);
  fs.writeFileSync(path.join(ws, pid, "decks", "pitch", "slides", "02-权限.html"),
    '<section data-layout="content"><h2>权限</h2><pf-embed ref="sheet:matrix#汇总"></pf-embed><div class="mermaid">flowchart LR\n  A-->B</div></section>');
  buildDeck(ws, pid, "pitch", { note: "v1" }, CTX);
  return { ws, pid, root: path.join(ws, pid) };
}

// 页面里 <iframe src="相对路径"> 引用的同项目页面（画布的画板）。
function framePaths(relPath, html) {
  const dir = path.posix.dirname(relPath);
  return [...String(html).matchAll(/<iframe[^>]*\ssrc="([^"]+)"/g)]
    .map((m) => m[1].replace(/&amp;/g, "&"))
    .filter((src) => !/^[a-z]+:|^\//i.test(src))
    .map((src) => path.posix.normalize(path.posix.join(dir, src)));
}

test("渲染确定性：每个产品的页面（含嵌入的画板）渲染两次结果完全相同", async () => {
  const { ws, pid, root } = await fixture();
  for (const product of PRODUCTS.filter((p) => p.render)) {
    const pages = (product.nav ? product.nav(ws, pid) : []).map((e) => e.href).filter(Boolean).map(decodeURIComponent);
    assert.ok(pages.length, `示例项目里没有「${product.label}」的页面，给 tests/renderDeterminism.test.js 的 fixture 补一个`);
    for (const rel of pages) {
      const first = renderProjectView(root, rel);
      assert.ok(first, `${rel} 应该能渲染`);
      assert.equal(renderProjectView(root, rel), first, `${rel} 两次渲染结果不同`);
      for (const frame of framePaths(rel, first)) {
        const a = renderProjectView(root, frame);
        assert.ok(a, `${frame} 应该能渲染`);
        assert.equal(renderProjectView(root, frame), a, `${frame} 两次渲染结果不同`);
      }
    }
  }
});
