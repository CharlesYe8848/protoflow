// products/doc/migrate.js — 文档的旧格式 → 当前格式，只由迁移命令调用（core/migrate.js）。
//   1. doc.json 没有 sources 的版本：按老字段补上（老字段保留，不改写历史）
//        versions[].sourceFingerprints { 画板id: 源码哈希 } → canvas:main#画板id，fp = 当时的源码哈希
//        origin [{ docId, version }]（建文档时的 from）→ 每一版的声明引用 doc:<docId>@<version>
//      还没定过版的，origin 变成 pendingSources。
//   2. 文档类型的旧写法 → 标签 labels（core/labels.js）：kind（最早的文档类型）、recipe（后来的
//      "<配方>/<模板>"）都转成标签。prd、release-note 的模板和检查在产品研发流程 skill 里，它认
//      product-dev/prd、product-dev/release-note 这两个标签。更早记模板名的 template 字段一并去掉。
//   3. 旧截图流水线的配置 docs/<id>/.build/captures.json → docs/<id>/captures.json。
import fs from "node:fs";
import path from "node:path";
import { entityRoot, readJson, writeJson } from "protoflow/sdk";
import * as docStore from "./store.js";

const KIND_TO_LABEL = { prd: "product-dev/prd", "release-note": "product-dev/release-note" };

function upgradeRefs(dj) {
  const originRefs = (dj.origin || []).map((o) => ({ ref: `doc:${o.docId}@${o.version}`, via: "declared" }));
  let changed = false;
  for (const v of dj.versions || []) {
    if (v.sources) continue;
    v.sources = [
      ...originRefs,
      ...Object.entries(v.sourceFingerprints || {}).map(([ab, fp]) => ({ ref: `canvas:main#${ab}`, via: "capture", fp })),
    ];
    changed = true;
  }
  if (!(dj.versions || []).length && originRefs.length && !dj.pendingSources) {
    dj.pendingSources = originRefs;
    changed = true;
  }
  return changed;
}

export function migrate(ws, pid, { apply }) {
  const root = entityRoot(ws, pid, docStore.DOC_ENTITY);
  if (!fs.existsSync(root)) return [];
  const changes = [];
  for (const docId of fs.readdirSync(root)) {
    const dir = path.join(root, docId);
    const jsonPath = path.join(dir, "doc.json");
    const dj = readJson(jsonPath, null);
    if (!dj) continue;
    const what = [];
    if (upgradeRefs(dj)) what.push("补 sources");
    if (dj.kind !== undefined || dj.recipe !== undefined || dj.template !== undefined) {
      const label = dj.recipe || KIND_TO_LABEL[dj.kind];
      const labels = Array.isArray(dj.labels) ? dj.labels : [];
      if (label && !labels.includes(label)) labels.push(label);
      if (labels.length) dj.labels = labels;
      const old = ["kind", "recipe", "template"].filter((k) => dj[k] !== undefined).join("、");
      delete dj.kind;
      delete dj.recipe;
      delete dj.template;
      what.push(`${old} → labels ${label || "（无）"}`);
    }
    const oldCaptures = path.join(dir, ".build", "captures.json");
    const newCaptures = path.join(dir, "captures.json");
    const moveCaptures = fs.existsSync(oldCaptures) && !fs.existsSync(newCaptures);
    if (moveCaptures) what.push(".build/captures.json → captures.json");
    if (!what.length) continue;
    if (apply) {
      writeJson(jsonPath, dj);
      if (moveCaptures) fs.renameSync(oldCaptures, newCaptures);
    }
    changes.push(`docs/${docId}：${what.join("；")}`);
  }
  return changes;
}
