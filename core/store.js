// core/store.js — 唯一 FS 边界。ws = workspace 绝对路径，由调用方（MCP 层/测试）提供。
import fs from "node:fs";
import path from "node:path";
import { contentHash, objectHash } from "./hash.js";
import { newId, slugify, assertSafeSegment } from "./ids.js";
import { extractElementIds } from "./compile.js";
import { parseElementRefs } from "./annotations.js";
import { buildPreviewHtml, copyPreviewLibs, readAssetsMap, copyMarkedLib, copyMermaidLib, PREVIEW_LIB_FILES } from "./preview.js";
import { buildCanvasHtml } from "./canvas.js";
import { buildAgentsDoc } from "./agentsDoc.js";
import { renderDocPreviewHtml, usesMermaidDoc } from "./docPreview.js";
import { resolveKind } from "./docKinds.js";

const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback);
const writeJson = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n"); };

export function projectDir(ws, projectId) { return path.join(ws, assertSafeSegment(projectId)); }
const pageDir = (ws, pid, pgId) => path.join(projectDir(ws, pid), "pages", assertSafeSegment(pgId));
export function pageDirPath(ws, projectId, pageId) { return pageDir(ws, projectId, pageId); }
export function artboardDir(ws, pid, abId) {
  const pgId = findPageOfArtboard(ws, pid, abId);
  return path.join(pageDir(ws, pid, pgId), "artboards", assertSafeSegment(abId));
}
// 通用文档基座：docs/<docId>/（工作草稿 doc.md + doc.json）+ docs/<docId>/versions/<n>/（不可变
// 快照）。取代原来的 prd/<versionId>/——版本不再有 id，就是 versions/ 下的整数下标。
export function docsRoot(ws, pid) { return path.join(projectDir(ws, pid), "docs"); }
export function docDir(ws, pid, docId) { return path.join(docsRoot(ws, pid), assertSafeSegment(docId)); }
export function docVersionDir(ws, pid, docId, n) {
  return path.join(docDir(ws, pid, docId), "versions", assertSafeSegment(String(n)));
}
export function projectLibDir(ws, pid) { return path.join(projectDir(ws, pid), "lib"); }

export function readDocJson(ws, pid, docId) {
  return readJson(path.join(docDir(ws, pid, docId), "doc.json"), null);
}
export function writeDocJson(ws, pid, docId, dj) {
  writeJson(path.join(docDir(ws, pid, docId), "doc.json"), dj);
}

// 实时派生的文档清单（决策：不落 docs/index.json，唯一真相是各 doc.json）。
export function listDocs(ws, pid) {
  const root = docsRoot(ws, pid);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const id of fs.readdirSync(root)) {
    const dj = readJson(path.join(root, id, "doc.json"), null);
    if (!dj) continue;
    const published = (dj.versions || []).some((v) => (v.publishedTo || []).length);
    out.push({ id, kind: dj.kind, title: dj.title || id, head: dj.head || 0, updatedAt: dj.updatedAt || "", published });
  }
  return out;
}

export function listProjects(ws) {
  if (!fs.existsSync(ws)) return [];
  return fs.readdirSync(ws)
    .filter((d) => fs.existsSync(path.join(ws, d, "project.json")))
    .map((d) => { const pj = readJson(path.join(ws, d, "project.json"), {}); return { id: pj.id, name: pj.name }; });
}

// 项目目录名 = 项目名的 slug（人类可读，直接在文件系统里就能认出项目），同名冲突时加序号后缀。
function uniqueProjectId(ws, name) {
  const base = slugify(name);
  if (!fs.existsSync(path.join(ws, base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!fs.existsSync(path.join(ws, candidate))) return candidate;
  }
}

// 项目根目录自描述文档：任何 agent 不挂 protoflow 这个 MCP，靠这份文档也能接手项目。
export function writeAgentsDocs(ws, projectId, projectName) {
  const doc = buildAgentsDoc({ projectId, projectName });
  const dir = projectDir(ws, projectId);
  fs.writeFileSync(path.join(dir, "AGENTS.md"), doc);
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), doc);
}

export function createProject(ws, name, ctx) {
  const id = uniqueProjectId(ws, name);
  writeJson(path.join(ws, id, "project.json"), { schemaVersion: 1, id, name, pageIds: [] });
  writeAgentsDocs(ws, id, name);
  return { id, name };
}

