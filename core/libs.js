// core/libs.js — 依赖库（vendored JS）的定位、拷贝和读取（框架）。不认识任何具体的库：每个产品在
// 自己目录下的 libs.js 里声明"库文件名 → 它在 node_modules 里的位置"（用这里的 packageFileFrom），调用时
// 把这张表传进来。项目级 lib/ 只拷一份（不同产品声明同名的库，指向的是同一个文件）；单 HTML 导出把库
// 读成字符串内联。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// 有的包 exports 字段不放行 ./umd/* 之类子路径（react 18），得经 package.json 定位包根目录再拼；
// 有的连 ./package.json 这个子路径都不放行（inline-style-parser），退回"解析它的 main 入口、往上走到
// 包根"这条路。
function pkgRoot(require_, name) {
  try { return path.dirname(require_.resolve(`${name}/package.json`)); }
  catch { return path.dirname(path.dirname(require_.resolve(name))); }
}

// 库表里的一项：包名 + 包内相对路径 → 惰性求值的绝对路径（没装的包只在真用到时才报错）。
// 包从调用方所在的位置解析（from 传调用方的 import.meta.url）：插件自带的依赖装在插件自己的
// node_modules 下也找得到，不依赖框架的安装位置。
export function packageFile(pkg, relPath, from) {
  if (!from) throw new Error("packageFile 需要 from（调用方的 import.meta.url）");
  const require_ = createRequire(from);
  return () => path.join(pkgRoot(require_, pkg), relPath);
}

// 绑好位置的 packageFile：产品的 libs.js 里写 const packageFile = packageFileFrom(import.meta.url)。
export const packageFileFrom = (from) => (pkg, relPath) => packageFile(pkg, relPath, from);

function resolveLib(table, name) {
  const resolve = table[name];
  if (!resolve) throw new Error(`未知的库文件：${name}`);
  return resolve();
}

// 按名字把库拷进 destDir（覆盖已有文件）。names 缺省 = 表里全部。
export function copyLibs(destDir, table, names = Object.keys(table)) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of names) fs.copyFileSync(resolveLib(table, name), path.join(destDir, name));
}

// 只拷缺的：本地服务每次 GET 都可能调，不该每次重拷 3.5MB 的 mermaid。
export function ensureLibs(destDir, table, names = Object.keys(table)) {
  const missing = names.filter((n) => !fs.existsSync(path.join(destDir, n)));
  if (missing.length) copyLibs(destDir, table, missing);
}

// 单 HTML 导出用：把库文件读成字符串（不落盘），供内联进 <script> 标签。
export function readLibSources(table, names) {
  const out = {};
  for (const name of names) out[name] = fs.readFileSync(resolveLib(table, name), "utf8");
  return out;
}
