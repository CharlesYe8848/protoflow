// products/diagram/engine/index.js — 渲染器登记表。一种写法 = 一个渲染器，按页面文件的扩展名找：
//
//   { kind, label, ext, icon, libs, validate(source) → 错误[], prepare(source) → 数据, clientScript() → 浏览器端脚本 }
//
//   kind           写法的名字，也是浏览器端注册时用的名字（PFDiagram.register(kind, …)）
//   ext            页面文件的扩展名，如 ".md"
//   icon           可选：页面标签上的图标（SVG 字符串，viewBox 24、stroke currentColor）
//   libs           浏览器端要的库：{ 文件名: [包名, 包内路径] }
//   validate       定版前的检查，返回错误列表
//   prepare        预览页里这一页要带的数据，结果必须是确定的
//   clientScript   浏览器端脚本：调用 PFDiagram.register(kind, { render, nodes })，约定见 client/README.md
//   toMarkdown     可选：这一页嵌进别处（文档、幻灯片）时的 Markdown 写法，没有就不能以 Markdown 嵌入
//
// 加一种写法 = 在 renderers/ 加一个文件、在下面的列表里加一行。存储、工具、预览页、标注都不用改。
// engine 层只依赖 npm 包和 Node 内置模块，不引用 core/，以后绘图产品单独抽出去时能原样带走。
import markmap from "./renderers/markmap.js";
import mermaid from "./renderers/mermaid.js";

const RENDERERS = [markmap, mermaid];

export function renderers() {
  return RENDERERS.slice();
}

export function rendererForFile(fileName) {
  return RENDERERS.find((r) => String(fileName).endsWith(r.ext)) || null;
}

export function rendererByKind(kind) {
  return RENDERERS.find((r) => r.kind === kind) || null;
}

// 测试用：临时登记一个渲染器，返回撤销函数。用来验证"只靠登记就能跑通"。
export function registerRenderer(renderer) {
  if (RENDERERS.some((r) => r.kind === renderer.kind || r.ext === renderer.ext)) {
    throw new Error(`渲染器重名：${renderer.kind}（${renderer.ext}）`);
  }
  RENDERERS.push(renderer);
  return () => {
    const i = RENDERERS.indexOf(renderer);
    if (i >= 0) RENDERERS.splice(i, 1);
  };
}
