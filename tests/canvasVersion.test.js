import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import * as canvasStore from "../products/canvas/store.js";
import { buildCanvas, canvasVersionState, collectCanvasFiles, canvasHash } from "../products/canvas/canvasVersion.js";
import { renderProjectView, resolveProjectFile } from "../products/index.js";
import { objectsDir } from "../core/versionStore.js";

const CTX = { now: () => 1700000000000, author: "Charles" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-cv-"));
  const proj = store.createProject(ws, "画布版本", CTX);
  const pg = canvasStore.upsertPage(ws, proj.id, { name: "首页" }, CTX);
  const a = canvasStore.upsertArtboard(ws, proj.id, pg.id, { id: undefined, name: "A" }, { now: () => 1 });
  const b = canvasStore.upsertArtboard(ws, proj.id, pg.id, { name: "B" }, { now: () => 2 });
  canvasStore.saveArtboardSource(ws, proj.id, a.id, "function Component(){ return <div>A1</div>; }");
  canvasStore.saveArtboardSource(ws, proj.id, b.id, "function Component(){ return <img src=\"assets/p.png\"/>; }");
  const assets = path.join(canvasStore.artboardDir(ws, proj.id, b.id), "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, "p.png"), PNG);
  fs.writeFileSync(path.join(canvasStore.artboardDir(ws, proj.id, a.id), "annotations.md"), "## A 的标注\n");
  return { ws, proj, pg, a, b, root: store.projectDir(ws, proj.id) };
}

const countObjects = (root) => {
  const dir = objectsDir(root);
  return fs.existsSync(dir) ? fs.readdirSync(dir).reduce((n, d) => n + fs.readdirSync(path.join(dir, d)).length, 0) : 0;
};

test("buildCanvas：note 必填、没有页面报 NO_PAGES", () => {
  const { ws, proj } = setup();
  assert.equal(buildCanvas(ws, proj.id, { note: " " }, CTX).error.code, "NOTE_REQUIRED");
  const empty = store.createProject(ws, "空", CTX);
  assert.equal(buildCanvas(ws, empty.id, { note: "x" }, CTX).error.code, "NO_PAGES");
});

test("buildCanvas：冻结全部页面/画板文件，写 canvas.json；草稿改动后 dirty，历史版本内容不变", () => {
  const { ws, proj, pg, a, b } = setup();
  assert.deepEqual(canvasVersionState(ws, proj.id, "main"), { head: 0, dirty: true, versions: [] });

  const r1 = buildCanvas(ws, proj.id, { note: "首版", label: "评审版" }, CTX);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.version, 1);
  assert.equal(r1.artboardCount, 2);
  const cj = canvasStore.readCanvasJson(ws, proj.id, "main");
  assert.equal(cj.head, 1);
  assert.equal(cj.versions[0].note, "首版");
  assert.equal(cj.versions[0].label, "评审版");
  assert.equal(cj.versions[0].author, "Charles");
  assert.deepEqual(cj.versions[0].sources, []);

  const v1 = canvasStore.openCanvasVersion(ws, proj.id, "main", 1);
  const base = `pages/${pg.id}/artboards`;
  for (const f of ["pages.json", `pages/${pg.id}/page.json`, `${base}/${a.id}/source.jsx`, `${base}/${a.id}/meta.json`,
    `${base}/${a.id}/annotations.md`, `${base}/${b.id}/assets/p.png`]) {
    assert.ok(v1.has(f), f);
  }
  assert.equal(canvasVersionState(ws, proj.id, "main").dirty, false);

  canvasStore.saveArtboardSource(ws, proj.id, a.id, "function Component(){ return <div>A2</div>; }");
  assert.equal(canvasVersionState(ws, proj.id, "main").dirty, true);
  assert.ok(canvasStore.canvasVersionReader(ws, proj.id, "main", 1).source(a.id).includes("A1"), "历史版本不跟着草稿变");

  const r2 = buildCanvas(ws, proj.id, { note: "改 A" }, CTX);
  assert.equal(r2.unchanged, false);
  assert.equal(buildCanvas(ws, proj.id, { note: "复核" }, CTX).unchanged, true);
});

test("内容寻址：没改的画板和图片跨版本只存一份", () => {
  const { ws, proj, a, root } = setup();
  buildCanvas(ws, proj.id, { note: "1" }, CTX);
  const after1 = countObjects(root);
  canvasStore.saveArtboardSource(ws, proj.id, a.id, "function Component(){ return <div>A2</div>; }");
  buildCanvas(ws, proj.id, { note: "2" }, CTX);
  // 只有 A 的 source.jsx 和 meta.json（lastValidatedHash 变了）是新内容
  assert.equal(countObjects(root) - after1, 2);
});

test("collectCanvasFiles：只收登记了的页面/画板，隐藏文件不算；指纹只看内容", () => {
  const { ws, proj, pg, a } = setup();
  const abDir = canvasStore.artboardDir(ws, proj.id, a.id);
  fs.writeFileSync(path.join(abDir, ".DS_Store"), "x");
  fs.mkdirSync(path.join(canvasStore.pageDirPath(ws, proj.id, pg.id), "artboards", "ab_orphan"), { recursive: true });
  fs.writeFileSync(path.join(canvasStore.pageDirPath(ws, proj.id, pg.id), "artboards", "ab_orphan", "source.jsx"), "x");
  const paths = collectCanvasFiles(ws, proj.id, "main").map((f) => f.path);
  assert.ok(!paths.some((p) => p.includes(".DS_Store") || p.includes("ab_orphan")));
  assert.equal(canvasHash(collectCanvasFiles(ws, proj.id, "main")), canvasHash(collectCanvasFiles(ws, proj.id, "main")));
});

