// products/index.js — 内置产品的注册表：把各产品的插件描述按固定顺序交给框架（core/plugin.js 的
// buildRegistry）组装成注册表。跟 cli/、bin/ 一样属于入口层（依赖边界见 tests/boundaries.test.js）：框架从不
// import 具体产品，都是从这里拿到注册表。
//
// 加一个内置产品 = 新建 products/<名字>/，写一份插件描述（index.js，definePlugin / defineEntityProduct），
// 在下面的列表里加一行；拿掉 = 删目录、删这一行。外部插件不用改这里，写进 protoflow.config.json 就行
// （core/pluginLoader.js）。插件描述的形状见 core/sdk.js 顶部。
//
// 这里的 BUILTIN 只含内置产品、同步可用，给测试和不需要读配置的场景用；CLI、本地服务、迁移命令经
// loadRegistry() 按配置加载（内置 + 配置里的插件，去掉禁用的）。
import path from "node:path";
import { fileURLToPath } from "node:url";
import canvas from "./canvas/index.js";
import doc from "./doc/index.js";
import sheet from "./sheet/index.js";
import diagram from "./diagram/index.js";
import deck from "./deck/index.js";
import { migrate as canvasLegacyMigrate } from "./canvas/migrate.js";
import { migrate as docLegacyMigrate } from "./doc/migrate.js";
import { buildRegistry } from "../core/plugin.js";
import { loadPluginCandidates } from "../core/pluginLoader.js";
import { createEmbedder } from "../core/embed.js";
import { createProjectRenderer } from "../core/renderService.js";
import { runProjectExport as runExport } from "../core/exportService.js";

export const FRAMEWORK_GUIDES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "guides");

export const BUILTIN_CANDIDATES = [
  { source: "builtin:canvas", descriptor: canvas },
  { source: "builtin:doc", descriptor: doc },
  { source: "builtin:sheet", descriptor: sheet },
  { source: "builtin:diagram", descriptor: diagram },
  { source: "builtin:deck", descriptor: deck },
];

// 把候选插件组装成一整套可用的注册表：产品、引用解析器、实体种类、工具，以及绑好注册表的渲染、导出入口。
// strict：内置产品必须全部通过（出错说明代码有问题，直接抛）；外部插件失败只记进 skipped。
export function assembleRegistry(candidates, { strict = false } = {}) {
  const reg = {};
  const { products, tools, sources, skipped } = buildRegistry(candidates, { reg, frameworkGuidesDir: FRAMEWORK_GUIDES_DIR });
  if (strict && skipped.length) throw new Error(`内置产品注册失败：${skipped.map((s) => `${s.source} ${s.reason}`).join("；")}`);
  const resolvers = Object.fromEntries(products.filter((p) => p.resolver).map((p) => [p.resolver.type, p.resolver]));
  const renderer = createProjectRenderer(products);
  const runProjectExport = (projectRoot, subPath, opts) => runExport(projectRoot, subPath, products, opts);
  Object.assign(reg, { products, resolvers, runExport: runProjectExport, embed: createEmbedder(products) });
  return {
    products, tools, sources, skipped, reg, resolvers,
    entities: products.flatMap((p) => p.entities || []),
    renderProjectView: renderer.renderProjectView,
    resolveProjectFile: renderer.resolveProjectFile,
    runProjectExport,
  };
}

export const BUILTIN = assembleRegistry(BUILTIN_CANDIDATES, { strict: true });

// 按配置加载：内置产品（去掉禁用的）+ 配置里的外部插件。外部插件失败、冲突只记进 skipped，不影响启动。
export async function loadRegistry(opts = {}) {
  const { candidates, config, disabled } = await loadPluginCandidates(BUILTIN_CANDIDATES, opts);
  return { ...assembleRegistry(candidates), config, disabled };
}

// 项目级格式版本（project.json 的 formatVersion，1 → 3）时代的历史迁移步骤，由迁移命令在框架那一步之后
// 调用（core/migrate.js）。它们不是插件契约的一部分——插件自己的数据格式升级走描述里的 migrate，按产品
// 各自的 formatVersion 调。
export const LEGACY_PROJECT_MIGRATIONS = [canvasLegacyMigrate, docLegacyMigrate];

export const PRODUCTS = BUILTIN.products;
export const RESOLVERS = BUILTIN.resolvers;
export const ENTITIES = BUILTIN.entities;
export const { renderProjectView, resolveProjectFile, runProjectExport } = BUILTIN;
