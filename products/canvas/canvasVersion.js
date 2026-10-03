// core/canvasVersion.js — 画布的版本，跟文档/表格同一个模型（docs/product-architecture.md §4.1）：
// 改完一轮 build_canvas(note) 把当前工作副本冻结成第 n 版；画布页 canvas.html 默认看最新版，
// ?v=<n> 看历史版本（core/renderService.js）。存储走框架层的内容寻址版本存储（core/versionStore.js）：
// 没改过的画板源码、图片跨版本只存一份，每次定版冻结整个画布也不会让项目膨胀。
//
// 版本内布局（路径相对画布本身，工作副本以后挪进 canvases/<id>/ 也不影响已冻结的版本）：
//   pages.json                                  { pageIds }，页面顺序
//   icons.jsx                                   项目共享图标（有才有）
//   pages/<pg>/page.json                        页面名 + 画板顺序
//   pages/<pg>/artboards/<ab>/<画板目录里的文件>  source.jsx、meta.json、annotations.md、assets/… 原样
//
// 每版在 meta 里记 canvasHash（整份画布的指纹，判断有没有未定版的改动）。别人引用某块画板时比较的
// 指纹不存在这里，由引用解析器按那一版的 source.jsx 现算（core/canvasProduct.js）。
import fs from "node:fs";
import path from "node:path";
import { assetSources, hashBytes, isSourceSidecar, objectHash, versionSources } from "protoflow/sdk";
import * as canvasStore from "./store.js";

const fail = (code, message, hint) => ({ ok: false, error: { code, message, ...(hint ? { hint } : {}) } });
const iso = (ctx) => new Date(ctx.now()).toISOString();

// 画板目录里的文件，隐藏文件（.DS_Store 之类）不算内容。
function walkFiles(dir, base = "") {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...walkFiles(path.join(dir, ent.name), rel));
    else if (ent.isFile()) out.push(rel);
  }
  return out.sort();
}

// 某个画布工作副本里构成画布的全部文件：[{ path, data }]（data 是 Buffer）。只收 canvas.json / page.json
// 里登记了的页面和画板——目录里残留的孤儿不进版本。icons.jsx 冻结的是这个画布实际生效的那份
// （画布自己的覆盖了项目级的）。
export function collectCanvasFiles(ws, pid, cid) {
  const cj = canvasStore.readCanvasJson(ws, pid, cid) || {};
  const pageIds = cj.pageIds || [];
  const files = [{ path: "pages.json", data: Buffer.from(JSON.stringify({ pageIds }, null, 2) + "\n") }];
  const icons = canvasStore.canvasIconsSource(ws, pid, cid);
  if (icons) files.push({ path: "icons.jsx", data: Buffer.from(icons) });
  for (const pgId of pageIds) {
    const pgDir = path.join(canvasStore.canvasDir(ws, pid, cid), "pages", pgId);
    const pgJson = path.join(pgDir, "page.json");
    if (!fs.existsSync(pgJson)) continue;
    const pgBuf = fs.readFileSync(pgJson);
    files.push({ path: `pages/${pgId}/page.json`, data: pgBuf });
    for (const abId of JSON.parse(pgBuf.toString("utf8")).artboardIds || []) {
      const abDir = path.join(pgDir, "artboards", abId);
      for (const rel of walkFiles(abDir)) {
        files.push({ path: `pages/${pgId}/artboards/${abId}/${rel}`, data: fs.readFileSync(path.join(abDir, ...rel.split("/"))) });
      }
    }
  }
  return files;
}

// 整份画布的指纹："路径 → 内容哈希"表的 objectHash，跟版本清单里的哈希同源。
export function canvasHash(files) {
  return objectHash(Object.fromEntries(files.map((f) => [f.path, hashBytes(f.data)])));
}

// 定版：把当前工作副本冻结成第 n 版。note 必填（一句话说清这次改了什么）。内容跟 head 一样也照常
// 出新版本（跟文档/表格一致），返回里 unchanged:true 提示一下。opts.sources 是这次声明的引用
// （入口层已校验并固定版本；没传就沿用上一版声明的），画板 assets/ 里素材自带的出处自动收进来。
// opts.canvasId 缺省：项目只有一个画布时就是它。
export function buildCanvas(ws, pid, opts, ctx) {
  const note = (opts.note || "").trim();
  if (!note) return fail("NOTE_REQUIRED", "build_canvas 需要 note（一句话说清这次改了什么，进版本记录）");
  if (!canvasStore.listCanvases(ws, pid).length) return fail("NO_PAGES", "项目尚无页面，没有可定版的画布内容，请先 upsert_page");
  let cid;
  try { cid = canvasStore.resolveCanvasId(ws, pid, opts.canvasId); } catch (e) { return fail("CANVAS_NOT_FOUND", e.message); }
  const tree = canvasStore.loadCanvasTree(ws, pid, cid);
  if (!tree.pages.length) return fail("NO_PAGES", "画布尚无页面，没有可定版的内容，请先 upsert_page");

  const files = collectCanvasFiles(ws, pid, cid);
  const hash = canvasHash(files);
  const cj = canvasStore.readCanvasJson(ws, pid, cid);
  cj.versions = cj.versions || [];
  const headV = cj.versions.find((v) => v.n === cj.head);
  const sources = versionSources({ declared: opts.sources, previous: headV && headV.sources, derived: assetSources(files.filter((f) => isSourceSidecar(f.path))) });
  const n = (cj.head || 0) + 1;
  const now = iso(ctx);
  try {
    canvasStore.freezeCanvasVersion(ws, pid, cid, n, files, { canvasHash: hash, builtAt: now, sources });
  } catch (e) {
    return fail("CANVAS_WRITE_FAILED", `冻结画布第 ${n} 版时写入失败：${e.message}`);
  }
  cj.versions.push({ n, note, label: (opts.label || "").trim(), author: opts.author || ctx.author || "", builtAt: now,
                     canvasHash: hash, sources, publishedTo: [] });
  cj.head = n;
  cj.updatedAt = now;
  canvasStore.writeCanvasJson(ws, pid, cid, cj);
  const artboardCount = tree.pages.reduce((k, pg) => k + pg.artboards.length, 0);
  return { ok: true, canvasId: cid, version: n, canvasHash: hash, artboardCount, unchanged: !!headV && headV.canvasHash === hash };
}

// 画布版本状态：head、全部版本、工作副本有没有 head 之后没定版的改动。没定过版 head 为 0，
// dirty 恒为 true（全部内容都还没定版）。
export function canvasVersionState(ws, pid, cid) {
  const cj = canvasStore.readCanvasJson(ws, pid, cid);
  const versions = (cj && cj.versions) || [];
  const head = (cj && cj.head) || 0;
  const headV = versions.find((v) => v.n === head);
  let dirty = true;
  if (headV) {
    try { dirty = canvasHash(collectCanvasFiles(ws, pid, cid)) !== headV.canvasHash; }
    catch { dirty = true; }
  }
  return {
    head, dirty,
    versions: versions.map((v) => ({ n: v.n, note: v.note || "", label: v.label || "", author: v.author || "", builtAt: v.builtAt || "" })),
  };
}
