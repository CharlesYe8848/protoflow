// core/store.js — 框架的文件读写边界：项目容器 + 通用的"带版本的实体"。ws = workspace 绝对路径，
// 由调用方（CLI 层/测试）提供。
//
// 不认识任何产品。各产品自己的读写在 products/<产品>/store.js，它们用这里的通用实体接口：
// 一个实体种类由产品声明成 { rootSeg, metaFile }（比如文档是 { rootSeg: "docs", metaFile: "doc.json" }），
// 实体放在 <项目>/<rootSeg>/<id>/，元信息在 <metaFile>（head + versions），不可变版本是清单
// versions/<n>.json + 项目级对象库（core/versionStore.js）。
import fs from "node:fs";
import path from "node:path";
import { slugify, assertSafeSegment } from "./ids.js";
import { buildAgentsDoc } from "./agentsDoc.js";
import { openVersion, freezeVersion } from "./versionStore.js";

export const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback);
export const writeJson = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n"); };

export function projectDir(ws, projectId) { return path.join(ws, assertSafeSegment(projectId)); }
export function projectLibDir(ws, pid) { return path.join(projectDir(ws, pid), "lib"); }
// 外部插件的依赖库放各自的子目录 lib/<type>/，同名不同版本的库不会互相覆盖；内置产品沿用 lib/（已有项目、导出不变）。
export function productLibDir(ws, pid, type) { return path.join(projectLibDir(ws, pid), assertSafeSegment(type)); }

// ---- 通用实体 ----

export function entityRoot(ws, pid, kind) { return path.join(projectDir(ws, pid), kind.rootSeg); }
export function entityDir(ws, pid, kind, id) { return path.join(entityRoot(ws, pid, kind), assertSafeSegment(id)); }
export function readEntityJson(ws, pid, kind, id) {
  return readJson(path.join(entityDir(ws, pid, kind, id), kind.metaFile), null);
}
export function writeEntityJson(ws, pid, kind, id, meta) {
  checkProductFormat(ws, pid, kind);
  writeJson(path.join(entityDir(ws, pid, kind, id), kind.metaFile), meta);
}
// 第 n 版的只读句柄（read/readText/list/filePath），没有这一版回 null。
export function openEntityVersion(ws, pid, kind, id, n) {
  return openVersion(projectDir(ws, pid), entityDir(ws, pid, kind, id), n);
}
// 定版：把 files（[{path, data}|{path, from}]）存成第 n 版。
export function freezeEntityVersion(ws, pid, kind, id, n, files, meta) {
  checkProductFormat(ws, pid, kind);
  return freezeVersion(projectDir(ws, pid), entityDir(ws, pid, kind, id), n, files, meta);
}
// 实时派生的清单（不落 index.json，唯一真相是各实体的元信息文件）。
export function listEntities(ws, pid, kind) {
  const root = entityRoot(ws, pid, kind);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const id of fs.readdirSync(root)) {
    const meta = readJson(path.join(root, id, kind.metaFile), null);
    if (!meta) continue;
    const published = (meta.versions || []).some((v) => (v.publishedTo || []).length);
    out.push({ id, labels: meta.labels || [], title: meta.title || id, head: meta.head || 0, updatedAt: meta.updatedAt || "", published });
  }
  return out;
}
// 读 head 版本一次性追加一条发布记录，所有产品共用（发布前要不要检查是调用方的业务判断，不在
// 这里）。实体不存在或还没定过版时回 null，调用方决定怎么报错。
export function appendPublishRecord(ws, pid, kind, id, record) {
  const meta = readEntityJson(ws, pid, kind, id);
  if (!meta || !meta.head) return null;
  const headV = (meta.versions || []).find((v) => v.n === meta.head);
  if (!headV) return null;
  headV.publishedTo = headV.publishedTo || [];
  headV.publishedTo.push(record);
  writeEntityJson(ws, pid, kind, id, meta);
  return { version: meta.head, recordCount: headV.publishedTo.length };
}
// ---- 项目容器 ----

// 项目的存储格式版本。格式变了就加一，并在迁移命令（core/migrate.js、各产品的 migrate）里补一步；
// 运行时代码只认当前格式，旧项目一律报 FORMAT_OUTDATED 让用户先迁移，不在各处写兼容分支。
export const FORMAT_VERSION = 3;
export const formatOf = (pj) => (pj && pj.formatVersion) || 1;

// ---- 产品登记（docs/product-architecture.md §4.11）----
// project.json 的 products 记着这个项目用到过哪些产品：{ <type>: { rootSeg, metaFile, formatVersion } }。
// 插件没装或被禁用时，框架凭它仍能认出、列出这个产品的数据（通用实体接口）；formatVersion 是这个项目里
// 该产品数据的格式版本，各产品各管各的，项目级 formatVersion 只管框架自己的数据。
// 某个产品第一次写实体时登记；打开项目时（syncProjectProducts）已加载的产品发现自己的目录已存在但没登记，
// 就按当前版本补上——老项目不用迁移。
export function projectProducts(ws, pid) {
  const pj = readJson(path.join(projectDir(ws, pid), "project.json"), null);
  return (pj && pj.products) || {};
}

