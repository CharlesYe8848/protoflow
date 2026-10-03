// products/diagram/diagram.js — 绘图的创建和定版。pages/ 下的源文件是正文本身，agent 直接读写；只有显式
// build_diagram(note:) 才产生一个版本。写法说明见 guides/diagram.md（本产品目录下）。
import fs from "node:fs";
import path from "node:path";
import { contentHash, isValidEntityId, normalizeLabels, objectHash, versionSources } from "protoflow/sdk";
import { renderers } from "./engine/index.js";
import * as diagramStore from "./store.js";

const fail = (code, message, hint) => ({ ok: false, error: { code, message, ...(hint ? { hint } : {}) } });
const iso = (ctx) => new Date(ctx.now()).toISOString();
const supportedExts = () => renderers().map((r) => `${r.ext}（${r.label}）`).join("、");

// 读草稿：pages.json 的页 + pages/ 里还没登记的新文件（自动追加到末尾，页名先用页 id）。不写盘。
// 返回 { entries:[{ file, name }], added:[页 id], errors:[…] }。
export function collectDraft(ws, pid, id) {
  const errors = [];
  const dir = diagramStore.pagesDir(ws, pid, id);
  let listed = [];
  const pj = diagramStore.pagesJsonPath(ws, pid, id);
  if (fs.existsSync(pj)) {
    try { listed = JSON.parse(fs.readFileSync(pj, "utf8")); }
    catch (e) { return { entries: [], added: [], errors: [`pages.json 不是合法 JSON：${e.message}`] }; }
    if (!Array.isArray(listed)) return { entries: [], added: [], errors: ["pages.json 必须是数组：[{ \"file\": \"mind.md\", \"name\": \"脑图\" }]"] };
  }
  const onDisk = diagramStore.draftPageFiles(ws, pid, id);
  const byFile = new Map(onDisk.map((f) => [f.file, f]));
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(".") && !byFile.has(f)) errors.push(`pages/${f} 的扩展名不认识，支持：${supportedExts()}`);
    }
  }
  const stems = new Map();
  for (const f of onDisk) {
    if (stems.has(f.id)) errors.push(`pages/${stems.get(f.id)} 和 pages/${f.file} 的页 id 都是「${f.id}」，改掉其中一个文件名`);
    else stems.set(f.id, f.file);
  }

  const entries = [];
  const seen = new Set();
  listed.forEach((p, i) => {
    const file = p && typeof p.file === "string" ? p.file : "";
    if (!file) { errors.push(`pages.json[${i}] 缺少 file`); return; }
    if (seen.has(file)) { errors.push(`pages.json 里 ${file} 出现了不止一次`); return; }
    seen.add(file);
    if (!byFile.has(file)) { errors.push(`pages.json 列了 ${file}，但 pages/ 下没有这个文件`); return; }
    entries.push({ file, name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : byFile.get(file).id });
  });
  const added = [];
  for (const f of onDisk) {
    if (seen.has(f.file)) continue;
    entries.push({ file: f.file, name: f.id });
    added.push(f.id);
  }
  return { entries, added, errors };
}

// 草稿指纹：页的顺序、名字和每页的源码。用来判断"有没有没定版的改动"，跟定版时算法一致。
export function draftHash(ws, pid, id) {
  const { entries, errors } = collectDraft(ws, pid, id);
  if (errors.length) return "invalid";
  const dir = diagramStore.pagesDir(ws, pid, id);
  return pagesHash(entries.map((e) => ({ ...e, source: fs.readFileSync(path.join(dir, e.file), "utf8") })));
}

function pagesHash(pages) {
  return objectHash(pages.map((p) => ({ file: p.file, name: p.name, source: contentHash(p.source) })));
}

// ---- create ----

