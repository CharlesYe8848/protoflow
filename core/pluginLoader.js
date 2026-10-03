// core/pluginLoader.js — 按配置加载产品插件（框架），docs/product-architecture.md §4.11。
//
// 配置文件 protoflow.config.json，跟本地服务的状态文件（~/.protoflow/server.json）放在同一个目录：
// 本地服务是这个用户唯一的一个、同时服务所有工作区的项目，它只能加载一套产品，所以配置是用户级的。
// PROTOFLOW_CONFIG 可以指到别处（测试用）。形状：
//   { "products": ["./my-plugin", "@someone/protoflow-slides"],   外部插件：路径（相对配置文件所在目录）或 npm 包名
//     "disabled": ["diagram"] }                                   按类型禁用，内置、外部都算
// 没有配置文件 = 只用内置产品。
//
// 只支持可信插件：插件就是在宿主进程里执行的代码，跟 npm 依赖同等信任，不做沙箱。
//
// 加载只产出"候选"（{ source, descriptor } 或 { source, error }），校验、查冲突、一次成型的注册在
// core/plugin.js 的 buildRegistry。产品集指纹（productsFingerprint）给本地服务的单例自检用：配置或插件
// 变了，指纹就变，CLI 发现跟正在跑的服务不一致就重启它，两边看到的产品始终一致。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { createHash } from "node:crypto";

// 跟本地服务的状态文件同目录（core/localServer.js 的 resolveStatusPath；这里不 import 它，免得跟
// localServer 互相引用）。
export function resolveConfigPath(env = process.env) {
  if (env.PROTOFLOW_CONFIG) return env.PROTOFLOW_CONFIG;
  const status = env.PROTOFLOW_SERVER_STATUS || path.join(os.homedir(), ".protoflow", "server.json");
  return path.join(path.dirname(status), "protoflow.config.json");
}

export function readPluginConfig(configPath = resolveConfigPath()) {
  if (!fs.existsSync(configPath)) return { path: configPath, exists: false, products: [], disabled: [], raw: "" };
  const raw = fs.readFileSync(configPath, "utf8");
  let cfg;
  try { cfg = JSON.parse(raw); } catch (e) { throw new Error(`配置文件不是合法 JSON：${configPath}（${e.message}）`); }
  const list = (v, name) => {
    if (v == null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`配置文件 ${configPath} 的 ${name} 应为字符串数组`);
    return v;
  };
  return { path: configPath, exists: true, products: list(cfg.products, "products"), disabled: list(cfg.disabled, "disabled"), raw };
}

const isPathSpec = (spec) => spec.startsWith(".") || spec.startsWith("/") || /^[A-Za-z]:[\\/]/.test(spec);

// 插件入口文件：路径是目录就看它的 package.json（exports["."] / main），没有就 index.js；包名从配置文件
// 所在目录解析（插件装在那里），找不到再从 protoflow 自己的位置解析。
export function resolvePluginEntry(spec, configDir) {
  if (isPathSpec(spec)) {
    const abs = path.resolve(configDir, spec);
    if (!fs.existsSync(abs)) throw new Error(`插件路径不存在：${abs}`);
    if (fs.statSync(abs).isFile()) return abs;
    const pj = path.join(abs, "package.json");
    if (fs.existsSync(pj)) {
      const meta = JSON.parse(fs.readFileSync(pj, "utf8"));
      const exp = typeof meta.exports === "string" ? meta.exports : meta.exports && (meta.exports["."] && (meta.exports["."].import || meta.exports["."].default || meta.exports["."]));
      const main = (typeof exp === "string" && exp) || meta.main;
      if (main) return path.resolve(abs, main);
    }
    return path.join(abs, "index.js");
  }
  for (const from of [path.join(configDir, "noop.js"), import.meta.url]) {
    try { return createRequire(from).resolve(spec); } catch { /* 下一个位置 */ }
  }
  throw new Error(`找不到插件包 ${spec}（在 ${configDir} 下 npm i 它）`);
}

// builtins：内置产品的候选（按顺序）；返回 { candidates, config, disabled: [类型] }。
export async function loadPluginCandidates(builtins, { configPath = resolveConfigPath() } = {}) {
  let config;
  try { config = readPluginConfig(configPath); }
  catch (e) { return { candidates: [...builtins, { source: configPath, error: e }], config: { path: configPath, exists: true, products: [], disabled: [] }, disabled: [] }; }
  const off = new Set(config.disabled);
  const candidates = builtins.filter((c) => !off.has(c.descriptor.type));
  for (const spec of config.products) {
    try {
      const entry = resolvePluginEntry(spec, path.dirname(configPath));
      const mod = await import(pathToFileURL(entry).href);
      const descriptor = mod.default;
      if (!descriptor || typeof descriptor !== "object") throw new Error("插件入口没有默认导出插件描述（export default definePlugin({...})）");
      if (off.has(descriptor.type)) continue;
      candidates.push({ source: spec, descriptor });
    } catch (e) {
      candidates.push({ source: spec, error: e });
    }
  }
  return { candidates, config, disabled: [...off] };
}

// 产品集指纹：配置内容 + 每个外部插件入口文件的位置和修改时间（改了插件代码也算）。内置产品随 protoflow
// 本身的代码走，不计入。只读文件元信息，每次 CLI 调用都算得起。
export function productsFingerprint(configPath = resolveConfigPath()) {
  const h = createHash("sha256");
  let config;
  try { config = readPluginConfig(configPath); } catch (e) { h.update(`bad-config:${e.message}`); return h.digest("hex").slice(0, 16); }
  h.update(config.raw);
  for (const spec of config.products) {
    try {
      const entry = resolvePluginEntry(spec, path.dirname(configPath));
      h.update(`\n${entry}:${fs.statSync(entry).mtimeMs}`);
    } catch (e) { h.update(`\n${spec}:unresolved`); }
  }
  return h.digest("hex").slice(0, 16);
}
