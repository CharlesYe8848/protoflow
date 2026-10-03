// 按配置加载和产品登记（docs/product-architecture.md §4.11，阶段 13）：配置里的插件、禁用、加载失败、
// 产品集指纹；项目里的产品登记、各产品自己的数据格式版本和迁移回滚；禁用后数据仍可见；项目说明跟着产品集走。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPluginCandidates, productsFingerprint, readPluginConfig } from "../core/pluginLoader.js";
import { migrateProject, projectNeedsMigration } from "../core/migrate.js";
import * as store from "../core/store.js";
import { projectGraph } from "../core/projectGraph.js";
import { buildProjectNav } from "../core/projectNav.js";
import { definePlugin } from "../core/plugin.js";
import { BUILTIN_CANDIDATES, PRODUCTS, assembleRegistry } from "../products/index.js";
import { createTools, listSkills } from "../cli/tools.js";
import { createTestHost } from "protoflow/sdk/testing";
import notePlugin from "../examples/plugin-note/index.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOTE_DIR = path.join(ROOT, "examples", "plugin-note");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function writeConfig(cfg) {
  const dir = tmp("pf-cfg-");
  const file = path.join(dir, "protoflow.config.json");
  fs.writeFileSync(file, JSON.stringify(cfg));
  return file;
}

test("配置：没有配置文件 = 只有内置产品", async () => {
  const { candidates, config } = await loadPluginCandidates(BUILTIN_CANDIDATES, { configPath: path.join(tmp("pf-cfg-"), "none.json") });
  assert.equal(config.exists, false);
  assert.deepEqual(candidates.map((c) => c.descriptor.type), ["canvas", "doc", "sheet", "diagram", "deck"]);
});

test("配置：外部插件按路径加载（相对配置文件目录），按类型禁用，加载失败的留下原因", async () => {
  const configPath = writeConfig({ products: [NOTE_DIR, "./nope", "no-such-package-xyz"], disabled: ["diagram"] });
  const reg = assembleRegistry((await loadPluginCandidates(BUILTIN_CANDIDATES, { configPath })).candidates);
  assert.deepEqual(reg.products.map((p) => p.type), ["canvas", "doc", "sheet", "deck", "note"]);
  assert.equal(reg.sources.note, NOTE_DIR);
  assert.deepEqual(reg.skipped.map((s) => s.source), ["./nope", "no-such-package-xyz"]);
  assert.match(reg.skipped[0].reason, /插件路径不存在/);
  assert.match(reg.skipped[1].reason, /找不到插件包/);
  assert.ok(reg.tools.some((t) => t.name === "build_note"));
  assert.ok(!reg.tools.some((t) => t.name === "build_diagram"), "禁用的产品没有工具");
});

test("配置：格式不对报清楚；产品集指纹随配置和插件入口变化", () => {
  const bad = writeConfig({ products: "x" });
  assert.throws(() => readPluginConfig(bad), /products 应为字符串数组/);
  const configPath = writeConfig({ products: [NOTE_DIR] });
  const a = productsFingerprint(configPath);
  assert.equal(productsFingerprint(configPath), a, "没变就一样");
  fs.writeFileSync(configPath, JSON.stringify({ products: [NOTE_DIR], disabled: ["sheet"] }));
  assert.notEqual(productsFingerprint(configPath), a, "改配置指纹就变");
});

test("产品登记：第一次写实体时登记；已有目录打开项目时补登；格式比插件新拒绝写，比插件旧要求先迁移", async () => {
  const host = createTestHost([...PRODUCTS, notePlugin]);
  try {
    const { id } = host.createProject("登记");
    await host.call("write_note", { projectId: id, noteId: "a", content: "x" });
    assert.deepEqual(store.projectProducts(host.ws, id), { note: { rootSeg: "notes", metaFile: "note.json", formatVersion: 1 } });

    fs.mkdirSync(path.join(host.ws, id, "sheets", "old"), { recursive: true }); // 登记之前就有的数据
    store.syncProjectProducts(host.ws, id, host.products);
    assert.equal(store.projectProducts(host.ws, id).sheet.formatVersion, 1);

    const pjPath = path.join(host.ws, id, "project.json");
    const setNoteFormat = (v) => { const pj = JSON.parse(fs.readFileSync(pjPath, "utf8")); pj.products.note.formatVersion = v; fs.writeFileSync(pjPath, JSON.stringify(pj)); };
    setNoteFormat(2);
    await assert.rejects(async () => host.call("write_note", { projectId: id, noteId: "a", content: "y" }), (e) => e.code === "PRODUCT_FORMAT_NEWER");
    setNoteFormat(0);
    await assert.rejects(async () => host.call("write_note", { projectId: id, noteId: "a", content: "y" }), (e) => e.code === "PRODUCT_FORMAT_OUTDATED");
  } finally { host.cleanup(); }
});

