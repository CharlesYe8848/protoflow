// core/exportFormats.js — 导出格式的路由登记表：core/exportService.js 只管按 <target>/<formatId>
// 查这张表分发，不用为每个格式各写一个 if 分支。id/label/hint 来自 core/exportMenu.js（画布/
// 文档页面生成菜单也读那张表）；这里补上 build 函数和 mime，两张表用同一个 id 接起来。
//
// 加新格式：exportMenu.js 里加一项 { id, label, hint }，下面 BUILDERS/MIME 补上同 id 的条目——
// 三处都改完，路由和菜单自动一起生效。tests/exportMenu.test.js 断言两张表 id 完全对应，漏了哪边
// 会直接报错，不会等到点了菜单才发现 404。
import { EXPORT_MENU } from "./exportMenu.js";
import { buildCanvasExportZip } from "./exportCanvas.js";
import { buildCanvasExportHtml } from "./exportCanvasHtml.js";
import { buildDocExportWord } from "./exportDocWord.js";
import { buildDocExportHtml } from "./exportDocHtml.js";
import { buildDocExportMarkdown } from "./exportDocMarkdown.js";

const BUILDERS = {
  canvas: { zip: buildCanvasExportZip, html: buildCanvasExportHtml },
  doc: { docx: buildDocExportWord, html: buildDocExportHtml, markdown: buildDocExportMarkdown },
};
const MIME = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip: "application/zip", html: "text/html", markdown: "application/zip" };

export const EXPORT_TARGETS = Object.fromEntries(
  Object.entries(EXPORT_MENU).map(([target, formats]) => [
    target,
    {
      formats: formats.map((f) => ({
        ...f,
        mime: MIME[f.id],
        build: BUILDERS[target] && BUILDERS[target][f.id],
      })),
    },
  ]),
);
