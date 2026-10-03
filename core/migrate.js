// core/migrate.js — 旧格式项目 → 当前格式（框架）。只由迁移命令（bin/protoflow-migrate.mjs）调用，运行时
// 代码只认当前格式（readProject 对旧项目报 FORMAT_OUTDATED）。
//
// 一个项目的迁移分项目级和按产品两层，见 migrateProject。每一步都返回
// "改了什么"的描述列表；apply 为 false 时只检测不动文件（预演）。每一步都可重复执行。
// 以后框架自己的数据格式变了：FORMAT_VERSION 加一，在这里补一步；某个产品的数据格式变了：那个产品的
// formatVersion 加一、在它描述里的 migrate 补一步，框架不用动。
//   1 → 2  单画布布局 → canvases/；旧版本目录 → 内容寻址；doc.json 补 sources、截图配置挪位置
//   2 → 3  文档类型（kind / recipe）→ 标签 labels
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJson, writeJson, projectDir, entityRoot, FORMAT_VERSION, formatOf, projectProducts, syncProjectProducts } from "./store.js";
import { freezeVersion } from "./versionStore.js";

const OLD_VERSION_META = "manifest.json";

function walkFiles(dir, base = "") {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...walkFiles(path.join(dir, ent.name), rel));
    else if (ent.isFile()) out.push(rel);
  }
  return out;
}

// 一个实体目录下旧的 versions/<n>/ 整份复制目录 → versions/<n>.json 清单 + objects/ 对象。
// 已经有清单的版本（上次迁到一半）直接删旧目录。
function migrateEntityVersions(pdir, edir, apply) {
  const vroot = path.join(edir, "versions");
  if (!fs.existsSync(vroot)) return [];
  const ns = fs.readdirSync(vroot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[1-9]\d*$/.test(e.name))
    .map((e) => Number(e.name)).sort((a, b) => a - b);
  if (apply) {
    for (const n of ns) {
      const dir = path.join(vroot, String(n));
      if (!fs.existsSync(path.join(vroot, `${n}.json`))) {
        const metaFile = path.join(dir, OLD_VERSION_META);
        const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : {};
        const files = walkFiles(dir).filter((f) => f !== OLD_VERSION_META).map((f) => ({ path: f, from: path.join(dir, ...f.split("/")) }));
        freezeVersion(pdir, edir, n, files, meta);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return ns;
}

function migrateVersionStorage(ws, pid, kinds, apply) {
  const changes = [];
  for (const kind of kinds) {
    const root = entityRoot(ws, pid, kind);
    if (!fs.existsSync(root)) continue;
    for (const id of fs.readdirSync(root)) {
      const edir = path.join(root, id);
      if (!fs.statSync(edir).isDirectory()) continue;
      const ns = migrateEntityVersions(projectDir(ws, pid), edir, apply);
      if (ns.length) changes.push(`${kind.rootSeg}/${id}：版本 ${ns.join(",")} 转成内容寻址存储`);
    }
  }
  return changes;
}

// 工作区里某个目录的项目格式版本；不是项目（没有 project.json，或者是 .protoflow-backup 这类隐藏目录）回 null。
export function projectFormat(ws, name) {
  if (name.startsWith(".")) return null;
  const pj = readJson(path.join(ws, name, "project.json"), null);
  return pj ? formatOf(pj) : null;
}

// 迁一个项目，两层：
//   1. 项目级（project.json 的 formatVersion < FORMAT_VERSION）：框架自己的一步（版本目录 → 内容寻址）
//      + legacy 里的历史步骤（入口层传进来，见 products/index.js 的 LEGACY_PROJECT_MIGRATIONS），最后盖上当前版本。
//   2. 按产品（project.json.products.<type>.formatVersion < 插件的 formatVersion）：调插件描述里的
//      migrate(ws, pid, { from, to, apply })，成功后把登记里的版本升上去。某个产品的迁移抛错，只把这个
//      产品的数据目录和它的登记恢复原样，其余产品照常迁完，结果里记在 failed。
// products 是当前加载的注册表。返回 { from, to, changes, failed: [{ type, error }] }。
export function migrateProject(ws, pid, products, { apply = false, legacy = [] } = {}) {
  const pjPath = path.join(projectDir(ws, pid), "project.json");
  const from = formatOf(readJson(pjPath, null));
  const changes = [];
  const failed = [];
  if (from < FORMAT_VERSION) {
    changes.push(...migrateVersionStorage(ws, pid, products.flatMap((p) => p.entities || []), apply));
    for (const step of legacy) changes.push(...step(ws, pid, { apply }));
    if (apply) {
      const pj = readJson(pjPath, {}); // 历史步骤可能改过 project.json，重新读
      writeJson(pjPath, { ...pj, formatVersion: FORMAT_VERSION });
    }
    changes.push(`project.json：formatVersion ${from} → ${FORMAT_VERSION}`);
  }
  if (apply) syncProjectProducts(ws, pid, products);
  const registered = projectProducts(ws, pid);
  for (const p of products) {
    const r = registered[p.type];
    const to = p.formatVersion || 1;
    if (!r || r.formatVersion >= to || !p.migrate) continue;
    const label = `${p.label}（${p.type}）数据格式 ${r.formatVersion} → ${to}`;
    if (!apply) { changes.push(label, ...p.migrate(ws, pid, { from: r.formatVersion, to, apply: false })); continue; }
    const snap = snapshotProduct(ws, pid, p);
    try {
      changes.push(label, ...p.migrate(ws, pid, { from: r.formatVersion, to, apply: true }));
      const pj = readJson(pjPath, {});
      pj.products[p.type] = { ...pj.products[p.type], formatVersion: to };
      writeJson(pjPath, pj);
    } catch (e) {
      snap.restore();
      failed.push({ type: p.type, error: e.message });
      changes.push(`${label}：失败，已恢复原样（${e.message}）`);
    } finally { snap.dispose(); }
  }
  return { from, to: Math.max(from, FORMAT_VERSION), changes, failed };
}

// 这个项目要不要迁：项目级格式旧了，或者有已加载的产品登记的数据格式比插件旧。
export function projectNeedsMigration(ws, name, products) {
  const f = projectFormat(ws, name);
  if (f == null) return false;
  if (f < FORMAT_VERSION) return true;
  const reg = projectProducts(ws, name);
  return products.some((p) => p.migrate && reg[p.type] && reg[p.type].formatVersion < (p.formatVersion || 1));
}

// 一个产品迁移前的现场：它的数据目录 + project.json，失败时原样放回。
function snapshotProduct(ws, pid, p) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-migrate-"));
  const pjPath = path.join(projectDir(ws, pid), "project.json");
  const pjRaw = fs.readFileSync(pjPath);
  const roots = (p.entities || []).map((k) => entityRoot(ws, pid, k)).filter((d) => fs.existsSync(d));
  roots.forEach((d, i) => fs.cpSync(d, path.join(tmp, String(i)), { recursive: true }));
  return {
    restore() {
      for (const k of p.entities || []) fs.rmSync(entityRoot(ws, pid, k), { recursive: true, force: true });
      roots.forEach((d, i) => fs.cpSync(path.join(tmp, String(i)), d, { recursive: true }));
      fs.writeFileSync(pjPath, pjRaw);
    },
    dispose: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}
