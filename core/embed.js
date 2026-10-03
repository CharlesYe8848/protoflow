// core/embed.js — 跨产品嵌入（框架），docs/product-architecture.md §4.11。
//
// 一个产品要在自己的内容里放另一个产品的内容（文档里嵌一张表、幻灯片里嵌一张图），不 import 对方，而是
// 经框架：embedRef(ws, pid, "类型:id@版本#子部位", { prefer }) → 框架按类型找到对应产品的 embed()。产品之间
// 照样互不认识，唯一的约定就是引用格式。
//
// 形式按场景协商：被嵌的产品在描述里声明自己能给哪几种（embedFormats），调用方按场景给优先级 prefer，
// 框架挑第一种对方能给的：
//   html      自包含的 HTML 片段（预览页用；嵌入方当黑盒展示，不依赖里面的类名）
//   data      结构化数据：表格 { columns?, rows: [[…]] }（Word 里生成原生表格、Markdown 里生成表格）
//   svg       SVG 源码
//   markdown  Markdown 片段（比如一段 Mermaid 代码块，嵌入方用自己的渲染管线）
// 一种都给不了就降级成 link（标题 + 引用），导出不因为嵌入失败。
//
// 版本：embedRef 按传进来的引用原样取——已定版的内容由嵌入方传固定过版本的引用（定版时 pinRefs 记下的
// sources），保证能复现；草稿里不写 @版本 的，由对方产品按它的最新版给。
//
// 结果统一成 { as, ref, title, html?|data?|svg?|markdown?, placeholder?: "uninstalled"|"missing"|"cycle" }。
// 占位（placeholder）时 as 是 "link"，带一句 text 说明原因。
import { parseRef } from "./refs.js";
import { projectProducts, readEntityJson } from "./store.js";

export const EMBED_FORMATS = ["html", "data", "svg", "markdown"];
export const MAX_EMBED_DEPTH = 3;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function placeholder(ref, kind, title, text) {
  return { as: "link", ref, title, placeholder: kind, text };
}

// products：当前注册表。返回 embedRef(ws, pid, ref, { prefer, chain })；chain 是上层的嵌入链（防循环），
// 产品在自己的 embed 里再嵌别的内容时，把收到的 ctx.embed 接着用就行，链会自动往下传。
export function createEmbedder(products) {
  const byType = Object.fromEntries(products.map((p) => [p.type, p]));

  function embedRef(ws, pid, ref, { prefer = EMBED_FORMATS, chain = [] } = {}) {
    const r = parseRef(ref);
    if (!r) return placeholder(ref, "missing", ref, `嵌入的引用格式不对：${ref}`);
    const key = `${r.type}:${r.id}${r.version ? `@${r.version}` : ""}${r.part ? `#${r.part}` : ""}`;
    if (chain.includes(key)) return placeholder(ref, "cycle", ref, `嵌入形成了循环（${[...chain, key].join(" → ")}），这里不再展开`);
    if (chain.length >= MAX_EMBED_DEPTH) return placeholder(ref, "cycle", ref, `嵌入层数超过 ${MAX_EMBED_DEPTH} 层，这里不再展开`);

    const p = byType[r.type];
    if (!p) {
      let reg = null;
      try { reg = projectProducts(ws, pid)[r.type]; } catch { /* 不是真实项目 */ }
      if (reg) {
        const meta = readEntityJson(ws, pid, { rootSeg: reg.rootSeg, metaFile: reg.metaFile }, r.id);
        return placeholder(ref, meta ? "uninstalled" : "missing", (meta && meta.title) || r.id,
          meta ? `${r.type} 产品没有启用（插件没装或被禁用），这里显示不了` : `嵌入的 ${ref} 已不存在`);
      }
      return placeholder(ref, "missing", r.id, `嵌入的 ${ref} 不认识（没有 ${r.type} 这个产品）`);
    }
    const formats = (p.embed && p.embedFormats) || [];
    const as = prefer.find((f) => formats.includes(f));
    const title = (p.resolver && p.resolver.describe) ? p.resolver.describe(ws, pid, r.id, r.part) : `${p.label}「${r.id}」`;
    if (!as) return placeholder(ref, null, title, `${p.label}不支持以这种形式嵌入，给出链接`);
    const nested = (ws2, pid2, ref2, opts2 = {}) => embedRef(ws2, pid2, ref2, { ...opts2, chain: [...chain, key] });
    let out;
    try { out = p.embed(ws, pid, r, { as, embed: nested }); }
    catch (e) { return placeholder(ref, "missing", title, `嵌入 ${ref} 出错：${e.message}`); }
    if (!out) return placeholder(ref, "missing", title, `嵌入的 ${ref} 已不存在`);
    return { as, ref, title, ...out };
  }
  return embedRef;
}

