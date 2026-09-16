// core/importer.js — 只 cp 源目录，绝不写源目录；导入后补登指纹基线。
import fs from "node:fs";
import path from "node:path";
import { contentHash } from "./hash.js";
import { writeAgentsDocs } from "./store.js";

const fail = (code, message) => ({ ok: false, error: { code, message } });

export function importProject(ws, sourceDir, ctx) {
  const pjPath = path.join(sourceDir, "project.json");
  if (!fs.existsSync(pjPath)) return fail("NOT_A_PROJECT", `${sourceDir} 缺少 project.json，不是可导入的项目目录`);
  const pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
  const projectId = pj.id || path.basename(sourceDir);
  const dst = path.join(ws, projectId);
  if (fs.existsSync(dst)) return fail("ALREADY_EXISTS", `workspace 已存在项目 ${projectId}`);
  // 只拷设计数据：project.json / icons.jsx / pages/。prd、chat 等历史产物不带（新链路重新生成）。
  fs.mkdirSync(dst, { recursive: true });
  for (const item of ["project.json", "icons.jsx", "pages"]) {
    const src = path.join(sourceDir, item);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dst, item), { recursive: true });
  }
  // 补登基线：lastValidatedHash = 当前源码 hash；有 annotations.md 的画板同样盖上 annotationsValidatedHash
  let artboards = 0;
  for (const pgId of pj.pageIds || []) {
    const abRoot = path.join(dst, "pages", pgId, "artboards");
    if (!fs.existsSync(abRoot)) continue;
    for (const abId of fs.readdirSync(abRoot)) {
      const dir = path.join(abRoot, abId);
      const srcPath = path.join(dir, "source.jsx");
      if (!fs.existsSync(srcPath)) continue;
      const h = contentHash(fs.readFileSync(srcPath, "utf8"));
      const metaPath = path.join(dir, "meta.json");
      const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : { id: abId };
      meta.lastValidatedHash = h;
      const annMd = path.join(dir, "annotations.md");
      if (meta.annotationsValidatedHash == null && fs.existsSync(annMd) && fs.readFileSync(annMd, "utf8").trim()) {
        meta.annotationsValidatedHash = h;
      }
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      artboards++;
    }
  }
  writeAgentsDocs(ws, projectId, pj.name || projectId);
  return { ok: true, projectId, artboards };
}
