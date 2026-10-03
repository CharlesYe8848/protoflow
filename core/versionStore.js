// core/versionStore.js — 框架层的版本存储，所有带版本的产品（文档、表格，以后的画布）共用。
//
// 按内容寻址：文件字节按 sha256 存进项目内的对象库 objects/<前两位>/<sha256>，同样的内容整个项目
// 只存一份；每个版本只写一份清单 <实体目录>/versions/<n>.json（路径 → {hash, size}，外加产品自己的
// meta）。以前每次定版把草稿目录整份复制进 versions/<n>/，图片没改也再存一份，版本越多项目越大。
// 设计取舍见 docs/product-architecture.md §4.9。
//
// 产品只接触两件事：定版时 freezeVersion（"把这组文件存成第 n 版"），读取时 openVersion 拿一个
// 只读句柄按路径取文件——不关心文件实际存在哪。更早的 versions/<n>/ 整份复制目录只由迁移命令
// （core/migrate.js）转换，这里不认。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertSafeSegment } from "./ids.js";

export function objectsDir(projectDir) { return path.join(projectDir, "objects"); }

export function objectPath(projectDir, hash) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`非法对象哈希：${hash}`);
  return path.join(objectsDir(projectDir), hash.slice(0, 2), hash);
}

function versionsDir(entityDir) { return path.join(entityDir, "versions"); }
function manifestPath(entityDir, n) { return path.join(versionsDir(entityDir), assertSafeSegment(String(n)) + ".json"); }

// 版本内的相对路径：posix 风格、不能越出版本（..）、不能是绝对路径。"./assets/a.png" 归一成
// "assets/a.png"。不合法回 null——读取方把它当"没有这个文件"处理。
export function normalizeVersionPath(rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\0") || rel.includes("\\")) return null;
  const norm = path.posix.normalize(rel);
  if (norm.startsWith("/") || norm === "." || norm === ".." || norm.startsWith("../")) return null;
  return norm;
}

// 先写临时文件再改名：进程中途被杀不会留下半截对象（半截对象的哈希对不上内容，而且因为"已存在就
// 跳过"，以后再也不会被修好）。
function writeAtomic(target, data) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
}

// 对象的地址：文件字节的 sha256。产品要算"内容有没有变"（比如画布草稿和 head 比）时用同一个函数，
// 跟对象库里的地址天然一致。
export function hashBytes(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  return createHash("sha256").update(buf).digest("hex");
}

// 存一个对象，返回 { hash, size }。同样内容已经在库里就什么也不写。
export function putObject(projectDir, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  const hash = hashBytes(buf);
  const target = objectPath(projectDir, hash);
  if (!fs.existsSync(target)) writeAtomic(target, buf);
  return { hash, size: buf.length };
}

// 把一组文件存成第 n 版。files: [{ path, data }]（data 是 Buffer 或字符串）或 [{ path, from }]
// （from 是磁盘上的绝对路径）。meta 是产品自己的元信息（如文档的 docHash），原样存进清单。
// 清单最后写：它一落盘这一版才算存在，对象先写好，中途失败不会留下指向缺失对象的清单。
export function freezeVersion(projectDir, entityDir, n, files, meta = {}) {
  const table = {};
  for (const f of files) {
    const rel = normalizeVersionPath(f.path);
    if (!rel) throw new Error(`版本内文件路径不合法：${f.path}`);
    if (rel in table) throw new Error(`版本内文件路径重复：${rel}`);
    table[rel] = putObject(projectDir, f.from != null ? fs.readFileSync(f.from) : f.data);
  }
  const manifest = { schemaVersion: 1, n, meta, files: table };
  writeAtomic(manifestPath(entityDir, n), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

function makeHandle(n, meta, table, resolve) {
  const paths = Object.keys(table).sort();
  const filePath = (rel) => {
    const norm = normalizeVersionPath(rel);
    return norm && Object.hasOwn(table, norm) ? resolve(norm) : null;
  };
  return {
    n,
    meta,
    // 前缀按目录算："assets" 和 "assets/" 一样，都只列 assets/ 下面的文件。
    list(prefix = "") {
      if (!prefix) return paths.slice();
      const p = prefix.endsWith("/") ? prefix : prefix + "/";
      return paths.filter((x) => x.startsWith(p));
    },
    has: (rel) => filePath(rel) != null,
    filePath,
    read(rel) {
      const p = filePath(rel);
      return p ? fs.readFileSync(p) : null;
    },
    readText(rel) {
      const p = filePath(rel);
      return p ? fs.readFileSync(p, "utf8") : null;
    },
  };
}

// 第 n 版的只读句柄，没有这一版回 null。
export function openVersion(projectDir, entityDir, n) {
  const mp = manifestPath(entityDir, n);
  if (fs.existsSync(mp)) {
    const m = JSON.parse(fs.readFileSync(mp, "utf8"));
    return makeHandle(n, m.meta || {}, m.files || {}, (rel) => objectPath(projectDir, m.files[rel].hash));
  }
  return null;
}
