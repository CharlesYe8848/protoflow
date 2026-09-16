// core/docKinds.js — 文档类型的发现层。核心不认识任何具体类型：一个类型 = 一个自包含目录
// （kind.json + template.md + writing.md + 可选 checks/*.mjs），运行时被发现，加类型不动 core。
//
// 发现路径两处，项目本地优先级更高（可覆盖内置、也可新增内置没有的类型）：
//   1. <projectRoot>/doc-kinds/<kind>/
//   2. <repoRoot>/doc-kinds/<kind>/        （内置）
//
// checks 是叠加不是覆盖：内置 _shared → 内置 <kind> → 项目 _shared → 项目 <kind>，存在的全跑。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafeSegment } from "./ids.js";

const BUILTIN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "doc-kinds");

// 优先级从高到低：项目本地在前，内置在后。
export function docKindsRoots(projectDir) {
  const roots = [];
  if (projectDir) roots.push(path.join(projectDir, "doc-kinds"));
  roots.push(BUILTIN_ROOT);
  return roots;
}

function readKindJson(dir) {
  const p = path.join(dir, "kind.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function hydrate(kind, dir, meta) {
  return {
    kind,
    dir,
    label: meta.label || kind,
    contextSource: meta.contextSource || null,
    templatePath: fs.existsSync(path.join(dir, "template.md")) ? path.join(dir, "template.md") : null,
    writingPath: fs.existsSync(path.join(dir, "writing.md")) ? path.join(dir, "writing.md") : null,
  };
}

// 解析单个类型；找不到返回 null（调用方给出"可用类型有哪些"的错误信息）。
export function resolveKind(projectDir, kind) {
  assertSafeSegment(kind);
  for (const root of docKindsRoots(projectDir)) {
    const dir = path.join(root, kind);
    const meta = readKindJson(dir);
    if (meta) return hydrate(kind, dir, meta);
  }
  return null;
}

// 列出所有可用类型（项目本地遮蔽同名内置）。
export function listKinds(projectDir) {
  const seen = new Map();
  for (const root of docKindsRoots(projectDir)) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      if (name.startsWith("_") || name.startsWith(".")) continue;
      if (seen.has(name)) continue;
      const dir = path.join(root, name);
      const meta = readKindJson(dir);
      if (meta) seen.set(name, hydrate(name, dir, meta));
    }
  }
  return [...seen.values()];
}

// 给定类型，收集所有要跑的 check 目录（叠加，内置在前项目在后）。
export function checkDirsFor(projectDir, kind) {
  const dirs = [];
  const roots = docKindsRoots(projectDir).slice().reverse(); // 内置在前，项目覆盖在后
  for (const root of roots) {
    for (const seg of ["_shared", kind]) {
      const d = path.join(root, seg, "checks");
      if (fs.existsSync(d)) dirs.push(d);
    }
  }
  return dirs;
}
