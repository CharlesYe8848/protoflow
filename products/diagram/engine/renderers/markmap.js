// products/diagram/engine/renderers/markmap.js — Markmap 渲染器：一页 Markdown 大纲 → 脑图。
//
// Markdown 在服务端转成节点树嵌进页面，浏览器只加载 markmap-view + d3，不加载体积大得多的
// markmap-lib。转换只启用 sourceLines 插件：每个节点带 payload.lines（源文件起止行），标注时
// agent 能精确找回源码位置；katex、代码高亮之类插件用不上，不启用。
//
// engine 层只依赖 npm 包和 Node 内置模块，不引用 core/（tests/boundaries.test.js 检查）。
import fs from "node:fs";
import { Transformer, builtInPlugins } from "markmap-lib";

const transformer = new Transformer(builtInPlugins.filter((p) => p.name === "sourceLines"));

export default {
  kind: "markmap",
  label: "脑图",
  ext: ".md",
  // 页面标签上的图标（viewBox 24、stroke currentColor）。
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="2.5"/><path d="M7.5 12h3M10.5 12c2 0 2-6 5-6h4M10.5 12h9M10.5 12c2 0 2 6 5 6h4"/></svg>',
  // 浏览器端要的库：文件名 → [包名, 包内路径]。接框架的那一层把它换成 core/libs.js 的库表。
  libs: {
    "d3.min.js": ["d3", "dist/d3.min.js"],
    "markmap-view.js": ["markmap-view", "dist/browser/index.js"],
  },

  // 返回错误列表，空数组 = 通过。
  validate(source) {
    const text = String(source || "");
    if (!text.trim()) return ["内容为空"];
    if (!/^\s*(#{1,6}\s+\S|[-*+]\s+\S|\d+[.)]\s+\S)/m.test(text)) return ["至少要有一个标题（# …）或列表项（- …）"];
    return [];
  },

  // 预览页里这一页要带的数据。结果必须是确定的（同样的输入永远得到同样的输出）：页面实时刷新按
  // 渲染结果算指纹，不确定的输出会让页面反复白刷新。
  // 嵌进别处：脑图的源码本身就是 Markdown 大纲，原样给出（嵌入方显示成层级列表）。
  toMarkdown(source) {
    return String(source).trim();
  },
  prepare(source) {
    return { root: transformer.transform(String(source || "")).root };
  },

  clientScript() {
    return fs.readFileSync(new URL("../client/markmap.js", import.meta.url), "utf8");
  },
};
