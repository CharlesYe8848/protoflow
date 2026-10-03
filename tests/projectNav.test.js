import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import * as canvasStore from "../products/canvas/store.js";
import * as sheetStore from "../products/sheet/store.js";
import { createSheet, buildSheet } from "../products/sheet/sheet.js";
import { PRODUCTS } from "../products/index.js";
import { buildProjectNav, injectProjectNav } from "../core/projectNav.js";
import { renderProjectView } from "../products/index.js";

const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1`, author: "Charles" };

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-pnav-"));
  const proj = store.createProject(ws, "结账流程", CTX);
  return { ws, proj, root: path.join(ws, proj.id) };
}

async function builtSheet(ws, pid, sheetId, title) {
  createSheet(ws, pid, { sheetId, title }, CTX);
  fs.writeFileSync(path.join(sheetStore.sheetDir(ws, pid, sheetId), "sheet.json"),
    JSON.stringify({ schemaVersion: 1, title, sheets: [{ name: "A", rows: [["a"]] }] }));
  await buildSheet(ws, pid, sheetId, { note: "首版" }, CTX);
}

const navOf = (html) => JSON.parse(html.match(/window\.__PF_PNAV__ = (\{[\s\S]*?\});/)[1]);

test("buildProjectNav：项目名 + 每个产品一组（按注册表顺序）；未定版的产物有条目但没有链接", async () => {
  const { ws, proj } = setup();
  await builtSheet(ws, proj.id, "sales", "销售数据");
  createSheet(ws, proj.id, { sheetId: "draft", title: "草稿表" }, CTX);
  canvasStore.upsertPage(ws, proj.id, { name: "流程" }, CTX); // 第一个页面自动建出画布 main
  canvasStore.createCanvas(ws, proj.id, { canvasId: "admin", title: "后台" }, { now: () => CTX.now() + 1 });

  const nav = buildProjectNav(ws, proj.id, PRODUCTS);
  assert.deepEqual(nav.project, { id: proj.id, name: "结账流程" });
  assert.deepEqual(nav.groups.map((g) => g.type), ["canvas", "doc", "sheet", "diagram", "deck"]);
  assert.deepEqual(nav.groups[0].items, [
    { id: "main", title: "结账流程", href: "canvases/main/canvas.html", meta: "" },
    { id: "admin", title: "后台", href: "canvases/admin/canvas.html", meta: "" },
  ], "每个画布一条，按创建先后");
  assert.deepEqual(nav.groups[1].items, [], "没有文档就是空组");
  const sheets = Object.fromEntries(nav.groups[2].items.map((i) => [i.id, i]));
  assert.equal(sheets.sales.href, "sheets/sales/preview.html");
  assert.equal(sheets.sales.meta, "", "列表里不标版本号");
  assert.equal(sheets.draft.href, null, "没定过版就没有阅读页可去");
  assert.equal(sheets.draft.meta, "未定版");
});

test("injectProjectNav：插在 <body> 开头，只插一次，数据里的 < 被转义（防 </script> 截断）", () => {
  const nav = { project: { id: "p", name: "</script><b>x" }, groups: [] };
  const out = injectProjectNav("<html><head></head><body class=\"k\"><p>正文 <body> 字样</p></body></html>", nav, { type: "canvas", id: "canvas" });
  assert.ok(out.startsWith('<html><head></head><body class="k"><style>'), "紧跟真正的 <body> 标签");
  assert.equal((out.match(/window\.__PF_PNAV__ = /g) || []).length, 1, "正文里出现的 <body> 字样不会被当成插入点");
  assert.ok(!out.includes("</script><b>x"), "项目名里的 </script> 不能原样进脚本");
});

test("injectProjectNav：收起时不占位置（没有常驻窄条），只在展开时推开页面", () => {
  const out = injectProjectNav("<body>", { project: { id: "p", name: "P" }, groups: [] }, {});
  assert.ok(out.includes("html.pf-pnav-open body{margin-left:248px}"), "展开才推开页面");
  assert.ok(!/html\.pf-pnav-on body/.test(out) && !out.includes("margin-left:44px"), "收起态不再留 44px 窄条");
  assert.ok(out.includes('.pf-pnav{position:fixed') && out.includes("display:none") && out.includes("html.pf-pnav-open .pf-pnav{display:flex}"), "面板收起时整个不显示");
  assert.ok(out.includes('document.querySelectorAll("[data-pf-nav-slot]")'), "入口按钮放进产品预留的每个位置");
  assert.ok(out.includes("pf-pnav__launcher--float"), "没留位置的页面退化成左上角悬浮按钮");
  assert.ok(!out.includes("pf-pnav__group-hd"), "列表不分组、没有组头，靠类型图标区分");
});

test("injectProjectNav：注入的客户端脚本是语法合法的 JS（Node 模板字符串里的转义最容易出错）", () => {
  const out = injectProjectNav("<body>", { project: { id: "p", name: "P" }, groups: [] }, {});
  const script = out.slice(out.indexOf("<script>") + "<script>".length, out.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new Function(script));
});

test("renderProjectView：画布、文档阅读页、表格阅读页都注入侧边栏并标出当前产物；画板预览（iframe）不注入", async () => {
  const { ws, proj, root } = setup();
  const pg = canvasStore.upsertPage(ws, proj.id, { name: "流程" }, CTX);
  const ab = canvasStore.upsertArtboard(ws, proj.id, pg.id, { name: "列表页" }, CTX);
  canvasStore.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="l">列表</div>; }`);
  await builtSheet(ws, proj.id, "sales", "销售数据");

  const canvas = renderProjectView(root, "canvases/main/canvas.html");
  assert.deepEqual(navOf(canvas).current, { type: "canvas", id: "main" });


  const sheet = renderProjectView(root, "sheets/sales/preview.html");
  assert.deepEqual(navOf(sheet).current, { type: "sheet", id: "sales" });
  assert.ok(navOf(sheet).nav.groups[2].items.some((i) => i.id === "sales"), "侧边栏数据是实时的产物清单");
  assert.ok(!fs.readFileSync(path.join(sheetStore.sheetDir(ws, proj.id, "sales"), "preview.html"), "utf8").includes("__PF_PNAV__"),
    "只在返回页面时注入，磁盘上冻结的阅读页不含侧边栏（所以导出产物天然不带）");

  const artboard = renderProjectView(root, `canvases/main/pages/${pg.id}/artboards/${ab.id}/preview.html`);
  assert.ok(!artboard.includes("__PF_PNAV__"), "画板预览是嵌在画布里的 iframe，不注入");
});

