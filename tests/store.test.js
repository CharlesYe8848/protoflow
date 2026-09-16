import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";

function tmpWs() { return fs.mkdtempSync(path.join(os.tmpdir(), "pf-ws-")); }
const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1700000000000` };
// 单个测试内需要建同前缀多个实体（如两个页面）时用这个避免固定时间戳导致 id 撞车。
let seq = 0;
function seqCtx() { return { now: () => 1700000000000 + (++seq), genId: (p) => `${p}_${1700000000000 + (++seq)}` }; }

test("createProject 用项目名 slug 做目录名，写自描述文档，可被 list/load 看到", () => {
  const ws = tmpWs();
  const proj = store.createProject(ws, "招聘系统", CTX);
  assert.equal(proj.id, "招聘系统");
  assert.deepEqual(store.listProjects(ws).map((p) => p.id), [proj.id]);
  const tree = store.loadProjectTree(ws, proj.id);
  assert.equal(tree.name, "招聘系统");
  assert.deepEqual(tree.pages, []);
  const agentsMd = fs.readFileSync(path.join(ws, proj.id, "AGENTS.md"), "utf8");
  assert.ok(agentsMd.includes("招聘系统"));
  assert.equal(agentsMd, fs.readFileSync(path.join(ws, proj.id, "CLAUDE.md"), "utf8"));
});

test("createProject 同名冲突时目录名自动加序号后缀", () => {
  const ws = tmpWs();
  const p1 = store.createProject(ws, "P", CTX);
  const p2 = store.createProject(ws, "P", CTX);
  assert.equal(p1.id, "p");
  assert.equal(p2.id, "p-2");
  assert.deepEqual(store.listProjects(ws).map((p) => p.id).sort(), ["p", "p-2"]);
});

test("upsertPage/upsertArtboard 建与改名，索引一致", () => {
  const ws = tmpWs();
  const proj = store.createProject(ws, "P", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "登录流程" }, CTX);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "登录页", description: "d" }, CTX);
  store.upsertPage(ws, proj.id, { id: pg.id, name: "登录流程2" }, CTX);
  const tree = store.loadProjectTree(ws, proj.id);
  assert.equal(tree.pages[0].name, "登录流程2");
  assert.equal(tree.pages[0].artboards[0].id, ab.id);
  assert.equal(tree.pages[0].artboards[0].format, "jsx");
});

test("reorderArtboards 调整画板在页面里的顺序；新画板默认追加到末尾——回归测试：用户反馈画布里新增画板总是排在最后，没有办法调整", () => {
  const ws = tmpWs();
  const proj = store.createProject(ws, "P", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "pg" }, CTX);
  const a = store.upsertArtboard(ws, proj.id, pg.id, { name: "a" }, seqCtx());
  const b = store.upsertArtboard(ws, proj.id, pg.id, { name: "b" }, seqCtx());
  const c = store.upsertArtboard(ws, proj.id, pg.id, { name: "c" }, seqCtx());
  assert.deepEqual(store.loadProjectTree(ws, proj.id).pages[0].artboards.map((x) => x.id), [a.id, b.id, c.id], "新建画板默认追加到末尾");

  store.reorderArtboards(ws, proj.id, pg.id, [c.id, a.id, b.id]);
  assert.deepEqual(store.loadProjectTree(ws, proj.id).pages[0].artboards.map((x) => x.id), [c.id, a.id, b.id]);
});

test("reorderArtboards 拒绝缺画板/多画板/换成别的画板 id 的顺序", () => {
  const ws = tmpWs();
  const proj = store.createProject(ws, "P", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "pg" }, CTX);
  const a = store.upsertArtboard(ws, proj.id, pg.id, { name: "a" }, seqCtx());
  const b = store.upsertArtboard(ws, proj.id, pg.id, { name: "b" }, seqCtx());
  assert.throws(() => store.reorderArtboards(ws, proj.id, pg.id, [a.id]), /全排列/);
  assert.throws(() => store.reorderArtboards(ws, proj.id, pg.id, [a.id, b.id, "ab_ghost"]), /全排列/);
  assert.throws(() => store.reorderArtboards(ws, proj.id, pg.id, [a.id, "ab_ghost"]), /全排列/);
});

test("saveArtboardSource 写源码并盖 lastValidatedHash；readArtboard 实时算 sourceHash", () => {
  const ws = tmpWs();
  const proj = store.createProject(ws, "P", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "pg" }, CTX);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "a" }, CTX);
  store.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="x"/>; }`);
  const got = store.readArtboard(ws, proj.id, ab.id);
  assert.equal(got.meta.lastValidatedHash, got.sourceHash);
  assert.deepEqual(got.elementIds, ["x"]);
  // 模拟外部直接改文件 → sourceHash 变、lastValidatedHash 不变
  fs.appendFileSync(got.sourcePath, "\n// touched\n");
  const got2 = store.readArtboard(ws, proj.id, ab.id);
  assert.notEqual(got2.sourceHash, got2.meta.lastValidatedHash);
});