// 占位、链接的通用 HTML（嵌入方可以直接用，也可以按自己的样式画）。
export function embedPlaceholderHtml(result) {
  return `<div class="pf-embed pf-embed--${result.placeholder || "link"}" data-pf-embed="${esc(result.ref)}">`
    + `<span class="pf-embed__title">${esc(result.title || result.ref)}</span>`
    + (result.text ? `<span class="pf-embed__text">${esc(result.text)}</span>` : "")
    + `</div>`;
}

// 表格数据 → Markdown 表格（data 形式在 Markdown 场景的通用写法）。
export function tableDataToMarkdown(data) {
  const rows = (data && data.rows) || [];
  if (!rows.length) return "";
  const cell = (v) => String(v == null ? "" : v).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(" | ")} |`;
  const [head, ...body] = data.columns ? [data.columns, ...rows] : rows;
  return [line(head), `| ${Array(width).fill("---").join(" | ")} |`, ...body.map(line)].join("\n");
}

// ---- Markdown 类产品的嵌入块（文档、幻灯片……共用）----
// 写法：正文里一个 embed 代码块，里面一行引用。在别的 Markdown 工具里它就是一个显示引用的代码块，不会坏。
//   ```embed
//   sheet:sales#汇总
//   ```
// 定版时产品用 embedBlockRefs 取出引用、经 pinSources 固定到对方当时的版本，记成这一版的 sources
// （via: "embed"，from 是正文原文）；展示、导出时 expandEmbedBlocks 按记下的版本展开，结果仍是 Markdown，
// 交给产品自己的渲染管线：html → 原样 HTML 块（marked 透传）；markdown → 原样插入；data → Markdown 表格；
// 占位 / 链接 → 网页里一个占位块，纯 Markdown 场景里一行说明。
const EMBED_BLOCK_RE = /^```embed[ \t]*\n([^\n`]+)\n```[ \t]*$/gm;

// 各场景希望拿到的形式，按优先级。
export const EMBED_PREFER = {
  html: ["html", "svg", "markdown", "data"],   // 网页（阅读页、单 HTML 导出）
  markdown: ["markdown", "data"],              // 纯 Markdown 导出
  docx: ["data", "markdown"],                  // Word：表格生成原生表格
};

export function embedBlockRefs(md) {
  return [...new Set([...String(md).matchAll(EMBED_BLOCK_RE)].map((m) => m[1].trim()))];
}

// 定版时的嵌入引用：已经 pinSources 过的 sources（跟 raws 一一对应）→ 记进版本的形状。
export function embedSourcesFrom(raws, pinned) {
  return (pinned || []).map((s, i) => ({ ...s, via: "embed", from: raws[i] }));
}

// target：html（结果进网页）或 markdown（纯 Markdown / Word）。embed 缺席（不经过本地服务的场景）时给占位。
export function expandEmbedBlocks(md, { ws, pid, embed, sources, target = "html", prefer = EMBED_PREFER[target] }) {
  const pinned = Object.fromEntries((sources || []).filter((s) => s.via === "embed" && s.from).map((s) => [s.from, s.ref]));
  return String(md).replace(EMBED_BLOCK_RE, (_whole, raw) => {
    const ref = pinned[raw.trim()] || raw.trim();
    const r = embed ? embed(ws, pid, ref, { prefer }) : { as: "link", ref, title: ref, placeholder: "missing", text: "预览服务之外看不到嵌入内容" };
    if (r.as === "markdown") return r.markdown;
    if (r.as === "data") return tableDataToMarkdown(r.data);
    if (target === "html") {
      const body = r.as === "html" ? r.html : r.as === "svg" ? r.svg : embedPlaceholderHtml(r);
      // HTML 块前后留空行、内部不能有空行，marked 才会整块透传
      return `\n<div class="pf-embed-slot" data-pf-embed="${esc(ref)}">${String(body).replace(/\n\s*\n/g, "\n")}</div>\n`;
    }
    return `> 嵌入：${r.title || ref}（${ref}）${r.text ? `——${r.text}` : ""}`;
  });
}
