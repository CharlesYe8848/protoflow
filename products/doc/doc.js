// products/doc/doc.js — 文档产品的核心：建文档、定版。不认识任何文档类型（PRD、上线公告的模板在
// 流程 skill 里），也不认识截图（图从哪来都一样放进 assets/，带出处文件的自动成为引用）。
// 每个版本的引用单 sources 见 core/refs.js。
//
// 版本模型照 Artifacts：文档有身份（docs/<docId>/），版本没有 id，就是整数下标 n；
// 只有显式 build_doc(note:) 才产生一个版本。
//
// finalize：doc.md 已写好、图片已放进 assets/。校验图片引用 → 收集引用 → 算指纹 → 冻结成第 n 版
// （core/versionStore.js）→ 重渲染 preview.html（含自动生成的修改记录表）。
import fs from "node:fs";
import path from "node:path";
import { assetSources, contentHash, isSourceSidecar, isValidEntityId, normalizeLabels, objectHash, versionSources } from "protoflow/sdk";
import * as docStore from "./store.js";

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

// from: "prd" → 该文档 head 版本；"prd@3" → 版本 3。结果是一条声明的引用 doc:prd@3，存进
// doc.json.pendingSources，第一次 finalize 时成为第 1 版的引用（之后的版本沿用，直到重新声明）。
function parseFrom(ws, pid, from) {
  const [fromId, vRaw] = String(from).split("@");
  const dj = docStore.readDocJson(ws, pid, fromId);
  if (!dj) return { error: fail("ORIGIN_NOT_FOUND", `from 指向的文档 ${fromId} 不存在`) };
  const version = vRaw ? Number(vRaw) : (dj.head || 0);
  if (!version) return { error: fail("ORIGIN_NOT_BUILT", `from 指向的文档 ${fromId} 还没有任何版本`) };
  return { source: { ref: `doc:${fromId}@${version}`, via: "declared" } };
}

// 文档产品不认识 PRD、上线公告这些类型，也不认识模板：模板在流程 skill 里（比如产品研发流程的
// references/prd-template.md），模型读了以后把起草好的正文作为 content 传进来。labels 是给流程 skill
// 认自己文档用的标签（core/labels.js），文档只存不解释。
//   docId    必填，目录名（人类可读 slug，可含中文）
//   title    主题一句话；传了就填进一级标题和 doc.json.title
//   content  初始正文；不传就是只有一级标题的空文档
export function createDoc(ws, pid, opts, ctx) {
  const docId = opts.docId;
  if (!docId) return fail("DOC_ID_REQUIRED", "要传 docId（文档目录名）");
  if (!isValidEntityId(docId)) return fail("BAD_DOC_ID", `docId 不合法：${docId}（人类可读 slug，可含中文，不以连字符开头/收尾、无连续连字符、无斜杠空白）`);
  let labels;
  try { labels = normalizeLabels(opts.labels); } catch (e) { return fail(e.code, e.message); }
  const dir = docStore.docDir(ws, pid, docId);
  if (fs.existsSync(dir)) return fail("DOC_EXISTS", `文档 ${docId} 已存在`);

  let pendingSources = [];
  if (opts.from) {
    const r = parseFrom(ws, pid, opts.from);
    if (r.error) return r.error;
    pendingSources = [r.source];
  }

  let md = opts.content != null ? String(opts.content).replace(/\s*$/, "\n") : `# ${docId}\n`;
  // 有 title 就把正文里的一级标题换成它（模板里的一级标题通常是占位），没有一级标题就补一个
  if (opts.title) {
    const h1 = `# ${opts.title.trim()}`;
    md = /^#\s+.*$/m.test(md) ? md.replace(/^#\s+.*$/m, h1) : `${h1}\n\n${md}`;
  }
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "doc.md"), md);
  const now = iso(ctx);
  docStore.writeDocJson(ws, pid, docId, {
    schemaVersion: 1, title: h1Title(md, docId),
    ...(labels.length ? { labels } : {}),
    pendingSources, head: 0, versions: [], createdAt: now, updatedAt: now,
  });
  return { ok: true, docId, docMdPath: path.join(dir, "doc.md"), labels };
}

// ---- finalize ----

async function buildFinalize(ws, pid, docId, opts, ctx) {
  if (!isValidEntityId(docId)) return fail("BAD_DOC_ID", `docId 不合法：${docId}`);
  const dir = docStore.docDir(ws, pid, docId);
  const dj = docStore.readDocJson(ws, pid, docId);
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
    return fail("IMAGE_REF_MISSING", `doc.md 引用了 assets/ 下不存在的图片：${missing.join(", ")}`, "doc-writing");
  }

  // 这一版的引用：这次声明的（opts.sources，入口层已校验并固定版本；没传就沿用上一版声明的，
  // 第一版沿用建文档时的 from）+ assets/ 里素材自带的出处（比如流程 skill 的截图脚本写的 <图>.source.json，
  // 截自画布的哪一版哪块画板）。
  const headV = (dj.versions || []).find((v) => v.n === dj.head);
  const sources = versionSources({
    declared: opts.sources,
    previous: headV ? headV.sources : dj.pendingSources,
    derived: [
      ...(opts.embedSources || []), // 正文里的嵌入块（入口层已固定版本，./embeds.js）
      ...assetSources(assetFiles.filter(isSourceSidecar).map((f) => ({ path: f, data: fs.readFileSync(path.join(assetsDir, f), "utf8") }))),
    ],
  });

  const n = (dj.head || 0) + 1;
  const mdHash = contentHash(md);
  const docHash = objectHash({ md, sources });
  const now = iso(ctx);

  // 冻结第 n 版：doc.md + assets/ 进对象库，同样的图片跨版本只存一份（core/versionStore.js）。
  docStore.freezeDocVersion(ws, pid, docId, n, [
    { path: "doc.md", data: md },
    ...assetFiles.map((f) => ({ path: `assets/${f}`, from: path.join(assetsDir, f) })),
  ], { docHash, mdHash, builtAt: now, sources });

  // 更新 doc.json（head 唯一真相源；preview.html / list_docs 都从它派生）
  dj.versions = dj.versions || [];
  dj.versions.push({ n, note, label: (opts.label || "").trim(), author: opts.author || ctx.author || "", builtAt: now, docHash, mdHash, sources, publishedTo: [] });
  delete dj.pendingSources;
  dj.head = n;
  dj.updatedAt = now;
  dj.title = h1Title(md, dj.title || docId);
  docStore.writeDocJson(ws, pid, docId, dj);

  // 只重渲染本篇：同项目其它产物的入口在项目侧边栏里实时生成（core/projectNav.js），不用为了
  // 刷新导航去重渲染别的文档。
  const rendered = docStore.renderDocPreview(ws, pid, docId);

  // 文档的检查（开放问题、公告 FAQ 数量……）是流程 skill 的事，不在定版里跑。
  return { ok: true, mode: "finalize", docId, version: n, docHash, headPreviewPath: rendered.headPreviewPath };
}

// mode 只有 finalize（缺省也是它）。截图不是文档的构建步骤：图从哪来都一样放进 assets/。
export async function buildDoc(ws, pid, docId, mode, opts, ctx) {
  if (mode == null || mode === "finalize") return buildFinalize(ws, pid, docId, opts || {}, ctx);
  return fail("BAD_MODE", `mode 只能是 finalize，收到 ${mode}`);
}
