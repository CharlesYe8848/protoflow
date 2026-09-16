import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPORT_MENU } from "../core/exportMenu.js";
import { EXPORT_TARGETS } from "../core/exportFormats.js";

// core/exportMenu.js（画布/文档页面渲染菜单用，零依赖）和 core/exportFormats.js（路由分发用，
// 每项补上 build 函数）是两张分开维护的表，靠 id 对应——这个测试就是那道"漏了哪边直接报错"的
// 安全网：菜单里出现的每一行，路由那边必须真有一个可调用的 build 函数接着，不能等用户点了菜单
// 才发现 404。
test("EXPORT_MENU 和 EXPORT_TARGETS 的 target/format id 完全对应，每个 format 都有可调用的 build 函数和 mime", () => {
  assert.deepEqual(Object.keys(EXPORT_MENU).sort(), Object.keys(EXPORT_TARGETS).sort());
  for (const target of Object.keys(EXPORT_MENU)) {
    const menuIds = EXPORT_MENU[target].map((f) => f.id).sort();
    const routedIds = EXPORT_TARGETS[target].formats.map((f) => f.id).sort();
    assert.deepEqual(menuIds, routedIds, `target=${target} 菜单和路由的格式 id 不一致`);
    for (const f of EXPORT_TARGETS[target].formats) {
      assert.equal(typeof f.build, "function", `target=${target} format=${f.id} 缺 build 函数`);
      assert.ok(f.mime, `target=${target} format=${f.id} 缺 mime`);
    }
  }
});