export function createDiagram(ws, pid, opts, ctx) {
  const id = opts.diagramId;
  if (!id || !isValidEntityId(id)) return fail("BAD_DIAGRAM_ID", `diagramId 不合法：${id}（人类可读 slug，可含中文）`);
  let labels;
  try { labels = normalizeLabels(opts.labels); } catch (e) { return fail(e.code, e.message); }
  const dir = diagramStore.diagramDir(ws, pid, id);
  if (fs.existsSync(dir)) return fail("DIAGRAM_EXISTS", `绘图 ${id} 已存在`);

  fs.mkdirSync(path.join(dir, "pages"), { recursive: true });
  fs.writeFileSync(diagramStore.pagesJsonPath(ws, pid, id), "[]\n");
  const now = iso(ctx);
  const title = (opts.title || "").trim() || "未命名绘图";
  diagramStore.writeDiagramJson(ws, pid, id, {
    schemaVersion: 1, title, ...(labels.length ? { labels } : {}), head: 0, versions: [], createdAt: now, updatedAt: now,
  });
  return {
    ok: true, diagramId: id, labels,
    pagesDir: diagramStore.pagesDir(ws, pid, id),
    pagesJsonPath: diagramStore.pagesJsonPath(ws, pid, id),
    next: `在 pages/ 下新建页面文件：${supportedExts()}，写完 build_diagram(note:"…") 定第一个版本`,
  };
}

// ---- 定版 ----

export async function buildDiagram(ws, pid, id, opts, ctx) {
  if (!isValidEntityId(id)) return fail("BAD_DIAGRAM_ID", `diagramId 不合法：${id}`);
  const dj = diagramStore.readDiagramJson(ws, pid, id);
  if (!dj) return fail("DIAGRAM_NOT_FOUND", `绘图 ${id} 不存在，先 create_diagram`);
  const note = (opts.note || "").trim();
  if (!note) return fail("NOTE_REQUIRED", "build_diagram 需要 note（一句话说清这次改了什么，进修改记录）");

  const { entries, added, errors } = collectDraft(ws, pid, id);
  if (errors.length) return fail("DIAGRAM_PAGES_INVALID", `页面有问题（${errors.length} 项）：\n- ${errors.join("\n- ")}`, "diagram");
  if (!entries.length) return fail("DIAGRAM_EMPTY", `还没有页：在 pages/ 下新建页面文件，支持 ${supportedExts()}`, "diagram");

  const dir = diagramStore.pagesDir(ws, pid, id);
  const pages = entries.map((e) => {
    const source = fs.readFileSync(path.join(dir, e.file), "utf8");
    const renderer = renderers().find((r) => e.file.endsWith(r.ext));
    return { ...e, id: e.file.slice(0, -renderer.ext.length), source, renderer };
  });
  const invalid = pages.flatMap((p) => p.renderer.validate(p.source).map((msg) => `pages/${p.file}（${p.renderer.label}）：${msg}`));
  if (invalid.length) return fail("DIAGRAM_VALIDATION_FAILED", `页面内容不合法（${invalid.length} 项）：\n- ${invalid.join("\n- ")}`, "diagram");

  // 新页登记进草稿的 pages.json，agent 下次读到的就是完整的页列表。
  const pagesJson = JSON.stringify(entries, null, 2) + "\n";
  if (added.length) fs.writeFileSync(diagramStore.pagesJsonPath(ws, pid, id), pagesJson);

  const headV = (dj.versions || []).find((v) => v.n === dj.head);
  const sources = versionSources({ declared: opts.sources, previous: headV && headV.sources, derived: [] });
  const n = (dj.head || 0) + 1;
  const diagramHash = pagesHash(pages);
  const now = iso(ctx);

  try {
    diagramStore.freezeDiagramVersion(ws, pid, id, n, [
      { path: "pages.json", data: pagesJson },
      ...pages.map((p) => ({ path: `pages/${p.file}`, data: p.source })),
    ], { diagramHash, builtAt: now, sources });
  } catch (e) {
    return fail("DIAGRAM_WRITE_FAILED", `冻结版本 ${n} 时写入失败：${e.message}`);
  }

  dj.versions = dj.versions || [];
  dj.versions.push({ n, note, label: (opts.label || "").trim(), author: opts.author || ctx.author || "", builtAt: now, diagramHash, sources, publishedTo: [] });
  dj.head = n;
  dj.updatedAt = now;
  try {
    diagramStore.writeDiagramJson(ws, pid, id, dj);
  } catch (e) {
    return fail("DIAGRAM_WRITE_FAILED", `提交版本 ${n} 的元信息失败：${e.message}`);
  }

  const rendered = diagramStore.renderDiagramPreview(ws, pid, id);
  return {
    ok: true, diagramId: id, version: n, diagramHash,
    pages: pages.map((p) => ({ id: p.id, name: p.name, kind: p.renderer.kind })),
    ...(added.length ? { addedPages: added } : {}),
    headPreviewPath: rendered.headPreviewPath,
  };
}
