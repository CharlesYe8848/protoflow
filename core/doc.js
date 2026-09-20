// core/doc.js — 通用文档基座（原 core/prd.js）。核心不认识任何文档类型：类型差异全在
// doc-kinds/<kind>/（模板 + 撰写规范 + checks），行为从内容里掉出来（有 sourceFingerprints 才追
// 画板漂移、有 **待确认** 标记才拦发布），不靠 flag。
//
// 版本模型照 Artifacts：文档有身份（docs/<docId>/），版本没有 id，就是 versions/<n>/ 的整数下标；
// 只有显式 build_doc(mode:"finalize", note:) 才产生一个版本。
//
// 两个 mode：
//   snapshot：读 .build/captures.json，把引用到的画板源码/标注冻结进 .build/snapshot/，供
//     build_publish_pack 截图。只写 .build/，不产生版本。
//   finalize：doc.md 已手写好、（用截图流水线的话）截图已 seal。校验图片引用 → 算指纹 →
//     冻结成 versions/<n>/ → 重渲染 preview.html（含自动生成的修改记录表）→ 跑 checks。
import fs from "node:fs";
import path from "node:path";
import { contentHash, objectHash } from "./hash.js";
import { captureInputHash } from "./captureProvenance.js";
import { isValidDocId } from "./ids.js";
import * as store from "./store.js";
import { copyPreviewLibs, buildPreviewHtml, readAssetsMap } from "./preview.js";
import { resolveKind, listKinds } from "./docKinds.js";
import { runChecks } from "./checkRunner.js";

const fail = (code, message, hint) => ({ ok: false, error: { code, message, ...(hint ? { hint } : {}) } });
const iso = (ctx) => new Date(ctx.now()).toISOString();

// doc.md 里引用截图/资产的标准写法：![说明](assets/<file>)。只校验这一种来源，外部图床/手画图
// 用完整 URL，不受约束。
const ASSET_REF_RE = /!\[[^\]]*\]\(assets\/([^)\s]+)\)/g;
function referencedAssets(md) {
  const out = new Set();
  let m;
  ASSET_REF_RE.lastIndex = 0;
  while ((m = ASSET_REF_RE.exec(md))) out.add(m[1]);
  return [...out];
}

function h1Title(md, fallback) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

// 从 doc-kinds/<kind>/template.md 里抽起始骨架：优先第一个 ```markdown fenced block，否则整份
// 文件，否则一个最小骨架。
function seedFromTemplate(templatePath) {
  const MIN = "# 标题\n\n<!-- protoflow:changelog -->\n";
  if (!templatePath || !fs.existsSync(templatePath)) return MIN;
  const raw = fs.readFileSync(templatePath, "utf8");
  const fenced = raw.match(/```(?:markdown|md)\n([\s\S]*?)\n```/);
  return (fenced ? fenced[1] : raw).trim() + "\n";
}

// from: "prd" → 该文档 head 版本；"prd@3" → 版本 3。
function parseFrom(ws, pid, from) {
  const [fromId, vRaw] = String(from).split("@");
  const dj = store.readDocJson(ws, pid, fromId);
  if (!dj) return { error: fail("ORIGIN_NOT_FOUND", `from 指向的文档 ${fromId} 不存在`) };
  const version = vRaw ? Number(vRaw) : (dj.head || 0);
  if (!version) return { error: fail("ORIGIN_NOT_BUILT", `from 指向的文档 ${fromId} 还没有任何版本`) };
  return { origin: { docId: fromId, version } };
}

