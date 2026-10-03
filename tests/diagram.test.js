import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import { evaluateSource } from "../core/refs.js";
import { readZipEntries } from "../core/zip.js";
import { PRODUCTS, RESOLVERS } from "../products/index.js";
import { projectHealth } from "../core/projectGraph.js";
import * as diagramStore from "../products/diagram/store.js";
import { createDiagram, buildDiagram, draftHash } from "../products/diagram/diagram.js";
import { artifacts } from "../products/diagram/diagramProduct.js";
import { buildDiagramExportHtml, buildDiagramExportZip } from "../products/diagram/exports.js";
import { registerRenderer, rendererForFile } from "../products/diagram/engine/index.js";
import markmap from "../products/diagram/engine/renderers/markmap.js";
import mermaid from "../products/diagram/engine/renderers/mermaid.js";

let seq = 0;
const CTX = { now: () => 1700000000000 + (++seq) * 1000, author: "Charles" };

const MIND = "# 会员体系\n\n## 等级\n- 普通会员\n- 金卡\n\n## 积分\n- 获取\n- 消耗\n";
const FLOW = "flowchart TD\n  start([开始]) --> pay[支付]\n  pay --> done[完成]\n";

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-diagram-"));
  const proj = store.createProject(ws, "梳理", CTX);
  const r = createDiagram(ws, proj.id, { diagramId: "member", title: "会员体系梳理" }, CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  const write = (file, text) => fs.writeFileSync(path.join(r.pagesDir, file), text);
  const build = (note = "改了", extra = {}) => buildDiagram(ws, proj.id, "member", { note, ...extra }, CTX);
  return { ws, pid: proj.id, dir: r.pagesDir, write, build };
}

test("createDiagram：建出 pages/ 和空的 pages.json；id 不合法或已存在时报错", () => {
  const { ws, pid, dir } = setup();
  assert.ok(fs.existsSync(dir));
  assert.deepEqual(JSON.parse(fs.readFileSync(diagramStore.pagesJsonPath(ws, pid, "member"), "utf8")), []);
  assert.equal(diagramStore.readDiagramJson(ws, pid, "member").title, "会员体系梳理");
  assert.equal(createDiagram(ws, pid, { diagramId: "member" }, CTX).error.code, "DIAGRAM_EXISTS");
  assert.equal(createDiagram(ws, pid, { diagramId: "a/b" }, CTX).error.code, "BAD_DIAGRAM_ID");
});

test("buildDiagram：没有页、没写 note 都拒绝；新文件自动登记进 pages.json 并冻结成第 1 版", async () => {
  const { ws, pid, write, build } = setup();
  assert.equal((await build()).error.code, "DIAGRAM_EMPTY");
  write("mind.md", MIND);
  write("flow.mmd", FLOW);
  assert.equal((await build("  ")).error.code, "NOTE_REQUIRED");

  const r = await build("初稿");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.version, 1);
  assert.deepEqual(r.addedPages, ["flow", "mind"]);
  assert.deepEqual(r.pages.map((p) => [p.id, p.kind]), [["flow", "mermaid"], ["mind", "markmap"]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(diagramStore.pagesJsonPath(ws, pid, "member"), "utf8")),
    [{ file: "flow.mmd", name: "flow" }, { file: "mind.md", name: "mind" }]);
  assert.ok(fs.existsSync(r.headPreviewPath));

  // pages.json 决定顺序和页名；草稿没变时不算有改动
  fs.writeFileSync(diagramStore.pagesJsonPath(ws, pid, "member"), JSON.stringify([{ file: "mind.md", name: "脑图" }, { file: "flow.mmd", name: "下单流程" }]));
  const r2 = await build("调顺序");
  assert.deepEqual(r2.pages.map((p) => `${p.id}:${p.name}`), ["mind:脑图", "flow:下单流程"]);
  assert.equal(r2.addedPages, undefined);
  const pages = diagramStore.readVersionPages(ws, pid, "member", 2);
  assert.deepEqual(pages.map((p) => p.name), ["脑图", "下单流程"]);
  assert.equal(pages[0].source, MIND);
  assert.equal(diagramStore.readVersionPages(ws, pid, "member", 1)[0].id, "flow", "旧版本不可变");
  assert.equal(draftHash(ws, pid, "member"), diagramStore.readDiagramJson(ws, pid, "member").versions[1].diagramHash);
});

test("buildDiagram：页面文件和内容有问题时逐条报出来，不定版", async () => {
  const { ws, pid, write, build } = setup();
  write("flow.mmd", "流程图\n  a --> b\n");
  write("empty.md", "   \n");
  const bad = await build();
  assert.equal(bad.error.code, "DIAGRAM_VALIDATION_FAILED");
  assert.match(bad.error.message, /pages\/flow\.mmd（Mermaid）：第一行应该是图表类型/);
  assert.match(bad.error.message, /pages\/empty\.md（脑图）：内容为空/);

  write("flow.mmd", FLOW);
  write("empty.md", MIND);
  write("notes.txt", "x");
  write("flow.md", MIND);
  fs.writeFileSync(diagramStore.pagesJsonPath(ws, pid, "member"), JSON.stringify([{ file: "gone.md" }]));
  const pagesBad = await build();
  assert.equal(pagesBad.error.code, "DIAGRAM_PAGES_INVALID");
  for (const msg of ["pages/notes.txt 的扩展名不认识", "页 id 都是「flow」", "pages.json 列了 gone.md"]) {
    assert.ok(pagesBad.error.message.includes(msg), `${msg}\n${pagesBad.error.message}`);
  }
  assert.equal(diagramStore.readDiagramJson(ws, pid, "member").head, 0);
});

