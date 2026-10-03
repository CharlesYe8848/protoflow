// core/sheet.js — 表格基座（跟 core/doc.js 平级）。sheets/<sheetId>/sheet.json 是正文本身，AI 直接
// Read/Edit/Write；只有显式 build_sheet(note:) 才产生一个版本。没有 kind、没有截图流水线、没有
// snapshot 阶段——改完 sheet.json 一步到位 finalize。
//
// 内容模型见 guides/sheet-schema.md（本产品目录下）：{ title, sheets: [{ name, rows, merges?, styles? }] }。
import fs from "node:fs";
import { assetSources, isSourceSidecar, isValidEntityId, normalizeLabels, objectHash, versionSources } from "protoflow/sdk";
import path from "node:path";
import * as sheetStore from "./store.js";

const fail = (code, message, hint) => ({ ok: false, error: { code, message, ...(hint ? { hint } : {}) } });
const iso = (ctx) => new Date(ctx.now()).toISOString();

function seedContent(title) {
  return {
    schemaVersion: 1,
    title: title || "未命名表格",
    sheets: [{ name: "Sheet1", rows: [["", ""], ["", ""]], styles: {} }],
  };
}

// 单元格值整体是 ![说明](assets/<file>) 时，这一格渲染成图片而不是文字——跟 doc.md 里
// ![](assets/x) 是同一个约定（同一个正则、同一套"引用的文件必须存在于 assets/、finalize 时冻结
// 进 versions/<n>/assets/"规则），只是这里要求整格就是这一个引用，不允许图片和别的文字混排
// （表格单元格是原子值，不是流式正文，混排没有意义）。core/exportSheetXlsx.js 复用这个正则，
// core/sheetPreview.js 的浏览器端是同一条正则的第二份拷贝，改一处记得改另一处。
export const IMAGE_CELL_RE = /^!\[([^\]]*)\]\(assets\/([^)\s]+)\)$/;
export function matchImageCell(value) {
  if (typeof value !== "string") return null;
  const m = IMAGE_CELL_RE.exec(value.trim());
  return m ? { alt: m[1], file: decodeURIComponent(m[2]) } : null;
}

function referencedAssets(content) {
  const out = new Set();
  for (const sheet of content.sheets || []) {
    for (const row of sheet.rows || []) {
      for (const val of row) {
        const img = matchImageCell(val);
        if (img) out.add(img.file);
      }
    }
  }
  return [...out];
}

// ---- 校验 ----

// 纯函数：{ ok:true } 或 { ok:false, errors:[…] }（每条都带具体的 sheet/坐标，方便 AI 定位改）。
export function validateSheetContent(content) {
  const errors = [];
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return { ok: false, errors: ["顶层必须是一个 JSON 对象"] };
  }
  const sheets = content.sheets;
  if (!Array.isArray(sheets) || sheets.length === 0) {
    return { ok: false, errors: ["sheets 必须是非空数组"] };
  }

  const seenNames = new Set();
  sheets.forEach((sheet, si) => {
    const label = `sheets[${si}]${sheet && sheet.name ? `（${sheet.name}）` : ""}`;
    if (!sheet || typeof sheet !== "object") { errors.push(`${label} 必须是对象`); return; }
    if (typeof sheet.name !== "string" || !sheet.name.trim()) {
      errors.push(`${label} 缺少非空的 name`);
    } else if (seenNames.has(sheet.name)) {
      errors.push(`sheet 名称重复：${sheet.name}`);
    } else {
      seenNames.add(sheet.name);
    }

    const rows = sheet.rows;
    if (!Array.isArray(rows) || !rows.length || !rows.every((r) => Array.isArray(r))) {
      errors.push(`${label} 的 rows 必须是非空的二维数组`);
      return; // 行都不合法，下面按行数/列数校验的规则没法继续查
    }
    const nCols = rows[0].length;
    rows.forEach((r, ri) => {
      if (r.length !== nCols) errors.push(`${label} 第 ${ri} 行长度是 ${r.length}，跟第 0 行的 ${nCols} 列不一致`);
    });
    const nRows = rows.length;
    const inBounds = (r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < nRows && c >= 0 && c < nCols;

    const styles = sheet.styles || {};
    for (const key of Object.keys(styles.rows || {})) {
      const r = Number(key);
      if (!Number.isInteger(r) || r < 0 || r >= nRows) errors.push(`${label} styles.rows["${key}"] 越界（这个 sheet 只有 ${nRows} 行）`);
    }
    for (const key of Object.keys(styles.columns || {})) {
      const c = Number(key);
      if (!Number.isInteger(c) || c < 0 || c >= nCols) errors.push(`${label} styles.columns["${key}"] 越界（这个 sheet 只有 ${nCols} 列）`);
    }
    for (const key of Object.keys(styles.cells || {})) {
      const m = /^(\d+):(\d+)$/.exec(key);
      if (!m || !inBounds(Number(m[1]), Number(m[2]))) errors.push(`${label} styles.cells["${key}"] 不是合法坐标或越界（${nRows}×${nCols}）`);
    }

    const merges = sheet.merges || [];
    if (!Array.isArray(merges)) { errors.push(`${label} 的 merges 必须是数组`); return; }
    const ranges = [];
    merges.forEach((m, mi) => {
      const mLabel = `${label} merges[${mi}]`;
      if (!m || typeof m !== "object") { errors.push(`${mLabel} 必须是对象`); return; }
      const { startRow, startCol, endRow, endCol } = m;
      if (![startRow, startCol, endRow, endCol].every(Number.isInteger)) {
        errors.push(`${mLabel} 的 startRow/startCol/endRow/endCol 必须都是整数`); return;
      }
      if (startRow > endRow || startCol > endCol) { errors.push(`${mLabel} 的 start 不能大于 end`); return; }
      if (!inBounds(startRow, startCol) || !inBounds(endRow, endCol)) {
        errors.push(`${mLabel} 范围超出这个 sheet 的边界（${nRows}×${nCols}）`); return;
      }
      for (const [pr, pc, prevIdx] of ranges) {
        if (startRow <= pr[1] && pr[0] <= endRow && startCol <= pc[1] && pc[0] <= endCol) {
          errors.push(`${mLabel} 跟 merges[${prevIdx}] 范围重叠`);
        }
      }
      ranges.push([[startRow, endRow], [startCol, endCol], mi]);
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          if (r === startRow && c === startCol) continue;
          if (rows[r][c] !== "") errors.push(`${mLabel} 覆盖的格子 rows[${r}][${c}] 必须是空字符串，实际是 ${JSON.stringify(rows[r][c])}`);
        }
      }
    });
  });

  return errors.length ? { ok: false, errors } : { ok: true };
}

