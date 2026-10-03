// core/labels.js — 产物的标签（框架）。标签存在产物自己的元信息文件里（canvas.json / doc.json /
// sheet.json 的 labels: string[]），框架只存、只在项目图谱里原样返回，不解释含义。流程 skill 用它认出
// 自己管的产物（比如产品研发流程给 PRD 打 "product-dev/prd"），所以框架和产品都不认识任何流程。
//
// 一个产品的产物种类 = 它在注册描述里声明的第一个实体种类（entities[0]），按类型找就行，不用产品配合。
import { readEntityJson, writeEntityJson } from "./store.js";

const MAX_LABEL = 64;

// 规范化：去空白、去重、保持顺序。不合法（不是字符串数组、空串、太长、含空白）抛错。
export function normalizeLabels(labels) {
  if (labels == null) return [];
  if (!Array.isArray(labels)) throw Object.assign(new Error("labels 要是字符串数组"), { code: "BAD_LABELS" });
  const out = [];
  for (const raw of labels) {
    const l = typeof raw === "string" ? raw.trim() : raw;
    if (typeof l !== "string" || !l || l.length > MAX_LABEL || /\s/.test(l)) {
      throw Object.assign(new Error(`标签不合法：${JSON.stringify(raw)}（非空、不含空白、不超过 ${MAX_LABEL} 字）`), { code: "BAD_LABELS" });
    }
    if (!out.includes(l)) out.push(l);
  }
  return out;
}

export function artifactKind(products, type) {
  const p = products.find((x) => x.type === type);
  return (p && p.entities && p.entities[0]) || null;
}

export function readLabels(ws, pid, kind, id) {
  const meta = readEntityJson(ws, pid, kind, id);
  return (meta && Array.isArray(meta.labels)) ? meta.labels : [];
}

// 整组替换。产物不存在回 null。
export function writeLabels(ws, pid, kind, id, labels) {
  const meta = readEntityJson(ws, pid, kind, id);
  if (!meta) return null;
  meta.labels = normalizeLabels(labels);
  writeEntityJson(ws, pid, kind, id, meta);
  return meta.labels;
}