test("deleteTarget 按 id 判别；删页级联；未知 id 报错", () => {
  const ws = tmpWs();
  const proj = store.createProject(ws, "P", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "pg" }, CTX);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "a" }, CTX);
  store.deleteTarget(ws, proj.id, pg.id);
  assert.deepEqual(store.loadProjectTree(ws, proj.id).pages, []);
  assert.throws(() => store.deleteTarget(ws, proj.id, ab.id), /不存在/);
});

test("annotations.md 读默认空串、写后可读回；refs 侧车按需增删；盖 annotationsValidatedHash", () => {
  const ws = tmpWs();
  const proj = store.createProject(ws, "P", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "pg" }, CTX);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "a" }, CTX);
  assert.equal(store.readAnnotationsMd(ws, proj.id, ab.id), "");
  assert.deepEqual(store.readAnnotationRefs(ws, proj.id, ab.id), {});
  store.writeAnnotationsMd(ws, proj.id, ab.id, "## 说明\n\n点 [按钮](#el/btn)", { btn: { interactionPath: [] } }, "h9");
  assert.match(store.readAnnotationsMd(ws, proj.id, ab.id), /点 \[按钮\]\(#el\/btn\)/);
  assert.deepEqual(store.readAnnotationRefs(ws, proj.id, ab.id), { btn: { interactionPath: [] } });
  assert.equal(store.readAnnotationValidatedHash(ws, proj.id, ab.id), "h9");
  // 空 refs 时移除侧车文件
  store.writeAnnotationsMd(ws, proj.id, ab.id, "## 只有文字", {}, "h10");
  assert.equal(fs.existsSync(store.annotationsRefsPath(ws, proj.id, ab.id)), false);
});

test("loadChainSnapshot 装配 chain.js 需要的快照", () => {
  const ws = tmpWs();
  const proj = store.createProject(ws, "P", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "pg" }, CTX);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "列表页" }, CTX);
  store.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="btn"/>; }`);
  store.writeAnnotationsMd(ws, proj.id, ab.id, "点 [按钮](#el/btn) 试试", {}, "old");
  const snap = store.loadChainSnapshot(ws, proj.id);
  assert.equal(snap.artboards.length, 1);
  assert.equal(snap.artboards[0].hasAnnotations, true);
  assert.deepEqual(snap.artboards[0].annotationRefElementIds, ["btn"]);
  assert.equal(snap.artboards[0].annotationsValidatedHash, "old");
  assert.deepEqual(snap.docs, []);
});

test("路径穿越 projectId 被拒绝", () => {
  const ws = tmpWs();
  assert.throws(() => store.loadProjectTree(ws, "../etc"), /不合法/);
});

test("artboardPreviewHtml 确定性：相同磁盘内容重复调用逐字节相同；无源码时报错；不落盘", () => {
  const ws = tmpWs();
  const proj = store.createProject(ws, "P", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "pg" }, CTX);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "板" }, CTX);
  assert.throws(() => store.artboardPreviewHtml(ws, proj.id, ab.id), /尚无源码/);
  store.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="x">hi</div>; }`);
  const h1 = store.artboardPreviewHtml(ws, proj.id, ab.id);
  assert.equal(store.artboardPreviewHtml(ws, proj.id, ab.id), h1);
  assert.ok(h1.includes("hi") && h1.includes('src="../../../../lib/react.production.min.js"'));
  assert.equal(fs.existsSync(path.join(ws, proj.id, "pages", pg.id, "artboards", ab.id, "preview.html")), false, "实时渲染不落盘");
  assert.ok(fs.existsSync(path.join(ws, proj.id, "lib", "react.production.min.js")), "但 lib/ 要补齐（preview 用相对路径引它）");
});

