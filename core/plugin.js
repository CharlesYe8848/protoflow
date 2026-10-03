// core/plugin.js — 产品插件的契约和注册（框架），docs/product-architecture.md §4.11。
//
//   definePlugin(desc)          通用的底层契约：不假定插件有实体、有版本。只做形状上的整理，校验在注册时做。
//   defineEntityProduct(opts)   标准实体产品（<rootSeg>/<id>/preview.html 一个阅读页 + 版本文件）的
//                               便利封装：生成路由、版本文件解析、侧边栏清单，其余字段原样透传，都能覆盖。
//   buildRegistry(candidates)   把一组候选插件变成注册表，一次成型：先逐个校验描述，再按顺序查冲突
//                               （type、数据目录、工具名、指南主题），最后一次性提交。失败的、冲突的
//                               后来者跳过并记下原因，不会留下半套路由或工具。
import fs from "node:fs";
import { z } from "zod";
import { listEntities } from "./store.js";

// 宿主支持的契约版本。只在契约出现不兼容变化时加一（包本身按语义化版本发版，跟这个不是一回事）。
export const SUPPORTED_API_VERSIONS = [1];

const fn = z.custom((v) => typeof v === "function", { message: "应为函数" });
const entityKind = z.object({
  rootSeg: z.string().regex(/^[a-z][a-z0-9-]*$/, "数据目录名只用小写字母、数字、连字符"),
  metaFile: z.string().regex(/^[\w.-]+\.json$/, "元信息文件应为 <名字>.json"),
}).passthrough();

const DESCRIPTOR = z.object({
  apiVersion: z.number().int(),
  type: z.string().regex(/^[a-z][a-z0-9-]*$/, "type 只用小写字母、数字、连字符（它会写进用户数据的引用里，发布后不能改）"),
  label: z.string().min(1),
  formatVersion: z.number().int().positive().optional(),
  navIcon: z.string().optional(),
  nav: fn.optional(),
  render: fn.optional(),
  resolveFile: fn.optional(),
  exports: z.object({ hasId: z.boolean(), defaultFormat: z.string(), formats: z.array(z.object({ id: z.string(), build: fn }).passthrough()) }).optional(),
  tools: fn.optional(),
  publish: z.object({ entity: entityKind, hashField: z.string(), notBuilt: z.string() }).optional(),
  describeProject: fn.optional(),
  describeHint: z.string().optional(),
  resolver: z.object({ type: z.string(), label: z.string(), head: fn, fingerprint: fn }).passthrough().optional(),
  artifacts: fn.optional(),
  health: fn.optional(),
  entities: z.array(entityKind).optional(),
  deletePart: fn.optional(),
  partHint: z.string().optional(),
  migrate: fn.optional(),
  embed: fn.optional(),
  embedFormats: z.array(z.enum(["html", "data", "svg", "markdown"])).optional(),
  guidesDir: z.string().optional(),
  agentsDoc: z.object({}).passthrough().optional(),
}).strict();

// 通用契约。缺省 formatVersion = 1；实体种类上标出所属产品和数据格式版本，框架按实体种类读写时
// （产品登记、格式检查）用得到，产品不用自己再传一遍。
export function definePlugin(desc) {
  const out = { formatVersion: 1, ...desc };
  for (const kind of out.entities || []) {
    if (kind.type == null) kind.type = out.type;
    if (kind.formatVersion == null) kind.formatVersion = out.formatVersion;
  }
  return out;
}

