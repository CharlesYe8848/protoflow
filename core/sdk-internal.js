// core/sdk-internal.js — 产品插件的过渡接口（"protoflow/sdk/internal"），docs/product-architecture.md §4.11。
//
// 现有产品还在用、但还没定型到能进稳定接口（core/sdk.js）的框架能力。不承诺兼容，只减不增：
// 每一项标着去向，清掉一项就删一项；各产品用了多少在 tests/boundaries.test.js 里按产品记着，
// 新增要改那张表。新产品（从幻灯片起）不准用这里的任何东西。
//
// 去向：提升 = 定型后挪进 sdk.js；收回 = 挪回用它的产品内部；删除 = 换成别的方式后去掉。

// 单 HTML 导出把依赖库压缩内联、页面里再解压。去向：提升——等"单 HTML 导出"做成一个通用的
// 导出零件（产品只给页面和库清单），这几个底层函数就不用再露出来。
export { compressLibSources, decompressLibsScript, injectArtboardLibsScript, PLACEHOLDER_LIB_PATH } from "./libCodec.js";

// 素材文件 → data: URL 表（画布内联素材用）。去向：提升——并进 sdk.js 的 versionAssetsDataMap，
// 统一成"一组文件 → data: URL 表"。
export { assetsDataMap } from "./ui.js";
