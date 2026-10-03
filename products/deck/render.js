// products/deck/render.js — 一版幻灯片 → 可以放进页面的各页 HTML：<pf-embed> 按这一版记下的版本展开、
// assets/ 引用按场景改写（阅读页是版本路径，单 HTML 导出是 data URI）。
import { marked } from "marked";
import { embedPlaceholderHtml } from "protoflow/sdk";
import { EMBED_TAG_RE, rewriteAssets, slideTitle, slideLayout } from "./html.js";

// 嵌入要的形式：页面里优先 HTML；Markdown（比如绘图给的 Mermaid 代码块）在这里转成 HTML。
const PREFER = ["html", "svg", "markdown", "data"];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function markdownToHtml(md) {
  const fence = /^```mermaid\s*\n([\s\S]*?)\n```\s*$/.exec(String(md).trim());
  if (fence) return `<div class="mermaid">${esc(fence[1])}</div>`;
  return marked.parse(String(md)).replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, '<div class="mermaid">$1</div>');
}

function tableHtml(data) {
  return `<table>${(data.rows || []).map((r) => `<tr>${r.map((c) => `<td>${esc(c == null ? "" : c)}</td>`).join("")}</tr>`).join("")}</table>`;
}

export function expandEmbeds(html, { ws, pid, embed, sources }) {
  const pinned = Object.fromEntries((sources || []).filter((s) => s.via === "embed" && s.from).map((s) => [s.from, s.ref]));
  return String(html).replace(EMBED_TAG_RE, (_m, raw) => {
    const ref = pinned[raw.trim()] || raw.trim();
    const r = embed ? embed(ws, pid, ref, { prefer: PREFER }) : { as: "link", ref, title: ref, placeholder: "missing", text: "预览服务之外看不到嵌入内容" };
    const body = r.as === "html" ? r.html : r.as === "svg" ? r.svg : r.as === "markdown" ? markdownToHtml(r.markdown) : r.as === "data" ? tableHtml(r.data) : embedPlaceholderHtml(r);
    return `<div class="pf-embed-slot" data-pf-embed="${esc(ref)}">${body}</div>`;
  });
}

// slides：[{ id, html }]。返回 [{ id, title, layout, html }]。
export function renderSlides(slides, { ws, pid, embed, sources, urlFor }) {
  return slides.map((s, i) => ({
    id: s.id,
    title: slideTitle(s.html, i),
    layout: slideLayout(s.html),
    html: rewriteAssets(expandEmbeds(s.html, { ws, pid, embed, sources }), urlFor),
  }));
}

export const usesMermaid = (slides) => slides.some((s) => /class="mermaid"/.test(s.html));
