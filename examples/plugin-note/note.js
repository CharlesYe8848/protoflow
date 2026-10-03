// examples/plugin-note/note.js — 示例插件"笔记"的读写：草稿 note.md，build 时冻结成一个版本。
// 只用 protoflow/sdk 的稳定接口。
import fs from "node:fs";
import path from "node:path";
import {
  entityDir, readEntityJson, writeEntityJson, openEntityVersion, freezeEntityVersion, listEntities,
  isValidEntityId, contentHash, versionSources, fail, FAVICON_LINK, BRAND_CSS_VARS,
} from "protoflow/sdk";

export const NOTE_ENTITY = { rootSeg: "notes", metaFile: "note.json" };

const draftPath = (ws, pid, id) => path.join(entityDir(ws, pid, NOTE_ENTITY, id), "note.md");
const readDraft = (ws, pid, id) => (fs.existsSync(draftPath(ws, pid, id)) ? fs.readFileSync(draftPath(ws, pid, id), "utf8") : null);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function writeNote(ws, pid, { noteId, title, content }, now) {
  if (!isValidEntityId(noteId)) return fail("BAD_NOTE_ID", `noteId 不合法：${noteId}`);
  const meta = readEntityJson(ws, pid, NOTE_ENTITY, noteId) || { title: title || noteId, head: 0, versions: [] };
  if (title) meta.title = title;
  meta.updatedAt = new Date(now).toISOString();
  fs.mkdirSync(entityDir(ws, pid, NOTE_ENTITY, noteId), { recursive: true });
  fs.writeFileSync(draftPath(ws, pid, noteId), content);
  writeEntityJson(ws, pid, NOTE_ENTITY, noteId, meta);
  return { ok: true, noteId };
}

export function buildNote(ws, pid, { noteId, note, sources }, now) {
  const meta = readEntityJson(ws, pid, NOTE_ENTITY, noteId);
  const draft = readDraft(ws, pid, noteId);
  if (!meta || draft == null) return fail("NOT_FOUND", `笔记 ${noteId} 不存在`);
  const n = (meta.head || 0) + 1;
  const previous = (meta.versions || []).find((v) => v.n === meta.head);
  freezeEntityVersion(ws, pid, NOTE_ENTITY, noteId, n, [{ path: "note.md", data: draft }], {});
  meta.versions = [...(meta.versions || []), {
    n, note: note || "", builtAt: new Date(now).toISOString(), noteHash: contentHash(draft),
    sources: versionSources({ declared: sources, previous: previous && previous.sources, derived: [] }),
  }];
  meta.head = n;
  writeEntityJson(ws, pid, NOTE_ENTITY, noteId, meta);
  return { ok: true, noteId, version: n };
}

export function readNoteVersion(ws, pid, noteId, n) {
  const meta = readEntityJson(ws, pid, NOTE_ENTITY, noteId);
  const v = meta && openEntityVersion(ws, pid, NOTE_ENTITY, noteId, n || meta.head);
  return v ? { title: meta.title, text: v.readText("note.md") } : null;
}

// 阅读页：最新版。留出 data-pf-nav-slot 给项目侧边栏（页面注入契约，见 protoflow/sdk）。
export function notePreviewHtml(ws, pid, noteId) {
  const v = readNoteVersion(ws, pid, noteId);
  if (!v) return null;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><title>${esc(v.title)} · protoflow</title>${FAVICON_LINK}`
    + `<style>${BRAND_CSS_VARS}body{margin:0;font:15px/1.7 -apple-system,"PingFang SC",sans-serif;color:var(--pf-brand)}`
    + `header{display:flex;align-items:center;gap:8px;height:40px;padding:0 12px}main{max-width:720px;margin:24px auto;padding:0 24px;white-space:pre-wrap}</style></head>`
    + `<body><header><span data-pf-nav-slot></span><strong>${esc(v.title)}</strong></header><main>${esc(v.text)}</main></body></html>`;
}

export const resolver = {
  type: "note",
  label: "笔记",
  head(ws, pid, id) {
    const meta = readEntityJson(ws, pid, NOTE_ENTITY, id);
    return meta ? meta.head || 0 : null;
  },
  fingerprint() { return null; }, // 笔记没有子部位
};

export function artifacts(ws, pid) {
  return listEntities(ws, pid, NOTE_ENTITY).map((e) => {
    const meta = readEntityJson(ws, pid, NOTE_ENTITY, e.id);
    const headV = (meta.versions || []).find((v) => v.n === meta.head);
    const draft = readDraft(ws, pid, e.id);
    return {
      type: "note", id: e.id, title: meta.title, head: meta.head || 0,
      dirty: !!headV && draft != null && headV.noteHash !== contentHash(draft),
      versions: (meta.versions || []).map((v) => ({ n: v.n, sources: v.sources || [], publishedTo: v.publishedTo || [] })),
    };
  });
}
