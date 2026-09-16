#!/usr/bin/env node
// Export current reviewed files; never copy Git history or overwrite a directory.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const arg = process.argv[2];
if (!arg) throw new Error("用法：node scripts/prepare-public.mjs <新的发布目录>");
const requested = path.resolve(arg);
let ancestor = requested;
while (!fs.existsSync(ancestor)) {
  try {
    if (fs.lstatSync(ancestor).isSymbolicLink()) throw new Error("发布路径包含失效的符号链接");
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  const parent = path.dirname(ancestor);
  if (parent === ancestor) throw new Error("无法解析发布目录");
  ancestor = parent;
}
const destination = path.join(fs.realpathSync(ancestor), path.relative(ancestor, requested));
const relative = path.relative(fs.realpathSync(root), destination);
if (!relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) {
  throw new Error("发布目录必须位于当前仓库之外");
}
if (fs.existsSync(destination)) throw new Error("发布目录已存在；为保护已有内容，请换一个新目录");
const rootFiles = new Set([".gitignore", ".nvmrc", "README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md", "package.json", "package-lock.json"]);
const directories = [".github/", "bin/", "core/", "mcp/", "guides/", "doc-kinds/", "tests/", "examples/", "scripts/", "docs/images/"];
const docs = new Set(["docs/usage.md", "docs/architecture-notes.md", "docs/release-v0.1.0.md", "docs/releasing.md"]);
const candidates = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root }).toString().split("\0").filter(Boolean);
const files = [...new Set(candidates)].filter(name => rootFiles.has(name) || docs.has(name) || directories.some(dir => name.startsWith(dir))).sort();
const secretPatterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bsk-[A-Za-z0-9_-]{30,}\b/];
const reviewed = [];
for (const name of files) {
  const src = path.join(root, name);
  if (!fs.existsSync(src)) continue;
  let cursor = root;
  for (const part of name.split("/")) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`拒绝符号链接：${name}`);
  }
  if (!fs.statSync(src).isFile()) throw new Error(`不是普通文件：${name}`);
  if (name.split("/").some(part => [".git", "node_modules", ".claude", ".env"].includes(part) || part.startsWith(".env."))) throw new Error(`拒绝本地配置：${name}`);
  if (!/\.(png|jpg|gif|webp|ico|woff2?)$/i.test(name)) {
    const text = fs.readFileSync(src, "utf8");
    if (secretPatterns.some(pattern => pattern.test(text))) throw new Error(`发现疑似凭据，请人工检查：${name}`);
  }
  reviewed.push(name);
}
fs.mkdirSync(destination, { recursive: true });
for (const name of reviewed) {
  const target = path.join(destination, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, name), target);
  fs.chmodSync(target, fs.statSync(path.join(root, name)).mode & 0o777);
}
console.log(JSON.stringify({ destination, files: reviewed.length, gitHistoryCopied: false, note: "只做常见凭据格式检查；发布前仍需人工检查文件清单。" }, null, 2));
