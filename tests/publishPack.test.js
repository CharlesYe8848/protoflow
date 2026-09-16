import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import { buildDoc, createDoc } from "../core/doc.js";
import { buildPublishPack, validateActions } from "../core/publishPack.js";

const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1`, author: "T" };

function writeCaptures(ddir, caps) {
  fs.mkdirSync(path.join(ddir, ".build"), { recursive: true });
  fs.writeFileSync(path.join(ddir, ".build", "captures.json"), JSON.stringify({ captures: caps }));
}

// 只走到 snapshot 阶段——previews/seal 就是要测这一步之后的行为。
async function setupSnapshotted() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-pack-"));
  const proj = store.createProject(ws, "P", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "pg" }, CTX);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "列表页" }, CTX);
  store.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="l">L</div>; }`);
  assert.equal(createDoc(ws, proj.id, { kind: "prd" }, CTX).ok, true);
  const ddir = store.docDir(ws, proj.id, "prd");
  writeCaptures(ddir, [{ id: "cap-list", artboardId: ab.id, title: "列表默认态", annotationIds: [] }]);
  const snap = await buildDoc(ws, proj.id, "prd", "snapshot", {}, CTX);
  assert.equal(snap.ok, true, JSON.stringify(snap));
  return { ws, proj, ab, ddir };
}

test("previews 模式：渲染每个 capture 的自包含预览页", async () => {
  const { ws, proj, ddir } = await setupSnapshotted();
  const r = await buildPublishPack(ws, proj.id, "prd", "previews", CTX);
  assert.equal(r.ok, true);
  const html = fs.readFileSync(path.join(ddir, ".build", "previews", "cap-list.html"), "utf8");
  assert.ok(html.includes("../../../../lib/react.production.min.js"), "预览页引用项目级 lib/，不再按版本各拷一份");
});

test("previews：captures 引用不存在的画板 / 文档尚未 snapshot → 报错", async () => {
  const { ws, proj, ddir } = await setupSnapshotted();
  writeCaptures(ddir, [{ id: "c", artboardId: "ab_ghost", title: "x", annotationIds: [] }]);
  assert.equal((await buildPublishPack(ws, proj.id, "prd", "previews", CTX)).error.code, "CAPTURE_REF_NOT_FOUND");
  assert.equal((await buildPublishPack(ws, proj.id, "nope", "previews", CTX)).error.code, "VERSION_NOT_BUILT");
});

test("seal：图片与清单一一对应才盖章；缺图/多图报错；截图落进 docs/<docId>/assets/", async () => {
  const { ws, proj, ddir } = await setupSnapshotted();
  await buildPublishPack(ws, proj.id, "prd", "previews", CTX);
  const imgDir = path.join(ddir, ".build", "exported-images");
  fs.mkdirSync(imgDir, { recursive: true });
  assert.equal((await buildPublishPack(ws, proj.id, "prd", "seal", CTX)).error.code, "IMAGE_MISSING");
  fs.writeFileSync(path.join(imgDir, "cap-list.png"), "png");
  fs.writeFileSync(path.join(imgDir, "extra.png"), "png");
  assert.equal((await buildPublishPack(ws, proj.id, "prd", "seal", CTX)).error.code, "IMAGE_UNEXPECTED");
  fs.rmSync(path.join(imgDir, "extra.png"));
  const r = await buildPublishPack(ws, proj.id, "prd", "seal", CTX);
  assert.equal(r.ok, true);
  const manifest = JSON.parse(fs.readFileSync(path.join(ddir, ".build", "captures-manifest.json"), "utf8"));
  assert.deepEqual(manifest.images.map((i) => i.file), ["cap-list.png"]);
  assert.ok(fs.existsSync(path.join(ddir, "assets", "cap-list.png")), "seal 后截图应落进 docs/<docId>/assets/");
});

test("validateActions：纯函数校验", () => {
  assert.equal(validateActions([]), null);
  assert.equal(validateActions(undefined), null);
  assert.equal(validateActions([{ type: "click", selector: "#btn" }]), null);
  assert.equal(validateActions([{ type: "hover", selector: "#btn" }]), null);
  assert.equal(validateActions([{ type: "wait", ms: 300 }]), null);
  assert.match(validateActions([{ type: "scroll" }]), /未知的 action type/);
  assert.match(validateActions([{ type: "click" }]), /需要 selector/);
});

test("capture 模式：previews 还没跑过时报 PREVIEW_MISSING，不启动浏览器", async () => {
  const { ws, proj } = await setupSnapshotted();
  const r = await buildPublishPack(ws, proj.id, "prd", "capture", CTX);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "PREVIEW_MISSING");
});

test("capture 模式：action 格式不对时报 CAPTURE_BAD_ACTION，不启动浏览器", async () => {
  const { ws, proj, ab, ddir } = await setupSnapshotted();
  writeCaptures(ddir, [{ id: "cap-list", artboardId: ab.id, title: "x", annotationIds: [], actions: [{ type: "bogus" }] }]);
  const r = await buildPublishPack(ws, proj.id, "prd", "capture", CTX);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CAPTURE_BAD_ACTION");
});

test("capture 模式：无头截图端到端——真的产出 PNG，视口高度按内容实际撑开", { timeout: 30000 }, async () => {
  const { ws, proj, ddir } = await setupSnapshotted();
  await buildPublishPack(ws, proj.id, "prd", "previews", CTX);
  const r = await buildPublishPack(ws, proj.id, "prd", "capture", CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.mode, "capture");
  assert.deepEqual(r.images.map((i) => i.file), ["cap-list.png"]);
  const imgPath = path.join(ddir, ".build", "exported-images", "cap-list.png");
  assert.ok(fs.existsSync(imgPath));
  assert.equal(fs.readFileSync(imgPath).slice(0, 8).toString("hex"), "89504e470d0a1a0a");
});
