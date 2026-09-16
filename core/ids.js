// core/ids.js — 纯计算，禁止 import fs
export function newId(prefix, now = Date.now) {
  return `${prefix}_${now()}`;
}

// 项目名 → 人类可读的目录名：保留字母/数字/中日韩等任意文字，把文件系统不安全的字符
// （斜杠、引号、空白……）折叠成单个 "-"；不强制转 ASCII，"招聘系统" 就用 "招聘系统" 做目录名。
const UNSAFE_CHARS = /[\\/:*?"<>|\s-]+/g;

export function slugify(name) {
  const s = String(name).trim().toLowerCase()
    .replace(UNSAFE_CHARS, "-")
    .replace(/^[-.]+/, "")
    .replace(/-+$/, "");
  return s || "project";
}

const FORBIDDEN_CHARS = /[\\/\s]/;

// projectId / pageId / artboardId / versionId 等做路径段前必须过这道闸：挡穿越（.. 与斜杠）、
// 反斜杠、空白、隐藏文件；不限制具体字符集是为了放行 slugify() 产出的非 ASCII 目录名。
export function assertSafeSegment(seg) {
  if (typeof seg !== "string" || seg.length === 0 || seg.length > 200
      || FORBIDDEN_CHARS.test(seg) || seg === "." || seg === ".." || seg.startsWith(".")) {
    throw new Error(`路径段不合法: ${JSON.stringify(seg)}`);
  }
  return seg;
}

// 旧 PRD 流程的 versionId（v1、rd-review-v5……）——只有迁移工具 bin/protoflow-migrate.mjs 还用它
// 读旧 prd/<versionId>/ 目录名，新链路不再有"版本 id"这个概念（版本就是 versions/<n>/ 的整数下标）。
export function isValidVersionId(v) {
  return typeof v === "string" && /^[a-z0-9][a-z0-9-]*$/.test(v);
}

// docId：一段人类可读的目录名 slug，规则跟项目/页面目录名一致（slugify 产出、过 assertSafeSegment
// 同一道闸），允许中日韩等任意文字——`docs/推荐候选人卡片/` 就用中文，别硬转 ASCII。只挡形状问题：
// 空/超长、连字符开头收尾、连续连字符、路径穿越、隐藏文件、空白与斜杠。文档类型的权威来源是
// doc.json.kind，不从 docId 前缀猜；`create_doc` 不传 title/docId 时才退回等于类型名（docs/prd/）。
export function isValidDocId(v) {
  if (typeof v !== "string" || v.length === 0 || v.length > 200) return false;
  if (v === "." || v === ".." || v.startsWith(".")) return false;
  if (v.startsWith("-") || v.endsWith("-") || v.includes("--")) return false;
  return !/[\\/\s]/.test(v);
}

// 版本下标：从 1 开始的正整数，落地成 versions/<n>/ 目录名。
export function isValidVersionN(n) {
  return Number.isInteger(n) && n >= 1;
}

// id 前缀 → 目标类型（delete 等统一 targetId 语义的判别依据）
export function idKind(id) {
  if (/^pg_/.test(id)) return "page";
  if (/^ab_/.test(id)) return "artboard";
  if (/^proj_/.test(id)) return "project";
  return null;
}
