// core/chain.js — 纯计算。产物声明依赖指纹，统一比对；下面的 RULES 即规则表。
// 新增派生产物 = 加一条规则，不动求值器骨架。
const SEVERITY = { broken: 0, unvalidated: 1, review: 2, uncommitted: 3, drifted: 4, lagging: 5 };

const RULES = [
  function sourceValidated(snap) {
    return snap.artboards
      .filter((ab) => ab.lastValidatedHash !== ab.sourceHash)
      .map((ab) => finding("unvalidated", "unvalidated", `artboard:${ab.id}`,
        `画板「${ab.name}」源码存在未经编译校验的外部修改（当前 ${ab.sourceHash} ≠ 已校验 ${ab.lastValidatedHash}）`,
        `用 save_artboard_source 重新校验盖章`));
  },
  // 标注 = 每块画板一篇 annotations.md，findings 因此是画板级（不再 per 标注）。
  function annotationsFresh(snap) {
    const out = [];
    for (const ab of snap.artboards) {
      if (!ab.hasAnnotations) continue;
      const brokenRefs = (ab.annotationRefElementIds || []).filter((eid) => !ab.elementIds.includes(eid));
      if (brokenRefs.length) {
        out.push(finding("annotation_broken", "broken", `annotation:${ab.id}`,
          `画板「${ab.name}」的 annotations.md 里引用的元素 ${brokenRefs.join("、")} 已不在源码中`,
          `修改源码恢复该元素，或用 write_annotations 改掉引用 / 删掉该段`));
      } else if (ab.annotationsValidatedHash !== ab.sourceHash) {
        out.push(finding("annotation_review", "review", `annotation:${ab.id}`,
          `画板「${ab.name}」源码已变，annotations.md 上次核对于 ${ab.annotationsValidatedHash || "(从未)"}`,
          `对照当前源码核对 annotations.md 仍准确后用 write_annotations 重新提交盖章`));
      }
    }
    return out;
  },
  // doc.md 有未定版的改动（含"草稿从未 finalize"）——不强制，只提醒。切点靠 doc-writing.md 引导。
  function docUncommitted(snap) {
    const out = [];
    for (const d of snap.docs || []) {
      if (!d.workingMdHash) continue;
      if (d.head === 0) {
        out.push(finding("doc_uncommitted", "uncommitted", `doc:${d.id}`,
          `文档「${d.id}」草稿从未定版`, `内容成型后 build_doc(mode:"finalize", note:"…")`));
      } else {
        const headV = (d.versions || []).find((v) => v.n === d.head);
        if (headV && headV.mdHash && headV.mdHash !== d.workingMdHash) {
          out.push(finding("doc_uncommitted", "uncommitted", `doc:${d.id}`,
            `文档「${d.id}」的 doc.md 有未定版的改动（当前 ${d.workingMdHash} ≠ v${d.head} 的 ${headV.mdHash}）`,
            `build_doc(mode:"finalize", note:"…") 切新版本`));
        }
      }
    }
    return out;
  },
  // head 版本引用的画板漂移了——建新版本。历史版本天然会漂，不报（"建新版本"你已经做了）。
  // 没有 sourceFingerprints 的文档（图不是从画板截的）天然跳过。
  function docDrifted(snap) {
    const out = [];
    const abMap = new Map(snap.artboards.map((a) => [a.id, a]));
    for (const d of snap.docs || []) {
      const headV = (d.versions || []).find((v) => v.n === d.head);
      if (!headV) continue;
      for (const [aid, built] of Object.entries(headV.sourceFingerprints || {})) {
        const ab = abMap.get(aid);
        if (!ab) {
          out.push(finding("doc_broken", "broken", `doc:${d.id}`,
            `文档「${d.id}」v${d.head} 引用的画板 ${aid} 已被删除`, `新建版本并更新 .build/captures.json`));
        } else if (ab.sourceHash !== built) {
          out.push(finding("doc_drifted", "drifted", `doc:${d.id}`,
            `文档「${d.id}」v${d.head} 构建时画板「${ab.name}」为 ${built}，现已是 ${ab.sourceHash}`,
            `build_doc(mode:"finalize") 切新版本`));
        }
      }
    }
    return out;
  },
  // 已发布版本引用的画板漂移了——需要建新版本→组包→重发。
  function publishLagging(snap) {
    const out = [];
    const abMap = new Map(snap.artboards.map((a) => [a.id, a]));
    for (const d of snap.docs || []) {
      for (const v of d.versions || []) {
        if (!(v.publishedTo || []).length) continue;
        const drifted = Object.entries(v.sourceFingerprints || {}).some(([aid, built]) => {
          const ab = abMap.get(aid);
          return !ab || ab.sourceHash !== built;
        });
        if (!drifted) continue;
        for (const rec of v.publishedTo) {
          out.push(finding("publish_lagging", "lagging", `publish:${d.id}@${v.n}/${rec.channel}:${rec.channelDocId}`,
            `渠道 ${rec.channel} 的文档 ${rec.channelDocId} 基于「${d.id}」v${v.n}，该版本引用的画板已漂移`,
            `建新版本→组包→重发，完成后 record_publish 登记`));
        }
      }
    }
    return out;
  },
  // 派生文档的上游已有更新版本（如上线公告基于 PRD v5，PRD 已到 v7）。
  function originStale(snap) {
    const out = [];
    const byId = new Map((snap.docs || []).map((d) => [d.id, d]));
    for (const d of snap.docs || []) {
      for (const o of d.origin || []) {
        const up = byId.get(o.docId);
        if (up && up.head > o.version) {
          out.push(finding("origin_stale", "lagging", `origin:${d.id}`,
            `文档「${d.id}」基于「${o.docId}」v${o.version}，上游已到 v${up.head}`,
            `回看上游变更，必要时更新本文档并切新版本`));
        }
      }
    }
    return out;
  },
];

function finding(code, level, target, reason, suggestedAction) {
  return { code, level, target, reason, suggestedAction };
}

export function evaluateChain(snapshot) {
  const all = RULES.flatMap((rule) => rule(snapshot));
  return all.sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level]);
}
