// products/deck/deckProduct.js — 幻灯片交给框架的三样东西：
//   resolver   引用解析：子部位是页 id（文件名去掉 .html，比如 03-数据），指纹 = 那一页 HTML 的哈希
//   artifacts  幻灯片产物清单
//   health     草稿从未定版、有没定版的改动
import { contentHash, finding } from "protoflow/sdk";
import * as deckStore from "./store.js";
import { draftHash } from "./deck.js";

const readMeta = (ws, pid, id) => { try { return deckStore.readDeckJson(ws, pid, id); } catch { return null; } };

export const resolver = {
  type: "deck",
  label: "幻灯片",
  head(ws, pid, id) {
    const dj = readMeta(ws, pid, id);
    return dj ? dj.head || 0 : null;
  },
  fingerprint(ws, pid, id, n, part) {
    if (!part) return null;
    const version = n ?? this.head(ws, pid, id);
    if (!version) return null;
    const v = deckStore.openDeckVersion(ws, pid, id, version);
    const html = v && v.readText(`slides/${part}.html`);
    return html != null ? contentHash(html) : null;
  },
  describe(ws, pid, id, part) {
    const dj = readMeta(ws, pid, id);
    return `幻灯片「${(dj && dj.title) || id}」${part ? `的页「${part}」` : ""}`;
  },
};

export function artifacts(ws, pid) {
  return deckStore.listDecks(ws, pid).map((d) => {
    const dj = readMeta(ws, pid, d.id) || {};
    const head = dj.head || 0;
    const headV = (dj.versions || []).find((v) => v.n === head);
    return {
      type: "deck", id: d.id, title: dj.title || d.id, head,
      dirty: !!headV && headV.filesHash !== draftHash(ws, pid, d.id),
      versions: (dj.versions || []).map((v) => ({ n: v.n, sources: v.sources || [], publishedTo: v.publishedTo || [] })),
    };
  });
}

export function health(ws, pid) {
  const out = [];
  for (const a of artifacts(ws, pid)) {
    if (!a.head) out.push(finding("deck_uncommitted", "uncommitted", `deck:${a.id}`, `幻灯片「${a.title}」草稿从未定版`, `内容成型后 build_deck(note:"…")`));
    else if (a.dirty) out.push(finding("deck_uncommitted", "uncommitted", `deck:${a.id}`, `幻灯片「${a.title}」有没定版的改动（最新 v${a.head}）`, `改完 build_deck(note:"…") 定一个新版本`));
  }
  return out;
}