test("按产品迁移：登记的格式旧了就调插件的 migrate 并升版本；抛错的只回滚这个产品，别的照常", async () => {
  const entity = { rootSeg: "boxes", metaFile: "box.json" };
  const good = definePlugin({ apiVersion: 1, type: "box", label: "盒子", formatVersion: 2, entities: [entity],
    migrate(ws, pid, { from, to, apply }) {
      if (apply) fs.writeFileSync(path.join(store.entityRoot(ws, pid, entity), "b1", "migrated.txt"), `${from}->${to}`);
      return [`box ${from}→${to}`];
    } });
  const badEntity = { rootSeg: "crates", metaFile: "crate.json" };
  const bad = definePlugin({ apiVersion: 1, type: "crate", label: "箱子", formatVersion: 2, entities: [badEntity],
    migrate(ws, pid, { apply }) {
      if (apply) { fs.writeFileSync(path.join(store.entityRoot(ws, pid, badEntity), "c1", "half.txt"), "写到一半"); throw new Error("坏了"); }
      return ["crate 1→2"];
    } });
  const ws = tmp("pf-mig-");
  const { id } = store.createProject(ws, "迁移", { now: () => 0 });
  for (const [k, e] of [["b1", entity], ["c1", badEntity]]) {
    fs.mkdirSync(path.join(store.entityRoot(ws, id, e), k), { recursive: true });
    fs.writeFileSync(path.join(store.entityRoot(ws, id, e), k, e.metaFile), "{}");
  }
  const pjPath = path.join(ws, id, "project.json");
  const pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
  pj.products = { box: { rootSeg: "boxes", metaFile: "box.json", formatVersion: 1 }, crate: { rootSeg: "crates", metaFile: "crate.json", formatVersion: 1 } };
  fs.writeFileSync(pjPath, JSON.stringify(pj));

  assert.equal(projectNeedsMigration(ws, id, [good, bad]), true);
  assert.deepEqual(migrateProject(ws, id, [good, bad]).changes, ["盒子（box）数据格式 1 → 2", "box 1→2", "箱子（crate）数据格式 1 → 2", "crate 1→2"], "预演不动文件");
  const r = migrateProject(ws, id, [good, bad], { apply: true });
  assert.deepEqual(r.failed, [{ type: "crate", error: "坏了" }]);
  const after = store.projectProducts(ws, id);
  assert.equal(after.box.formatVersion, 2);
  assert.equal(after.crate.formatVersion, 1, "失败的产品登记没变");
  assert.equal(fs.readFileSync(path.join(ws, id, "boxes", "b1", "migrated.txt"), "utf8"), "1->2");
  assert.ok(!fs.existsSync(path.join(ws, id, "crates", "c1", "half.txt")), "失败的产品目录恢复原样");
  assert.ok(fs.existsSync(path.join(ws, id, "crates", "c1", "crate.json")));
});

test("禁用产品：产物仍在导航和项目图谱里（不能打开），指向它的引用是无法校验、不是失效；重新启用恢复", async () => {
  const host = createTestHost([...PRODUCTS, notePlugin]);
  try {
    const { id } = host.createProject("禁用");
    await host.call("write_note", { projectId: id, noteId: "idea", title: "想法", content: "x" });
    await host.call("build_note", { projectId: id, noteId: "idea" });
    await host.call("write_note", { projectId: id, noteId: "follow", content: "y" });
    await host.call("build_note", { projectId: id, noteId: "follow", sources: ["note:idea"] });

    const without = PRODUCTS; // note 没加载
    const resolvers = Object.fromEntries(without.filter((p) => p.resolver).map((p) => [p.resolver.type, p.resolver]));
    const nav = buildProjectNav(host.ws, id, without);
    const g = nav.groups.find((x) => x.type === "note");
    assert.ok(g.uninstalled);
    assert.deepEqual(g.items.map((i) => [i.title, i.href, i.meta]), [["follow", null, "未安装"], ["想法", null, "未安装"]].sort());
    const graph = projectGraph(host.ws, id, without, resolvers);
    const follow = graph.artifacts.find((a) => a.id === "follow");
    assert.equal(follow.installed, false);
    assert.equal(follow.head, 1);
    assert.equal(follow.sources[0].status, "unverifiable");

    const withNote = projectGraph(host.ws, id, host.products, host.reg.resolvers);
    assert.equal(withNote.artifacts.find((a) => a.id === "follow").sources[0].status, "fresh");
  } finally { host.cleanup(); }
});

test("项目说明（AGENTS.md）跟着启用的产品重新生成，内容没变不重写", async () => {
  const ws = tmp("pf-agents-");
  const { id } = store.createProject(ws, "说明", { now: () => 0 }, { products: PRODUCTS });
  const file = path.join(ws, id, "AGENTS.md");
  assert.ok(fs.readFileSync(file, "utf8").includes("diagrams/"));
  const noDiagram = PRODUCTS.filter((p) => p.type !== "diagram");
  store.syncProjectProducts(ws, id, noDiagram);
  assert.ok(!fs.readFileSync(file, "utf8").includes("diagrams/"), "禁用绘图后项目说明里不再有它");
  const mtime = fs.statSync(file).mtimeMs;
  store.syncProjectProducts(ws, id, noDiagram);
  assert.equal(fs.statSync(file).mtimeMs, mtime);
});

test("plugins 工具：列出启用的产品、来源、跳过的原因，以及流程 skill 缺哪些产品", async () => {
  const configPath = writeConfig({ products: [NOTE_DIR, "./nope"], disabled: ["canvas"] });
  const { candidates, config, disabled } = await loadPluginCandidates(BUILTIN_CANDIDATES, { configPath });
  const { TOOL_MAP } = createTools({ ...assembleRegistry(candidates), config, disabled });
  const out = await TOOL_MAP.plugins.handler({}, { skillsDir: path.join(ROOT, "skills") });
  assert.deepEqual(out.products.map((p) => `${p.type}:${p.source}`), ["doc:内置", "sheet:内置", "diagram:内置", "deck:内置", `note:${NOTE_DIR}`]);
  assert.deepEqual(out.disabled, ["canvas"]);
  assert.equal(out.skipped[0].source, "./nope");
  const dev = out.skills.find((s) => s.name === "protoflow-product-dev");
  assert.deepEqual(dev.requires, ["canvas", "doc"]);
  assert.deepEqual(dev.missing, ["canvas"], "禁用了画布，产品研发流程缺它");
  assert.deepEqual(listSkills(path.join(ROOT, "skills")).find((s) => s.name === "protoflow").requires, []);
});
