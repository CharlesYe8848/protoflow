// products/diagram/embed.js — 绘图被别的产品嵌入（docs/product-architecture.md §4.11 跨产品嵌入）。
// 以 Markdown 形式给出：子部位是页 id，只给那一页；不带子部位给全部页（多页时每页前面一行页名）。
// 每种写法怎么变成 Markdown 由 engine 里的渲染器决定（toMarkdown），这里不认识具体写法。
import * as diagramStore from "./store.js";
import { rendererByKind } from "./engine/index.js";

export const DIAGRAM_EMBED_FORMATS = ["markdown"];

export function embedDiagram(ws, pid, ref, { as }) {
  if (as !== "markdown") return null;
  const dj = diagramStore.readDiagramJson(ws, pid, ref.id);
  const n = ref.version ?? (dj && dj.head);
  if (!n) return null;
  let pages;
  try { pages = diagramStore.readVersionPages(ws, pid, ref.id, n); } catch { return null; }
  const picked = ref.part ? pages.filter((p) => p.id === ref.part) : pages;
  if (!picked.length) return null;
  const md = picked.map((p) => {
    const r = rendererByKind(p.kind);
    const body = r && r.toMarkdown ? r.toMarkdown(p.source) : "```\n" + p.source.trim() + "\n```";
    return picked.length > 1 ? `**${p.name}**\n\n${body}` : body;
  });
  return { markdown: md.join("\n\n") };
}
