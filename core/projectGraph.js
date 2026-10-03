// core/projectGraph.js — 项目图谱与健康检查的组装（框架）。产品以 { artifacts, health } 的形状
// 传进来，引用解析器以 { 类型: resolver } 传进来——组装发生在入口层（cli/tools.js），这里不
// import 任何产品。
//
// 项目图谱是流程 skill 脚本依赖的公开接口（docs/product-architecture.md §4.6、§4.7），结构带
// schemaVersion，改字段要升版本并保持向后兼容：
//   { schemaVersion: 1,
//     artifacts: [{ type, id, title, head, dirty, labels, installed?,
//                   sources: [{ ref, via, status: "fresh"|"stale"|"missing"|"unverifiable", target, head, reason }] }] }
// sources 是最新版（head）的引用单及每条的当前状态；没定过版的产物 sources 为空。labels 是产物的
// 标签（core/labels.js），框架不解释，给流程 skill 认自己管的产物。
// 产品没启用（项目里登记过、插件没装或被禁用）的产物照样列出，带 installed: false：框架凭产品登记用通用
// 实体接口读它们的元信息（标题、版本、引用单、发布记录），只是没有产品自己的判断（dirty 一律 false）。
// status 的 unverifiable（引用的产品没启用、无法校验）是后加的取值，只认前三种的读取方按"不是过期"处理即可。
import { evaluateSources } from "./refs.js";
import { referenceFindings, sortFindings } from "./chain.js";
import { readLabels } from "./labels.js";
import { listEntities, readEntityJson, uninstalledProducts } from "./store.js";

export const GRAPH_SCHEMA_VERSION = 1;

function uninstalledArtifacts(ws, pid, products) {
  return uninstalledProducts(ws, pid, products).flatMap(({ type, kind }) => listEntities(ws, pid, kind).map((e) => {
    const meta = readEntityJson(ws, pid, kind, e.id) || {};
    return { type, id: e.id, title: e.title, head: e.head, dirty: false, installed: false, labels: e.labels,
             versions: (meta.versions || []).map((v) => ({ n: v.n, sources: v.sources || [], publishedTo: v.publishedTo || [] })) };
  }));
}

function allArtifacts(ws, pid, products) {
  return [
    ...products.filter((p) => p.artifacts).flatMap((p) => {
      const kind = (p.entities || [])[0];
      return p.artifacts(ws, pid).map((a) => ({ ...a, labels: kind ? readLabels(ws, pid, kind, a.id) : [] }));
    }),
    ...uninstalledArtifacts(ws, pid, products),
  ];
}

export function projectGraph(ws, pid, products, resolvers) {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    artifacts: allArtifacts(ws, pid, products).map((a) => {
      const headV = (a.versions || []).find((v) => v.n === a.head);
      return { type: a.type, id: a.id, title: a.title, head: a.head, dirty: !!a.dirty, labels: a.labels,
               ...(a.installed === false ? { installed: false } : {}),
               sources: headV ? evaluateSources(ws, pid, headV.sources, resolvers) : [] };
    }),
  };
}

export function projectHealth(ws, pid, products, resolvers) {
  return sortFindings([
    ...products.filter((p) => p.health).flatMap((p) => p.health(ws, pid)),
    ...referenceFindings(ws, pid, allArtifacts(ws, pid, products), resolvers),
  ]);
}
