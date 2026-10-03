// products/canvas/migrate.js — 画布的旧格式 → 当前格式，只由迁移命令调用（core/migrate.js）。
// 单画布时代的布局（project.json.pageIds + 项目根的 pages/）→ canvases/main/（canvas.json 存页面列表，
// pages/ 挪进去）。已冻结的画布版本本来就在 canvases/main/ 下、路径相对画布，不用动。
// 顺序保证中途打断能接着迁：先写 canvas.json，再挪 pages/，最后才从 project.json 去掉 pageIds。
import fs from "node:fs";
import path from "node:path";
import { projectDir, readJson, writeJson } from "protoflow/sdk";
import { CANVAS_ENTITY, DEFAULT_CANVAS_ID } from "./store.js";

export function migrate(ws, pid, { apply }) {
  const pdir = projectDir(ws, pid);
  const pjPath = path.join(pdir, "project.json");
  const pj = readJson(pjPath, null);
  if (!pj || !Array.isArray(pj.pageIds)) return [];
  const cdir = path.join(pdir, CANVAS_ENTITY.rootSeg, DEFAULT_CANVAS_ID);
  const oldPages = path.join(pdir, "pages");
  const newPages = path.join(cdir, "pages");
  if (fs.existsSync(oldPages) && fs.existsSync(newPages)) {
    throw new Error(`${pid}：${newPages} 已存在，不覆盖；请手动合并 ${oldPages}`);
  }
  const change = `画布：pageIds + pages/（${pj.pageIds.length} 个页面）→ canvases/${DEFAULT_CANVAS_ID}/`;
  if (apply) {
    const cjPath = path.join(cdir, CANVAS_ENTITY.metaFile);
    const cj = readJson(cjPath, null) || { schemaVersion: 1, head: 0, versions: [], createdAt: "" };
    writeJson(cjPath, { ...cj, title: cj.title || pj.name || pid, pageIds: pj.pageIds });
    if (fs.existsSync(oldPages)) fs.renameSync(oldPages, newPages);
    delete pj.pageIds;
    writeJson(pjPath, pj);
  }
  return [change];
}
