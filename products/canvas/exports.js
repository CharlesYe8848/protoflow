// products/canvas/exports.js — 画布的导出格式：菜单数据（./exportMenu.js）+ build 函数 + mime。
// 框架的导出服务（core/exportService.js）按产品注册表里的这张表分发。
import { CANVAS_EXPORT_MENU } from "./exportMenu.js";
import { buildCanvasExportZip } from "./exportCanvas.js";
import { buildCanvasExportHtml } from "./exportCanvasHtml.js";

// 画布不存在时回 null（跟文档一样：导出目标不存在 → 404），别的错照常抛。
const orNull = (fn) => (ws, pid, canvasId) => {
  try { return fn(ws, pid, canvasId); } catch (e) { if (e.code === "CANVAS_NOT_FOUND") return null; throw e; }
};
const BUILD = {
  zip: { build: orNull(buildCanvasExportZip), mime: "application/zip" },
  html: { build: orNull(buildCanvasExportHtml), mime: "text/html" },
};
export const CANVAS_EXPORTS = CANVAS_EXPORT_MENU.map((f) => ({ ...f, ...BUILD[f.id] }));
