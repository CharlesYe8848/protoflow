// core/exportService.js — 把「导出请求」解析成「一份文件的字节 + mime + 建议文件名」。跟
// core/renderService.js 平级：localServer 保持通用，bin/protoflow-server.mjs 在入口把这个函数
// 作为 runExport 注入。不落盘到项目目录——落盘只发生在系统临时目录，打完包立刻删（见
// core/exportCanvas.js / core/exportCanvasHtml.js / core/exportDoc.js / core/exportDocHtml.js），
// 响应直接把字节发回去，由浏览器的下载/另存为流程决定存去哪——不是我们替用户决定一个固定路径。
//
// 具体有哪些格式、每种格式怎么产出，都在 core/exportFormats.js 的登记表里——这里只管按路径查表
// 分发，加新格式不用碰这个文件。
//
// 路由（POST /p/<key>/__protoflow_export/<subPath>）：
//   canvas/<formatId>       → 画布导出（zip：目录树；html：单文件，见 exportFormats.js）
//   doc/<docId>/<formatId>  → 文档导出，只带当前版本（zip：目录树；html：单文件）
//
// <formatId> 段可以省略（"canvas"、"doc/<docId>"），默认 "zip"——doc 的 preview.html 是
// build_doc 时冻结的静态快照，不是每次实时渲染的；加 formatId 这一段之前生成的旧快照，页面里的
// 「导出」按钮点出来还是旧的不带格式段的 URL，得继续认得出来，不然要等用户对着每篇文档重新
// build_doc 一遍旧文档的导出才会恢复——不能指望这一点，兼容旧 URL 更稳。
import path from "node:path";
import { buildDocExportZip } from "./exportDoc.js";
import { EXPORT_TARGETS } from "./exportFormats.js";

const CANVAS_RE = /^canvas(?:\/([^/]+))?$/;
const DOC_RE = /^doc\/([^/]+)(?:\/([^/]+))?$/;

// projectRoot 绝对路径；subPath 已被 localServer 解码、过了 containment。
// 返回 { filename, buffer, mime }，或 null（不认识的 target/格式 / 该导出目标不存在，比如文档
// 没有任何版本）。
export function runProjectExport(projectRoot, subPath) {
  const ws = path.dirname(projectRoot);
  const projectId = path.basename(projectRoot);

  let target, formatId, docId;
  const cm = CANVAS_RE.exec(subPath);
  const dm = !cm && DOC_RE.exec(subPath);
  if (cm) { target = "canvas"; formatId = cm[1] || "zip"; }
  else if (dm) { target = "doc"; docId = decodeURIComponent(dm[1]); formatId = dm[2] || "zip"; }
  else return null;

  // Frozen older previews still request ZIP, including URLs without a format.
  if (target === "doc" && formatId === "zip") {
    const out = buildDocExportZip(ws, projectId, docId);
    return out ? { ...out, mime: "application/zip" } : null;
  }

  const fmt = ((EXPORT_TARGETS[target] || {}).formats || []).find((f) => f.id === formatId);
  if (!fmt || !fmt.build) return null;

  const out = target === "canvas" ? fmt.build(ws, projectId) : fmt.build(ws, projectId, docId);
  const response = (result) => result ? { filename: result.filename, buffer: result.buffer, mime: result.mime || fmt.mime } : null;
  return out instanceof Promise ? out.then(response) : response(out);
}
