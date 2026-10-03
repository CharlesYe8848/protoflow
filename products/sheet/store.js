// products/sheet/store.js — 表格的文件读写：sheets/<sheetId>/ 实体（sheet.json 草稿 + doc.json 元信息
// + 不可变版本）和阅读页的渲染入口。通用实体接口来自框架（core/store.js）。
import fs from "node:fs";
import path from "node:path";
import { ensureLibs, entityDir, entityRoot, freezeEntityVersion, listEntities, openEntityVersion, projectLibDir, readEntityJson, writeEntityJson } from "protoflow/sdk";
import { SHEET_LIBS } from "./libs.js";
import { renderSheetPreviewHtml } from "./sheetPreview.js";

// 元信息文件沿用 doc.json（表格先做的时候照抄了文档），以后要改名得带迁移。
export const SHEET_ENTITY = { rootSeg: "sheets", metaFile: "doc.json" };
export function sheetsRoot(ws, pid) { return entityRoot(ws, pid, SHEET_ENTITY); }
export function sheetDir(ws, pid, sheetId) { return entityDir(ws, pid, SHEET_ENTITY, sheetId); }
export function openSheetVersion(ws, pid, sheetId, n) { return openEntityVersion(ws, pid, SHEET_ENTITY, sheetId, n); }
export function freezeSheetVersion(ws, pid, sheetId, n, files, meta) { return freezeEntityVersion(ws, pid, SHEET_ENTITY, sheetId, n, files, meta); }
export function readSheetJson(ws, pid, sheetId) { return readEntityJson(ws, pid, SHEET_ENTITY, sheetId); }
export function writeSheetJson(ws, pid, sheetId, dj) { writeEntityJson(ws, pid, SHEET_ENTITY, sheetId, dj); }
export function listSheets(ws, pid) { return listEntities(ws, pid, SHEET_ENTITY); }

// 表格阅读页：同上，现场用冻结的各版本 sheet.json + 当前模板拼。
export function sheetPreviewHtml(ws, projectId, sheetId) {
  const dj = readSheetJson(ws, projectId, sheetId);
  if (!dj || !(dj.versions || []).length) return null;
  const lib = projectLibDir(ws, projectId);
  const versions = dj.versions.map((v) => {
    const content = JSON.parse(requireVersion(openSheetVersion(ws, projectId, sheetId, v.n), sheetId, v.n).readText("sheet.json") || "null");
    return { n: v.n, content, note: v.note || "", author: v.author || "", builtAt: v.builtAt || "" };
  });
  ensureLibs(lib, SHEET_LIBS);
  return renderSheetPreviewHtml({ versions, head: dj.head, title: dj.title || sheetId, sheetId, libRelPath: "../../lib" });
}

export function renderSheetPreview(ws, projectId, sheetId) {
  const html = sheetPreviewHtml(ws, projectId, sheetId);
  if (html == null) return { rendered: false };
  const headPreviewPath = path.join(sheetDir(ws, projectId, sheetId), "preview.html");
  fs.writeFileSync(headPreviewPath, html);
  return { rendered: true, headPreviewPath };
}

function requireVersion(handle, id, n) {
  if (!handle) throw new Error(`${id} 的第 ${n} 版内容缺失`);
  return handle;
}
