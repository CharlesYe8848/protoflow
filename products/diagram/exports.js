// products/diagram/exports.js — 绘图的导出格式：菜单数据（./exportMenu.js）+ build 函数 + mime。
// 都只导 head 版本，不带版本切换，不带标注（导出的页面没有本地 agent 可复制给）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLibSources, safeFileName, zipDirectory } from "protoflow/sdk";
import { compressLibSources } from "protoflow/sdk/internal";
import { DIAGRAM_EXPORT_MENU } from "./exportMenu.js";
import { readDiagramJson, readVersionPages } from "./store.js";
import { renderDiagramPreviewHtml, libNamesFor } from "./preview.js";
import { diagramLibs } from "./libs.js";

// 没有任何版本回 null（导出目标不存在）。
function loadHead(ws, pid, id) {
  const dj = readDiagramJson(ws, pid, id);
  if (!dj || !(dj.versions || []).length) return null;
  const v = dj.versions.find((x) => x.n === dj.head) || dj.versions[dj.versions.length - 1];
  return { dj, v, pages: readVersionPages(ws, pid, id, v.n), name: safeFileName(dj.title, id) };
}

function singleHtml(head, id) {
  const kinds = [...new Set(head.pages.map((p) => p.kind))];
  const compressedLibs = compressLibSources(readLibSources(diagramLibs(kinds), libNamesFor(kinds)));
  return renderDiagramPreviewHtml({
    versions: [{ n: head.v.n, note: head.v.note || "", author: head.v.author || "", builtAt: head.v.builtAt || "", pages: head.pages }],
    head: head.v.n, title: head.dj.title || id, standalone: true, compressedLibs,
  });
}

export function buildDiagramExportHtml(ws, pid, id) {
  const head = loadHead(ws, pid, id);
  if (!head) return null;
  return { filename: `${head.name}.html`, buffer: Buffer.from(singleHtml(head, id), "utf8") };
}

// 源文件包：pages/ 下每页的源文件、pages.json（页的顺序和名字）、一份单页 HTML。
export function buildDiagramExportZip(ws, pid, id) {
  const head = loadHead(ws, pid, id);
  if (!head) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-diagram-export-"));
  try {
    const root = path.join(tmp, head.name);
    fs.mkdirSync(path.join(root, "pages"), { recursive: true });
    for (const p of head.pages) fs.writeFileSync(path.join(root, "pages", p.file), p.source);
    fs.writeFileSync(path.join(root, "pages.json"), JSON.stringify(head.pages.map((p) => ({ file: p.file, name: p.name })), null, 2) + "\n");
    fs.writeFileSync(path.join(root, `${head.name}.html`), singleHtml(head, id));
    return { filename: `${head.name}.zip`, buffer: zipDirectory(tmp) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const BUILD = {
  html: { build: buildDiagramExportHtml, mime: "text/html" },
  zip: { build: buildDiagramExportZip, mime: "application/zip" },
};
export const DIAGRAM_EXPORTS = DIAGRAM_EXPORT_MENU.map((f) => ({ ...f, ...BUILD[f.id] }));
