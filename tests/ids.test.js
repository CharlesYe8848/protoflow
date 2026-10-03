import { test } from "node:test";
import assert from "node:assert/strict";
import { newId, assertSafeSegment, isValidEntityId } from "../core/ids.js";

test("newId 用注入时钟生成 前缀_毫秒", () => {
  assert.equal(newId("ab", () => 1700000000000), "ab_1700000000000");
});

test("assertSafeSegment 拒绝路径穿越与非法字符", () => {
  assert.doesNotThrow(() => assertSafeSegment("proj_123"));
  for (const bad of ["../x", "a/b", "a\\b", "", "a b", ".hidden"]) {
    assert.throws(() => assertSafeSegment(bad), /不合法/, bad);
  }
});

test("isValidEntityId：允许中文 slug（跟项目/页面目录名一个策略），挡形状问题与路径穿越", () => {
  for (const ok of ["prd", "推荐候选人卡片与通用详情侧栏", "card-style", "release-note", "a1"]) {
    assert.ok(isValidEntityId(ok), ok);
  }
  for (const bad of ["", "..", ".", ".hidden", "-x", "x-", "a--b", "a/b", "a\\b", "a b", "x".repeat(201)]) {
    assert.ok(!isValidEntityId(bad), bad);
  }
});
