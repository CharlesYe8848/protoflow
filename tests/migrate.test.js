// 迁移命令（bin/protoflow-migrate.mjs → core/migrate.js + 各产品的 migrate）：旧格式项目一次迁到当前格式；
// 运行时只认当前格式，旧项目报 FORMAT_OUTDATED。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as store from "../core/store.js";
import * as canvasStore from "../products/canvas/store.js";
import * as docStore from "../products/doc/store.js";
import { migrateProject } from "../core/migrate.js";
import { PRODUCTS, RESOLVERS, LEGACY_PROJECT_MIGRATIONS } from "../products/index.js";
import { projectGraph } from "../core/projectGraph.js";
import { contentHash } from "../core/hash.js";

const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "protoflow-migrate.mjs");
const SRC = "function Component(){ return <div>A1</div>; }";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const w = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof data === "string" ? data : data instanceof Buffer ? data : JSON.stringify(data)); };

// 旧格式（格式版本 1）的项目：单画布布局、旧的整份复制版本目录、doc.json 的旧字段、旧截图配置位置。
function oldProject() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-mig-"));
  const p = path.join(ws, "招聘");
  w(path.join(p, "project.json"), { schemaVersion: 1, id: "招聘", name: "招聘", pageIds: ["pg_1"] });
  w(path.join(p, "pages/pg_1/page.json"), { id: "pg_1", name: "首页", artboardIds: ["ab_1"] });
  w(path.join(p, "pages/pg_1/artboards/ab_1/meta.json"), { id: "ab_1", name: "列表" });
  w(path.join(p, "pages/pg_1/artboards/ab_1/source.jsx"), SRC);
  const d = path.join(p, "docs/prd");
  w(path.join(d, "doc.md"), "# PRD\n");
  w(path.join(d, "doc.json"), { schemaVersion: 1, kind: "prd", template: "prd", title: "PRD", origin: null, head: 1,
    versions: [{ n: 1, mdHash: "x", sourceFingerprints: { ab_1: contentHash(SRC) }, publishedTo: [] }] });
  w(path.join(d, "versions/1/doc.md"), "# PRD v1\n");
  w(path.join(d, "versions/1/assets/a.png"), PNG);
  w(path.join(d, "versions/1/manifest.json"), { docHash: "h1" });
  w(path.join(d, ".build/captures.json"), { captures: [] });
  w(path.join(p, "docs/rn/doc.json"), { kind: "release-note", title: "公告", origin: [{ docId: "prd", version: 1 }], head: 0, versions: [] });
  return { ws, pid: "招聘", p };
}

test("旧格式项目：运行时报 FORMAT_OUTDATED 并给出迁移命令；list_projects 标出来", () => {
  const { ws, pid } = oldProject();
  assert.throws(() => store.readProject(ws, pid), (e) => e.code === "FORMAT_OUTDATED" && e.message.includes("protoflow-migrate.mjs"));
  assert.throws(() => canvasStore.loadProjectTree(ws, pid), (e) => e.code === "FORMAT_OUTDATED");
  assert.deepEqual(store.listProjects(ws), [{ id: pid, name: "招聘", formatOutdated: true }]);
  const fresh = store.createProject(ws, "新项目", { now: () => 1 });
  assert.equal(store.readProject(ws, fresh.id).formatVersion, store.FORMAT_VERSION, "新建的项目直接是当前格式");
});

test("预演只报要改什么，不动文件", () => {
  const { ws, pid, p } = oldProject();
  const before = fs.readFileSync(path.join(p, "project.json"), "utf8");
  const r = migrateProject(ws, pid, PRODUCTS, { legacy: LEGACY_PROJECT_MIGRATIONS });
  assert.deepEqual(r.changes, [
    "docs/prd：版本 1 转成内容寻址存储",
    "画布：pageIds + pages/（1 个页面）→ canvases/main/",
    "docs/prd：补 sources；kind、template → labels product-dev/prd；.build/captures.json → captures.json",
    "docs/rn：补 sources；kind → labels product-dev/release-note",
    `project.json：formatVersion 1 → ${store.FORMAT_VERSION}`,
  ]);
  assert.equal(fs.readFileSync(path.join(p, "project.json"), "utf8"), before);
  assert.ok(fs.existsSync(path.join(p, "pages")) && fs.existsSync(path.join(p, "docs/prd/versions/1")));
});