test("渲染：没定过版看工作副本、不显示版本下拉；定过版后默认看最新版，没定版的改动不出现", () => {
  const { ws, proj, pg, a, root } = setup();
  let page = renderProjectView(root, "canvases/main/canvas.html");
  assert.ok(!page.includes(`class="pf-vsel"`), "没定过版没有版本下拉");
  assert.ok(page.includes(`src="pages/${pg.id}/artboards/${a.id}/preview.html"`), "画板看工作副本");

  buildCanvas(ws, proj.id, { note: "首版" }, CTX);
  canvasStore.saveArtboardSource(ws, proj.id, a.id, "function Component(){ return <div>A2</div>; }");
  page = renderProjectView(root, "canvases/main/canvas.html");
  assert.ok(page.includes(`class="pf-vsel"`));
  assert.ok(page.includes(`src="versions/1/pages/${pg.id}/artboards/${a.id}/preview.html"`), "画板指向最新版");
  assert.ok(!page.includes(`class="pf-vsel-badge"`), "看的是最新版，不带 vN 小标");
  assert.ok(page.includes(`class="pf-export-entry"`), "分享照常在");
  assert.ok(page.includes(`src="../../lib/marked.min.js"`));
  assert.ok(page.includes("__PF_PNAV__"), "项目侧边栏照样注入");
  const abHtml = renderProjectView(root, `canvases/main/versions/1/pages/${pg.id}/artboards/${a.id}/preview.html`);
  assert.ok(abHtml.includes("A1") && !abHtml.includes("A2"), "没定版的改动不出现");
  assert.ok(abHtml.includes(`src="../../../../../../../../lib/react.production.min.js"`));
});

test("渲染：?v=<n> 看历史版本（带 vN 小标）；不存在的版本回落到最新版；版本数据给下拉用", () => {
  const { ws, proj, pg, a, b, root } = setup();
  buildCanvas(ws, proj.id, { note: "首版" }, CTX);
  canvasStore.saveArtboardSource(ws, proj.id, a.id, "function Component(){ return <div>A2</div>; }");
  buildCanvas(ws, proj.id, { note: "第二版" }, CTX);

  const v1 = renderProjectView(root, "canvases/main/canvas.html", { query: "v=1" });
  assert.ok(v1.includes(`src="versions/1/pages/${pg.id}/artboards/${a.id}/preview.html"`));
  assert.ok(v1.includes(`<span class="pf-vsel-badge">v1</span>`));
  const data = JSON.parse(/<script type="application\/json" id="pf-versions">([^<]*)<\/script>/.exec(v1)[1]);
  assert.equal(data.head, 2);
  assert.equal(data.current, 1);
  assert.deepEqual(data.versions.map((v) => v.n), [1, 2]);

  for (const q of ["v=9", "v=abc", ""]) {
    const html = renderProjectView(root, "canvases/main/canvas.html", { query: q });
    assert.ok(html.includes(`src="versions/2/pages/`), q);
  }

  assert.equal(renderProjectView(root, `canvases/main/versions/9/pages/${pg.id}/artboards/${a.id}/preview.html`), null);
  assert.equal(renderProjectView(root, "canvases/main/versions/1/canvas.html"), null, "版本不再有单独的页面地址");
  const blob = resolveProjectFile(root, `canvases/main/versions/1/pages/${pg.id}/artboards/${b.id}/assets/p.png`);
  assert.deepEqual(fs.readFileSync(blob), PNG);
  assert.equal(resolveProjectFile(root, `canvases/other/versions/1/pages/${pg.id}/artboards/${b.id}/assets/p.png`), null);
});

test("导出：定过版导最新版本，没定版的改动不带；没定过版导工作副本", async () => {
  const { ws, proj, a } = setup();
  const { buildCanvasExportZip } = await import("../products/canvas/exportCanvas.js");
  const { buildCanvasExportHtml } = await import("../products/canvas/exportCanvasHtml.js");
  const zipHas = (buf, text) => buf.includes(Buffer.from(text));
  // 按源码片段找（单 HTML 里压缩库的 base64 可能碰巧含有 "A2" 这种短串）
  const has = (text, n) => text.includes(`<div>A${n}</div>`);
  assert.ok(has(buildCanvasExportHtml(ws, proj.id).buffer.toString("utf8"), 1), "没定过版导工作副本");
  buildCanvas(ws, proj.id, { note: "首版" }, CTX);
  canvasStore.saveArtboardSource(ws, proj.id, a.id, "function Component(){ return <div>A2</div>; }");
  const html = buildCanvasExportHtml(ws, proj.id).buffer.toString("utf8");
  assert.ok(has(html, 1) && !has(html, 2));
  const zip = buildCanvasExportZip(ws, proj.id).buffer;
  assert.ok(zipHas(zip, "p.png"), "图片从版本里拷出来");
});

test("文档、表格、画布的版本下拉同一个写法：第一行版本说明，第二行版本号 + 时间", () => {
  for (const f of ["doc/docPreview.js", "sheet/sheetPreview.js", "canvas/canvas.js"]) {
    const src = fs.readFileSync(new URL(`../products/${f}`, import.meta.url), "utf8");
    assert.match(src, /'<span class="t">' \+ esc\(v\.note \|\| [A-Z.a-z]+\) \+ '<\/span><span class="s">' \+ sub \+ '<\/span>'/, f);
    assert.ok(src.includes(`var sub = "v" + v.n; var r = rel(v.builtAt); if (r) sub += " · " + r;`), f);
    assert.ok(src.includes(".pf-vsel-item .t{") && src.includes(".pf-vsel-item .s{"), f);
  }
});
