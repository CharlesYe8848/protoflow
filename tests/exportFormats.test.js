import { test } from "node:test";
import assert from "node:assert/strict";
import { CANVAS_EXPORT_MENU } from "../products/canvas/exportMenu.js";
import { DOC_EXPORT_MENU } from "../products/doc/exportMenu.js";
import { SHEET_EXPORT_MENU } from "../products/sheet/exportMenu.js";
import { PRODUCTS } from "../products/index.js";
import { parseExportPath } from "../core/exportService.js";

// 每个产品的「分享」菜单（exportMenu.js，页面模板用，纯数据）和导出格式（exports.js，导出服务用，
// 带 build 函数）是分开的两个文件，靠 id 对应——这个测试就是"漏了哪边直接报错"的安全网：菜单里
// 出现的每一行，注册表里必须真有一个可调用的 build 函数和 mime 接着，不能等用户点了菜单才发现 404。
const MENUS = { canvas: CANVAS_EXPORT_MENU, doc: DOC_EXPORT_MENU, sheet: SHEET_EXPORT_MENU };

test("每个产品的导出菜单行都有注册表里的 build 函数和 mime；不显示在菜单里的格式标了 hidden", () => {
  for (const [type, menu] of Object.entries(MENUS)) {
    const p = PRODUCTS.find((x) => x.type === type);
    assert.ok(p && p.exports, `${type} 没有导出格式`);
    const visible = p.exports.formats.filter((f) => !f.hidden).map((f) => f.id);
    assert.deepEqual(menu.map((f) => f.id), visible, `${type} 菜单和注册表的格式 id 不一致`);
    for (const f of p.exports.formats) {
      assert.equal(typeof f.build, "function", `${type}/${f.id} 缺 build 函数`);
      assert.ok(f.mime, `${type}/${f.id} 缺 mime`);
    }
    assert.ok(p.exports.formats.some((f) => f.id === p.exports.defaultFormat), `${type} 的缺省格式不存在`);
  }
});

test("导出路径按注册表解析：有 id 的产品是 <类型>/<id>/<格式>，没有 id 的是 <类型>/<格式>，格式可省", () => {
  const t = (s) => { const r = parseExportPath(s, PRODUCTS); return r && [r.product.type, r.id, r.formatId]; };
  assert.deepEqual(t("canvas/admin/html"), ["canvas", "admin", "html"]);
  assert.deepEqual(t("canvas/admin"), ["canvas", "admin", "zip"]);
  assert.deepEqual(t("doc/%E6%96%87%E6%A1%A3/docx"), ["doc", "文档", "docx"]);
  assert.deepEqual(t("doc/prd"), ["doc", "prd", "zip"]);
  assert.deepEqual(t("sheet/s"), ["sheet", "s", "xlsx"]);
  for (const bad of ["nope/x", "doc", "canvas", "canvas/a/b/c", "doc/a/b/c"]) assert.equal(parseExportPath(bad, PRODUCTS), null, bad);
});