const byRecent = (a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 标准实体产品：一个实体种类 entity、一个阅读页 previewHtml(ws, pid, id, opts) → html | null、一个
// 版本句柄 openVersion(ws, pid, id, n)。生成：
//   entities    [entity]
//   nav         按最近更新排序，定过版的可点开（<rootSeg>/<id>/preview.html），没定版的置灰标"未定版"
//   render      <rootSeg>/<id>/preview.html → 阅读页（产品主页面，注入项目侧边栏）
//   resolveFile <rootSeg>/<id>/versions/<n>/<路径> → 版本里文件的实际位置
// 其余字段（exports、tools、resolver……）原样透传；上面生成的任何一项都可以在 opts 里显式覆盖。
export function defineEntityProduct({ entity, previewHtml, openVersion, ...rest }) {
  if (!entity || !previewHtml || !openVersion) throw new Error("defineEntityProduct 需要 entity、previewHtml、openVersion");
  const seg = escapeRe(entity.rootSeg);
  const previewRe = new RegExp(`^${seg}/([^/]+)/preview\\.html$`);
  const versionFileRe = new RegExp(`^${seg}/([^/]+)/versions/([1-9]\\d*)/(.+)$`);
  return definePlugin({
    entities: [entity],
    nav(ws, pid) {
      return listEntities(ws, pid, entity).sort(byRecent).map((e) => ({
        id: e.id, title: e.title || e.id,
        href: e.head ? `${entity.rootSeg}/${encodeURIComponent(e.id)}/preview.html` : null,
        meta: e.head ? "" : "未定版",
      }));
    },
    render(ws, pid, relPath, opts) {
      const m = previewRe.exec(relPath);
      if (!m) return null;
      const html = previewHtml(ws, pid, m[1], opts);
      return html == null ? null : { html, current: { type: rest.type, id: m[1] } };
    },
    resolveFile(ws, pid, relPath) {
      const m = versionFileRe.exec(relPath);
      if (!m) return null;
      const version = openVersion(ws, pid, m[1], Number(m[2]));
      return (version && version.filePath(m[3])) || null;
    },
    ...rest,
  });
}

function guideTopics(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
}

// candidates：[{ source, descriptor } | { source, error }]，按优先顺序排好（内置在前，其余按配置顺序）。
// reg：交给各产品 tools(reg) 的句柄，注册成型后由调用方补上 products 等字段（工具的 handler 运行时才用）。
// frameworkGuidesDir：框架自己的指南目录，主题跟产品的一起查重。
// 返回 { products, tools, sources: { 类型: 来源 }, skipped: [{ source, type?, reason }] }。
export function buildRegistry(candidates, { reg = {}, frameworkGuidesDir = null } = {}) {
  const skipped = [];
  const accepted = [];
  const taken = { type: new Map(), rootSeg: new Map(), tool: new Map(), topic: new Map() };
  for (const t of guideTopics(frameworkGuidesDir)) taken.topic.set(t, "框架");

  for (const c of candidates) {
    if (c.error) { skipped.push({ source: c.source, reason: `加载失败：${c.error.message || c.error}` }); continue; }
    const parsed = DESCRIPTOR.safeParse(c.descriptor);
    if (!parsed.success) {
      const why = parsed.error.issues.map((i) => `${i.path.join(".") || "(描述)"}：${i.message}`).join("；");
      skipped.push({ source: c.source, type: c.descriptor && c.descriptor.type, reason: `描述不合法：${why}` });
      continue;
    }
    const p = definePlugin(c.descriptor);
    if (!SUPPORTED_API_VERSIONS.includes(p.apiVersion)) {
      skipped.push({ source: c.source, type: p.type, reason: `apiVersion ${p.apiVersion} 不受支持（宿主支持 ${SUPPORTED_API_VERSIONS.join("、")}）` });
      continue;
    }
    let tools;
    try { tools = p.tools ? p.tools(reg) : []; }
    catch (e) { skipped.push({ source: c.source, type: p.type, reason: `工具定义出错：${e.message}` }); continue; }
    const claims = [
      ["type", [p.type], "类型"],
      ["rootSeg", (p.entities || []).map((k) => k.rootSeg), "数据目录"],
      ["tool", tools.map((t) => t.name), "工具"],
      ["topic", guideTopics(p.guidesDir), "指南主题"],
    ];
    const clash = claims.flatMap(([k, vals, label]) => vals.filter((v) => taken[k].has(v)).map((v) => `${label} ${v} 已被 ${taken[k].get(v)} 占用`));
    if (clash.length) { skipped.push({ source: c.source, type: p.type, reason: `冲突：${clash.join("；")}` }); continue; }
    for (const [k, vals] of claims) for (const v of vals) taken[k].set(v, `${p.type}（${c.source}）`);
    accepted.push({ product: p, tools, source: c.source });
  }
  // 一次性提交。来源不写进产品描述（描述可以原样再注册一次），单独按类型给出。
  return {
    products: accepted.map((a) => a.product),
    tools: accepted.flatMap((a) => a.tools),
    sources: Object.fromEntries(accepted.map((a) => [a.product.type, a.source])),
    skipped,
  };
}

// 本地服务的路由分发：路径第一段是哪个产品的数据目录，就只问那个产品；不属于任何实体目录的路径，
// 只问没有实体的插件（工具型插件）。产品之间不会抢路由。
export function routeOwners(products, relPath) {
  const seg = String(relPath).split("/")[0];
  const owner = products.filter((p) => (p.entities || []).some((k) => k.rootSeg === seg));
  return owner.length ? owner : products.filter((p) => !(p.entities || []).length);
}

export function pluginSourceLabel(source) {
  return source && source.startsWith("builtin:") ? "内置" : source;
}
