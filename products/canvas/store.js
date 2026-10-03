// products/canvas/store.js — 画布的文件读写：画布、页面、画板、标注，画布的版本，以及画布页 / 画板
// 预览页的渲染入口。项目容器和通用实体接口来自框架（core/store.js）。
//
// 一个项目可以有多个画布（docs/product-architecture.md §4.2），每个画布是一个带版本的实体：
//   canvases/<canvasId>/canvas.json   { title, pageIds, head, versions, createdAt }
//   canvases/<canvasId>/pages/<pg>/page.json、pages/<pg>/artboards/<ab>/{source.jsx, meta.json, …}
//   canvases/<canvasId>/versions/<n>.json   不可变版本清单（路径相对画布本身）
//   canvases/<canvasId>/icons.jsx     可选，覆盖项目级 icons.jsx
// 页面 id、画板 id 在整个项目里唯一，按 id 就能找到它在哪个画布，所以页面/画板级的函数不用传画布 id。
import fs from "node:fs";
import path from "node:path";
import { assertSafeSegment, contentHash, ensureLibs, entityDir, freezeEntityVersion, listEntities, newId, normalizeLabels, openEntityVersion, projectDir, projectLibDir, readEntityJson, readJson, readProject, slugify, writeEntityJson, writeJson, writeProject } from "protoflow/sdk";
import { assetsDataMap } from "protoflow/sdk/internal";
import { CANVAS_LIBS, PREVIEW_LIB_FILES } from "./libs.js";
import { extractElementIds } from "./compile.js";
import { buildPreviewHtml } from "./preview.js";
import { buildCanvasHtml } from "./canvas.js";

export const CANVAS_ENTITY = { rootSeg: "canvases", metaFile: "canvas.json" };
// 项目里还没有画布时自动建的第一个画布的 id（迁移命令也把单画布时代的项目迁成这个 id）。
export const DEFAULT_CANVAS_ID = "main";

export function canvasDir(ws, pid, cid) { return entityDir(ws, pid, CANVAS_ENTITY, cid); }
export function readCanvasJson(ws, pid, cid) { return readEntityJson(ws, pid, CANVAS_ENTITY, cid); }
export function writeCanvasJson(ws, pid, cid, cj) { writeEntityJson(ws, pid, CANVAS_ENTITY, cid, cj); }
export function openCanvasVersion(ws, pid, cid, n) { return openEntityVersion(ws, pid, CANVAS_ENTITY, cid, n); }
export function freezeCanvasVersion(ws, pid, cid, n, files, meta) { return freezeEntityVersion(ws, pid, CANVAS_ENTITY, cid, n, files, meta); }

