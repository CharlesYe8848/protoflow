// core/exportService.js — 把「导出请求」解析成「一份文件的字节 + mime + 建议文件名」（框架）。跟
// core/renderService.js 平级：localServer 保持通用，bin/protoflow-server.mjs 在入口把这个函数
// 作为 runExport 注入。不落盘到项目目录——落盘只发生在系统临时目录，打完包立刻删；响应直接把字节
// 发回去，由浏览器的下载/另存为流程决定存去哪。
//
// 不认识任何产品：有哪些产品、每个产品有哪些导出格式，都来自产品注册表（products/index.js）。
// 路由（POST /p/<key>/__protoflow_export/<subPath>）：
//   <类型>/<formatId>          → 没有 id 的产品，formatId 缺省取该产品第一个格式
//   <类型>/<id>/<formatId>     → 有 id 的产品（画布、文档、表格），只导当前版本
// 每个产品在注册描述里声明 exports: { hasId, defaultFormat, formats:[{ id, mime, build(ws, pid, id, ctx) }] }；
// ctx.embed 是跨产品嵌入（core/embed.js），导出里要展开嵌入内容的产品用它；
// ctx.progress(fraction, stage, extra) 报进度（0–1，stage 是给人看的一句"在做什么"），慢的导出（比如录视频）用，
// 页面上的导出进度弹窗据此显示进度条。extra 可选：{ preview: 当前渲染画面的图片文件路径（弹窗左边实时预览），
// meta: { durationMs, … } 作品信息 }。不报也行，弹窗就只显示已经等了多少秒。
// ctx.signal 是 AbortSignal：页面取消导出时触发，慢的导出应该据此停下（关浏览器、杀子进程）。
import path from "node:path";
import { createEmbedder } from "./embed.js";

// 按产品注册表解析 subPath。返回 { product, id, formatId } 或 null。
export function parseExportPath(subPath, products) {
  const segs = String(subPath).split("/");
  const product = products.find((p) => p.type === segs[0] && p.exports);
  if (!product) return null;
  const { hasId, defaultFormat } = product.exports;
  if (hasId) {
    if (!segs[1] || segs.length > 3) return null;
    return { product, id: decodeURIComponent(segs[1]), formatId: segs[2] || defaultFormat };
  }
  if (segs.length > 2) return null;
  return { product, id: null, formatId: segs[1] || defaultFormat };
}

// projectRoot 绝对路径；subPath 已被 localServer 解码、过了 containment。
// 返回 { filename, buffer, mime }，或 null（不认识的产品/格式、导出目标不存在——比如文档没有任何版本）。
// opts.onProgress({ fraction, stage, preview, meta })：导出进度，本地服务按任务记下来给页面轮询（core/localServer.js）；
// opts.signal：页面取消导出时触发。
export function runProjectExport(projectRoot, subPath, products, { onProgress, signal } = {}) {
  const parsed = parseExportPath(subPath, products);
  if (!parsed) return null;
  const fmt = parsed.product.exports.formats.find((f) => f.id === parsed.formatId);
  if (!fmt || !fmt.build) return null;
  const ws = path.dirname(projectRoot);
  const projectId = path.basename(projectRoot);
  const progress = (fraction, stage, extra = {}) => {
    if (onProgress) onProgress({ fraction: Math.max(0, Math.min(1, Number(fraction) || 0)), stage: stage ? String(stage) : "", preview: extra.preview || null, meta: extra.meta || null });
  };
  const out = fmt.build(ws, projectId, parsed.id, { embed: createEmbedder(products), progress, signal });
  const response = (result) => result ? { filename: result.filename, buffer: result.buffer, mime: result.mime || fmt.mime } : null;
  return out instanceof Promise ? out.then(response) : response(out);
}
