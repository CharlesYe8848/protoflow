// core/sheetProduct.js — 表格交给框架的三样东西（同 core/canvasProduct.js）：
//   resolver   引用解析：子部位是 sheet（按名字），指纹 = 那个 sheet 整体（数据、合并、样式）的哈希
//   artifacts  表格产物清单
//   health     表格自己的规则：草稿从未定版、sheet.json 有没定版的改动
import fs from "node:fs";
import path from "node:path";
import { finding, objectHash } from "protoflow/sdk";
import * as sheetStore from "./store.js";

function workingHash(ws, pid, sheetId) {
  const p = path.join(sheetStore.sheetDir(ws, pid, sheetId), "sheet.json");
  if (!fs.existsSync(p)) return null;
  try { return objectHash(JSON.parse(fs.readFileSync(p, "utf8"))); } catch { return "invalid"; }
}

export const resolver = {
  type: "sheet",
  label: "表格",
  head(ws, pid, id) {
    let dj;
    try { dj = sheetStore.readSheetJson(ws, pid, id); } catch { return null; }
    return dj ? dj.head || 0 : null;
  },
  fingerprint(ws, pid, id, n, part) {
    if (!part) return null;
    const version = n ?? this.head(ws, pid, id);
    if (!version) return null;
    const v = sheetStore.openSheetVersion(ws, pid, id, version);
    const raw = v && v.readText("sheet.json");
    if (!raw) return null;
    const sheet = (JSON.parse(raw).sheets || []).find((s) => s.name === part);
    return sheet ? objectHash(sheet) : null;
  },
  describe(ws, pid, id, part) {
    let dj = null;
    try { dj = sheetStore.readSheetJson(ws, pid, id); } catch { /* 用 id */ }
    return `表格「${(dj && dj.title) || id}」${part ? `的 sheet「${part}」` : ""}`;
  },
};

export function artifacts(ws, pid) {
  return sheetStore.listSheets(ws, pid).map((d) => {
    const dj = sheetStore.readSheetJson(ws, pid, d.id) || {};
    const head = dj.head || 0;
    const headV = (dj.versions || []).find((v) => v.n === head);
    return {
      type: "sheet", id: d.id, title: dj.title || d.id, head,
      dirty: !!headV && headV.sheetHash !== workingHash(ws, pid, d.id),
      versions: (dj.versions || []).map((v) => ({ n: v.n, sources: v.sources || [], publishedTo: v.publishedTo || [] })),
    };
  });
}

export function health(ws, pid) {
  const out = [];
  for (const a of artifacts(ws, pid)) {
    if (!workingHash(ws, pid, a.id)) continue;
    if (!a.head) {
      out.push(finding("sheet_uncommitted", "uncommitted", `sheet:${a.id}`,
        `表格「${a.title}」草稿从未定版`, `内容成型后 build_sheet(note:"…")`));
    } else if (a.dirty) {
      out.push(finding("sheet_uncommitted", "uncommitted", `sheet:${a.id}`,
        `表格「${a.title}」的 sheet.json 有 v${a.head} 之后没定版的改动`, `build_sheet(note:"…") 切新版本`));
    }
  }
  return out;
}
