// products/doc/exportUtil.js — 文档几个导出格式（zip / docx / markdown / html）共用的第一步。
import { safeFileName } from "protoflow/sdk";
import { readDocJson, openDocVersion } from "./store.js";
import { usesMermaidDoc } from "./docPreview.js";
import { expandEmbeds } from "./embeds.js";

// <!-- protoflow:changelog --> 表要展开成的行：全部版本的 { n, author, note, builtAt }，跟
// ./store.js（在线预览）用的是同一份 dj.versions，字段取法必须一致——三个单文档导出格式
// （docx/markdown/html）共用这一个函数，改字段只用改这一处。
export function changelogVersions(dj) {
  return (dj.versions || []).map((v) => ({ n: v.n, author: v.author || "", note: v.note || "", builtAt: v.builtAt || "" }));
}
// 文档导出（zip、单 HTML 都要）共用的第一步：只认 head 版本，取它的 md、版本句柄（按路径读冻结
// 文件，见 core/versionStore.js）、是否用了 mermaid。
// 返回 null（文档没有任何版本，调用方直接回 null 表示"这个导出目标不存在"）。
// ctx.embed（导出时框架给的跨产品嵌入）在的话，正文里的嵌入块按 target 展开（./embeds.js）。
export function loadDocHead(ws, projectId, docId, { embed, target = "html", prefer } = {}) {
  const dj = readDocJson(ws, projectId, docId);
  if (!dj || !(dj.versions || []).length) return null;
  const head = dj.head;
  const v = dj.versions.find((x) => x.n === head) || dj.versions[dj.versions.length - 1];
  const version = openDocVersion(ws, projectId, docId, v.n);
  const raw = version && version.readText("doc.md");
  if (raw == null) throw new Error(`文档 ${docId} 的第 ${v.n} 版内容缺失`);
  const md = expandEmbeds(raw, { ws, pid: projectId, embed, sources: v.sources, target, ...(prefer ? { prefer } : {}) });
  return { dj, v, version, md, anyMermaid: usesMermaidDoc(md), name: safeFileName(dj.title || docId, docId) };
}
