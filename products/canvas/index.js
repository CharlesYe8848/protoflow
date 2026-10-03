// products/canvas/index.js — 画布产品的注册描述（docs/product-architecture.md §4.10）。框架只按这个
// 形状用画布：页面路由、版本里的文件、导航、导出、工具、引用解析、健康规则、实体种类。
//
// 一个项目可以有多个画布（§4.2），页面地址都在 canvases/<画布>/ 下：
//   canvases/<id>/canvas.html                        画布页，默认最新版，?v=<n> 看第 n 版，没定过版看工作副本
//   canvases/<id>/pages/<pg>/artboards/<ab>/preview.html            工作副本的画板（画布页的 iframe、单独打开）
//   canvases/<id>/versions/<n>/pages/<pg>/artboards/<ab>/preview.html  第 n 版的画板
import { definePlugin } from "protoflow/sdk";
import * as canvasStore from "./store.js";
import * as canvasProduct from "./canvasProduct.js";
import { canvasVersionState } from "./canvasVersion.js";
import { CANVAS_EXPORTS } from "./exports.js";
import { canvasTools } from "./tools.js";
import { canvasAgentsDoc } from "./agentsDoc.js";
import { fileURLToPath } from "node:url";

const CANVAS_PAGE_RE = /^canvases\/([^/]+)\/canvas\.html$/;
const ARTBOARD_RE = /^canvases\/([^/]+)\/pages\/([^/]+)\/artboards\/([^/]+)\/preview\.html$/;
const VERSION_ARTBOARD_RE = /^canvases\/([^/]+)\/versions\/([1-9]\d*)\/pages\/([^/]+)\/artboards\/([^/]+)\/preview\.html$/;
const VERSION_FILE_RE = /^canvases\/([^/]+)\/versions\/([1-9]\d*)\/(.+)$/;


const exists = (ws, pid, cid) => canvasStore.listCanvases(ws, pid).some((c) => c.id === cid);

// 画布页看哪一版、版本下拉的数据。没定过版回 null（看工作副本、不显示下拉）。?v 不是已有的版本时
// 回落到最新版，跟文档阅读页一致。
function canvasPageVersion(ws, pid, cid, query) {
  const cj = canvasStore.readCanvasJson(ws, pid, cid);
  if (!cj || !cj.head) return null;
  const want = Number(new URLSearchParams(query || "").get("v"));
  const versions = (cj.versions || []).map((v) => ({ n: v.n, note: v.note || "", builtAt: v.builtAt || "" }));
  const current = versions.some((v) => v.n === want) ? want : cj.head;
  return { head: cj.head, current, versions };
}

export default definePlugin({
  apiVersion: 1,
  type: "canvas",
  label: "画布",
  navIcon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v18M18 3v18M3 6h18M3 18h18"/></svg>',
  entities: [canvasStore.CANVAS_ENTITY],
  guidesDir: fileURLToPath(new URL("./guides/", import.meta.url)),
  agentsDoc: canvasAgentsDoc,

  nav(ws, pid) {
    return canvasStore.listCanvases(ws, pid).map((c) => ({ id: c.id, title: c.title || c.id, href: `canvases/${encodeURIComponent(c.id)}/canvas.html`, meta: "" }));
  },

  render(ws, pid, relPath, { query, localState } = {}) {
    const cp = CANVAS_PAGE_RE.exec(relPath);
    if (cp) {
      const cid = cp[1];
      if (!exists(ws, pid, cid)) return null;
      const versioning = canvasPageVersion(ws, pid, cid, query);
      const opts = { libRelPath: "../../lib", localState };
      const html = versioning
        ? canvasStore.canvasHtml(ws, pid, cid, null, { ...opts, version: versioning.current, framePrefix: canvasStore.canvasVersionBase(versioning.current), versioning })
        : canvasStore.canvasHtml(ws, pid, cid, null, opts);
      return { html, current: { type: "canvas", id: cid } };
    }
    const va = VERSION_ARTBOARD_RE.exec(relPath);
    if (va) {
      const [, cid, n, , abId] = va;
      if (!exists(ws, pid, cid) || !canvasStore.openCanvasVersion(ws, pid, cid, Number(n))) return null; // 没有这一版：落到静态通道 404
      return { html: canvasStore.artboardPreviewHtml(ws, pid, abId, { canvasId: cid, version: Number(n), servedDeeper: "../../" }) };
    }
    const a = ARTBOARD_RE.exec(relPath);
    if (a && exists(ws, pid, a[1])) return { html: canvasStore.artboardPreviewHtml(ws, pid, a[3], { canvasId: a[1] }) };
    return null;
  },

  resolveFile(ws, pid, relPath) {
    const m = VERSION_FILE_RE.exec(relPath);
    if (!m || !exists(ws, pid, m[1])) return null;
    const version = canvasStore.openCanvasVersion(ws, pid, m[1], Number(m[2]));
    return (version && version.filePath(m[3])) || null;
  },

  exports: { hasId: true, defaultFormat: "zip", formats: CANVAS_EXPORTS },
  tools: canvasTools,

  // get_project 里画布自己的那部分：项目树（全部画布的页面/画板，每个页面带 canvasId）、画布清单
  // 及各自的版本状态。
  describeHint: "项目树 project（页面/画板层级，每个页面带 canvasId，画板 sourcePath 是绝对路径，可以直接读写文件）、canvases（各画布的版本状态：head 最新版本号、dirty 有没有未定版的改动）",
  describeProject(ws, pid) {
    const canvases = canvasStore.listCanvases(ws, pid).map((c) => {
      const st = canvasVersionState(ws, pid, c.id);
      return { id: c.id, title: c.title, head: st.head, dirty: st.dirty, versionCount: st.versions.length };
    });
    return { project: canvasStore.loadProjectTree(ws, pid), canvases };
  },

  // 删除产物内部的一部分（页面 pg_… 级联删画板、画板 ab_…）；不是自己的 id 回 null。整个画布的删除
  // 由框架按实体种类做（delete canvas:<id>）。
  partHint: "pg_… 页面，级联删它的画板；ab_… 画板",
  deletePart(ws, pid, targetId) {
    if (!/^(pg|ab)_/.test(targetId)) return null;
    return canvasStore.deleteTarget(ws, pid, targetId);
  },
  resolver: canvasProduct.resolver,
  artifacts: canvasProduct.artifacts,
  health: canvasProduct.health,
});
