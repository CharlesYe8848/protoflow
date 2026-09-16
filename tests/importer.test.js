import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import { importProject } from "../core/importer.js";
import { contentHash } from "../core/hash.js";

const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1` };
const SRC = `function Component(){ return <div id="btn">x</div>; }`;

// 模拟 Axure0.3 项目目录（无 lastValidatedHash / annotationsValidatedHash 的旧格式）
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-ax-"));
  const proj = path.join(dir, "proj_old");
  fs.mkdirSync(path.join(proj, "pages", "pg_1", "artboards", "ab_1", "assets"), { recursive: true });
  fs.writeFileSync(path.join(proj, "project.json"), JSON.stringify({ id: "proj_old", name: "老项目", pageIds: ["pg_1"] }));
  fs.writeFileSync(path.join(proj, "pages", "pg_1", "page.json"), JSON.stringify({ id: "pg_1", name: "页一", artboardIds: ["ab_1"] }));
  fs.writeFileSync(path.join(proj, "pages", "pg_1", "artboards", "ab_1", "meta.json"), JSON.stringify({ id: "ab_1", name: "画板一", status: "ready" }));
  fs.writeFileSync(path.join(proj, "pages", "pg_1", "artboards", "ab_1", "source.jsx"), SRC);
  fs.writeFileSync(path.join(proj, "pages", "pg_1", "artboards", "ab_1", "annotations.md"), "## 说明\n\n点 [按钮](#el/btn)");
  fs.writeFileSync(path.join(proj, "pages", "pg_1", "artboards", "ab_1", "assets", "a.png"), "img");
  return { dir, proj };
}

test("导入：结构完整、补登指纹基线、源目录未被写", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-ws-"));
  const { proj } = makeFixture();
  const before = fs.statSync(path.join(proj, "project.json")).mtimeMs;
  const r = importProject(ws, proj, CTX);
  assert.equal(r.ok, true);
  const ab = store.readArtboard(ws, r.projectId, "ab_1");
  assert.equal(ab.meta.lastValidatedHash, contentHash(SRC));           // 基线 = 当前
  assert.equal(ab.meta.annotationsValidatedHash, contentHash(SRC));    // 有 annotations.md 的画板视为已核对
  assert.match(store.readAnnotationsMd(ws, r.projectId, "ab_1"), /点 \[按钮\]\(#el\/btn\)/);
  assert.ok(fs.existsSync(path.join(ws, r.projectId, "pages", "pg_1", "artboards", "ab_1", "assets", "a.png")));
  assert.equal(fs.statSync(path.join(proj, "project.json")).mtimeMs, before); // 源目录只读
  assert.ok(fs.readFileSync(path.join(ws, r.projectId, "AGENTS.md"), "utf8").includes("老项目")); // 补写自描述文档
});

test("目标已存在同名项目 id 时报错，不覆盖", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-ws-"));
  const { proj } = makeFixture();
  importProject(ws, proj, CTX);
  const r = importProject(ws, proj, CTX);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "ALREADY_EXISTS");
});

test("源目录缺 project.json 报错", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-ws-"));
  const r = importProject(ws, fs.mkdtempSync(path.join(os.tmpdir(), "pf-empty-")), CTX);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "NOT_A_PROJECT");
});
