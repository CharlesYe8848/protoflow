// core/docProduct.js — 文档交给框架的三样东西（同 core/canvasProduct.js）：
//   resolver   引用解析：文档暂不分子部位，引用按版本号比较（doc:prd@5，head 比 5 新就算过期）
//   artifacts  文档产物清单
//   health     文档自己的规则：草稿从未定版、doc.md 有没定版的改动
import fs from "node:fs";
import path from "node:path";
import { contentHash, finding } from "protoflow/sdk";
import * as docStore from "./store.js";

function workingMdHash(ws, pid, docId) {
  const p = path.join(docStore.docDir(ws, pid, docId), "doc.md");
  return fs.existsSync(p) ? contentHash(fs.readFileSync(p, "utf8")) : null;
}

export const resolver = {
  type: "doc",
  label: "文档",
  head(ws, pid, id) {
    let dj;
    try { dj = docStore.readDocJson(ws, pid, id); } catch { return null; }
    return dj ? dj.head || 0 : null;
  },
  fingerprint() { return null; }, // 没有子部位
  describe(ws, pid, id) {
    let dj = null;
    try { dj = docStore.readDocJson(ws, pid, id); } catch { /* 用 id */ }
    return `文档「${(dj && dj.title) || id}」`;
  },
};

export function artifacts(ws, pid) {
  return docStore.listDocs(ws, pid).map((d) => {
    const dj = docStore.readDocJson(ws, pid, d.id) || {};
    const head = dj.head || 0;
    const headV = (dj.versions || []).find((v) => v.n === head);
    return {
      type: "doc", id: d.id, title: dj.title || d.id, head,
      dirty: !!headV && !!headV.mdHash && headV.mdHash !== workingMdHash(ws, pid, d.id),
      versions: (dj.versions || []).map((v) => ({ n: v.n, sources: v.sources || [], publishedTo: v.publishedTo || [] })),
    };
  });
}

export function health(ws, pid) {
  const out = [];
  for (const d of docStore.listDocs(ws, pid)) {
    const dj = docStore.readDocJson(ws, pid, d.id) || {};
    const working = workingMdHash(ws, pid, d.id);
    if (!working) continue;
    if (!dj.head) {
      out.push(finding("doc_uncommitted", "uncommitted", `doc:${d.id}`,
        `文档「${d.id}」草稿从未定版`, `内容成型后 build_doc(mode:"finalize", note:"…")`));
      continue;
    }
    const headV = (dj.versions || []).find((v) => v.n === dj.head);
    if (headV && headV.mdHash && headV.mdHash !== working) {
      out.push(finding("doc_uncommitted", "uncommitted", `doc:${d.id}`,
        `文档「${d.id}」的 doc.md 有未定版的改动（当前 ${working} ≠ v${dj.head} 的 ${headV.mdHash}）`,
        `build_doc(mode:"finalize", note:"…") 切新版本`));
    }
  }
  return out;
}
