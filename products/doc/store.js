// products/doc/store.js — 文档的文件读写：docs/<docId>/ 实体（doc.md 草稿 + doc.json 元信息 +
// 不可变版本）和阅读页的渲染入口。通用实体接口来自框架（core/store.js）。
import fs from "node:fs";
import path from "node:path";
import { ensureLibs, entityDir, entityRoot, freezeEntityVersion, listEntities, openEntityVersion, projectLibDir, readEntityJson, writeEntityJson } from "protoflow/sdk";
import { DOC_LIBS } from "./libs.js";
import { renderDocPreviewHtml, usesMermaidDoc } from "./docPreview.js";
import { expandEmbeds } from "./embeds.js";

export const DOC_ENTITY = { rootSeg: "docs", metaFile: "doc.json" };
export function docsRoot(ws, pid) { return entityRoot(ws, pid, DOC_ENTITY); }
export function docDir(ws, pid, docId) { return entityDir(ws, pid, DOC_ENTITY, docId); }
export function openDocVersion(ws, pid, docId, n) { return openEntityVersion(ws, pid, DOC_ENTITY, docId, n); }
export function freezeDocVersion(ws, pid, docId, n, files, meta) { return freezeEntityVersion(ws, pid, DOC_ENTITY, docId, n, files, meta); }
export function readDocJson(ws, pid, docId) { return readEntityJson(ws, pid, DOC_ENTITY, docId); }
export function writeDocJson(ws, pid, docId, dj) { writeEntityJson(ws, pid, DOC_ENTITY, docId, dj); }
export function listDocs(ws, pid) { return listEntities(ws, pid, DOC_ENTITY); }

// 渲染这个文档唯一的阅读页 docs/<docId>/preview.html——一个自包含 SPA，内嵌**全部版本**的原始
// markdown，版本切换在页内重渲染 + history 改 ?v=<n>，不跳转（参考 Artifacts）。版本只存冻结内容
// （doc.md / assets/），不再有各自的 html。lib 落项目级 lib/。
// 文档阅读页的 HTML：用冻结的各版本内容 + 当前模板现场拼。本地服务每次 GET 都走这里（见
// core/renderService.js），所以改了模板，所有老文档打开就是新样式，不用逐篇重新定版；版本内容
// 本身来自冻结的版本，不会变。没有任何版本时回 null。
export function docPreviewHtml(ws, projectId, docId, { embed } = {}) {
  const dj = readDocJson(ws, projectId, docId);
  if (!dj || !(dj.versions || []).length) return null;
  const lib = projectLibDir(ws, projectId);
  // 每版的原始 markdown，图片引用改写成版本作用域路径：![](assets/x) → ![](versions/<n>/assets/x)
  // （阅读页在 docs/<docId>/preview.html；versions/<n>/assets/x 这条地址由本地服务按版本清单解析到
  // 对象库，见 core/renderService.js 的 resolveProjectFile）。
  const versions = dj.versions.map((v) => {
    let md = requireVersion(openDocVersion(ws, projectId, docId, v.n), docId, v.n).readText("doc.md") || "";
    md = expandEmbeds(md, { ws, pid: projectId, embed, sources: v.sources, target: "html" }); // 嵌入按这一版记下的版本展开
    md = md.replace(/\]\(assets\//g, `](versions/${v.n}/assets/`);
    return { n: v.n, md, note: v.note || "", author: v.author || "", builtAt: v.builtAt || "" };
  });
  const anyMermaid = versions.some((v) => usesMermaidDoc(v.md));
  ensureLibs(lib, DOC_LIBS, anyMermaid ? ["marked.min.js", "mermaid.min.js"] : ["marked.min.js"]);
  return renderDocPreviewHtml({ versions, head: dj.head, title: dj.title || docId, anyMermaid, libRelPath: "../../lib" });
}

function requireVersion(handle, id, n) {
  if (!handle) throw new Error(`${id} 的第 ${n} 版内容缺失`);
  return handle;
}

// finalize 时仍写一份到磁盘：直接用 file:// 打开、或不经过本地服务的场景还能看。
export function renderDocPreview(ws, projectId, docId) {
  const html = docPreviewHtml(ws, projectId, docId);
  if (html == null) return { rendered: false };
  const headPreviewPath = path.join(docDir(ws, projectId, docId), "preview.html");
  fs.writeFileSync(headPreviewPath, html);
  return { rendered: true, headPreviewPath };
}
