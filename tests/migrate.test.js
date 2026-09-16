import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as store from "../core/store.js";

const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "protoflow-migrate.mjs");
const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1` };

// 造一个旧结构：projects 目录下一个项目，带 prd/index.json + prd/v1/ prd/v2/。
function legacyProject(titles) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-mig-"));
  const proj = store.createProject(ws, "招聘", CTX);
  const prdRoot = path.join(ws, proj.id, "prd");
  const vids = titles.map((_, i) => `v${i + 1}`);
  fs.mkdirSync(prdRoot, { recursive: true });
  fs.writeFileSync(path.join(prdRoot, "index.json"), JSON.stringify({ versions: vids.map((id) => ({ id })) }));
  titles.forEach((title, i) => {
    const vdir = path.join(prdRoot, vids[i]);
    fs.mkdirSync(path.join(vdir, "publish", "exported-images"), { recursive: true });
    // 顶部带一张手写修改记录表（累积到当前版本），迁移应把它解析进 versions[].note 并从正文删掉
    const rows = vids.slice(0, i + 1).map((v, j) => `| ${v} | 2026-08-2${j} | Charles | 第 ${j + 1} 版改动 |`).join("\n");
    fs.writeFileSync(path.join(vdir, "PRD.md"),
      `# ${title}\n\n| **版本** | **修改日期** | **修改人** | **修改内容** |\n| :--- | :--- | :--- | :--- |\n${rows}\n\n正文 ${i}\n\n![x](publish/exported-images/cap-a.png)\n`);
    fs.writeFileSync(path.join(vdir, "publish", "exported-images", "cap-a.png"), "png");
    fs.writeFileSync(path.join(vdir, "manifest.json"), JSON.stringify({ prdHash: `p${i}`, builtAt: "2026-08-20T00:00:00.000Z", artboards: {} }));
    if (i === titles.length - 1) fs.writeFileSync(path.join(vdir, "publish.json"), JSON.stringify({ records: [{ channel: "dingtalk", docId: "d1", url: "u", prdHash: `p${i}` }] }));
  });
  return { ws, pid: proj.id, prdRoot };
}

test("dry-run 打印方案，不动文件", () => {
  const { ws, pid, prdRoot } = legacyProject(["招聘 PRD 首版", "招聘 PRD 二版"]);
  const out = execFileSync("node", [MIG, ws], { encoding: "utf8" });
  assert.ok(out.includes("v1, v2"));
  assert.ok(out.includes("versions 1..2"));
  assert.ok(fs.existsSync(prdRoot), "dry-run 不改动旧目录");
  assert.ok(!fs.existsSync(store.docDir(ws, pid, "prd")));
});

test("--apply 合并成单个 docs/prd/ 的多版本，旧目录改名 prd.pre-migration/", () => {
  const { ws, pid, prdRoot } = legacyProject(["招聘 PRD 首版", "招聘 PRD 二版", "招聘 PRD 三版"]);
  execFileSync("node", [MIG, ws, "--apply"], { encoding: "utf8" });
  assert.ok(!fs.existsSync(prdRoot));
  assert.ok(fs.existsSync(path.join(ws, pid, "prd.pre-migration")));
  const dj = store.readDocJson(ws, pid, "prd");
  assert.equal(dj.kind, "prd");
  assert.equal(dj.head, 3);
  assert.equal(dj.versions.length, 3);
  assert.equal(dj.versions[0].label, "v1");
  // 手写修改记录表的行被提进 versions[].note/author/日期
  assert.equal(dj.versions[2].note, "第 3 版改动");
  assert.equal(dj.versions[2].author, "Charles");
  assert.ok(dj.versions[2].builtAt.startsWith("2026-08-22"));
  // 图片引用被改写、图片被搬进 versions/<n>/assets/；手写表已从正文删掉
  const v3md = fs.readFileSync(path.join(store.docVersionDir(ws, pid, "prd", 3), "doc.md"), "utf8");
  assert.ok(v3md.includes("(assets/cap-a.png)"));
  assert.ok(v3md.includes("<!-- protoflow:changelog -->"));
  assert.ok(!v3md.includes("| **版本** |"), "顶部手写修改记录表应已从正文删掉");
  assert.ok(fs.existsSync(path.join(store.docVersionDir(ws, pid, "prd", 3), "assets", "cap-a.png")));
  // 最后一版的发布记录迁移到 publishedTo
  assert.equal(dj.versions[2].publishedTo[0].channelDocId, "d1");
  // 根 preview.html 已渲染
  assert.ok(fs.existsSync(path.join(store.docDir(ws, pid, "prd"), "preview.html")));
});

test("标题差异大时拒绝自动合并，需 --force", () => {
  const { ws, pid } = legacyProject(["结账流程 PRD", "退款流程说明"]);
  let code = 0;
  try { execFileSync("node", [MIG, ws, "--apply"], { encoding: "utf8" }); }
  catch (e) { code = e.status; }
  assert.equal(code, 2, "有风险项且未 --force 时非零退出");
  assert.ok(!fs.existsSync(store.docDir(ws, pid, "prd")));
  execFileSync("node", [MIG, ws, "--apply", "--force"], { encoding: "utf8" });
  assert.ok(fs.existsSync(store.docDir(ws, pid, "prd")));
});