test("引用：子部位是页，只有那一页改了才算过期；健康检查报没定版的改动", async () => {
  const { ws, pid, write, build } = setup();
  write("mind.md", MIND);
  write("flow.mmd", FLOW);
  await build("初稿");
  const status = (ref) => evaluateSource(ws, pid, { ref }, RESOLVERS).status;
  assert.equal(status("diagram:member@1#flow"), "fresh");
  assert.equal(status("diagram:member@1#nope"), "missing");

  write("flow.mmd", FLOW + "  done --> start\n");
  assert.deepEqual(projectHealth(ws, pid, PRODUCTS, RESOLVERS).map((f) => f.code), ["diagram_uncommitted"]);
  assert.equal(artifacts(ws, pid)[0].dirty, true);
  await build("加回环");
  assert.deepEqual(projectHealth(ws, pid, PRODUCTS, RESOLVERS), []);
  assert.equal(status("diagram:member@1#flow"), "stale");
  assert.equal(status("diagram:member@1#mind"), "fresh", "别的页没改，引用它的不算过期");
  assert.equal(status("diagram:member@1"), "stale", "不带子部位时按版本号比较");
});

test("阅读页：只引用用到的写法的库，渲染结果是确定的（实时刷新按它判断页面变没变）", async () => {
  const { ws, pid, write, build } = setup();
  write("flow.mmd", FLOW);
  await build("只有流程图");
  const html = diagramStore.diagramPreviewHtml(ws, pid, "member");
  assert.ok(html.includes("mermaid.min.js") && !html.includes("markmap-view.js"), "只用了 Mermaid 就不加载 markmap");
  assert.ok(fs.existsSync(path.join(store.projectLibDir(ws, pid), "mermaid.min.js")), "缺的库补进项目 lib/");
  assert.equal(diagramStore.diagramPreviewHtml(ws, pid, "member"), html);
  assert.ok(html.includes("__pfNote") && html.includes('"member"'), "本地预览启用标注");

  write("mind.md", MIND);
  await build("加脑图");
  const html2 = diagramStore.diagramPreviewHtml(ws, pid, "member");
  assert.ok(html2.indexOf("d3.min.js") < html2.indexOf("markmap-view.js"), "d3 要先于 markmap-view 加载");
  assert.ok(html2.includes('"lines":"0,1"'), "脑图节点带源码行号");
});

test("导出：单页 HTML 内嵌压缩的库、不带标注和分享；源文件包里有每页的源码", async () => {
  const { ws, pid, write, build } = setup();
  assert.equal(buildDiagramExportHtml(ws, pid, "member"), null, "没有版本时导出目标不存在");
  write("mind.md", MIND);
  write("flow.mmd", FLOW);
  await build("初稿");

  const html = buildDiagramExportHtml(ws, pid, "member");
  const text = html.buffer.toString("utf8");
  assert.equal(html.filename, "会员体系梳理.html");
  assert.ok(text.includes("__pfDecompressLibs") && text.includes('"markmap-view.js"') && text.includes('"mermaid.min.js"'));
  assert.ok(!text.includes('src="../../lib/'), "单页 HTML 不引用 lib/");
  assert.ok(!text.includes("window.__pfNote = {") && !text.includes("class=\"pf-export-entry\""), "导出页没有标注和分享");

  const zip = buildDiagramExportZip(ws, pid, "member");
  const names = readZipEntries(zip.buffer).map((e) => e.name).sort();
  assert.deepEqual(names, ["会员体系梳理/pages.json", "会员体系梳理/pages/flow.mmd", "会员体系梳理/pages/mind.md", "会员体系梳理/会员体系梳理.html"]);
});

test("渲染器：按扩展名找；只靠登记就能跑通定版和阅读页（接口不是只为两种写法设计的）", async () => {
  assert.equal(rendererForFile("a.md"), markmap);
  assert.equal(rendererForFile("a.mmd"), mermaid);
  assert.equal(rendererForFile("a.txt"), null);
  assert.deepEqual(markmap.validate("随便一段话"), ["至少要有一个标题（# …）或列表项（- …）"]);
  assert.deepEqual(mermaid.validate("%% 注释\n\nsequenceDiagram\n A->>B: hi"), []);
  assert.deepEqual(mermaid.validate("---\ntitle: x\n---\nflowchart LR\n a-->b"), [], "跳过 frontmatter");
  assert.deepEqual(markmap.prepare(MIND), markmap.prepare(MIND), "prepare 结果是确定的");

  const plain = {
    kind: "plain", label: "纯文本", ext: ".txt", libs: {},
    validate: (s) => (s.trim() ? [] : ["空"]),
    prepare: (s) => ({ lines: s.trim().split("\n") }),
    clientScript: () => "PFDiagram.register('plain', { render: function(){ return Promise.resolve(); }, nodes: function(){ return []; } });",
  };
  const unregister = registerRenderer(plain);
  try {
    assert.throws(() => registerRenderer({ ...plain }), /渲染器重名/);
    const { ws, pid, write, build } = setup();
    write("notes.txt", "第一行\n第二行\n");
    const r = await build("纯文本页");
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.pages.map((p) => p.kind), ["plain"]);
    const html = diagramStore.diagramPreviewHtml(ws, pid, "member");
    assert.ok(html.includes("PFDiagram.register('plain'") && html.includes('"lines":["第一行","第二行"]'));
  } finally {
    unregister();
  }
  assert.equal(rendererForFile("a.txt"), null);
});
