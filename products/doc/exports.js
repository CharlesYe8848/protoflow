// products/doc/exports.js — 文档的导出格式：菜单数据（./exportMenu.js）+ build 函数 + mime。
// zip（目录树）不在菜单里，但老的阅读页、export_doc 的缺省格式还在用，保留成不显示的格式。
import { DOC_EXPORT_MENU } from "./exportMenu.js";
import { buildDocExportZip } from "./exportDoc.js";
import { buildDocExportWord } from "./exportDocWord.js";
import { buildDocExportHtml } from "./exportDocHtml.js";
import { buildDocExportMarkdown } from "./exportDocMarkdown.js";

const BUILD = {
  docx: { build: buildDocExportWord, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  html: { build: buildDocExportHtml, mime: "text/html" },
  markdown: { build: buildDocExportMarkdown, mime: "application/zip" },
};
export const DOC_EXPORTS = [
  ...DOC_EXPORT_MENU.map((f) => ({ ...f, ...BUILD[f.id] })),
  { id: "zip", label: "目录树", hint: "preview.html + lib/ + assets/", hidden: true, build: buildDocExportZip, mime: "application/zip" },
];
