// products/diagram/diagramProduct.js — 绘图交给框架的三样东西（同表格的 sheetProduct.js）：
//   resolver   引用解析：子部位是页（页 id），指纹 = 那一页源码的哈希
//   artifacts  绘图产物清单
//   health     绘图自己的规则：草稿从未定版、有没定版的改动
import { contentHash, finding } from "protoflow/sdk";
import * as diagramStore from "./store.js";
import { draftHash } from "./diagram.js";

function readMeta(ws, pid, id) {
  try { return diagramStore.readDiagramJson(ws, pid, id); } catch { return null; }
}

export const resolver = {
  type: "diagram",
  label: "绘图",
  head(ws, pid, id) {
    const dj = readMeta(ws, pid, id);
    return dj ? dj.head || 0 : null;
  },
  fingerprint(ws, pid, id, n, part) {
    if (!part) return null;
    const version = n ?? this.head(ws, pid, id);
    if (!version) return null;
    let pages;
    try { pages = diagramStore.readVersionPages(ws, pid, id, version); } catch { return null; }
    const page = pages.find((p) => p.id === part);
    return page ? contentHash(page.source) : null;
  },
  describe(ws, pid, id, part) {
    const dj = readMeta(ws, pid, id);
    return `绘图「${(dj && dj.title) || id}」${part ? `的页「${part}」` : ""}`;
  },
};

export function artifacts(ws, pid) {
  return diagramStore.listDiagrams(ws, pid).map((d) => {
    const dj = readMeta(ws, pid, d.id) || {};
    const head = dj.head || 0;
    const headV = (dj.versions || []).find((v) => v.n === head);
    return {
      type: "diagram", id: d.id, title: dj.title || d.id, head,
      dirty: !!headV && headV.diagramHash !== draftHash(ws, pid, d.id),
      versions: (dj.versions || []).map((v) => ({ n: v.n, sources: v.sources || [], publishedTo: v.publishedTo || [] })),
    };
  });
}

export function health(ws, pid) {
  const out = [];
  for (const a of artifacts(ws, pid)) {
    if (!diagramStore.draftPageFiles(ws, pid, a.id).length) continue;
    if (!a.head) {
      out.push(finding("diagram_uncommitted", "uncommitted", `diagram:${a.id}`,
        `绘图「${a.title}」草稿从未定版`, `内容成型后 build_diagram(note:"…")`));
    } else if (a.dirty) {
      out.push(finding("diagram_uncommitted", "uncommitted", `diagram:${a.id}`,
        `绘图「${a.title}」有 v${a.head} 之后没定版的改动`, `改完一轮就 build_diagram(note:"…") 定一个版本，阅读页才会更新`));
    }
  }
  return out;
}
