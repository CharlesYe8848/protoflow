// 插件契约和注册（docs/product-architecture.md §4.11，阶段 12）：描述校验、一次成型的注册、冲突、
// 路由按数据目录分发、页面注入契约；最小示例插件只靠 protoflow/sdk 就能完整跑通。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildRegistry, routeOwners, definePlugin, defineEntityProduct } from "../core/plugin.js";
import { injectLiveClient } from "../core/liveReload.js";
import { BUILTIN_CANDIDATES, PRODUCTS } from "../products/index.js";
import { createTestHost } from "protoflow/sdk/testing";
import notePlugin from "../examples/plugin-note/index.js";

const tiny = (over = {}) => definePlugin({ apiVersion: 1, type: "tiny", label: "小", ...over });
const cand = (descriptor, source = `test:${descriptor && descriptor.type}`) => ({ source, descriptor });

test("注册：内置产品全部通过，工具名、数据目录各不相同", () => {
  const { products, tools, skipped } = buildRegistry(BUILTIN_CANDIDATES);
  assert.deepEqual(skipped, []);
  assert.deepEqual(products.map((p) => p.type), ["canvas", "doc", "sheet", "diagram", "deck"]);
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  for (const p of products) for (const k of p.entities) {
    assert.equal(k.type, p.type, "实体种类标出了所属产品");
    assert.equal(k.formatVersion, 1, "缺省数据格式版本 1");
  }
});

test("注册：描述不合法、apiVersion 不支持、加载失败的跳过并写明原因，不影响其余插件", () => {
  const { products, skipped } = buildRegistry([
    cand(tiny({ type: "a" })),
    cand({ apiVersion: 1, type: "Bad Type", label: "x" }),
    cand(tiny({ type: "b", label: "" })),
    cand(tiny({ type: "c", apiVersion: 2 })),
    cand(tiny({ type: "d", typo: true })),
    { source: "./broken", error: new Error("Cannot find module") },
    cand(tiny({ type: "e" })),
  ]);
  assert.deepEqual(products.map((p) => p.type), ["a", "e"]);
  const why = Object.fromEntries(skipped.map((s) => [s.source, s.reason]));
  assert.match(why["test:Bad Type"], /type/);
  assert.match(why["test:b"], /label/);
  assert.match(why["test:c"], /apiVersion 2 不受支持/);
  assert.match(why["test:d"], /typo/, "拼错的字段不会被悄悄忽略");
  assert.match(why["./broken"], /加载失败/);
});

test("注册：冲突的后来者整个跳过——不留下它的任何工具", () => {
  const tool = (name) => ({ name, description: "", schema: {}, handler: () => ({}) });
  const first = tiny({ type: "first", entities: [{ rootSeg: "things", metaFile: "t.json" }], tools: () => [tool("make_thing")] });
  const sameType = tiny({ type: "first", tools: () => [tool("other_tool")] });
  const sameDir = tiny({ type: "second", entities: [{ rootSeg: "things", metaFile: "x.json" }], tools: () => [tool("second_tool")] });
  const sameTool = tiny({ type: "third", tools: () => [tool("fresh_tool"), tool("make_thing")] });
  const { products, tools, skipped } = buildRegistry([cand(first), cand(sameType, "dup-type"), cand(sameDir), cand(sameTool)]);
  assert.deepEqual(products.map((p) => p.type), ["first"]);
  assert.deepEqual(tools.map((t) => t.name), ["make_thing"], "冲突插件的其它工具（fresh_tool 等）也不进注册表");
  assert.match(skipped.find((s) => s.source === "dup-type").reason, /类型 first 已被/);
  assert.match(skipped.find((s) => s.type === "second").reason, /数据目录 things 已被/);
  assert.match(skipped.find((s) => s.type === "third").reason, /工具 make_thing 已被/);
});

test("路由：路径第一段是谁的数据目录就只问谁；其余路径只问没有实体的插件", () => {
  const tool = tiny({ type: "tool-only" });
  const products = [...PRODUCTS, tool];
  assert.deepEqual(routeOwners(products, "sheets/a/preview.html").map((p) => p.type), ["sheet"]);
  assert.deepEqual(routeOwners(products, "canvases/main/canvas.html").map((p) => p.type), ["canvas"]);
  assert.deepEqual(routeOwners(products, "whatever/x.html").map((p) => p.type), ["tool-only"]);
});

test("defineEntityProduct：生成路由、版本文件解析、侧边栏清单；显式传入的字段覆盖生成的", () => {
  const entity = { rootSeg: "boards", metaFile: "board.json" };
  const p = defineEntityProduct({ apiVersion: 1, type: "board", label: "板", entity, previewHtml: () => "<html><body></body></html>",
    openVersion: () => ({ filePath: (rel) => `/obj/${rel}` }), nav: () => [{ id: "x", title: "自定义", href: null }] });
  assert.deepEqual(p.entities, [entity]);
  assert.deepEqual(p.render("ws", "pid", "boards/b1/preview.html").current, { type: "board", id: "b1" });
  assert.equal(p.render("ws", "pid", "boards/b1/other.html"), null);
  assert.equal(p.resolveFile("ws", "pid", "boards/b1/versions/2/a/b.png"), "/obj/a/b.png");
  assert.equal(p.nav()[0].title, "自定义");
});