export function createDoc(ws, pid, opts, ctx) {
  const kindMeta = resolveKind(store.projectDir(ws, pid), opts.kind);
  if (!kindMeta) {
    const avail = listKinds(store.projectDir(ws, pid)).map((k) => k.kind).join(", ");
    return fail("KIND_UNKNOWN", `未知文档类型 ${opts.kind}；可用：${avail || "（无）"}`);
  }
  // docId（= 目录名）默认就是类型名（docs/prd/、docs/release-note/）——一个项目一种类型一篇是常态，
  // 类型名当目录名最直白。同类型要多篇时才显式传 docId（可含中文）。title 不参与目录命名，只用来
  // 填 doc.md 的一级标题和 doc.json.title（主题一句话，不带项目名/类型字样/版本号）。
  const docId = opts.docId || opts.kind;
  if (!isValidDocId(docId)) return fail("BAD_DOC_ID", `docId 不合法：${docId}（人类可读 slug，可含中文，不以连字符开头/收尾、无连续连字符、无斜杠空白）`);
  const dir = store.docDir(ws, pid, docId);
  if (fs.existsSync(dir)) return fail("DOC_EXISTS", `文档 ${docId} 已存在`);

  let origin = null;
  if (opts.from) {
    const r = parseFrom(ws, pid, opts.from);
    if (r.error) return r.error;
    origin = [r.origin];
  }

  let md = seedFromTemplate(kindMeta.templatePath);
  // 有 title 就直接把骨架里的一级标题占位替换掉，省得建完还要手动改 H1
  if (opts.title) md = md.replace(/^#\s+.*$/m, `# ${opts.title.trim()}`);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "doc.md"), md);
  const now = iso(ctx);
  store.writeDocJson(ws, pid, docId, {
    schemaVersion: 1, kind: opts.kind, title: h1Title(md, docId), template: opts.kind,
    origin, head: 0, versions: [], createdAt: now, updatedAt: now,
  });
  return { ok: true, docId, kind: opts.kind, kindLabel: kindMeta.label, contextSource: kindMeta.contextSource, docMdPath: path.join(dir, "doc.md") };
}

// ---- snapshot ----

function buildSnapshot(ws, pid, docId, ctx) {
  if (!isValidDocId(docId)) return fail("BAD_DOC_ID", `docId 不合法：${docId}`);
  const dir = store.docDir(ws, pid, docId);
  if (!fs.existsSync(dir)) return fail("DOC_NOT_FOUND", `文档 ${docId} 不存在，先 create_doc`);
  const capsPath = path.join(dir, ".build", "captures.json");
  if (!fs.existsSync(capsPath)) return fail("CAPTURES_MISSING", `缺少 ${capsPath}`, "capture");
  const { captures = [] } = JSON.parse(fs.readFileSync(capsPath, "utf8"));
  if (!captures.length) return fail("CAPTURES_EMPTY", "captures.json 中 captures 为空", "capture");

  const refs = [...new Set(captures.map((c) => c.artboardId))];
  const artboards = {};
  for (const aid of refs) {
    let ab;
    try { ab = store.readArtboard(ws, pid, aid); } catch { ab = null; }
    if (!ab || ab.source == null) return fail("CAPTURE_REF_NOT_FOUND", `captures.json 引用的画板 ${aid} 不存在或无源码`);
    artboards[aid] = ab;
  }

  // 项目级 lib/（react/babel/mermaid）——预览页引用它，不再往 snapshot/ 里各拷一份（版本目录太重
  // 的主要来源之一）。
  copyPreviewLibs(store.projectLibDir(ws, pid));

  const snapDir = path.join(dir, ".build", "snapshot");
  fs.rmSync(snapDir, { recursive: true, force: true });
  const iconsPath = path.join(store.projectDir(ws, pid), "icons.jsx");
  const iconsSource = fs.existsSync(iconsPath) ? fs.readFileSync(iconsPath, "utf8") : "";
  for (const aid of refs) {
    const ab = artboards[aid];
    const annotationsMd = store.readAnnotationsMd(ws, pid, aid);
    const dst = path.join(snapDir, "artboards", aid);
    fs.mkdirSync(dst, { recursive: true });
    fs.writeFileSync(path.join(dst, "source.jsx"), ab.source);
    fs.writeFileSync(path.join(dst, "meta.json"), JSON.stringify(ab.meta, null, 2));
    if (annotationsMd.trim()) fs.writeFileSync(path.join(dst, "annotations.md"), annotationsMd);
    const assetsMap = readAssetsMap(path.join(ab.dir, "assets"));
    fs.writeFileSync(path.join(dst, "preview.html"),
      buildPreviewHtml({ artboardId: aid, source: ab.source, iconsSource, assetsMap, libRelPath: "../../../../../../lib", annotationsMd }));
  }
  return { ok: true, mode: "snapshot", artboardCount: refs.length };
}

// ---- finalize ----

async function buildFinalize(ws, pid, docId, opts, ctx) {
  if (!isValidDocId(docId)) return fail("BAD_DOC_ID", `docId 不合法：${docId}`);
  const dir = store.docDir(ws, pid, docId);
  const dj = store.readDocJson(ws, pid, docId);
  if (!dj) return fail("DOC_NOT_FOUND", `文档 ${docId} 不存在，先 create_doc`);
  const mdPath = path.join(dir, "doc.md");
  if (!fs.existsSync(mdPath)) return fail("DOC_MD_MISSING", `缺少 ${mdPath}`, "doc-writing");
  const note = (opts.note || "").trim();
  if (!note) return fail("NOTE_REQUIRED", "finalize 需要 note（一句话说清这次改了什么，进修改记录表）", "doc-writing");

  const md = fs.readFileSync(mdPath, "utf8");
  const assetsDir = path.join(dir, "assets");
  const assetFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];

  const referenced = referencedAssets(md);
  const missing = referenced.filter((f) => !assetFiles.includes(f));
  if (missing.length) {
    return fail("IMAGE_REF_MISSING", `doc.md 引用了 assets/ 下不存在的图片：${missing.join(", ")}`, "capture");
  }

  // 截图流水线（可选）：有 .build/captures.json 就要求 snapshot + seal 过，并据 seal 清单算
  // sourceFingerprints（供 chain_status 判断画板是否漂移）。没有则 sourceFingerprints 为空，
  // 该文档天然不参与画板漂移检测——不是 flag，是"图不是从画板截的"的自然结果。
  const capsPath = path.join(dir, ".build", "captures.json");
  let sourceFingerprints = {};
  if (fs.existsSync(capsPath)) {
    const snapArts = path.join(dir, ".build", "snapshot", "artboards");
    if (!fs.existsSync(snapArts)) return fail("NOT_SNAPSHOTTED", `${docId} 尚未 build_doc(mode:"snapshot")`, "workflow");
    const manifestPath = path.join(dir, ".build", "captures-manifest.json");
    if (!fs.existsSync(manifestPath)) return fail("CAPTURES_NOT_SEALED", `${docId} 尚未 build_publish_pack(mode:"seal")`, "workflow");
    const capManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const captures = JSON.parse(fs.readFileSync(capsPath, "utf8")).captures || [];
    if (!capManifest.inputHash || capManifest.inputHash !== captureInputHash(path.join(dir, ".build"), captures)) {
      return fail("CAPTURES_STALE", `${docId} 的截图配置、快照与已 seal 图片不一致，请重新运行截图流水线`, "capture");
    }
    const sealedArtboards = [...new Set((capManifest.images || []).map((i) => i.artboardId).filter(Boolean))];
    for (const aid of sealedArtboards) {
      const srcPath = path.join(snapArts, aid, "source.jsx");
      if (!fs.existsSync(srcPath)) continue;
      // 跟 chain.js 比对的 ab.sourceHash 用同一个哈希函数（contentHash(source)）——drift 检测就是
      // "画板源码变没变"，别的（标注等）由 annotationsFresh 规则单独管。
      sourceFingerprints[aid] = contentHash(fs.readFileSync(srcPath, "utf8"));
    }
  }

  const n = (dj.head || 0) + 1;
  const mdHash = contentHash(md);
  const docHash = objectHash({ md, sourceFingerprints });
  const now = iso(ctx);

  // 冻结 versions/<n>/
  const vdir = store.docVersionDir(ws, pid, docId, n);
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(path.join(vdir, "doc.md"), md);
  const vAssets = path.join(vdir, "assets");
  fs.rmSync(vAssets, { recursive: true, force: true });
  if (assetFiles.length) {
    fs.mkdirSync(vAssets, { recursive: true });
    for (const f of assetFiles) fs.copyFileSync(path.join(assetsDir, f), path.join(vAssets, f));
  }
  fs.writeFileSync(path.join(vdir, "manifest.json"), JSON.stringify(
    { schemaVersion: 1, docHash, mdHash, builtAt: now, sourceFingerprints }, null, 2) + "\n");

  // 更新 doc.json（head 唯一真相源；preview.html / list_docs 都从它派生）
  dj.versions = dj.versions || [];
  dj.versions.push({ n, note, label: (opts.label || "").trim(), author: opts.author || ctx.author || "", builtAt: now, docHash, mdHash, sourceFingerprints, publishedTo: [] });
  dj.head = n;
  dj.updatedAt = now;
  dj.title = h1Title(md, dj.title || docId);
  store.writeDocJson(ws, pid, docId, dj);

  // 重渲染同项目所有已定版文档。文档菜单的 siblings 来自项目当前文档清单；如果只渲染本篇，
  // 先定版的文档不会自动出现后来新增/改名的文档入口。
  let rendered = { rendered: false };
  for (const doc of store.listDocs(ws, pid)) {
    if (!doc.head) continue;
    const result = store.renderDocPreview(ws, pid, doc.id);
    if (doc.id === docId) rendered = result;
  }

  // 清掉可再生的截图中间产物；保留 captures.json / captures-manifest.json / snapshot（供纯 prose
  // 改动时的下一次 finalize 复用、也是画板漂移检测的基线）。
  fs.rmSync(path.join(dir, ".build", "previews"), { recursive: true, force: true });

  // checks：finalize 只报，不拦（写作是迭代的）；error 级 finding 的拦截发生在 record_publish。
  const findings = await runChecks(store.projectDir(ws, pid), dj.kind, {
    docMd: md, docJson: dj, assets: assetFiles, docId, versionN: n,
  });

  return {
    ok: true, mode: "finalize", docId, version: n, docHash,
    headPreviewPath: rendered.headPreviewPath,
    findings,
  };
}

export async function buildDoc(ws, pid, docId, mode, opts, ctx) {
  if (mode === "snapshot") return buildSnapshot(ws, pid, docId, ctx);
  if (mode === "finalize") return buildFinalize(ws, pid, docId, opts || {}, ctx);
  return fail("BAD_MODE", `mode 必须是 snapshot 或 finalize，收到 ${mode}`);
}
