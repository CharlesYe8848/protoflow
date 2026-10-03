// core/canvasProduct.js — 画布交给框架的三样东西（docs/product-architecture.md §4.3、§4.10）：
//   resolver   引用解析：引用里的 id 是画布 id，子部位是画板，指纹 = 画板 source.jsx 的内容哈希（跟"画板改没改"
//              的一贯口径一致，老文档的 sourceFingerprints 就是这个值，能原样迁成引用）
//   artifacts  项目里的画布产物清单（给项目图谱用）
//   health     画布自己的健康规则：源码未校验、标注失效 / 待核对、有未定版的改动
// 框架只按这个形状调用，不认识画布。阶段 5 的产品注册会把它们收进画布的注册描述。
import { contentHash, finding } from "protoflow/sdk";
import * as canvasStore from "./store.js";
import { parseElementRefs } from "./annotations.js";
import { canvasVersionState } from "./canvasVersion.js";

// 画布 cid 第 n 版（null = 现在：定过版就是最新版，没定过版就是工作副本）里某块画板的源码。
function sourceAt(ws, pid, cid, n, abId) {
  const version = n ?? canvasStore.canvasHead(ws, pid, cid); // canvasHead 没定过版回 null → 读工作副本
  try { return canvasStore.canvasReader(ws, pid, cid, version).source(abId); } catch { return null; }
}

function artboardName(ws, pid, cid, abId) {
  try {
    for (const pg of canvasStore.canvasReader(ws, pid, cid, canvasStore.canvasHead(ws, pid, cid)).tree().pages) {
      const ab = pg.artboards.find((a) => a.id === abId);
      if (ab) return ab.name;
    }
  } catch { /* 用 id */ }
  return abId;
}

// 引用里的 id 就是画布 id（canvas:<画布>@<版本>#<画板>）。
export const resolver = {
  type: "canvas",
  label: "画布",
  head(ws, pid, id) {
    let cj;
    try { cj = canvasStore.listCanvases(ws, pid).some((c) => c.id === id) && canvasStore.readCanvasJson(ws, pid, id); } catch { return null; }
    return cj ? cj.head || 0 : null;
  },
  fingerprint(ws, pid, id, n, part) {
    if (!part || this.head(ws, pid, id) == null) return null;
    const src = sourceAt(ws, pid, id, n, part);
    return src == null ? null : contentHash(src);
  },
  describe(ws, pid, id, part) {
    const title = (() => { try { return (canvasStore.readCanvasJson(ws, pid, id) || {}).title || id; } catch { return id; } })();
    return part ? `画布「${title}」的画板「${artboardName(ws, pid, id, part)}」` : `画布「${title}」`;
  },
};

export function artifacts(ws, pid) {
  let canvases;
  try { canvases = canvasStore.listCanvases(ws, pid); } catch { return []; }
  return canvases.map((c) => {
    const st = canvasVersionState(ws, pid, c.id);
    const cj = canvasStore.readCanvasJson(ws, pid, c.id) || {};
    return {
      type: "canvas", id: c.id, title: cj.title || c.id, head: st.head, dirty: st.head > 0 && st.dirty,
      versions: (cj.versions || []).map((v) => ({ n: v.n, sources: v.sources || [], publishedTo: v.publishedTo || [] })),
    };
  });
}

export function health(ws, pid) {
  let tree;
  try { tree = canvasStore.loadProjectTree(ws, pid); } catch { return []; }
  const out = [];
  for (const pg of tree.pages) for (const abRef of pg.artboards) {
    if (!abRef.hasSource) continue;
    const ab = canvasStore.readArtboard(ws, pid, abRef.id);
    const lastValidated = ab.meta.lastValidatedHash ?? null;
    if (lastValidated !== ab.sourceHash) {
      out.push(finding("unvalidated", "unvalidated", `artboard:${abRef.id}`,
        `画板「${abRef.name}」源码存在未经编译校验的外部修改（当前 ${ab.sourceHash} ≠ 已校验 ${lastValidated}）`,
        `用 save_artboard_source 重新校验盖章`));
    }
    // 画板里画 Mermaid 只为兼容老画板保留（preview.js 的 MERMAID_INIT），新的图不画在画板里。这条提醒
    // 不写具体的画图产品名：画布不在文字里依赖别的产品。
    if (ab.source && /\bmermaid\b/.test(ab.source)) {
      out.push(finding("artboard_diagram", "advice", `artboard:${abRef.id}`,
        `画板「${abRef.name}」里画了 Mermaid 图。画板只做界面原型，图建议用专门的画图工具`,
        `把这张图挪到画图工具里（protoflow --help 看有哪些产品），画板里删掉；引用这块画板的地方一起改`));
    }
    // 标注 = 每块画板一篇 annotations.md，发现项是画板级的。
    const md = canvasStore.readAnnotationsMd(ws, pid, abRef.id);
    if (!md.trim()) continue;
    const brokenRefs = parseElementRefs(md).filter((eid) => !ab.elementIds.includes(eid));
    if (brokenRefs.length) {
      out.push(finding("annotation_broken", "broken", `annotation:${abRef.id}`,
        `画板「${abRef.name}」的 annotations.md 里引用的元素 ${brokenRefs.join("、")} 已不在源码中`,
        `修改源码恢复该元素，或用 write_annotations 改掉引用 / 删掉该段`));
    } else if ((ab.meta.annotationsValidatedHash ?? null) !== ab.sourceHash) {
      out.push(finding("annotation_review", "review", `annotation:${abRef.id}`,
        `画板「${abRef.name}」源码已变，annotations.md 上次核对于 ${ab.meta.annotationsValidatedHash || "(从未)"}`,
        `对照当前源码核对 annotations.md 仍准确后用 write_annotations 重新提交盖章`));
    }
  }
  // 定过版之后才提醒：从没定过版的画布本来就显示源文件，没有"没定版的改动看不到"的问题。
  for (const c of canvasStore.listCanvases(ws, pid)) {
    const st = canvasVersionState(ws, pid, c.id);
    if (st.head > 0 && st.dirty) {
      out.push(finding("canvas_uncommitted", "uncommitted", `canvas:${c.id}`,
        `画布「${c.title}」有 v${st.head} 之后没定版的改动，画布页上看不到`, `build_canvas(${c.id === canvasStore.DEFAULT_CANVAS_ID ? "" : `canvasId:"${c.id}", `}note:"…") 定一个新版本`));
    }
  }
  return out;
}