// ---- create ----

export function createSheet(ws, pid, opts, ctx) {
  const sheetId = opts.sheetId;
  if (!sheetId || !isValidEntityId(sheetId)) return fail("BAD_SHEET_ID", `sheetId 不合法：${sheetId}（人类可读 slug，可含中文）`);
  let labels;
  try { labels = normalizeLabels(opts.labels); } catch (e) { return fail(e.code, e.message); }
  const dir = sheetStore.sheetDir(ws, pid, sheetId);
  if (fs.existsSync(dir)) return fail("SHEET_EXISTS", `表格 ${sheetId} 已存在`);

  const content = seedContent(opts.title);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sheet.json"), JSON.stringify(content, null, 2) + "\n");
  const now = iso(ctx);
  sheetStore.writeSheetJson(ws, pid, sheetId, {
    schemaVersion: 1, title: content.title, ...(labels.length ? { labels } : {}), head: 0, versions: [], createdAt: now, updatedAt: now,
  });
  return { ok: true, sheetId, sheetJsonPath: path.join(dir, "sheet.json"), labels };
}

// ---- finalize ----

export async function buildSheet(ws, pid, sheetId, opts, ctx) {
  if (!isValidEntityId(sheetId)) return fail("BAD_SHEET_ID", `sheetId 不合法：${sheetId}`);
  const dir = sheetStore.sheetDir(ws, pid, sheetId);
  const dj = sheetStore.readSheetJson(ws, pid, sheetId);
  if (!dj) return fail("SHEET_NOT_FOUND", `表格 ${sheetId} 不存在，先 create_sheet`);
  const jsonPath = path.join(dir, "sheet.json");
  if (!fs.existsSync(jsonPath)) return fail("SHEET_JSON_MISSING", `缺少 ${jsonPath}`);
  const note = (opts.note || "").trim();
  if (!note) return fail("NOTE_REQUIRED", "build_sheet 需要 note（一句话说清这次改了什么，进修改记录）");

  const raw = fs.readFileSync(jsonPath, "utf8");
  let content;
  try { content = JSON.parse(raw); }
  catch (e) { return fail("SHEET_JSON_INVALID", `sheet.json 不是合法 JSON：${e.message}`); }

  const validation = validateSheetContent(content);
  if (!validation.ok) {
    return fail("SHEET_VALIDATION_FAILED", `sheet.json 内容不合法（${validation.errors.length} 项）：\n- ${validation.errors.join("\n- ")}`);
  }

  const assetsDir = path.join(dir, "assets");
  const assetFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
  const referenced = referencedAssets(content);
  const missing = referenced.filter((f) => !assetFiles.includes(f));
  if (missing.length) {
    return fail("IMAGE_REF_MISSING", `sheet.json 里 ![]() 引用了 assets/ 下不存在的图片：${missing.join(", ")}`, "sheet-schema");
  }

  // 这一版的引用：这次声明的（opts.sources，入口层已校验并固定版本；没传就沿用上一版声明的）+
  // assets/ 里素材自带的出处（core/refs.js）。
  const headV = (dj.versions || []).find((v) => v.n === dj.head);
  const sources = versionSources({
    declared: opts.sources,
    previous: headV && headV.sources,
    derived: assetSources(assetFiles.filter(isSourceSidecar).map((f) => ({ path: f, data: fs.readFileSync(path.join(assetsDir, f), "utf8") }))),
  });

  const n = (dj.head || 0) + 1;
  const sheetHash = objectHash(content);
  const now = iso(ctx);

  try {
    sheetStore.freezeSheetVersion(ws, pid, sheetId, n, [
      { path: "sheet.json", data: raw },
      ...assetFiles.map((f) => ({ path: `assets/${f}`, from: path.join(assetsDir, f) })),
    ], { sheetHash, builtAt: now, sources });
  } catch (e) {
    return fail("SHEET_WRITE_FAILED", `冻结版本 ${n} 时写入失败：${e.message}`);
  }

  dj.versions = dj.versions || [];
  dj.versions.push({ n, note, label: (opts.label || "").trim(), author: opts.author || ctx.author || "", builtAt: now, sheetHash, sources, publishedTo: [] });
  dj.head = n;
  dj.updatedAt = now;
  dj.title = content.title || dj.title || sheetId;
  try {
    sheetStore.writeSheetJson(ws, pid, sheetId, dj);
  } catch (e) {
    return fail("SHEET_WRITE_FAILED", `提交版本 ${n} 的元信息失败：${e.message}`);
  }

  const rendered = sheetStore.renderSheetPreview(ws, pid, sheetId);
  return { ok: true, sheetId, version: n, sheetHash, headPreviewPath: rendered.headPreviewPath };
}
