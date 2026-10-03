// products/diagram/engine/renderers/mermaid.js — Mermaid 渲染器：一页 Mermaid 源码 → 流程图、时序图、
// 状态图等。源码原样嵌进页面，由浏览器端的 mermaid 渲染。
//
// Mermaid 的完整语法检查只能在浏览器里做（它依赖 DOM），这里只查"内容不为空、第一行是认识的图表
// 类型"；写错的语法在预览页上明确显示成渲染失败，不静默放过。
//
// engine 层只依赖 npm 包和 Node 内置模块，不引用 core/（tests/boundaries.test.js 检查）。
import fs from "node:fs";

// Mermaid 11 的图表类型关键字（第一行的第一个词）。
const DIAGRAM_TYPES = [
  "flowchart", "graph", "sequenceDiagram", "classDiagram", "stateDiagram", "stateDiagram-v2", "erDiagram",
  "journey", "gantt", "pie", "quadrantChart", "requirementDiagram", "gitGraph", "C4Context", "C4Container",
  "C4Component", "C4Dynamic", "C4Deployment", "mindmap", "timeline", "zenuml", "sankey-beta", "xychart-beta",
  "block-beta", "packet-beta", "kanban", "architecture-beta", "radar-beta", "treemap-beta",
];

// 跳过开头的 frontmatter（--- … ---）、%% 注释和空行，取第一行有效内容的第一个词。
function firstKeyword(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  if (lines[0] && lines[0].trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++;
  }
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith("%%")) continue;
    return t.split(/\s+/)[0];
  }
  return "";
}

export default {
  kind: "mermaid",
  label: "Mermaid",
  ext: ".mmd",
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="15" width="8" height="6" rx="1.5"/><path d="M7 9v5a1 1 0 0 0 1 1h5"/></svg>',
  libs: { "mermaid.min.js": ["mermaid", "dist/mermaid.min.js"] },

  validate(source) {
    const text = String(source || "");
    if (!text.trim()) return ["内容为空"];
    const kw = firstKeyword(text);
    if (!DIAGRAM_TYPES.includes(kw)) return [`第一行应该是图表类型（如 flowchart TD、sequenceDiagram、stateDiagram-v2），实际是「${kw}」`];
    return [];
  },

  // 嵌进别处：一段 Mermaid 代码块，由嵌入方用自己的 Mermaid 渲染。
  toMarkdown(source) {
    return "```mermaid\n" + String(source).trim() + "\n```";
  },
  prepare() {
    return {};
  },

  clientScript() {
    return fs.readFileSync(new URL("../client/mermaid.js", import.meta.url), "utf8");
  },
};
