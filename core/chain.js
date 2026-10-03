// core/chain.js — 项目健康检查的框架部分：发现项的形状、严重度排序，以及唯一一类跨产品规则——
// 引用（core/refs.js）。各产品自己的规则（画板源码未校验、标注待核对、草稿没定版……）由产品的
// health 提供（core/canvasProduct.js 等），框架不认识它们。
//
// 严重度：broken（引用的东西没了）> unvalidated > review > uncommitted（有没定版的改动）>
// drifted（引用的内容之后变了）> lagging（已发布的内容落后于来源）> advice（建议，不处理也不影响使用）。
import { evaluateSources } from "./refs.js";

const SEVERITY = { broken: 0, unvalidated: 1, review: 2, uncommitted: 3, drifted: 4, lagging: 5, advice: 6 };

export function finding(code, level, target, reason, suggestedAction) {
  return { code, level, target, reason, suggestedAction };
}

export function sortFindings(findings) {
  return [...findings].sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level]);
}


// 引用规则：最新版引用的内容变了 / 没了；已发布的版本引用的内容变了 / 没了（渠道上的内容落后）。
// 只看最新版，历史版本天然会落后，不报（"出新版本"已经做了）。
export function referenceFindings(ws, pid, artifacts, resolvers) {
  const label = (a) => `${(resolvers[a.type] && resolvers[a.type].label) || a.type}「${a.title || a.id}」`;
  const out = [];
  for (const a of artifacts) {
    const target = `${a.type}:${a.id}`;
    const headV = (a.versions || []).find((v) => v.n === a.head);
    if (headV) {
      for (const r of evaluateSources(ws, pid, headV.sources, resolvers)) {
        if (r.status === "missing") {
          out.push(finding("ref_missing", "broken", target, `${label(a)} v${a.head} 引用的 ${r.ref} 不在了：${r.reason}`,
            `确认是否还需要这条引用；需要的话更新内容后定一个新版本`));
        } else if (r.status === "stale") {
          out.push(finding("ref_stale", "drifted", target, `${label(a)} v${a.head} 引用的内容变了：${r.reason}`,
            `回看变化，需要跟进就更新内容后定一个新版本`));
        } else if (r.status === "unverifiable") {
          out.push(finding("ref_unverifiable", "advice", target, `${label(a)} v${a.head} 引用的 ${r.ref} 无法校验：${r.reason}`,
            `启用对应的产品插件后再看；数据都还在，不影响使用`));
        }
      }
    }
    for (const v of a.versions || []) {
      if (!(v.publishedTo || []).length) continue;
      if (!evaluateSources(ws, pid, v.sources, resolvers).some((r) => r.status === "stale" || r.status === "missing")) continue;
      for (const rec of v.publishedTo) {
        out.push(finding("publish_lagging", "lagging", `publish:${a.type}:${a.id}@${v.n}/${rec.channel}:${rec.channelDocId}`,
          `渠道 ${rec.channel} 的文档 ${rec.channelDocId} 基于${label(a)} v${v.n}，这一版引用的内容已经变了`,
          `出新版本后重新发布，完成后 record_publish 登记`));
      }
    }
  }
  return out;
}