test("artboardPreviewHtml 实时反映磁盘：改了 source.jsx（不经 saveArtboardSource）下次调用即最新", () => {
  const ws = tmpWs();
  const proj = store.createProject(ws, "P", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "pg" }, CTX);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "板" }, CTX);
  store.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="x">v1</div>; }`);
  assert.ok(store.artboardPreviewHtml(ws, proj.id, ab.id).includes("v1"));
  fs.writeFileSync(path.join(ws, proj.id, "pages", pg.id, "artboards", ab.id, "source.jsx"),
    `function Component(){ return <div id="x">v2</div>; }`);
  const after = store.artboardPreviewHtml(ws, proj.id, ab.id);
  assert.ok(after.includes("v2") && !after.includes("v1"));
});

test("canvasHtml：单份文档汇总全部页面，canvasWidth 透传，无源码画板显示占位；不落盘", () => {
  const ws = tmpWs();
  const c = seqCtx();
  const proj = store.createProject(ws, "P", c);
  const pg1 = store.upsertPage(ws, proj.id, { name: "页一" }, c);
  const pg2 = store.upsertPage(ws, proj.id, { name: "页二" }, c);
  const ab1 = store.upsertArtboard(ws, proj.id, pg1.id, { name: "板A", canvasWidth: 375 }, c);
  store.saveArtboardSource(ws, proj.id, ab1.id, `function Component(){ return <div id="x">A</div>; }`);
  store.upsertArtboard(ws, proj.id, pg2.id, { name: "板B（无源码）" }, c);

  const html = store.canvasHtml(ws, proj.id);
  assert.equal(html, store.canvasHtml(ws, proj.id), "纯函数：相同磁盘状态逐字节相同");
  assert.ok(html.includes("页二"), "两个页面应都在同一份文档里");
  assert.ok(html.includes("width:375px"), "自定义 canvasWidth 应生效");
  assert.ok(html.includes("尚无内容"), "板B 无源码应显示占位");
  assert.equal(fs.existsSync(store.canvasPath(ws, proj.id)), false, "实时渲染不落盘");
});

test("canvasHtml 把每块画板的 annotations.md + refs 传给画布——左侧标注侧边栏用；无标注画板不进列表", () => {
  const ws = tmpWs();
  const c = seqCtx();
  const proj = store.createProject(ws, "P", c);
  const pg = store.upsertPage(ws, proj.id, { name: "页一" }, c);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "板A" }, c);
  store.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="x">A</div><div id="y"/>; }`);
  store.writeAnnotationsMd(ws, proj.id, ab.id,
    "## 主流程\n\n### 提交\n\n点 [提交](#el/x)\n\n### 校验\n\n校验 [金额](#el/y)",
    { x: { interactionPath: [{ type: "click", selector: "#x" }] } }, "h1");
  const noAnn = store.upsertArtboard(ws, proj.id, pg.id, { name: "板B" }, c);
  store.saveArtboardSource(ws, proj.id, noAnn.id, `function Component(){ return <div id="z">B</div>; }`);

  const html = store.canvasHtml(ws, proj.id);
  // 标注入口在画板上：只有有 annotations.md 的板 A 出现 .pf-frame__annotate，板 B 不出
  assert.equal((html.match(/<button class="pf-frame__annotate"/g) || []).length, 1, "只有板 A 有画板级标注按钮");
  const annBtnIdx = html.indexOf('<button class="pf-frame__annotate"');
  assert.ok(annBtnIdx > 0 && html.indexOf(`data-artboard="${ab.id}"`) < annBtnIdx && annBtnIdx < html.indexOf(`data-artboard="${noAnn.id}"`), "标注按钮落在板 A 的 label 里，板 B 没有");
  assert.ok(fs.existsSync(path.join(ws, proj.id, "lib", "marked.min.js")), "canvasHtml 顺带把 marked 拷进项目 lib/（侧栏渲染 markdown 用）");
  const data = JSON.parse(html.match(/id="pf-ann-data">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, "<"));
  assert.equal(data[pg.id].length, 1, "只有板A有标注");
  const abData = data[pg.id][0];
  assert.equal(abData.artboardName, "板A");
  assert.match(abData.md, /### 提交/);
  assert.match(abData.md, /点 \[提交\]\(#el\/x\)/);
  assert.deepEqual(abData.refs, { x: { interactionPath: [{ type: "click", selector: "#x" }] } });
});

test("canvasHtml 实时反映结构变化：新增画板后下次调用即包含它，无需任何『打开/刷新』动作", () => {
  const ws = tmpWs();
  const proj = store.createProject(ws, "P", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "页一" }, CTX);
  assert.ok(!store.canvasHtml(ws, proj.id).includes("新画板"));
  store.upsertArtboard(ws, proj.id, pg.id, { name: "新画板" }, CTX);
  assert.ok(store.canvasHtml(ws, proj.id).includes("新画板"));
});