test("执行：画布、版本存储、文档字段、截图配置都迁到当前格式；引用判断跟以前一致；可重复执行", () => {
  const { ws, pid, p } = oldProject();
  migrateProject(ws, pid, PRODUCTS, { apply: true, legacy: LEGACY_PROJECT_MIGRATIONS });

  const pj = store.readProject(ws, pid);
  const { products, ...rest } = pj;
  assert.deepEqual(rest, { schemaVersion: 1, id: pid, name: "招聘", formatVersion: store.FORMAT_VERSION });
  assert.deepEqual(Object.keys(products).sort(), ["canvas", "doc"], "迁完顺带登记项目里已有数据的产品（各自格式版本 1）");
  assert.equal(products.doc.formatVersion, 1);
  assert.ok(!fs.existsSync(path.join(p, "pages")));
  const tree = canvasStore.loadProjectTree(ws, pid);
  assert.deepEqual(tree.canvases, [{ id: "main", title: "招聘" }]);
  assert.equal(canvasStore.readArtboard(ws, pid, "ab_1").source, SRC);

  const v1 = docStore.openDocVersion(ws, pid, "prd", 1);
  assert.equal(v1.readText("doc.md"), "# PRD v1\n");
  assert.deepEqual(v1.read("assets/a.png"), PNG);
  assert.equal(v1.meta.docHash, "h1");
  assert.ok(!fs.existsSync(path.join(p, "docs/prd/versions/1")), "旧版本目录删掉");

  const prd = docStore.readDocJson(ws, pid, "prd");
  assert.deepEqual(prd.labels, ["product-dev/prd"]);
  assert.equal("kind" in prd || "recipe" in prd || "template" in prd, false);
  assert.deepEqual(prd.versions[0].sourceFingerprints, { ab_1: contentHash(SRC) }, "老字段保留，不改写历史");
  assert.deepEqual(docStore.readDocJson(ws, pid, "rn").pendingSources, [{ ref: "doc:prd@1", via: "declared" }]);
  assert.ok(fs.existsSync(path.join(p, "docs/prd/captures.json")) && !fs.existsSync(path.join(p, "docs/prd/.build/captures.json")));

  const graph = projectGraph(ws, pid, PRODUCTS, RESOLVERS);
  assert.deepEqual(graph.artifacts.find((x) => x.id === "prd").sources.map((s) => [s.ref, s.via, s.status]), [["canvas:main#ab_1", "capture", "fresh"]]);
  canvasStore.saveArtboardSource(ws, pid, "ab_1", "function Component(){ return <div>改</div>; }");
  assert.equal(projectGraph(ws, pid, PRODUCTS, RESOLVERS).artifacts.find((x) => x.id === "prd").sources[0].status, "stale");

  assert.deepEqual(migrateProject(ws, pid, PRODUCTS, { apply: true, legacy: LEGACY_PROJECT_MIGRATIONS }).changes, [], "已是当前格式就跳过");
});

test("画布目标目录已存在时不覆盖，报错", () => {
  const { ws, pid, p } = oldProject();
  fs.mkdirSync(path.join(p, "canvases/main/pages"), { recursive: true });
  assert.throws(() => migrateProject(ws, pid, PRODUCTS, { apply: true, legacy: LEGACY_PROJECT_MIGRATIONS }), /不覆盖/);
});

test("命令行：默认预演；--apply 先整份备份再迁，之后再跑提示不用迁", () => {
  const { ws, p } = oldProject();
  const dry = execFileSync("node", [MIG, ws], { encoding: "utf8" });
  assert.ok(dry.includes("预演") && dry.includes(`招聘（格式 1 → ${store.FORMAT_VERSION}）`) && dry.includes("加 --apply 执行"));
  assert.ok(fs.existsSync(path.join(p, "pages")));

  const out = execFileSync("node", [MIG, ws, "--apply"], { encoding: "utf8" });
  const backup = out.match(/备份在 (.+)/)[1].trim();
  assert.ok(fs.existsSync(path.join(backup, "招聘", "pages/pg_1/artboards/ab_1/source.jsx")), "备份是迁移前的原样");
  assert.ok(!fs.existsSync(path.join(p, "pages")));
  assert.deepEqual(store.listProjects(ws), [{ id: "招聘", name: "招聘" }], "备份目录不算项目");

  assert.ok(execFileSync("node", [MIG, ws], { encoding: "utf8" }).includes("都是当前格式"));
});

test("格式 2 → 3：doc.json 的 recipe 转成标签，已有的标签保留", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-mig3-"));
  const p = path.join(ws, "p");
  w(path.join(p, "project.json"), { schemaVersion: 1, formatVersion: 2, id: "p", name: "p" });
  w(path.join(p, "docs/prd/doc.json"), { title: "PRD", recipe: "product-dev/prd", labels: ["mine"], head: 0, versions: [] });
  w(path.join(p, "docs/note/doc.json"), { title: "笔记", head: 0, versions: [] });
  const r = migrateProject(ws, "p", PRODUCTS, { apply: true, legacy: LEGACY_PROJECT_MIGRATIONS });
  assert.deepEqual(r.changes, ["docs/prd：recipe → labels product-dev/prd", `project.json：formatVersion 2 → ${store.FORMAT_VERSION}`]);
  assert.deepEqual(docStore.readDocJson(ws, "p", "prd").labels, ["mine", "product-dev/prd"]);
  assert.equal("recipe" in docStore.readDocJson(ws, "p", "prd"), false);
  assert.equal(docStore.readDocJson(ws, "p", "note").labels, undefined);
});