test("新增产物后，已冻结的阅读页再次打开就能在侧边栏看到它，不用重新定版", async () => {
  const { ws, proj, root } = setup();
  await builtSheet(ws, proj.id, "sales", "销售数据");
  const before = navOf(renderProjectView(root, "sheets/sales/preview.html")).nav.groups[2].items.map((i) => i.id);
  await builtSheet(ws, proj.id, "costs", "成本数据");
  const after = navOf(renderProjectView(root, "sheets/sales/preview.html")).nav.groups[2].items.map((i) => i.id);
  assert.deepEqual(before, ["sales"]);
  assert.deepEqual(after.sort(), ["costs", "sales"]);
});

test("展开状态：按用户级偏好初始展开（服务端直接写进页面，打开不闪），点开/收起会存回服务端", async () => {
  const { ws, proj, root } = setup();
  const pg = canvasStore.upsertPage(ws, proj.id, { name: "流程" }, CTX);
  canvasStore.upsertArtboard(ws, proj.id, pg.id, { name: "列表页" }, CTX);
  assert.equal(navOf(renderProjectView(root, "canvases/main/canvas.html")).open, false, "没有偏好就是收起");
  assert.equal(navOf(renderProjectView(root, "canvases/main/canvas.html", { ui: { projectNavOpen: true } })).open, true);
  const out = injectProjectNav("<body>", { project: { id: "p", name: "P" }, groups: [] }, {}, { open: true });
  assert.ok(out.includes('if (D.open) root.classList.add("pf-pnav-open")'), "脚本在 <body> 开头同步设上展开状态");
  assert.ok(out.includes('fetch("/__protoflow_ui"') && out.includes("projectNavOpen: v"), "切换时存回服务端");
});

test("文档/表格阅读页按当前模板现场渲染，不再原样返回磁盘上 finalize 时写的旧页面", async () => {
  const { ws, proj, root } = setup();
  await builtSheet(ws, proj.id, "sales", "销售数据");
  const file = path.join(sheetStore.sheetDir(ws, proj.id, "sales"), "preview.html");
  fs.writeFileSync(file, "<html><body>旧模板写的页面 OLD-TEMPLATE-MARKER</body></html>");
  const html = renderProjectView(root, "sheets/sales/preview.html");
  assert.ok(!html.includes("OLD-TEMPLATE-MARKER"), "不读磁盘上的旧页面");
  assert.ok(html.includes("data-pf-nav-slot") && html.includes('"name":"A"'), "是用冻结的版本内容 + 当前模板拼出来的");
  assert.equal(renderProjectView(root, "sheets/nope/preview.html"), null, "不存在的表格照旧交给静态通道（404）");
});

test("项目入口 index.html：按侧边栏顺序跳第一个能打开的产物；只有文档/表格的项目跳文档/表格；空项目显示空页面并展开侧边栏", async () => {
  const { ws, proj, root } = setup();
  const empty = renderProjectView(root, "index.html");
  assert.ok(empty.includes("还没有可看的内容") && !empty.includes("location.replace"), "空项目不跳转");
  assert.equal(navOf(empty).open, true, "侧边栏展开，好切到别的项目");
  assert.equal(navOf(empty).current, null);
  assert.equal(navOf(empty).nav.entry, "index.html", "切换项目统一打开项目入口");

  createSheet(ws, proj.id, { sheetId: "draft", title: "草稿表" }, CTX);
  assert.ok(!renderProjectView(root, "index.html").includes("location.replace"), "没定过版的表格点不进去，不算");
  await builtSheet(ws, proj.id, "sales", "销售数据");
  assert.ok(renderProjectView(root, "index.html").includes('location.replace("sheets/sales/preview.html")'), "没有画布就去表格");

  canvasStore.upsertPage(ws, proj.id, { name: "流程" }, CTX);
  assert.ok(renderProjectView(root, "index.html").includes('location.replace("canvases/main/canvas.html")'), "有画布先去画布");
  assert.equal(renderProjectView(root, "canvas.html"), null, "不再有画布自己的入口");
});
