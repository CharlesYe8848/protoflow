// core/exportUtil.js — 导出相关小工具，给 exportCanvas.js / exportDoc.js / exportCanvasHtml.js /
// exportDocHtml.js 四个 build 函数共用，不用各自重复写一遍。
import fs from "node:fs";
import path from "node:path";
import { readDocJson, docVersionDir } from "./store.js";
import { usesMermaidDoc } from "./docPreview.js";

// 文件名 = 项目名/文档标题，去掉文件系统不友好的字符；空则回退 fallback（通常是 id）。
export function safeFileName(name, fallback) {
  const s = String(name || "").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "").replace(/\s+/g, " ").trim();
  return (s || fallback).slice(0, 120);
}

// 文档导出（zip、单 HTML 都要）共用的第一步：只认 head 版本，取它的 md/目录/是否用了 mermaid。
// 返回 null（文档没有任何版本，调用方直接回 null 表示"这个导出目标不存在"）。
export function loadDocHead(ws, projectId, docId) {
  const dj = readDocJson(ws, projectId, docId);
  if (!dj || !(dj.versions || []).length) return null;
  const head = dj.head;
  const v = dj.versions.find((x) => x.n === head) || dj.versions[dj.versions.length - 1];
  const vDir = docVersionDir(ws, projectId, docId, v.n);
  const md = fs.readFileSync(path.join(vDir, "doc.md"), "utf8");
  return { dj, v, vDir, md, anyMermaid: usesMermaidDoc(md), name: safeFileName(dj.title || docId, docId) };
}
