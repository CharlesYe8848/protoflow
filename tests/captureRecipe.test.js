// 产品研发配方的截图脚本（skills/protoflow-product-dev/scripts/capture.mjs）。端到端：真的起本地服务、
// 真的开无头浏览器截图——这也是它依赖的公开约定（CLI 输出、已定版画板的预览地址、预览页的
// protoflow-artboard meta、元素 id）的防失效测试：画布那边改坏了这些，这里直接失败。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { imageSize } from "image-size";
import * as store from "../core/store.js";
import * as canvasStore from "../products/canvas/store.js";
import { artboardPreviewHtml } from "../products/canvas/store.js";
import * as docStore from "../products/doc/store.js";
import { buildCanvas } from "../products/canvas/canvasVersion.js";
import { createDoc, buildDoc } from "../products/doc/doc.js";
import { run, parseArgs, validateCaptures } from "../skills/protoflow-product-dev/scripts/capture.mjs";
import { tpl } from "./helpers/productDevTemplate.js";

// 脚本通过 CLI 拉起的本地服务用一个临时状态文件隔离，测试结束 kill 掉。
process.env.PROTOFLOW_SERVER_STATUS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pf-cap-srv-")), "server.json");
after(() => {
  try { process.kill(JSON.parse(fs.readFileSync(process.env.PROTOFLOW_SERVER_STATUS, "utf8")).pid); } catch {}
});

const CTX = { now: () => 1700000000000, author: "T" };
const SRC = `function Component(){
  const [open, setOpen] = React.useState(false);
  return <div style={{ padding: 20 }}>
    <button id="toggle" onClick={() => setOpen(true)}>展开</button>
    {open && <div id="panel" style={{ height: 600, background: "#eef" }}>面板</div>}
  </div>;
}`;

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-cap-"));
  const proj = store.createProject(ws, "截图", CTX);
  const pg = canvasStore.upsertPage(ws, proj.id, { name: "首页" }, CTX);
  const ab = canvasStore.upsertArtboard(ws, proj.id, pg.id, { name: "列表", canvasWidth: 800 }, CTX);
  canvasStore.saveArtboardSource(ws, proj.id, ab.id, SRC);
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  const projectDir = store.projectDir(ws, proj.id);
  const capturesPath = path.join(docStore.docDir(ws, proj.id, "prd"), "captures.json");
  const writeCaptures = (captures) => fs.writeFileSync(capturesPath, JSON.stringify({ captures }));
  return { ws, pid: proj.id, ab: ab.id, projectDir, writeCaptures };
}

test("parseArgs / validateCaptures：<项目> <docId> 的缺省路径；id、画板、标记、操作都校验", () => {
  const o = parseArgs(["/p", "prd"]);
  assert.equal(o.captures, path.resolve("/p/docs/prd/captures.json"));
  assert.equal(o.out, path.resolve("/p/docs/prd/assets"));
  assert.throws(() => parseArgs([]), /用法/);
  assert.throws(() => parseArgs(["/p"]), /缺少/);
  const ok = { id: "cap-a", artboardId: "ab_1" };
  assert.doesNotThrow(() => validateCaptures([ok]));
  for (const bad of [[], [{ ...ok, id: "Bad" }], [ok, ok], [{ id: "cap-b" }],
    [{ ...ok, markers: [{ elementId: "x", number: 0, label: "a" }] }], [{ ...ok, actions: [{ type: "drag" }] }]]) {
    assert.throws(() => validateCaptures(bad), undefined, JSON.stringify(bad));
  }
});

test("画板预览页声明 protoflow-artboard（截图脚本按它设视口宽度）", () => {
  const { ws, pid, ab } = setup();
  const html = artboardPreviewHtml(ws, pid, ab);
  const m = /<meta name="protoflow-artboard" content="([^"]*)"/.exec(html);
  assert.ok(m);
  assert.deepEqual(JSON.parse(m[1].replace(/&quot;/g, '"')), { id: ab, canvasWidth: 800, canvasHeight: null });
});

