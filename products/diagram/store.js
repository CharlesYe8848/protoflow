// products/diagram/store.js — 绘图的文件读写：diagrams/<diagramId>/ 实体和阅读页的渲染入口。通用实体
// 接口来自框架（core/store.js）。
//
//   diagrams/<diagramId>/
//     diagram.json        元信息：title、labels、head、versions
//     pages.json          草稿：[{ file, name }]，页的顺序和名字；页 id = 文件名去掉扩展名
//     pages/<pageId>.<ext> 每页一个源文件，扩展名决定用哪个渲染器（engine/index.js）
//     versions/<n>.json   定版时冻结 pages.json 和 pages/，文件本体在项目级 objects/
import fs from "node:fs";
import path from "node:path";
import { ensureLibs, entityDir, entityRoot, freezeEntityVersion, listEntities, openEntityVersion, projectLibDir, readEntityJson, writeEntityJson } from "protoflow/sdk";
import { rendererForFile } from "./engine/index.js";
import { diagramLibs } from "./libs.js";
import { renderDiagramPreviewHtml } from "./preview.js";

export const DIAGRAM_ENTITY = { rootSeg: "diagrams", metaFile: "diagram.json" };
export function diagramsRoot(ws, pid) { return entityRoot(ws, pid, DIAGRAM_ENTITY); }
export function diagramDir(ws, pid, id) { return entityDir(ws, pid, DIAGRAM_ENTITY, id); }
export function openDiagramVersion(ws, pid, id, n) { return openEntityVersion(ws, pid, DIAGRAM_ENTITY, id, n); }
export function freezeDiagramVersion(ws, pid, id, n, files, meta) { return freezeEntityVersion(ws, pid, DIAGRAM_ENTITY, id, n, files, meta); }
export function readDiagramJson(ws, pid, id) { return readEntityJson(ws, pid, DIAGRAM_ENTITY, id); }
export function writeDiagramJson(ws, pid, id, meta) { writeEntityJson(ws, pid, DIAGRAM_ENTITY, id, meta); }
export function listDiagrams(ws, pid) { return listEntities(ws, pid, DIAGRAM_ENTITY); }

export function pagesJsonPath(ws, pid, id) { return path.join(diagramDir(ws, pid, id), "pages.json"); }
export function pagesDir(ws, pid, id) { return path.join(diagramDir(ws, pid, id), "pages"); }

// 草稿里 pages/ 下能认的页面文件：[{ id, file, renderer }]，按文件名排序（只用于发现新页，页的顺序看 pages.json）。
export function draftPageFiles(ws, pid, id) {
  const dir = pagesDir(ws, pid, id);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().flatMap((file) => {
    if (file.startsWith(".")) return [];
    const renderer = rendererForFile(file);
    return renderer ? [{ id: file.slice(0, -renderer.ext.length), file, renderer }] : [];
  });
}

// 某一版（或草稿）里的全部页：[{ id, name, file, kind, source }]，按 pages.json 的顺序。
// read(relPath) 读版本内（或草稿目录里）的文件文本，没有回 null。
export function readPages(read) {
  let list;
  try { list = JSON.parse(read("pages.json") || "[]"); } catch { list = []; }
  return (Array.isArray(list) ? list : []).flatMap((p) => {
    const file = p && p.file;
    const renderer = file && rendererForFile(file);
    if (!renderer) return [];
    const source = read(`pages/${file}`);
    const id = file.slice(0, -renderer.ext.length);
    return source == null ? [] : [{ id, name: p.name || id, file, kind: renderer.kind, source }];
  });
}

export function readDraftPages(ws, pid, id) {
  const dir = diagramDir(ws, pid, id);
  return readPages((rel) => {
    const p = path.join(dir, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  });
}

export function readVersionPages(ws, pid, id, n) {
  const v = openDiagramVersion(ws, pid, id, n);
  if (!v) throw new Error(`${id} 的第 ${n} 版内容缺失`);
  return readPages((rel) => v.readText(rel));
}

// 阅读页：现场用冻结的各版本内容 + 当前模板拼。没有任何版本回 null。
export function diagramPreviewHtml(ws, pid, id, { standalone = false, libRelPath = "../../lib" } = {}) {
  const dj = readDiagramJson(ws, pid, id);
  if (!dj || !(dj.versions || []).length) return null;
  const versions = dj.versions.map((v) => ({
    n: v.n, note: v.note || "", author: v.author || "", builtAt: v.builtAt || "",
    pages: readVersionPages(ws, pid, id, v.n),
  }));
  const kinds = [...new Set(versions.flatMap((v) => v.pages.map((p) => p.kind)))];
  if (!standalone) ensureLibs(projectLibDir(ws, pid), diagramLibs(kinds));
  return renderDiagramPreviewHtml({ versions, head: dj.head, title: dj.title || id, diagramId: id, libRelPath, standalone });
}

export function renderDiagramPreview(ws, pid, id) {
  const html = diagramPreviewHtml(ws, pid, id);
  if (html == null) return { rendered: false };
  const headPreviewPath = path.join(diagramDir(ws, pid, id), "preview.html");
  fs.writeFileSync(headPreviewPath, html);
  return { rendered: true, headPreviewPath };
}
