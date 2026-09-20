// core/renderService.js — 把「项目内相对路径」解析成一份实时渲染的视图 HTML，或 null（= 照普通
// 静态文件处理）。这是「源文件是唯一真相 + 本地预览服务动态读取 + 显式静态导出」里"动态读取"
// 的那一环。
//
// canvas.html 和各画板的 preview.html 不再是某个 render_* 工具写死在项目目录里的快照，而是每次
// HTTP GET 时依据 source.jsx / annotations.md / 项目结构的**当前**内容重新投影。任何 agent、
// 编辑器 Undo、git checkout 改了这些源文件、加删了画板，刷新浏览器即最新——不依赖任何人记得
// 重新跑 render，也不再有"落盘的 HTML 和源文件不一致"这种中间状态。
//
// 只认这两类动态路径，其余（source.jsx、assets/*、lib/*、.protoflow/*.json、docs/<id>/preview.html
// ——doc 阅读页只更新导出菜单，正文仍是冻结版本）除菜单刷新外返回 null，交回
// core/localServer.js 的静态文件通道：
//   canvas.html
//   pages/<pageId>/artboards/<artboardId>/preview.html
//
// core/localServer.js 保持通用（静态文件 + register + __protoflow_state），不 import 本模块；
// bin/protoflow-server.mjs 在入口处把这个函数作为 renderView 传进 createStaticHandler。
import path from "node:path";
import fs from "node:fs";
import { EXPORT_MENU } from "./exportMenu.js";
import { exportMenuRowsHtml } from "./preview.js";
import { canvasHtml, artboardPreviewHtml } from "./store.js";

const PREVIEW_RE = /^pages\/([^/]+)\/artboards\/([^/]+)\/preview\.html$/;

// projectRoot 是绝对项目根目录（localServer 的注册表 byKey 里存的就是它）。store 的函数签名是
// (ws, projectId) = (父目录, 文件夹名)，这里拆一下。relPath 已被 localServer 解码且过了
// containment 检查（不含 ..），直接用。
export function renderProjectView(projectRoot, relPath) {
  const ws = path.dirname(projectRoot);
  const projectId = path.basename(projectRoot);

  if (relPath === "canvas.html") return canvasHtml(ws, projectId);

  // Refresh only the menu of frozen document previews; preserve all version content.
  if (/^docs\/[^/]+\/preview\.html$/.test(relPath)) {
    const file = path.join(projectRoot, relPath);
    if (!fs.existsSync(file)) return null;
    const html = fs.readFileSync(file, "utf8");
    return html.replace(/(<div class="pf-export-menu" hidden><div class="pf-export-menu__section">导出<\/div>)[\s\S]*?(<\/div>)/,
      (_match, start, end) => start + exportMenuRowsHtml(EXPORT_MENU.doc) + end);
  }

  const m = PREVIEW_RE.exec(relPath);
  if (m) return artboardPreviewHtml(ws, projectId, m[2]);

  return null;
}