test("只截已定版的画布：没定过版、有没定版的改动都拒绝", async () => {
  const { ab, projectDir, writeCaptures, ws, pid } = setup();
  writeCaptures([{ id: "cap-a", artboardId: ab }]);
  await assert.rejects(run([projectDir, "prd"]), (e) => e.code === "CANVAS_NOT_BUILT");
  buildCanvas(ws, pid, { note: "v1" }, CTX);
  canvasStore.saveArtboardSource(ws, pid, ab, SRC.replace("展开", "打开"));
  await assert.rejects(run([projectDir, "prd"]), (e) => e.code === "CANVAS_DIRTY");
  writeCaptures([{ id: "cap-a", artboardId: "ab_ghost" }]);
  buildCanvas(ws, pid, { note: "v2" }, CTX);
  await assert.rejects(run([projectDir, "prd"]), (e) => e.code === "CAPTURE_REF_NOT_FOUND");
});

test("--urls：只给地址、操作和要写的出处文件，不截图", async () => {
  const { ws, pid, ab, projectDir, writeCaptures } = setup();
  buildCanvas(ws, pid, { note: "v1" }, CTX);
  writeCaptures([{ id: "cap-a", artboardId: ab, actions: [{ type: "click", selector: "#toggle" }] }]);
  const r = await run([projectDir, "prd", "--urls"]);
  assert.equal(r.mode, "urls");
  assert.match(r.captures[0].url, new RegExp(`/canvases/main/versions/1/pages/[^/]+/artboards/${ab}/preview\\.html$`));
  assert.deepEqual(r.captures[0].sourceFile.content, { ref: `canvas:main@1#${ab}` });
  assert.ok(!fs.existsSync(path.join(docStore.docDir(ws, pid, "prd"), "assets", "cap-a.png")));
  assert.equal((await fetch(r.captures[0].url)).status, 200, "地址能直接打开（手动截图用）");
});

test("端到端：按操作切到目标状态、按画板宽度和内容高度截图、画标记、写出处；文档定版时自动成为引用", async () => {
  const { ws, pid, ab, projectDir, writeCaptures } = setup();
  buildCanvas(ws, pid, { note: "v1" }, CTX);
  writeCaptures([
    { id: "cap-default", artboardId: ab },
    { id: "cap-open", artboardId: ab, actions: [{ type: "click", selector: "#toggle", ms: 100 }],
      markers: [{ elementId: "panel", number: 1, label: "面板" }] },
  ]);
  const r = await run([projectDir, "prd"]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.canvasVersion, 1);
  const assets = path.join(docStore.docDir(ws, pid, "prd"), "assets");
  const def = imageSize(fs.readFileSync(path.join(assets, "cap-default.png")));
  const open = imageSize(fs.readFileSync(path.join(assets, "cap-open.png")));
  assert.equal(def.width, 1600, "视口宽度 = 画板宽度 800 × 2 倍");
  assert.ok(open.height > def.height + 1000, `展开后内容更高（${def.height} → ${open.height}）`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(assets, "cap-open.png.source.json"), "utf8")), { ref: `canvas:main@1#${ab}` });
  assert.ok(!fs.readdirSync(path.dirname(assets)).some((f) => f.startsWith(".capture-")), "临时目录已清理");

  fs.writeFileSync(path.join(docStore.docDir(ws, pid, "prd"), "doc.md"), "# PRD\n\n![默认](assets/cap-default.png)\n\n![展开](assets/cap-open.png)\n");
  const built = await buildDoc(ws, pid, "prd", "finalize", { note: "首版" }, CTX);
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.deepEqual(docStore.readDocJson(ws, pid, "prd").versions[0].sources, [{ ref: `canvas:main@1#${ab}`, via: "asset" }]);
});