// 项目里的全部画布，按创建时间排。
export function listCanvases(ws, pid) {
  return listEntities(ws, pid, CANVAS_ENTITY)
    .map((e) => ({ ...e, createdAt: (readCanvasJson(ws, pid, e.id) || {}).createdAt || "" }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
}

export function createCanvas(ws, pid, { title, canvasId, labels } = {}, ctx) {
  if (!readProject(ws, pid)) throw new Error(`项目 ${pid} 不存在`);
  const tags = normalizeLabels(labels);
  const base = canvasId || slugify(title || "canvas");
  let id = base;
  for (let n = 2; readCanvasJson(ws, pid, id); n++) {
    if (canvasId) throw new Error(`画布 ${canvasId} 已存在`);
    id = `${base}-${n}`;
  }
  assertSafeSegment(id);
  const name = title || (readProject(ws, pid).name) || id;
  writeCanvasJson(ws, pid, id, { schemaVersion: 1, title: name, ...(tags.length ? { labels: tags } : {}), pageIds: [], head: 0, versions: [], createdAt: new Date(ctx.now()).toISOString() });
  return { id, title: name, labels: tags };
}

const coded = (code, msg) => Object.assign(new Error(msg), { code });

// 调用方没指定画布时用哪个：只有一个画布就是它；一个都没有就建 main（名字用项目名，建项目后直接建页面就行）；
// 有多个就要求指定。
export function resolveCanvasId(ws, pid, cid, ctx) {
  const list = listCanvases(ws, pid);
  if (cid) {
    if (!list.some((c) => c.id === cid)) throw coded("CANVAS_NOT_FOUND", `画布 ${cid} 不存在；有：${list.map((c) => c.id).join(", ") || "（无）"}`);
    return cid;
  }
  if (list.length === 1) return list[0].id;
  if (!list.length) {
    if (!ctx) throw coded("CANVAS_NOT_FOUND", `项目 ${pid} 还没有画布`);
    return createCanvas(ws, pid, { canvasId: DEFAULT_CANVAS_ID }, ctx).id;
  }
  throw coded("CANVAS_AMBIGUOUS", `项目有 ${list.length} 个画布，请传 canvasId：${list.map((c) => c.id).join(", ")}`);
}

// 页面 id → 所在画布 id，找不到回 null。
export function canvasOfPage(ws, pid, pgId) {
  for (const c of listCanvases(ws, pid)) {
    if (((readCanvasJson(ws, pid, c.id) || {}).pageIds || []).includes(pgId)) return c.id;
  }
  return null;
}

function pageDir(ws, pid, pgId) {
  const cid = canvasOfPage(ws, pid, pgId);
  if (!cid) throw new Error(`页面 ${pgId} 不存在`);
  return path.join(canvasDir(ws, pid, cid), "pages", assertSafeSegment(pgId));
}

export function pageDirPath(ws, projectId, pageId) { return pageDir(ws, projectId, pageId); }

export function artboardDir(ws, pid, abId) {
  const pgId = findPageOfArtboard(ws, pid, abId);
  return path.join(pageDir(ws, pid, pgId), "artboards", assertSafeSegment(abId));
}

// 画板 id → 所在画布 id（读版本、渲染画布页时用）。
export function canvasOfArtboard(ws, pid, abId) { return canvasOfPage(ws, pid, findPageOfArtboard(ws, pid, abId)); }

function pagesOfCanvas(ws, pid, cid) {
  const cdir = canvasDir(ws, pid, cid);
  return (((readCanvasJson(ws, pid, cid) || {}).pageIds) || []).map((pgId) => {
    const dir = path.join(cdir, "pages", pgId);
    const pg = readJson(path.join(dir, "page.json"), { id: pgId, name: pgId, artboardIds: [] });
    const artboards = (pg.artboardIds || []).map((abId) => {
      const abDir = path.join(dir, "artboards", abId);
      const meta = readJson(path.join(abDir, "meta.json"), { id: abId, name: abId });
      return { id: abId, name: meta.name, description: meta.description || "", format: meta.format || "jsx",
               status: meta.status || "draft", sourcePath: path.join(abDir, "source.jsx"),
               hasSource: fs.existsSync(path.join(abDir, "source.jsx")), canvasWidth: meta.canvasWidth || 1440,
               canvasHeight: meta.canvasHeight || null };
    });
    return { id: pg.id, name: pg.name, canvasId: cid, artboards };
  });
}

// 一个画布的树：{ id: 项目id, canvasId, name: 画布名, pages }。
export function loadCanvasTree(ws, pid, cid) {
  const cj = readCanvasJson(ws, pid, cid);
  if (!cj) throw new Error(`画布 ${cid} 不存在`);
  return { id: pid, canvasId: cid, name: cj.title || cid, pages: pagesOfCanvas(ws, pid, cid) };
}

// 整个项目的树：全部画布的页面汇在一起（每个页面带 canvasId），外加画布清单。
export function loadProjectTree(ws, projectId) {
  const pj = readProject(ws, projectId);
  if (!pj) throw new Error(`项目 ${projectId} 不存在`);
  const canvases = listCanvases(ws, projectId);
  const pages = canvases.flatMap((c) => pagesOfCanvas(ws, projectId, c.id));
  return { id: pj.id, name: pj.name, pages, canvases: canvases.map((c) => ({ id: c.id, title: c.title })) };
}

export function upsertPage(ws, projectId, { id, name, canvasId }, ctx) {
  if (!readProject(ws, projectId)) throw new Error(`项目 ${projectId} 不存在`);
  const cid = id ? canvasOfPage(ws, projectId, id) : resolveCanvasId(ws, projectId, canvasId, ctx);
  if (!cid) throw new Error(`页面 ${id} 不存在`);
  const cj = readCanvasJson(ws, projectId, cid);
  cj.pageIds = cj.pageIds || [];
  const pgId = id || newId("pg", ctx.now);
  const pgPath = path.join(canvasDir(ws, projectId, cid), "pages", assertSafeSegment(pgId), "page.json");
  const pg = readJson(pgPath, { schemaVersion: 1, id: pgId, name, artboardIds: [] });
  pg.name = name;
  writeJson(pgPath, pg);
  if (!cj.pageIds.includes(pgId)) { cj.pageIds.push(pgId); writeCanvasJson(ws, projectId, cid, cj); }
  return { id: pgId, name, canvasId: cid };
}

// canvasWidth：画布中该画板的真实像素宽度（Figma 式 Frame 宽度），省略则新建默认 1440、
// 更新已有画板时保留原值不变。
// canvasHeight：可选的固定高度声明（超出内容内部滚动，不再自动撑高）。省略时画板保持
// 自适应内容高度——加载时的占位高度改由 .protoflow/canvas.json 里每次真实渲染后自动
// 回填的测量缓存决定，不经过这个字段，所以这里不给默认值。
export function upsertArtboard(ws, projectId, pageId, { id, name, description = "", canvasWidth, canvasHeight }, ctx) {
  const pgPath = path.join(pageDir(ws, projectId, pageId), "page.json");
  const pg = readJson(pgPath, null);
  if (!pg) throw new Error(`页面 ${pageId} 不存在`);
  if (id && !pg.artboardIds.includes(id)) throw new Error(`画板 ${id} 不在页面 ${pageId} 下`);
  const abId = id || newId("ab", ctx.now);
  const metaPath = path.join(pageDir(ws, projectId, pageId), "artboards", abId, "meta.json");
  const meta = readJson(metaPath, { schemaVersion: 1, id: abId, format: "jsx", status: "draft", lastValidatedHash: null, canvasWidth: 1440 });
  Object.assign(meta, { name, description });
  if (canvasWidth != null) meta.canvasWidth = canvasWidth;
  if (meta.canvasWidth == null) meta.canvasWidth = 1440;
  if (canvasHeight != null) meta.canvasHeight = canvasHeight;
  writeJson(metaPath, meta);
  if (!pg.artboardIds.includes(abId)) { pg.artboardIds.push(abId); writeJson(pgPath, pg); }
  return { id: abId, name };
}

// artboardIds 必须是该页面现有画板 id 的一个全排列（顺序随便，集合必须完全一致）——
// 用完整顺序而不是"把 X 挪到 Y 前/后"这种相对指令，是因为前者没有歧义、也不用先查一遍现状
// 才能表达意图；调用方（模型）本来就得先读一遍 loadProjectTree 才知道有哪些画板，顺手把
// 目标顺序整体给出并不增加负担。
export function reorderArtboards(ws, projectId, pageId, artboardIds) {
  const pgPath = path.join(pageDir(ws, projectId, pageId), "page.json");
  const pg = readJson(pgPath, null);
  if (!pg) throw new Error(`页面 ${pageId} 不存在`);
  const before = pg.artboardIds || [];
  const beforeSet = new Set(before);
  const afterSet = new Set(artboardIds);
  if (before.length !== artboardIds.length || [...beforeSet].some((id) => !afterSet.has(id))) {
    throw new Error(`artboardIds 必须是页面 ${pageId} 现有画板的一个全排列；现有：${before.join(", ")}；收到：${artboardIds.join(", ")}`);
  }
  pg.artboardIds = artboardIds;
  writeJson(pgPath, pg);
  return { pageId, artboardIds };
}

export function findPageOfArtboard(ws, projectId, abId) {
  for (const c of listCanvases(ws, projectId)) {
    for (const pgId of ((readCanvasJson(ws, projectId, c.id) || {}).pageIds) || []) {
      const pg = readJson(path.join(canvasDir(ws, projectId, c.id), "pages", pgId, "page.json"), { artboardIds: [] });
      if ((pg.artboardIds || []).includes(abId)) return pgId;
    }
  }
  throw new Error(`画板 ${abId} 不存在`);
}

export function readArtboard(ws, projectId, abId) {
  const dir = artboardDir(ws, projectId, abId);
  const meta = readJson(path.join(dir, "meta.json"), null);
  if (!meta) throw new Error(`画板 ${abId} 不存在`);
  const sourcePath = path.join(dir, "source.jsx");
  const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : null;
  return { meta, source, sourcePath, dir,
           sourceHash: source == null ? null : contentHash(source),
           elementIds: source == null ? [] : extractElementIds(source) };
}

// 前置：调用方已通过 validateJsx。此处只落盘 + 盖章。
export function saveArtboardSource(ws, projectId, abId, source) {
  const dir = artboardDir(ws, projectId, abId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "source.jsx"), source);
  const metaPath = path.join(dir, "meta.json");
  const meta = readJson(metaPath, { id: abId });
  meta.lastValidatedHash = contentHash(source);
  meta.status = "ready";
  writeJson(metaPath, meta);
  return meta.lastValidatedHash;
}

export function deleteTarget(ws, projectId, targetId) {
  const pageCanvas = canvasOfPage(ws, projectId, targetId);
  if (pageCanvas) {
    fs.rmSync(pageDir(ws, projectId, targetId), { recursive: true, force: true });
    const cj = readCanvasJson(ws, projectId, pageCanvas);
    cj.pageIds = cj.pageIds.filter((x) => x !== targetId);
    writeCanvasJson(ws, projectId, pageCanvas, cj);
    return { deleted: "page", id: targetId };
  }
  let pgId;
  try { pgId = findPageOfArtboard(ws, projectId, targetId); } catch { throw new Error(`目标 ${targetId} 不存在`); }
  const pgPath = path.join(pageDir(ws, projectId, pgId), "page.json");
  const pg = readJson(pgPath, { artboardIds: [] });
  fs.rmSync(path.join(pageDir(ws, projectId, pgId), "artboards", targetId), { recursive: true, force: true });
  pg.artboardIds = pg.artboardIds.filter((x) => x !== targetId);
  writeJson(pgPath, pg);
  return { deleted: "artboard", id: targetId };
}

// 标注 = 每块画板 annotations.md（一篇 markdown）+ 可选 annotations.refs.json（元素要交互才可见时
// 的前置步骤，按元素 id）。meta.json.annotationsValidatedHash 记这份 md 上次对着哪版源码核对过。
export function annotationsMdPath(ws, projectId, abId) {
  return path.join(artboardDir(ws, projectId, abId), "annotations.md");
}

export function annotationsRefsPath(ws, projectId, abId) {
  return path.join(artboardDir(ws, projectId, abId), "annotations.refs.json");
}

export function readAnnotationsMd(ws, projectId, abId) {
  const p = annotationsMdPath(ws, projectId, abId);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

export function readAnnotationRefs(ws, projectId, abId) {
  return readJson(annotationsRefsPath(ws, projectId, abId), {});
}

export function readAnnotationValidatedHash(ws, projectId, abId) {
  const meta = readJson(path.join(artboardDir(ws, projectId, abId), "meta.json"), {});
  return meta.annotationsValidatedHash ?? null;
}

// 前置：调用方已校验（validateRefs 通过）。写 md、写/删 refs、把 meta.annotationsValidatedHash
// 盖成当前源码指纹。
export function writeAnnotationsMd(ws, projectId, abId, md, refs, sourceHash) {
  const dir = artboardDir(ws, projectId, abId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(annotationsMdPath(ws, projectId, abId), String(md ?? ""));
  const refsPath = annotationsRefsPath(ws, projectId, abId);
  if (refs && Object.keys(refs).length) writeJson(refsPath, refs);
  else if (fs.existsSync(refsPath)) fs.rmSync(refsPath);
  const metaPath = path.join(dir, "meta.json");
  const meta = readJson(metaPath, { id: abId });
  meta.annotationsValidatedHash = sourceHash ?? null;
  writeJson(metaPath, meta);
}

// vendored 依赖（react/babel）落项目级 lib/：只在缺文件时才拷。画板 preview.html 由本地预览服务
// 实时渲染（见 core/renderService.js），但它用相对路径 ../../../../lib 引这些库，所以文件本身必须
// 在磁盘上——首次渲染某项目的画板时补齐一次；只在真缺文件时才拷，不让每次 GET 都付拷 3.5MB mermaid 的成本。
export function ensurePreviewLibs(destDir) {
  ensureLibs(destDir, CANVAS_LIBS, PREVIEW_LIB_FILES);
}

// canvas.html 左侧标注侧边栏用 marked 渲染标注 content（完整 markdown）——同 ensurePreviewLibs，缺才拷。
export function ensureMarkedLib(destDir) {
  ensureLibs(destDir, CANVAS_LIBS, ["marked.min.js"]);
}

// 画布读取器：画布渲染（canvas.html、画板 preview.html）不直接读磁盘，经过它——草稿（工作副本）
// 和历史版本走同一条渲染路径，只是数据来源不同。形状：
//   tree()               → { name, pages:[{ id, name, artboards:[{ id, name, description, hasSource, canvasWidth, canvasHeight }] }] }
//   source(abId)         → source.jsx 文本或 null
//   annotationsMd(abId)  → annotations.md 文本（没有回 ""）
//   annotationRefs(abId) → annotations.refs.json 对象（没有回 {}）
//   icons()              → icons.jsx 文本（没有回 ""）
//   assetFiles(abId)     → [{ name, filePath }]，画板 assets/ 下的文件（导出拷文件/内联用）
function iconsSource(ws, pid, cid) {
  for (const p of [path.join(canvasDir(ws, pid, cid), "icons.jsx"), path.join(projectDir(ws, pid), "icons.jsx")]) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return "";
}
export function canvasIconsSource(ws, pid, cid) { return iconsSource(ws, pid, cid); }

function workingCanvasReader(ws, pid, cid) {
  return {
    tree: () => loadCanvasTree(ws, pid, cid),
    source: (abId) => readArtboard(ws, pid, abId).source,
    annotationsMd: (abId) => readAnnotationsMd(ws, pid, abId),
    annotationRefs: (abId) => readAnnotationRefs(ws, pid, abId),
    icons: () => iconsSource(ws, pid, cid),
    assetFiles: (abId) => {
      const dir = path.join(artboardDir(ws, pid, abId), "assets");
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => ({ name: f, filePath: path.join(dir, f) }));
    },
  };
}

// 画布第 n 版的读取器，没有这一版回 null。版本内布局见 core/canvasVersion.js 的 collectCanvasFiles：
// pages.json（页面顺序）、icons.jsx、pages/<pg>/page.json、pages/<pg>/artboards/<ab>/{meta.json,source.jsx,…}。
export function canvasVersionReader(ws, pid, cid, n) {
  const v = openCanvasVersion(ws, pid, cid, n);
  if (!v) return null;
  const json = (rel, fallback) => { const t = v.readText(rel); return t == null ? fallback : JSON.parse(t); };
  const pageIds = json("pages.json", { pageIds: [] }).pageIds || [];
  const abBase = new Map(); // abId → 版本内画板目录
  const pages = pageIds.map((pgId) => {
    const pg = json(`pages/${pgId}/page.json`, { id: pgId, name: pgId, artboardIds: [] });
    const artboards = (pg.artboardIds || []).map((abId) => {
      const base = `pages/${pgId}/artboards/${abId}`;
      abBase.set(abId, base);
      const meta = json(`${base}/meta.json`, { id: abId, name: abId });
      return { id: abId, name: meta.name, description: meta.description || "", hasSource: v.has(`${base}/source.jsx`),
               canvasWidth: meta.canvasWidth || 1440, canvasHeight: meta.canvasHeight || null };
    });
    return { id: pg.id, name: pg.name, artboards };
  });
  const file = (abId, name) => (abBase.has(abId) ? v.readText(`${abBase.get(abId)}/${name}`) : null);
  const title = (readCanvasJson(ws, pid, cid) || {}).title || cid;
  return {
    n,
    tree: () => ({ id: pid, canvasId: cid, name: title, pages }),
    source: (abId) => file(abId, "source.jsx"),
    annotationsMd: (abId) => file(abId, "annotations.md") || "",
    annotationRefs: (abId) => JSON.parse(file(abId, "annotations.refs.json") || "{}"),
    icons: () => v.readText("icons.jsx") || "",
    assetFiles: (abId) => (abBase.has(abId) ? v.list(`${abBase.get(abId)}/assets`) : [])
      .map((rel) => ({ name: rel.slice(rel.lastIndexOf("/") + 1), filePath: v.filePath(rel) })),
  };
}

// 画布的读取器：version 为 null 读工作副本，否则读第 version 版（没有这一版抛错）。
export function canvasReader(ws, pid, cid, version = null) {
  const reader = version == null ? workingCanvasReader(ws, pid, cid) : canvasVersionReader(ws, pid, cid, version);
  if (!reader) throw new Error(`画布 ${cid} 没有第 ${version} 版`);
  return reader;
}

// 画布最新版本号，没定过版回 null。画布页面、导出默认都看它；没定过版才用工作副本。
export function canvasHead(ws, pid, cid) {
  const cj = readCanvasJson(ws, pid, cid);
  return cj && cj.head ? cj.head : null;
}

// 第 n 版在画布页里的相对位置：画布页是 canvases/<id>/canvas.html，第 n 版的画板在
// canvases/<id>/versions/<n>/pages/<pg>/artboards/<ab>/preview.html，比工作副本的画板深 2 层。画板里
// assets/x 这种相对路径跟着落在版本下面，由本地服务按清单解析（画布注册描述的 resolveFile）。
export function canvasVersionBase(n) { return `versions/${n}/`; }

// 画板自包含 preview.html 的字符串——纯依据读取器当前内容投影，无内部状态、无计时器，相同输入
// 逐字节相同。本地预览服务每次 GET 现算一份（见 core/renderService.js）；不落盘，改 source.jsx /
// 标注 / git 撤回后刷新浏览器即最新。调用方负责在无源码时提前拒绝。
//
// 实时预览使用真实 lib/ 与 assets/ 相对路径（工作副本的画板在 canvases/<id>/pages/<pg>/artboards/<ab>/，
// 到项目级 lib/ 是 6 层）；导出传自己的 libRelPath，单 HTML 导出还传 inlineAssets=true 并把 libRelPath
// 换成供导出器替换的占位路径。version 传了就渲染画布第 n 版里的这块画板（要同时传 canvasId，画板在
// 工作副本里可能已经删了；不存在时抛错）。servedDeeper：页面比工作副本的画板还深几层（本地服务在
// canvases/<id>/versions/<n>/ 下提供第 n 版的画板时传 "../../"），只影响默认的 lib 路径。
export function artboardPreviewHtml(ws, projectId, abId, {
  libRelPath = null,
  inlineAssets = false,
  version = null,
  canvasId = null,
  servedDeeper = "",
} = {}) {
  const cid = canvasId || canvasOfArtboard(ws, projectId, abId);
  const reader = canvasReader(ws, projectId, cid, version);
  const source = reader.source(abId);
  if (source == null) throw new Error(`画板 ${abId} 尚无源码`);
  const abMeta = reader.tree().pages.flatMap((pg) => pg.artboards).find((a) => a.id === abId) || {};
  const lib = libRelPath || `../../../../../../${servedDeeper}lib`;
  if (!libRelPath) ensurePreviewLibs(projectLibDir(ws, projectId));
  return buildPreviewHtml({
    artboardId: abId, source, iconsSource: reader.icons(),
    assetsMap: inlineAssets ? assetsDataMap(reader.assetFiles(abId)) : null,
    libRelPath: lib, annotationsMd: reader.annotationsMd(abId),
    canvasWidth: abMeta.canvasWidth, canvasHeight: abMeta.canvasHeight,
  });
}

// 画布页在本地预览服务里的相对位置：canvases/<id>/canvas.html。不落盘，仅用于 toLocalUrl 推导对外
// URL（纯路径运算，不要求文件存在）。
export function canvasPath(ws, projectId, cid) {
  return path.join(canvasDir(ws, projectId, cid), "canvas.html");
}

// 整站画布 canvas.html 的字符串——全部页面 + 全部画板汇进同一份自包含文档，画板用 iframe 引各自
// 的 preview.html（相对路径，本地预览服务把那条路径也实时渲染，见 core/renderService.js）。纯依据
// 读取器当前内容投影，无副作用、多次调用逐字节相同；不落盘，加删/改名页面画板、首次写源码、
// git 撤回后刷新浏览器即最新。
// exportBundle 仅 core/exportCanvas.js 传，透传给 buildCanvasHtml（渲一次写盘用，见那边的注释）。
// opts.version：渲染画布第 n 版（不存在时抛错），缺省读工作副本。opts.framePrefix：画板 iframe 地址
// 的前缀（本地服务看第 n 版时是 canvasVersionBase(n)；导出把画板写在 pages/ 下，不带前缀）。
// opts.libRelPath：lib/ 的相对位置（本地服务的画布页在 canvases/<id>/ 下，是 "../../lib"；导出是 "lib"）。
// opts.versioning：版本下拉的数据 { head, current, versions:[{ n, note, builtAt }] }，不传就不显示。
export function canvasHtml(ws, projectId, cid, exportBundle = null, opts = {}) {
  const reader = canvasReader(ws, projectId, cid, opts.version ?? null);
  const tree = reader.tree();
  ensureMarkedLib(projectLibDir(ws, projectId)); // 侧边栏标注 content 用 marked 渲染
  const pages = tree.pages.map((pg) => ({
    id: pg.id, name: pg.name,
    artboards: pg.artboards.map((ab) => {
      // 标注 = 一篇 markdown（annotations.md）+ refs（元素要交互才可见时的前置步骤，按元素 id）。
      // 左侧侧边栏把当前页面各画板的 md 拼成一篇文章渲染，定位/高亮由画板 iframe 负责
      // （见 core/preview.js 的 __pfFlashElement / __pfHighlightElements）。
      const md = ab.hasSource ? reader.annotationsMd(ab.id) : "";
      return {
        id: ab.id, name: ab.name, description: ab.description, hasSource: ab.hasSource, canvasWidth: ab.canvasWidth,
        canvasHeight: ab.canvasHeight,
        annotationsMd: md, annotationRefs: md.trim() ? reader.annotationRefs(ab.id) : {},
      };
    }),
  }));
  const pdir = projectDir(ws, projectId);
  // 每块画板上一次真实渲染后测量到的高度（core/canvas.js 的 postMessage 处理器节流回写，见那边
  // 注释），用作初始占位高度，不用从 width*0.72 猜起——只在实时预览用，导出产物是某一时刻的自
  // 包含快照，不依赖这份没有随项目进 git 的本地运行时缓存（见 .gitignore 的 .protoflow/）。
  const heightCache = exportBundle || opts.localState === false ? null : readJson(path.join(pdir, ".protoflow", "canvas.json"), {}).artboardHeights || null;
  return buildCanvasHtml({
    projectName: tree.name, projectId, canvasId: cid, pages, exportBundle, heightCache,
    framePrefix: opts.framePrefix || "", libRelPath: opts.libRelPath || "lib",
    versioning: opts.versioning || null,
  });
}
