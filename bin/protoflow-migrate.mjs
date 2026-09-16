#!/usr/bin/env node
// bin/protoflow-migrate.mjs — 把旧的 prd/<versionId>/ 迁移到新的 docs/<docId>/versions/<n>/。
//
//   node bin/protoflow-migrate.mjs [dir]            dry-run：打印每个项目的迁移方案，不动文件
//   node bin/protoflow-migrate.mjs [dir] --apply    执行迁移（旧 prd/ 改名为 prd.pre-migration/）
//   ... --apply --force                             即使检测到 PRD 标题差异很大也强行合并
//
// 决策：一个项目的多个旧 versionId 合并成单个 docs/prd/ 文档的多个版本（历来一项目一份逻辑 PRD，
// 修改记录表约定佐证）。迁移的版本 sourceFingerprints 置空——旧指纹用的哈希函数不同、也没保留
// 画板基线，置空即"这些历史版本不参与画板漂移检测"，比携带对不上的旧值更干净。
import fs from "node:fs";
import path from "node:path";
import { contentHash, objectHash } from "../core/hash.js";
import * as store from "../core/store.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const dir = path.resolve(args.find((a) => !a.startsWith("--")) || process.cwd());

function projectsWithPrd(ws) {
  if (!fs.existsSync(ws)) return [];
  return fs.readdirSync(ws).filter((d) => {
    return fs.existsSync(path.join(ws, d, "project.json")) && fs.existsSync(path.join(ws, d, "prd"));
  });
}

function orderedVersionIds(prdRoot) {
  const idx = path.join(prdRoot, "index.json");
  let ordered = [];
  if (fs.existsSync(idx)) {
    try { ordered = (JSON.parse(fs.readFileSync(idx, "utf8")).versions || []).map((v) => v.id); } catch {}
  }
  const onDisk = fs.readdirSync(prdRoot).filter((f) => fs.statSync(path.join(prdRoot, f)).isDirectory());
  for (const d of onDisk.sort()) if (!ordered.includes(d)) ordered.push(d);
  return ordered.filter((id) => fs.existsSync(path.join(prdRoot, id, "PRD.md")));
}

function h1(md) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "";
}

function unrelatedTitles(titles) {
  const clean = titles.map((t) => t.replace(/\s*[（(]?\s*(rd-review-)?v\d+\s*[)）]?\s*$/i, "").trim()).filter(Boolean);
  if (clean.length < 2) return false;
  const prefixLen = 4;
  const p0 = clean[0].slice(0, prefixLen);
  return clean.some((t) => t.slice(0, prefixLen) !== p0);
}

function planProject(ws, pid) {
  const prdRoot = path.join(ws, pid, "prd");
  const vids = orderedVersionIds(prdRoot);
  const titles = vids.map((vid) => h1(fs.readFileSync(path.join(prdRoot, vid, "PRD.md"), "utf8")));
  return { pid, vids, titles, risky: unrelatedTitles(titles) };
}

// 老 PRD.md 顶部那张手写的「版本｜修改日期｜修改人｜修改内容」表：解析出行、并把整块从正文里
// 删掉（换成 <!-- protoflow:changelog --> 标记，之后由 versions[].note 自动重生成）。
function parseAndStripChangelog(md) {
  const lines = md.split("\n");
  const headIdx = lines.findIndex((l) => /^\s*\|.*版本.*\|.*修改内容.*\|\s*$/.test(l));
  if (headIdx === -1) return { md, rows: [] };
  let end = headIdx + 1;
  // 跳过分隔行 + 连续的表格行
  while (end < lines.length && /^\s*\|/.test(lines[end])) end++;
  const rowLines = lines.slice(headIdx + 2, end); // headIdx+1 是分隔行
  const rows = [];
  for (const rl of rowLines) {
    const cells = rl.split("|").slice(1, -1).map((c) => c.replace(/\*\*/g, "").replace(/<br\s*\/?>/gi, "，").trim());
    if (cells.length < 4) continue;
    const [vid, date, author, content] = cells;
    if (!vid || /^\[.*\]$/.test(vid)) continue; // 跳过模板占位行
    rows.push({ vid, date, author, content });
  }
  // 删掉整块表格（含可能残留的前后空行）
  lines.splice(headIdx, end - headIdx);
  while (headIdx > 0 && lines[headIdx - 1].trim() === "" && (lines[headIdx] || "").trim() === "") lines.splice(headIdx, 1);
  return { md: lines.join("\n"), rows };
}

