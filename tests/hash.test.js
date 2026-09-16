import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeContent, contentHash, stableStringify } from "../core/hash.js";

test("normalizeContent 统一换行并去每行尾随空白", () => {
  assert.equal(normalizeContent("a  \r\nb\t\r\n"), "a\nb\n");
  assert.equal(normalizeContent("a\nb"), "a\nb\n");
});

test("contentHash 对规范化后内容取 sha256 前16位，换行差异不影响指纹", () => {
  const h1 = contentHash("const x = 1;\r\n");
  const h2 = contentHash("const x = 1;  \n");
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{16}$/);
});

test("contentHash 不同内容不同指纹", () => {
  assert.notEqual(contentHash("a"), contentHash("b"));
});

test("stableStringify 键序无关，产生确定性字符串", () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
});