export function loadProjectTree(ws, projectId) {
  const pj = readJson(path.join(projectDir(ws, projectId), "project.json"), null);
  if (!pj) throw new Error(`项目 ${projectId} 不存在`);
  const pages = (pj.pageIds || []).map((pgId) => {
    const pg = readJson(path.join(pageDir(ws, projectId, pgId), "page.json"), { id: pgId, name: pgId, artboardIds: [] });
    const artboards = (pg.artboardIds || []).map((abId) => {
      const dir = path.join(pageDir(ws, projectId, pgId), "artboards", abId);
      const meta = readJson(path.join(dir, "meta.json"), { id: abId, name: abId });
      return { id: abId, name: meta.name, description: meta.description || "", format: meta.format || "jsx",
               status: meta.status || "draft", sourcePath: path.join(dir, "source.jsx"),
               hasSource: fs.existsSync(path.join(dir, "source.jsx")), canvasWidth: meta.canvasWidth || 1440 };
    });
    return { id: pg.id, name: pg.name, artboards };
  });
  return { id: pj.id, name: pj.name, pages };
}

export function upsertPage(ws, projectId, { id, name }, ctx) {
  const pjPath = path.join(projectDir(ws, projectId), "project.json");
  const pj = readJson(pjPath, null);
  if (!pj) throw new Error(`项目 ${projectId} 不存在`);
  if (id && !pj.pageIds.includes(id)) throw new Error(`页面 ${id} 不存在`);
  const pgId = id || newId("pg", ctx.now);
  const pgPath = path.join(pageDir(ws, projectId, pgId), "page.json");
  const pg = readJson(pgPath, { schemaVersion: 1, id: pgId, name, artboardIds: [] });
  pg.name = name;
  writeJson(pgPath, pg);
  if (!pj.pageIds.includes(pgId)) { pj.pageIds.push(pgId); writeJson(pjPath, pj); }
  return { id: pgId, name };
}