function registerProduct(ws, pid, kind) {
  const pjPath = path.join(projectDir(ws, pid), "project.json");
  const pj = readJson(pjPath, null);
  if (!pj || (pj.products && pj.products[kind.type])) return;
  pj.products = { ...(pj.products || {}), [kind.type]: { rootSeg: kind.rootSeg, metaFile: kind.metaFile, formatVersion: kind.formatVersion || 1 } };
  writeJson(pjPath, pj);
}

// 写一个产品的数据前：没登记就登记；登记的格式版本比插件新（插件被降级了）拒绝写，免得旧插件把数据写坏；
// 比插件旧，要先跑迁移命令（跟项目级的 FORMAT_OUTDATED 一致）。实体种类没标所属产品的（不经注册的旧写法）不管。
function checkProductFormat(ws, pid, kind) {
  if (!kind.type) return;
  const reg = projectProducts(ws, pid)[kind.type];
  if (!reg) return registerProduct(ws, pid, kind);
  const mine = kind.formatVersion || 1;
  if (reg.formatVersion > mine) {
    throw Object.assign(new Error(`项目里 ${kind.type} 的数据是格式 ${reg.formatVersion}，比当前插件支持的 ${mine} 新：先升级这个插件，不然会把数据写坏`), { code: "PRODUCT_FORMAT_NEWER" });
  }
  if (reg.formatVersion < mine) {
    throw Object.assign(new Error(`项目里 ${kind.type} 的数据是旧格式 ${reg.formatVersion}（当前 ${mine}），先运行迁移：node <protoflow>/bin/protoflow-migrate.mjs "${ws}" --apply`), { code: "PRODUCT_FORMAT_OUTDATED" });
  }
}

// 打开项目时调用（项目侧边栏、get_project）：补登已加载产品的目录；项目说明（AGENTS.md / CLAUDE.md）按
// 当前启用的产品重新生成，内容没变不写。
export function syncProjectProducts(ws, pid, products) {
  for (const p of products) for (const kind of p.entities || []) {
    if (kind.type && fs.existsSync(entityRoot(ws, pid, kind))) registerProduct(ws, pid, kind);
  }
  const pj = readJson(path.join(projectDir(ws, pid), "project.json"), null);
  if (pj) writeAgentsDocs(ws, pid, pj.name || pid, products, { onlyIfChanged: true });
}

// 登记过、但当前没加载的产品（插件没装或被禁用）：[{ type, kind }]。kind 可直接交给通用实体接口。
export function uninstalledProducts(ws, pid, products) {
  const loaded = new Set(products.map((p) => p.type));
  return Object.entries(projectProducts(ws, pid)).filter(([type]) => !loaded.has(type))
    .map(([type, r]) => ({ type, kind: { type, rootSeg: r.rootSeg, metaFile: r.metaFile, formatVersion: r.formatVersion } }));
}

// project.json 里框架只认 id、name、formatVersion、products；各产品可以往里放自己的字段，框架不解释。
export function readProject(ws, projectId) {
  const pj = readJson(path.join(projectDir(ws, projectId), "project.json"), null);
  if (pj && formatOf(pj) < FORMAT_VERSION) {
    throw Object.assign(new Error(`项目 ${projectId} 是旧格式（格式版本 ${formatOf(pj)}，当前 ${FORMAT_VERSION}），先运行迁移：node <protoflow>/bin/protoflow-migrate.mjs "${ws}" --apply`), { code: "FORMAT_OUTDATED" });
  }
  return pj;
}
export function writeProject(ws, projectId, pj) {
  writeJson(path.join(projectDir(ws, projectId), "project.json"), pj);
}

export function listProjects(ws) {
  if (!fs.existsSync(ws)) return [];
  return fs.readdirSync(ws)
    .filter((d) => fs.existsSync(path.join(ws, d, "project.json")))
    .map((d) => {
      const pj = readJson(path.join(ws, d, "project.json"), {});
      return { id: pj.id, name: pj.name, ...(formatOf(pj) < FORMAT_VERSION ? { formatOutdated: true } : {}) };
    });
}

// 项目目录名 = 项目名的 slug（人类可读，直接在文件系统里就能认出项目），同名冲突时加序号后缀。
function uniqueProjectId(ws, name) {
  const base = slugify(name);
  if (!fs.existsSync(path.join(ws, base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!fs.existsSync(path.join(ws, candidate))) return candidate;
  }
}

// 项目根目录自描述文档：任何 agent 靠这份文档和 protoflow CLI 就能接手项目。products 是产品注册表
// （由入口层传进来，框架不 import 产品），各产品的部分按它拼进文档。
export function writeAgentsDocs(ws, projectId, projectName, products = [], { onlyIfChanged = false } = {}) {
  const doc = buildAgentsDoc({ projectId, projectName, products });
  const dir = projectDir(ws, projectId);
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const file = path.join(dir, name);
    if (onlyIfChanged && fs.existsSync(file) && fs.readFileSync(file, "utf8") === doc) continue;
    fs.writeFileSync(file, doc);
  }
}

export function createProject(ws, name, ctx, { products = [] } = {}) {
  const id = uniqueProjectId(ws, name);
  writeJson(path.join(ws, id, "project.json"), { schemaVersion: 1, formatVersion: FORMAT_VERSION, id, name });
  writeAgentsDocs(ws, id, name, products);
  return { id, name };
}
