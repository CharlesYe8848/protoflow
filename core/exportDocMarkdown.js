// core/exportDocMarkdown.js — 把一篇文档的当前（head）版本导出成一份纯 Markdown 文件（下载，不落
// 项目盘）。跟 core/exportDocHtml.js 共用同一套"图片内联"手法（core/preview.js 的
// readAssetsMap，把 ](assets/x) 换成 data URI）——导出的是单个 .md 文件，脱离 assets/ 目录也能看图，
// 不用像 zip 导出那样另外拷一份 assets/ 出来。
//
// <!-- protoflow:changelog --> 标记按跟浏览器阅读页同一套算法（core/docPreview.js 的
// injectChangelogMarkdown）原地展开成表；没有标记就原样不动——是否展示这张表纯粹看正文内容，这里
// 不额外加任何判断。mermaid 代码块原样保留（doc.md 本来就是 fenced code block 存的，markdown
// 渲染器/钉钉文档等都认这个语法，不用转成图片）。
import path from "node:path";
import { readAssetsMap } from "./preview.js";
import { injectChangelogMarkdown } from "./docPreview.js";
import { loadDocHead } from "./exportUtil.js";

export function buildDocExportMarkdown(ws, projectId, docId) {
  const head = loadDocHead(ws, projectId, docId);
  if (!head) return null;
  const { v, vDir, name } = head;
  let { md } = head;

  // 导出产物只带当前版本，changelog 表也就只有这一行——跟 zip/html 导出「不带历史版本、不带
  // 版本切换」的既有设计一致（core/exportDoc.js）。
  md = injectChangelogMarkdown(md, [{ n: v.n, author: v.author || "", note: v.note || "", builtAt: v.builtAt || "" }], v.n);

  const assetsMap = readAssetsMap(path.join(vDir, "assets"));
  md = md.replace(/\]\(assets\/([^)\s]+)\)/g, (whole, filename) => {
    const uri = assetsMap[filename];
    return uri ? `](${uri})` : whole;
  });

  return { filename: `${name}.md`, buffer: Buffer.from(md, "utf8") };
}
