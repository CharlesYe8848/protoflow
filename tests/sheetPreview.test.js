import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSheetPreviewHtml } from "../products/sheet/sheetPreview.js";

// 抽出内嵌 <script> 的正文，用 new Function() 只做语法检查（不执行——里面用了 DOM API，
// Node 里跑不起来）。appScript() 是拼在 core/sheetPreview.js 源码里的模板字符串，字符串内部的
// 正则字面量必须把反斜杠写成两个（\\[ 而不是 \[），否则外层模板字符串自己的转义规则会先吃掉一个
// 反斜杠——这类 bug 之前真实发生过一次（IMAGE_CELL_RE 忘了双写反斜杠，导致整个内嵌脚本在浏览器
// 里直接语法错误、页面整个不渲染），而且是 `node --check core/sheetPreview.js` 测不出来的——那只
// 检查外层 .js 文件语法，模板字符串内容对 Node 来说只是普通字符串数据。这个测试就是专门堵这个坑。
function extractInlineScript(html) {
  const start = html.indexOf("(function(){");
  const end = html.indexOf("<\/script>", start);
  return html.slice(start, end);
}

test("renderSheetPreviewHtml：内嵌的客户端脚本必须是语法合法的 JS（模板字符串里的正则反斜杠转义是最容易出错的地方）", () => {
  const html = renderSheetPreviewHtml({
    versions: [{ n: 1, content: { title: "t", sheets: [{ name: "A", rows: [["a"]] }] }, note: "首版", builtAt: "2026-09-20" }],
    head: 1,
    title: "语法检查用表格",
  });
  const script = extractInlineScript(html);
  assert.ok(script.includes("IMAGE_CELL_RE"), "确认真的抽到了包含图片正则那一段脚本，不是抽空了");
  assert.doesNotThrow(() => new Function(script), "内嵌脚本必须能被 JS 引擎正常解析");
});

test("renderSheetPreviewHtml：图片单元格渲染成 <img>，src 按当前版本号拼 versions/<n>/assets/ 路径", () => {
  const html = renderSheetPreviewHtml({
    versions: [{ n: 3, content: { title: "t", sheets: [{ name: "A", rows: [["![截图](assets/a.png)"]] }] }, note: "v3", builtAt: "2026-09-20" }],
    head: 3,
    title: "图片单元格",
  });
  assert.match(html, /className = "pf-cell-img"/);
  assert.match(html, /classList\.add\("pf-image-cell"\)/);
  assert.match(html, /"versions\/" \+ versionN \+ "\/assets\/"/);
  assert.ok(html.includes("lockGridColumnsWhenImagesReady") && html.includes("pf-grid--columns-locked"), "图片加载完成后才锁定列宽，并把图片约束在单元格内");
});

test("renderSheetPreviewHtml：本地表格选区右键提供可扩展的标注菜单，并把精确上下文复制给 agent", () => {
  const html = renderSheetPreviewHtml({
    sheetId: "sales",
    versions: [{ n: 2, content: { title: "销售数据", sheets: [{
      name: "明细", rows: [["姓名", "销售额"], ["张三", 120000]],
      styles: { rows: { "0": "font-weight:600" } },
    }] }, note: "第二版", builtAt: "2026-09-20" }],
    head: 2,
    title: "销售数据",
  });
  assert.match(html, /var __PF_SHEET_ID__ = "sales"/);
  assert.ok(html.includes('[{ id: "annotate", label: "标注"'), "右键项由 actions 数组生成，后续可追加菜单项");
  assert.ok(html.includes('document.addEventListener("contextmenu"') && html.includes("rectInsideSelection"), "右键当前选区保留范围，右键选区外会切换选区");
  for (const field of ["source", "previewVersion", "worksheet", "range", "coordinates", "values", "styles", "merges"]) {
    assert.ok(html.includes(field), `复制上下文包含 ${field}`);
  }
  assert.ok(html.includes("window.__pfSheet = { selection: null, zoom: 1 }") && html.includes("syncPublicSelection"), "本地自动化也能从 window.__pfSheet 读取结构化选区与缩放状态");
  assert.ok(html.includes("复制给 agent") && html.includes("补充希望本地 agent 如何调整这片数据"), "标注面板允许用户补充调整要求后复制");
  assert.ok(html.includes('ae.tagName === "TEXTAREA"'), "在标注输入框里复制文字时不能被表格选区复制逻辑抢走");
  assert.ok(html.includes('e.key.toLowerCase() === "a"') && html.includes('selectionMode = "all"') && html.includes("e.preventDefault()"), "表格已有选区时 Ctrl/Cmd+A 应接管为整张工作表全选");
  assert.ok(html.includes("pf-sheet-zoom__label") && html.includes('wrap.addEventListener("wheel"') && html.includes('wrap.addEventListener("gesturechange"'), "表格提供缩放菜单和触控板捏合缩放");
  assert.ok(html.includes('if (!(e.ctrlKey || e.metaKey)) return'), "普通滚轮必须继续用于表格滚动，只接管捏合手势");
  assert.ok(html.includes("pf-sheet-bottom") && html.includes("lockGridColumns"), "缩放位于工作表底栏，并在缩放前锁定列宽避免重新排版");
  assert.ok(html.includes("zoomFromTopLeft") && html.includes('zoomAt(e.clientX, e.clientY'), "按钮缩放固定表格左上角，手势缩放仍以指针为中心");
});

test("renderSheetPreviewHtml：导出页不提供本地 agent 标注入口", () => {
  const html = renderSheetPreviewHtml({
    standalone: true,
    sheetId: "即使误传也必须禁用",
    versions: [{ n: 1, content: { sheets: [{ name: "A", rows: [["x"]] }] } }],
    head: 1,
  });
  assert.match(html, /var __PF_SHEET_ID__ = ""/);
  assert.ok(html.includes('if (SHEET_ID) document.addEventListener("contextmenu"'), "没有本地 sheetId 时不接管浏览器右键");
});