function toIso(date) {
  const m = String(date || "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T00:00:00.000Z`;
}

function migrateProject(ws, plan) {
  const { pid, vids } = plan;
  const prdRoot = path.join(ws, pid, "prd");
  const docId = "prd";
  if (fs.existsSync(store.docDir(ws, pid, docId))) {
    console.log(`  跳过 ${pid}：docs/${docId}/ 已存在`);
    return;
  }
  const versions = [];
  vids.forEach((vid, i) => {
    const n = i + 1;
    const vsrc = path.join(prdRoot, vid);
    let md = fs.readFileSync(path.join(vsrc, "PRD.md"), "utf8");
    md = md.replace(/\(publish\/exported-images\//g, "(assets/");
    // 解析并删掉手写的修改记录表；用它的行填这一版的 note/author/日期
    const { md: stripped, rows } = parseAndStripChangelog(md);
    md = stripped;
    const lines = md.split("\n");
    const hi = lines.findIndex((l) => /^#\s+\S/.test(l));
    if (hi !== -1 && !md.includes("<!-- protoflow:changelog -->")) {
      lines.splice(hi + 1, 0, "", "<!-- protoflow:changelog -->");
      md = lines.join("\n");
    }
    const mine = rows.filter((r) => r.vid === vid);
    const changelogNote = mine.map((r) => r.content).filter(Boolean).join("；") || `迁移自旧版本 ${vid}`;
    const changelogAuthor = mine.map((r) => r.author).find(Boolean) || "";
    const changelogDate = mine.map((r) => r.date).filter(Boolean).pop();
    const vdir = store.docVersionDir(ws, pid, docId, n);
    fs.mkdirSync(vdir, { recursive: true });
    fs.writeFileSync(path.join(vdir, "doc.md"), md);
    const imgSrc = path.join(vsrc, "publish", "exported-images");
    const assetFiles = fs.existsSync(imgSrc) ? fs.readdirSync(imgSrc).filter((f) => f.endsWith(".png")) : [];
    if (assetFiles.length) {
      fs.mkdirSync(path.join(vdir, "assets"), { recursive: true });
      for (const f of assetFiles) fs.copyFileSync(path.join(imgSrc, f), path.join(vdir, "assets", f));
    }
    const oldManifest = fs.existsSync(path.join(vsrc, "manifest.json")) ? JSON.parse(fs.readFileSync(path.join(vsrc, "manifest.json"), "utf8")) : {};
    const builtAt = toIso(changelogDate) || oldManifest.builtAt || new Date().toISOString();
    const mdHash = contentHash(md);
    const docHash = objectHash({ md, sourceFingerprints: {} });
    fs.writeFileSync(path.join(vdir, "manifest.json"), JSON.stringify(
      { schemaVersion: 1, docHash, mdHash, builtAt, sourceFingerprints: {} }, null, 2) + "\n");
    const oldPub = fs.existsSync(path.join(vsrc, "publish.json")) ? JSON.parse(fs.readFileSync(path.join(vsrc, "publish.json"), "utf8")) : { records: [] };
    const publishedTo = (oldPub.records || []).map((r) => ({ channel: r.channel, channelDocId: r.docId, url: r.url || "", publishedAt: r.publishedAt || "", docHash }));
    versions.push({ n, note: changelogNote, label: vid, author: changelogAuthor, builtAt, docHash, mdHash, sourceFingerprints: {}, publishedTo });
  });

  const head = versions.length;
  const headVdir = store.docVersionDir(ws, pid, docId, head);
  const headMd = fs.readFileSync(path.join(headVdir, "doc.md"), "utf8");
  fs.writeFileSync(path.join(store.docDir(ws, pid, docId), "doc.md"), headMd);
  const headAssets = path.join(headVdir, "assets");
  if (fs.existsSync(headAssets)) {
    fs.mkdirSync(path.join(store.docDir(ws, pid, docId), "assets"), { recursive: true });
    for (const f of fs.readdirSync(headAssets)) fs.copyFileSync(path.join(headAssets, f), path.join(store.docDir(ws, pid, docId), "assets", f));
  } else {
    fs.mkdirSync(path.join(store.docDir(ws, pid, docId), "assets"), { recursive: true });
  }
  const m = headMd.match(/^#\s+(.+)$/m);
  store.writeDocJson(ws, pid, docId, {
    schemaVersion: 1, kind: "prd", title: m ? m[1].trim() : docId, template: "prd",
    origin: null, head, versions, createdAt: versions[0].builtAt, updatedAt: versions[head - 1].builtAt,
  });
  store.renderDocPreview(ws, pid, docId); // 渲染唯一阅读页（内嵌全部版本）
  fs.renameSync(prdRoot, path.join(ws, pid, "prd.pre-migration"));
  // 整站画布是项目结构的实时投影（本地预览服务按需渲染，见 core/renderService.js），迁移后
  // 刷新已打开的画布标签即换成新的按类型分组文档菜单，这里不用再手动重渲染。
  console.log(`  ${pid}：${vids.length} 个旧版本 → docs/${docId}/ versions 1..${head}（旧目录改名 prd.pre-migration/）`);
}

const pids = projectsWithPrd(dir);
if (!pids.length) { console.log(`${dir} 下没有带 prd/ 的项目，无需迁移`); process.exit(0); }

console.log(`工作目录：${dir}\n${APPLY ? "执行迁移" : "dry-run（加 --apply 执行）"}\n`);
let anyRisky = false;
for (const pid of pids) {
  const plan = planProject(dir, pid);
  console.log(`项目 ${pid}：`);
  console.log(`  旧版本：${plan.vids.join(", ")}`);
  console.log(`  拟合并为 docs/prd/ 的 versions 1..${plan.vids.length}`);
  if (plan.risky) {
    anyRisky = true;
    console.log(`  ⚠️  这些版本的 PRD 标题差异较大，可能是不相关的文档：\n     - ${plan.titles.join("\n     - ")}`);
    console.log(`     确认要合并请加 --force`);
  }
  if (APPLY && (!plan.risky || FORCE)) migrateProject(dir, plan);
  console.log("");
}
if (!APPLY) console.log("以上为计划；确认无误后加 --apply 执行。");
else if (anyRisky && !FORCE) { console.log("有项目因标题差异被跳过，加 --force 强行合并。"); process.exit(2); }