test("示例插件（examples/plugin-note）：只靠 protoflow/sdk，跟内置产品一起注册，建 → 预览 → 定版 → 版本文件 → 导出 → 引用", async () => {
  const host = createTestHost([...PRODUCTS, notePlugin]);
  try {
    const { id } = host.createProject("演示");
    assert.deepEqual(await host.call("write_note", { projectId: id, noteId: "idea", title: "想法", content: "第一版" }), { ok: true, noteId: "idea" });
    assert.equal(host.render(id, "notes/idea/preview.html"), null, "没定版没有阅读页");
    assert.equal((await host.call("build_note", { projectId: id, noteId: "idea", note: "首版" })).version, 1);

    const html = host.render(id, "notes/idea/preview.html");
    assert.ok(html.includes("第一版"));
    assert.ok(html.includes("window.__PF_PNAV__"), "产品主页面由框架注入项目侧边栏");
    const { nav } = JSON.parse(html.match(/window\.__PF_PNAV__ = (\{[\s\S]*?\});/)[1]);
    assert.deepEqual(nav.groups.find((g) => g.type === "note").items.map((i) => i.href), ["notes/idea/preview.html"]);
    assert.ok(host.file(id, "notes/idea/versions/1/note.md"), "版本里的文件按清单解析到对象库");

    const out = await host.export(id, "note/idea/md");
    assert.equal(out.filename, "idea.md");
    assert.equal(out.buffer.toString(), "第一版");

    await host.call("write_note", { projectId: id, noteId: "follow", content: "基于 idea" });
    const built = await host.call("build_note", { projectId: id, noteId: "follow", sources: ["note:idea"] });
    assert.equal(built.ok, true, JSON.stringify(built));
    const bad = await host.call("build_note", { projectId: id, noteId: "follow", sources: ["note:nope"] });
    assert.equal(bad.ok, false, "引用不存在的笔记被框架的引用校验挡下");
  } finally { host.cleanup(); }
});

test("页面注入契约：各产品主页面留出侧边栏位置、用品牌 CSS 变量、顶部菜单栏有全屏；框架注入侧边栏，实时刷新脚本能注入", async () => {
  const host = createTestHost([...PRODUCTS, notePlugin]);
  try {
    const { id } = host.createProject("契约");
    const c = (name, args) => host.call(name, { projectId: id, ...args }).then((r) => { assert.notEqual(r && r.ok, false, `${name}: ${JSON.stringify(r)}`); return r; });
    await c("upsert_page", { name: "首页" });
    await c("create_doc", { docId: "prd", title: "PRD", content: "# 标题\n\n正文\n" });
    await c("build_doc", { docId: "prd", note: "v1" });
    await c("create_sheet", { sheetId: "s", title: "表" });
    await c("build_sheet", { sheetId: "s", note: "v1" });
    await c("create_diagram", { diagramId: "d", title: "图" });
    fs.mkdirSync(path.join(host.ws, id, "diagrams", "d", "pages"), { recursive: true });
    fs.writeFileSync(path.join(host.ws, id, "diagrams", "d", "pages", "01-总览.md"), "# 根\n## 子\n");
    await c("build_diagram", { diagramId: "d", note: "v1" });
    await c("write_note", { noteId: "n", content: "x" });
    await c("build_note", { noteId: "n" });
    await c("create_deck", { deckId: "k" });
    await c("build_deck", { deckId: "k", note: "v1" });
    const pages = {
      canvas: "canvases/main/canvas.html", doc: "docs/prd/preview.html", sheet: "sheets/s/preview.html",
      diagram: "diagrams/d/preview.html", deck: "decks/k/preview.html", note: "notes/n/preview.html",
    };
    for (const [type, rel] of Object.entries(pages)) {
      const html = host.render(id, rel);
      assert.ok(html, `${type} 主页面渲染得出来`);
      assert.ok(html.includes("data-pf-nav-slot"), `${type}：留出侧边栏位置 [data-pf-nav-slot]`);
      assert.ok(html.includes("--pf-brand"), `${type}：用品牌 CSS 变量`);
      assert.equal((html.match(/window\.__PF_PNAV__ = /g) || []).length, 1, `${type}：框架注入且只注入一次侧边栏`);
      assert.ok(injectLiveClient(html, "etag").includes("__protoflow_live"), `${type}：实时刷新脚本能注入`);
      if (type !== "note") { // 内置产品：顶部菜单栏有全屏按钮，菜单栏打了 data-pf-chrome（全屏时隐藏）
        assert.ok(html.includes("data-pf-fullscreen") && html.includes("window.__pfFullscreen"), `${type}：有全屏按钮和脚本`);
        assert.ok(/<header class="pf-hdr" data-pf-chrome>/.test(html), `${type}：顶部菜单栏标了 data-pf-chrome`);
      }
    }
  } finally { host.cleanup(); }
});
