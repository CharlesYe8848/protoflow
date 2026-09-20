import test from "node:test";
import assert from "node:assert/strict";
import { renderDocPreviewHtml } from "../core/docPreview.js";

test("文档预览：宽表格限制在正文内，并保留横向滚动能力", () => {
  const html = renderDocPreviewHtml({
    versions: [{ n: 1, md: "# 数据埋点\n\n| 事件名 | 参数 |\n| --- | --- |\n| xinling_review_fill_success | typeValueKey=filled_count |", builtAt: "2026-09-20" }],
    head: 1,
    title: "埋点文档",
  });

  assert.match(html, /\.pf-table-scroll\{[^}]*max-width:100%[^}]*overflow-x:auto/);
  assert.match(html, /docEl\.querySelectorAll\("table"\)\.forEach/);
  assert.match(html, /wrap\.appendChild\(table\)/);
  assert.match(html, /wrap\.tabIndex = 0/);
  assert.match(html, /aria-label", "表格，可横向滚动"/);
});
