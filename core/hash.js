// core/hash.js — 纯计算，禁止 import fs
import { createHash } from "node:crypto";

export function normalizeContent(text) {
  const body = String(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "");
  return body + "\n";
}

export function contentHash(text) {
  return createHash("sha256").update(normalizeContent(text), "utf8").digest("hex").slice(0, 16);
}

// 键排序的确定性 JSON 序列化——所有"对结构取指纹"的场景必须用它，禁止直接 JSON.stringify
export function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function objectHash(obj) {
  return createHash("sha256").update(stableStringify(obj), "utf8").digest("hex").slice(0, 16);
}
