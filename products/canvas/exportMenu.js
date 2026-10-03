// products/canvas/exportMenu.js — 画布「分享」菜单里的导出格式：纯数据，没有 build 函数。
// 单独一个文件是为了让页面模板（./canvas.js）能直接用，又不绕回导出函数（./exports.js →
// ./exportCanvas.js → ./store.js → ./canvas.js 会成环）。./exports.js 用同一份 id 接上 build 函数。
export const CANVAS_EXPORT_MENU = [
  { id: "zip", label: "项目 HTML", hint: "含全部页面与画板，.zip 压缩包" },
  { id: "html", label: "单页 HTML", hint: "全部内容内联为一个文件，双击即看" },
];
