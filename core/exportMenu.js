// core/exportMenu.js — 导出菜单要展示的格式列表：纯数据，没有 build 函数、没有任何 import。
//
// 之所以单独拆一个零依赖的文件：core/canvas.js / core/docPreview.js 是"纯模板函数"（生成页面时
// 直接把这张表渲成菜单行），如果直接 import core/exportFormats.js（带 build 函数）会绕回
// core/store.js → core/canvas.js，形成循环依赖。这张表只留 id/label/hint，两边都能安全 import；
// 真正的 build 函数登记表在 exportFormats.js，用同一份 id 去接 build/mime（有测试断言两边 id
// 一一对应，不会出现"菜单里有这一行、点了却 404"）。
//
// 加新格式：这里加一项 { id, label, hint }，exportFormats.js 里补上同 id 的 build 函数——
// 菜单行、路由分发都自动跟上，不用碰 canvas.js/docPreview.js/localServer.js 任何一处。
export const EXPORT_MENU = {
  canvas: [
    { id: "zip", label: "项目 HTML", hint: "含全部页面与画板，.zip 压缩包" },
    { id: "html", label: "单页 HTML", hint: "全部内容内联为一个文件，双击即看" },
  ],
  doc: [
    { id: "docx", label: "Word", hint: ".docx 文档，可编辑，含正文、表格与图片" },
    { id: "html", label: "单页 HTML", hint: "全部内容内联为一个文件，双击即看" },
    { id: "markdown", label: "Markdown", hint: ".md + 图片文件夹，.zip 压缩包，通用性最好、便于导入其它文档" },
  ],
};
