// products/deck/store.js — 幻灯片的读写：实体种类、目录、草稿和版本里的页。只用 protoflow/sdk 的稳定接口。
//
//   decks/<deckId>/
//   ├── slides/<nn-名字>.html  每页一个文件：根节点是一个 <section>，按文件名排序
//   ├── assets/                页面里 assets/… 引用的图片等素材
//   ├── design/                全稿共用的样式和脚本：顶层 .css、.js 按文件名顺序全部加载；子目录放字体等
//   ├── playback.json          自动翻页、循环、背景音乐和逐页旁白（可选；没有就是手动翻页）
//   ├── deck.json              { title, labels, head, versions:[{ n, note, author, builtAt, deckHash, filesHash, sources, publishedTo }] }
//   └── versions/<n>.json      不可变版本清单（页面、素材、设计和放映配置 → 内容哈希）
import fs from "node:fs";
import path from "node:path";
import {
  entityDir, readEntityJson, writeEntityJson, openEntityVersion, freezeEntityVersion, listEntities,
} from "protoflow/sdk";

export const DECK_ENTITY = { rootSeg: "decks", metaFile: "deck.json" };
export const SOURCE_DIRS = ["slides", "assets", "design"]; // 进版本的目录
export const SOURCE_FILES = ["playback.json"]; // 顶层、也要进版本的正文配置
const SLIDE_FILE_RE = /^[^.][^/]*\.html$/;

export const deckDir = (ws, pid, id) => entityDir(ws, pid, DECK_ENTITY, id);
export const slidesDir = (ws, pid, id) => path.join(deckDir(ws, pid, id), "slides");
export const assetsDir = (ws, pid, id) => path.join(deckDir(ws, pid, id), "assets");
export const designDir = (ws, pid, id) => path.join(deckDir(ws, pid, id), "design");
export const playbackPath = (ws, pid, id) => path.join(deckDir(ws, pid, id), "playback.json");
export const readDeckJson = (ws, pid, id) => readEntityJson(ws, pid, DECK_ENTITY, id);
export const writeDeckJson = (ws, pid, id, meta) => writeEntityJson(ws, pid, DECK_ENTITY, id, meta);
export const openDeckVersion = (ws, pid, id, n) => openEntityVersion(ws, pid, DECK_ENTITY, id, n);
export const freezeDeckVersion = (ws, pid, id, n, files, meta) => freezeEntityVersion(ws, pid, DECK_ENTITY, id, n, files, meta);
export const listDecks = (ws, pid) => listEntities(ws, pid, DECK_ENTITY);

export const slideIdOf = (file) => file.replace(/\.html$/, "");

// 草稿里的页：[{ id, file, html }]，按文件名排序。
export function readDraftSlides(ws, pid, id) {
  const dir = slidesDir(ws, pid, id);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => SLIDE_FILE_RE.test(f)).sort()
    .map((file) => ({ id: slideIdOf(file), file, html: fs.readFileSync(path.join(dir, file), "utf8") }));
}

// 某一版里的页，同上。
export function readVersionSlides(version) {
  return version.list("slides").map((p) => p.slice("slides/".length)).filter((f) => SLIDE_FILE_RE.test(f)).sort()
    .map((file) => ({ id: slideIdOf(file), file, html: version.readText(`slides/${file}`) }));
}

// 草稿里要进版本的全部文件：三个正文目录和顶层 playback.json；递归时跳过隐藏文件。
export function draftFiles(ws, pid, id) {
  const root = deckDir(ws, pid, id);
  const out = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r); else if (e.isFile()) out.push(r);
    }
  };
  for (const d of SOURCE_DIRS) walk(d);
  for (const f of SOURCE_FILES) if (fs.existsSync(path.join(root, f))) out.push(f);
  return out.sort();
}
