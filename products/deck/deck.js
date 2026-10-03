// products/deck/deck.js — 建幻灯片、定版。只用 protoflow/sdk 的稳定接口。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isValidEntityId, normalizeLabels, contentHash, objectHash, versionSources, assetSources, isSourceSidecar, fail } from "protoflow/sdk";
import * as deckStore from "./store.js";
import { checkSlide, assetRefs } from "./html.js";
import { DEFAULT_PLAYBACK_JSON, parsePlayback } from "./playback.js";

// 新幻灯片 design/ 里的起步样式：只保证能看、字够大。design/ 是这份幻灯片自己的文件，之后怎么改由写的人决定。
export const STARTER_DIR = fileURLToPath(new URL("./starter/", import.meta.url));
const iso = (ctx) => new Date(ctx.now()).toISOString();
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function createDeck(ws, pid, { deckId, title, labels }, ctx) {
  if (!deckId || !isValidEntityId(deckId)) return fail("BAD_DECK_ID", `deckId 不合法：${deckId}（人类可读 slug，可含中文）`);
  if (deckStore.readDeckJson(ws, pid, deckId)) return fail("DECK_EXISTS", `幻灯片 ${deckId} 已存在`);
  let norm;
  try { norm = normalizeLabels(labels); } catch (e) { return fail(e.code || "BAD_LABELS", e.message); }
  const name = (title || "").trim() || "未命名幻灯片";
  fs.mkdirSync(deckStore.slidesDir(ws, pid, deckId), { recursive: true });
  fs.mkdirSync(deckStore.assetsDir(ws, pid, deckId), { recursive: true });
  fs.cpSync(STARTER_DIR, deckStore.designDir(ws, pid, deckId), { recursive: true });
  fs.writeFileSync(path.join(deckStore.slidesDir(ws, pid, deckId), "01-封面.html"),
    `<section data-layout="cover">\n  <h1>${esc(name)}</h1>\n</section>\n`);
  fs.writeFileSync(deckStore.playbackPath(ws, pid, deckId), DEFAULT_PLAYBACK_JSON);
  const now = iso(ctx);
  deckStore.writeDeckJson(ws, pid, deckId, { schemaVersion: 2, title: name, labels: norm, head: 0, versions: [], createdAt: now, updatedAt: now });
  return { ok: true, deckId, slidesDir: deckStore.slidesDir(ws, pid, deckId), designDir: deckStore.designDir(ws, pid, deckId), labels: norm };
}

// 草稿的整体指纹（全部源文件的内容），判断有没有没定版的改动。
export function draftHash(ws, pid, deckId) {
  const root = deckStore.deckDir(ws, pid, deckId);
  return objectHash(Object.fromEntries(deckStore.draftFiles(ws, pid, deckId).map((rel) => [rel, contentHash(fs.readFileSync(path.join(root, rel)).toString("base64"))])));
}

// opts：{ note, label, author, sources（入口层固定过版本的声明引用）, embedSources（页里的 <pf-embed>，同上） }
export function buildDeck(ws, pid, deckId, opts, ctx) {
  const dj = deckStore.readDeckJson(ws, pid, deckId);
  if (!dj) return fail("DECK_NOT_FOUND", `幻灯片 ${deckId} 不存在，先 create_deck`);
  const note = (opts.note || "").trim();
  if (!note) return fail("NOTE_REQUIRED", "build_deck 需要 note（一句话说清这次改了什么）", "deck-writing");
  const slides = deckStore.readDraftSlides(ws, pid, deckId);
  if (!slides.length) return fail("DECK_EMPTY", "slides/ 下还没有页：每页一个 .html 文件，内容是一个 <section data-layout=\"…\">", "deck-writing");
  const bad = slides.flatMap((s) => checkSlide(s.html).map((e) => `${s.file}：${e}`));
  if (bad.length) return fail("BAD_SLIDE", bad.join("；"), "deck-writing");
  const assets = new Set(deckStore.draftFiles(ws, pid, deckId).filter((f) => f.startsWith("assets/")).map((f) => f.slice("assets/".length)));
  const missing = [...new Set(slides.flatMap((s) => assetRefs(s.html)))].filter((f) => !assets.has(f));
  if (missing.length) return fail("ASSET_MISSING", `页里引用了 assets/ 下不存在的文件：${missing.join(", ")}`, "deck-writing");
  const playbackText = fs.existsSync(deckStore.playbackPath(ws, pid, deckId)) ? fs.readFileSync(deckStore.playbackPath(ws, pid, deckId), "utf8") : null;
  const playback = parsePlayback(playbackText, { slideIds: slides.map((s) => s.id), assetFiles: assets, videoSlideIds: slides.filter((s) => /<video\b/i.test(s.html)).map((s) => s.id) });
  if (!playback.ok) return fail(playback.code, playback.message, "deck-writing");

  const headV = (dj.versions || []).find((v) => v.n === dj.head);
  // 引用：声明的 + 页里的嵌入 + 素材自带的出处（截图脚本在图旁边写的 <图>.source.json，比如截自画布哪一版哪块画板）
  const adir = deckStore.assetsDir(ws, pid, deckId);
  const sidecars = [...assets].filter(isSourceSidecar).map((f) => ({ path: f, data: fs.readFileSync(path.join(adir, f), "utf8") }));
  const sources = versionSources({ declared: opts.sources, previous: headV && headV.sources, derived: [...(opts.embedSources || []), ...assetSources(sidecars)] });
  const n = (dj.head || 0) + 1;
  const now = iso(ctx);
  const root = deckStore.deckDir(ws, pid, deckId);
  const filesHash = draftHash(ws, pid, deckId);
  const deckHash = objectHash({ filesHash, sources });
  deckStore.freezeDeckVersion(ws, pid, deckId, n, deckStore.draftFiles(ws, pid, deckId).map((rel) => ({ path: rel, from: path.join(root, rel) })), { deckHash, builtAt: now, sources });
  dj.versions = [...(dj.versions || []), { n, note, label: (opts.label || "").trim(), author: opts.author || ctx.author || "", builtAt: now, filesHash, deckHash, sources, publishedTo: [] }];
  dj.head = n;
  dj.updatedAt = now;
  deckStore.writeDeckJson(ws, pid, deckId, dj);
  return { ok: true, deckId, version: n, slideCount: slides.length, deckHash };
}