// canvasWidth：画布中该画板的真实像素宽度（Figma 式 Frame 宽度），省略则新建默认 1440、
// 更新已有画板时保留原值不变。
export function upsertArtboard(ws, projectId, pageId, { id, name, description = "", canvasWidth }, ctx) {
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
  const pj = readJson(path.join(projectDir(ws, projectId), "project.json"), null);
  if (!pj) throw new Error(`项目 ${projectId} 不存在`);
  for (const pgId of pj.pageIds || []) {
    const pg = readJson(path.join(pageDir(ws, projectId, pgId), "page.json"), { artboardIds: [] });
    if ((pg.artboardIds || []).includes(abId)) return pgId;
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
  const pjPath = path.join(projectDir(ws, projectId), "project.json");
  const pj = readJson(pjPath, null);
  if (!pj) throw new Error(`项目 ${projectId} 不存在`);
  if ((pj.pageIds || []).includes(targetId)) {
    fs.rmSync(pageDir(ws, projectId, targetId), { recursive: true, force: true });
    pj.pageIds = pj.pageIds.filter((x) => x !== targetId);
    writeJson(pjPath, pj);
    return { deleted: "page", id: targetId };
  }
  for (const pgId of pj.pageIds || []) {
    const pgPath = path.join(pageDir(ws, projectId, pgId), "page.json");
    const pg = readJson(pgPath, { artboardIds: [] });
    if ((pg.artboardIds || []).includes(targetId)) {
      fs.rmSync(path.join(pageDir(ws, projectId, pgId), "artboards", targetId), { recursive: true, force: true });
      pg.artboardIds = pg.artboardIds.filter((x) => x !== targetId);
      writeJson(pgPath, pg);
      return { deleted: "artboard", id: targetId };
    }
  }
  throw new Error(`目标 ${targetId} 不存在`);
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

export function loadChainSnapshot(ws, projectId) {
  const tree = loadProjectTree(ws, projectId);
  const artboards = [];
  for (const pg of tree.pages) for (const abRef of pg.artboards) {
    if (!abRef.hasSource) continue;
    const ab = readArtboard(ws, projectId, abRef.id);
    const md = readAnnotationsMd(ws, projectId, abRef.id);
    artboards.push({
      id: abRef.id, name: abRef.name, sourceHash: ab.sourceHash,
      lastValidatedHash: ab.meta.lastValidatedHash ?? null, elementIds: ab.elementIds,
      hasAnnotations: md.trim().length > 0,
      annotationRefElementIds: parseElementRefs(md),
      annotationsValidatedHash: ab.meta.annotationsValidatedHash ?? null,
    });
  }
  const docs = listDocs(ws, projectId).map((d) => {
    const dj = readDocJson(ws, projectId, d.id) || {};
    const mdPath = path.join(docDir(ws, projectId, d.id), "doc.md");
    const workingMdHash = fs.existsSync(mdPath) ? contentHash(fs.readFileSync(mdPath, "utf8")) : null;
    return {
      id: d.id,
      kind: dj.kind || d.kind,
      origin: dj.origin || null,
      head: dj.head || 0,
      workingMdHash,
      versions: (dj.versions || []).map((v) => ({
        n: v.n,
        mdHash: v.mdHash ?? null,
        docHash: v.docHash ?? null,
        sourceFingerprints: v.sourceFingerprints || {},
        publishedTo: v.publishedTo || [],
      })),
    };
  });
  return { artboards, docs };
}

// vendored 依赖（react/babel）落项目级 lib/：只在缺文件时才拷。画板 preview.html 由本地预览服务
// 实时渲染（见 core/renderService.js），但它用相对路径 ../../../../lib 引这些库，所以文件本身必须
// 在磁盘上——首次渲染某项目的画板时补齐一次；copyPreviewLibs 每次无条件拷 3.5MB 的 mermaid，不该
// 每次 GET 都付这个成本，所以这里只在真缺文件时才拷。
export function ensurePreviewLibs(destDir) {
  if (PREVIEW_LIB_FILES.some((f) => !fs.existsSync(path.join(destDir, f)))) copyPreviewLibs(destDir);
}

// canvas.html 左侧标注侧边栏用 marked 渲染标注 content（完整 markdown）——同 ensurePreviewLibs，缺才拷。
export function ensureMarkedLib(destDir) {
  if (!fs.existsSync(path.join(destDir, "marked.min.js"))) copyMarkedLib(destDir);
}

// 画板自包含 preview.html 的字符串——纯依据磁盘当前内容投影，无内部状态、无计时器，相同输入
// 逐字节相同。本地预览服务每次 GET 现算一份（见 core/renderService.js）；不落盘，改 source.jsx /
// 标注 / git 撤回后刷新浏览器即最新。调用方负责在无源码时提前拒绝。
//
// libRelPath 默认指向项目真实的 lib/ 目录（实时预览/zip 导出用）；单 HTML 导出
// （core/exportCanvasHtml.js）传一个占位路径（不对应任何真实文件，运行时由父文档换成 Blob
// URL，见 core/libCodec.js）——这种情况不需要、也不该去 ensurePreviewLibs 白白落盘一份用不上
// 的 lib/ 目录，所以只在用默认路径时才落这一步盘。
export function artboardPreviewHtml(ws, projectId, abId, libRelPath = "../../../../lib") {
  const ab = readArtboard(ws, projectId, abId);
  if (ab.source == null) throw new Error(`画板 ${abId} 尚无源码`);
  if (libRelPath === "../../../../lib") ensurePreviewLibs(projectLibDir(ws, projectId));
  const iconsPath = path.join(projectDir(ws, projectId), "icons.jsx");
  const iconsSource = fs.existsSync(iconsPath) ? fs.readFileSync(iconsPath, "utf8") : "";
  return buildPreviewHtml({
    artboardId: abId, source: ab.source, iconsSource,
    assetsMap: readAssetsMap(path.join(ab.dir, "assets")),
    libRelPath, annotationsMd: readAnnotationsMd(ws, projectId, abId),
  });
}

// 渲染这个文档唯一的阅读页 docs/<docId>/preview.html——一个自包含 SPA，内嵌**全部版本**的原始
// markdown，版本切换在页内重渲染 + history 改 ?v=<n>，不跳转（参考 Artifacts）。versions/<n>/ 只
// 存冻结内容（doc.md / manifest.json / assets/），不再有各自的 html。lib 落项目级 lib/。
export function renderDocPreview(ws, projectId, docId) {
  const dj = readDocJson(ws, projectId, docId);
  if (!dj || !(dj.versions || []).length) return { rendered: false };
  const pdir = projectDir(ws, projectId);
  const lib = projectLibDir(ws, projectId);
  const labelCache = new Map();
  const kindLabelOf = (k) => {
    if (!labelCache.has(k)) { const m = resolveKind(pdir, k); labelCache.set(k, m ? m.label : k); }
    return labelCache.get(k);
  };
  const kindLabel = kindLabelOf(dj.kind);
  // 同项目**所有**其它文档（跨类型），阅读页左上角菜单按类型分组用。只带名字 + 入口，不带版本：
  // preview.html 是 finalize 冻结的快照，别的文档发新版这页不会重建，带上版本列表会过期；各文档
  // 的版本在它自己那页的同一个菜单里看。
  const siblings = listDocs(ws, projectId)
    .filter((d) => d.id !== docId)
    .map((d) => ({ id: d.id, kind: d.kind, kindLabel: kindLabelOf(d.kind), title: d.title, href: `../${d.id}/preview.html` }));

  // 每版的原始 markdown，图片引用改写成版本作用域路径：![](assets/x) → ![](versions/<n>/assets/x)
  // （阅读页在 docs/<docId>/preview.html，各版本的 assets 在 versions/<n>/assets/）。
  const versions = dj.versions.map((v) => {
    let md = fs.readFileSync(path.join(docVersionDir(ws, projectId, docId, v.n), "doc.md"), "utf8");
    md = md.replace(/\]\(assets\//g, `](versions/${v.n}/assets/`);
    return { n: v.n, md, note: v.note || "", author: v.author || "", builtAt: v.builtAt || "" };
  });
  const anyMermaid = versions.some((v) => usesMermaidDoc(v.md));

  copyMarkedLib(lib);
  if (anyMermaid) copyMermaidLib(lib);

  const html = renderDocPreviewHtml({
    versions, head: dj.head, title: dj.title || docId, kind: dj.kind, kindLabel, siblings, anyMermaid,
    libRelPath: "../../lib",
  });
  const headPreviewPath = path.join(docDir(ws, projectId, docId), "preview.html");
  fs.writeFileSync(headPreviewPath, html);
  return { rendered: true, headPreviewPath };
}

// 整站画布在本地预览服务里的相对位置——项目根目录下的 canvas.html。不落盘，仅用于 toLocalUrl
// 推导对外 URL（纯路径运算，不要求文件存在）。
export function canvasPath(ws, projectId) {
  return path.join(projectDir(ws, projectId), "canvas.html");
}

// 整站画布 canvas.html 的字符串——全部页面 + 全部画板汇进同一份自包含文档，画板用 iframe 引各自
// 的 preview.html（相对路径，本地预览服务把那条路径也实时渲染，见 core/renderService.js）。纯依据
// 磁盘当前结构 + 每块画板标注数投影，无副作用、多次调用逐字节相同；不落盘，加删/改名页面画板、
// 首次写源码、git 撤回后刷新浏览器即最新。
// exportBundle 仅 core/exportCanvas.js 传，透传给 buildCanvasHtml（渲一次写盘用，见那边的注释）。
export function canvasHtml(ws, projectId, exportBundle = null) {
  const tree = loadProjectTree(ws, projectId);
  ensureMarkedLib(projectLibDir(ws, projectId)); // 侧边栏标注 content 用 marked 渲染
  const pages = tree.pages.map((pg) => ({
    id: pg.id, name: pg.name,
    artboards: pg.artboards.map((ab) => {
      // 标注 = 一篇 markdown（annotations.md）+ refs（元素要交互才可见时的前置步骤，按元素 id）。
      // 左侧侧边栏把当前页面各画板的 md 拼成一篇文章渲染，定位/高亮由画板 iframe 负责
      // （见 core/preview.js 的 __pfFlashElement / __pfHighlightElements）。
      const md = ab.hasSource ? readAnnotationsMd(ws, projectId, ab.id) : "";
      return {
        id: ab.id, name: ab.name, description: ab.description, hasSource: ab.hasSource, canvasWidth: ab.canvasWidth,
        annotationsMd: md, annotationRefs: md.trim() ? readAnnotationRefs(ws, projectId, ab.id) : {},
      };
    }),
  }));
  const pdir = projectDir(ws, projectId);
  const docs = listDocs(ws, projectId).map((d) => {
    const kind = resolveKind(pdir, d.kind);
    return { ...d, kindLabel: kind ? kind.label : d.kind };
  });
  return buildCanvasHtml({ projectName: tree.name, projectId, pages, docs, exportBundle });
}
