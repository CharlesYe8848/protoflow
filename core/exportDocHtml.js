// core/exportDocHtml.js — 把一篇文档的当前（head）版本导出成一个自包含单 HTML 文件（下载，不落
// 项目盘）。文档阅读页本来就没有 iframe、没有跨源问题（跟画布不一样，不用担心体积翻倍），单
// HTML 只是在目录树导出（core/exportDoc.js）的 standalone 模式上再处理两处：
//   - lib/marked.min.js（用到才有 mermaid.min.js）：<script src=...> 换成压缩后内嵌
//     （core/libCodec.js，跟画布单 HTML 导出共用同一套压缩/解压，换算法只用改那一个文件）
//   - assets/ 里的图片：markdown 原文里 ](assets/x) 直接替换成 data URI（复用画板那套
//     readAssetsMap，marked.parse() 原样把 data URI 吐进 <img src>，不需要额外的运行时补丁）
import path from "node:path";
import { renderDocPreviewHtml } from "./docPreview.js";
import { readLibSources, readAssetsMap } from "./preview.js";
import { compressLibSources } from "./libCodec.js";
import { loadDocHead } from "./exportUtil.js";

export function buildDocExportHtml(ws, projectId, docId) {
  const head = loadDocHead(ws, projectId, docId);
  if (!head) return null;
  const { dj, v, vDir, anyMermaid, name } = head;
  let { md } = head;

  const assetsMap = readAssetsMap(path.join(vDir, "assets")); // { 文件名: data URI }
  md = md.replace(/\]\(assets\/([^)\s]+)\)/g, (whole, filename) => {
    const uri = assetsMap[filename];
    return uri ? `](${uri})` : whole;
  });

  const libNames = anyMermaid ? ["marked.min.js", "mermaid.min.js"] : ["marked.min.js"];
  const compressedLibs = compressLibSources(readLibSources(libNames));

  const html = renderDocPreviewHtml({
    versions: [{ n: v.n, md, note: v.note || "", author: v.author || "", builtAt: v.builtAt || "" }],
    head: v.n,
    title: dj.title || docId,
    kind: dj.kind,
    kindLabel: "",
    anyMermaid,
    standalone: true,
    compressedLibs,
  });
  return { filename: `${name}.html`, buffer: Buffer.from(html, "utf8"), mime: "text/html" };
}
