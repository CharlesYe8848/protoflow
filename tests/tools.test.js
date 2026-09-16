import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { TOOL_REGISTRY, TOOL_MAP } from "../mcp/tools.js";

// 不碰开发者真实 ~/.protoflow/：本文件里所有会触发 render_preview/render_canvas/build_prd/
// build_publish_pack 的用例都会经过 core/localServer.js 起后台静态文件服务，统一用一个临时
// 状态文件隔离，测试结束把 spawn 出来的后台进程 kill 掉。
process.env.PROTOFLOW_SERVER_STATUS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pf-mcp-srv-")), "server.json");
after(() => {
  try { process.kill(JSON.parse(fs.readFileSync(process.env.PROTOFLOW_SERVER_STATUS, "utf8")).pid); } catch {}
});

const guidesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "guides");
let seq = 0;
function ctx() {
  return { ws: fs.mkdtempSync(path.join(os.tmpdir(), "pf-mcp-")), now: () => 1700000000000 + (++seq), genId: (p) => `${p}_g${++seq}`, guidesDir, author: "T" };
}
const call = (name, args, c) => TOOL_MAP[name].handler(args, c);

test("注册表：22 个工具，名称唯一，均有 description/schema/handler", () => {
  assert.equal(TOOL_REGISTRY.length, 22);
  assert.equal(new Set(TOOL_REGISTRY.map((t) => t.name)).size, 22);
  for (const t of TOOL_REGISTRY) {
    assert.ok(t.description.length > 10, t.name);
    assert.ok(t.schema && typeof t.handler === "function", t.name);
  }
});

test("端到端：建项目→画板→保存→标注→chain 全绿", async () => {
  const c = ctx();
  const proj = await call("create_project", { name: "T" }, c);
  const pg = await call("upsert_page", { projectId: proj.id, name: "pg" }, c);
  const ab = await call("upsert_artboard", { projectId: proj.id, pageId: pg.id, name: "板" }, c);
  const saved = await call("save_artboard_source", { projectId: proj.id, artboardId: ab.id, source: `function Component(){ return <div id="btn">B</div>; }` }, c);
  assert.equal(saved.ok, true);
  const ann = await call("get_annotations", { projectId: proj.id, artboardId: ab.id }, c);
  assert.equal(ann.md, "");
  assert.deepEqual(ann.elementIds, ["btn"]);
  const applied = await call("write_annotations", { projectId: proj.id, artboardId: ab.id, md: "## 说明\n\n点 [按钮](#el/btn)" }, c);
  assert.equal(applied.ok, true);
  const status = await call("chain_status", { projectId: proj.id }, c);
  assert.deepEqual(status.findings, []);
  const gp = await call("get_project", { projectId: proj.id }, c);
  assert.equal(gp.findingCount, 0);
  assert.ok(gp.project.pages[0].artboards[0].sourcePath.endsWith("source.jsx"));
});

test("save_artboard_source：编译失败不落盘；edits 补丁模式；非唯一匹配拒绝；idAudit", async () => {
  const c = ctx();
  const proj = await call("create_project", { name: "T" }, c);
  const pg = await call("upsert_page", { projectId: proj.id, name: "pg" }, c);
  const ab = await call("upsert_artboard", { projectId: proj.id, pageId: pg.id, name: "板" }, c);
  const bad = await call("save_artboard_source", { projectId: proj.id, artboardId: ab.id, source: `function Component(){ return <div` }, c);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "COMPILE_ERROR");
  await call("save_artboard_source", { projectId: proj.id, artboardId: ab.id, source: `function Component(){ return <div id="a">x</div>; }` }, c);
  await call("write_annotations", { projectId: proj.id, artboardId: ab.id, md: "点 [元素A](#el/a) 看看" }, c);
  const patched = await call("save_artboard_source", { projectId: proj.id, artboardId: ab.id, edits: [{ oldText: `id="a"`, newText: `id="b"` }] }, c);
  assert.equal(patched.ok, true);
  assert.deepEqual(patched.idAudit.idsRemoved, ["a"]);
  assert.deepEqual(patched.idAudit.brokenAnnotationRefs, ["a"], "annotations.md 里 [元素A](#el/a) 引用了 a，删掉元素 a 后 idAudit 点名这个断链引用");
  const dup = await call("save_artboard_source", { projectId: proj.id, artboardId: ab.id, edits: [{ oldText: "i", newText: "j" }] }, c);
  assert.equal(dup.ok, false);
  assert.equal(dup.error.code, "EDIT_AMBIGUOUS");
});

test("render_preview / render_canvas：校验入参后返回可用的实时画布 URL，不落盘", async () => {
  const c = ctx();
  const proj = await call("create_project", { name: "员工档案" }, c);

  const noPages = await call("render_canvas", { projectId: proj.id }, c);
  assert.equal(noPages.ok, false);
  assert.equal(noPages.error.code, "NO_PAGES");

  const pgList = await call("upsert_page", { projectId: proj.id, name: "列表" }, c);
  await call("upsert_page", { projectId: proj.id, name: "详情" }, c);
  const ab = await call("upsert_artboard", { projectId: proj.id, pageId: pgList.id, name: "员工列表页", canvasWidth: 1920 }, c);

  const noSrc = await call("render_preview", { projectId: proj.id, artboardId: ab.id }, c);
  assert.equal(noSrc.ok, false);
  assert.equal(noSrc.error.code, "NO_SOURCE");
  await call("save_artboard_source", { projectId: proj.id, artboardId: ab.id, source: `function Component(){ return <div id="x">列表</div>; }` }, c);

  const rp = await call("render_preview", { projectId: proj.id, artboardId: ab.id }, c);
  const rc = await call("render_canvas", { projectId: proj.id }, c);
  assert.equal(rp.ok, true);
  assert.equal(rc.ok, true);
  assert.equal(rc.pageCount, 2);
  // 两个工具都返回整站画布的 http://127.0.0.1 url（render_preview 不给画板级单独地址）
  assert.match(rp.url, /^http:\/\/127\.0\.0\.1:\d+\/p\/[^/]+\/canvas\.html$/);
  assert.equal(rc.url, rp.url);
  // 不再有落盘产物 / 落盘路径字段
  assert.equal("htmlPath" in rp, false);
  assert.equal("canvasPath" in rc, false);
  assert.equal(fs.existsSync(path.join(c.ws, proj.id, "canvas.html")), false);
  assert.equal(fs.existsSync(path.join(c.ws, proj.id, "pages", pgList.id, "artboards", ab.id, "preview.html")), false);

  const html = await (await fetch(rc.url)).text();
  assert.ok(html.includes('src="pages/' + pgList.id + '/artboards/' + ab.id + '/preview.html"'));
  assert.ok(html.includes("width:1920px"), "应使用 upsert_artboard 传入的 canvasWidth");
  assert.ok(html.includes("详情"), "第二个页面应出现在侧边栏里");
});

test("画布 URL 是实时投影：save_artboard_source / apply_annotation_changes / 结构变更 / reorder 之后重新 GET 即最新，无需重渲染，无 *Refreshed 字段", async () => {
  const c = ctx();
  const proj = await call("create_project", { name: "T" }, c);
  const pg = await call("upsert_page", { projectId: proj.id, name: "页一" }, c);
  const a = await call("upsert_artboard", { projectId: proj.id, pageId: pg.id, name: "板A" }, c);
  const b = await call("upsert_artboard", { projectId: proj.id, pageId: pg.id, name: "板B" }, c);
  const saved = await call("save_artboard_source", { projectId: proj.id, artboardId: a.id, source: `function Component(){ return <div id="x">v1</div>; }` }, c);
  assert.equal("previewRefreshed" in saved, false);
  assert.equal("canvasRefreshed" in saved, false);

  const { url } = await call("render_canvas", { projectId: proj.id }, c);
  const get = async () => (await fetch(url)).text();

  // 结构变更：新增页面、首次写源码 —— 重新 GET 即包含
  const pg2 = await call("upsert_page", { projectId: proj.id, name: "页二" }, c);
  const abNew = await call("upsert_artboard", { projectId: proj.id, pageId: pg2.id, name: "新画板" }, c);
  assert.equal("canvasRefreshed" in pg2, false);
  await call("save_artboard_source", { projectId: proj.id, artboardId: abNew.id, source: `function Component(){ return <div id="x">新</div>; }` }, c);
  let html = await get();
  assert.ok(html.includes("页二"));
  assert.ok(html.includes('src="pages/' + pg2.id + '/artboards/' + abNew.id + '/preview.html"'), "首次写源码后占位卡片换成真实画板");

  // 标注：画布左侧标注侧边栏的数据（pf-ann-data）是磁盘 annotations.md 的实时投影
  await call("write_annotations", { projectId: proj.id, artboardId: a.id, md: "## 点我\n\nC：见 [x](#el/x)" }, c);
  html = await get();
  const annData = JSON.parse(html.match(/id="pf-ann-data">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, "<"));
  const flat = Object.values(annData).flat();
  assert.ok(flat.some((ab) => ab.artboardId === a.id && /点我/.test(ab.md)), "新标注即时出现在画布标注数据里，无需重渲染");

  // reorder：非法顺序报错；合法顺序后重新 GET 即新序
  assert.throws(() => call("reorder_artboards", { projectId: proj.id, pageId: pg.id, artboardIds: [a.id] }, c), /全排列/);
  await call("reorder_artboards", { projectId: proj.id, pageId: pg.id, artboardIds: [b.id, a.id] }, c);
  html = await get();
  assert.ok(html.indexOf(`data-artboard="${b.id}"`) < html.indexOf(`data-artboard="${a.id}"`), "b 排在 a 前面");

  // delete：重新 GET 即移除
  await call("delete", { projectId: proj.id, targetId: b.id }, c);
  html = await get();
  assert.ok(!html.includes(`data-artboard="${b.id}"`));

  // 全程不产生落盘 canvas.html
  assert.equal(fs.existsSync(path.join(c.ws, proj.id, "canvas.html")), false);
});


// 端到端跑一遍新链路，供下面三个用例复用：建项目/画板 → create_doc → captures → build_doc snapshot
// → publish_pack previews/seal → 写 doc.md → build_doc finalize。返回 { c, proj, ab }。
async function fullDoc(c, { md, docId = "prd", kind = "prd" } = {}) {
  const proj = await call("create_project", { name: "T" }, c);
  const pg = await call("upsert_page", { projectId: proj.id, name: "pg" }, c);
  const ab = await call("upsert_artboard", { projectId: proj.id, pageId: pg.id, name: "板" }, c);
  await call("save_artboard_source", { projectId: proj.id, artboardId: ab.id, source: `function Component(){ return <div id="a">x</div>; }` }, c);
  await call("create_doc", { projectId: proj.id, kind, docId }, c);
  const bdir = path.join(c.ws, proj.id, "docs", docId, ".build");
  fs.mkdirSync(bdir, { recursive: true });
  fs.writeFileSync(path.join(bdir, "captures.json"), JSON.stringify({ captures: [{ id: "cap-a", artboardId: ab.id, title: "A", annotationIds: [] }] }));
  await call("build_doc", { projectId: proj.id, docId, mode: "snapshot" }, c);
  await call("build_publish_pack", { projectId: proj.id, docId, mode: "previews" }, c);
  fs.writeFileSync(path.join(bdir, "exported-images", "cap-a.png"), "png");
  await call("build_publish_pack", { projectId: proj.id, docId, mode: "seal" }, c);
  fs.writeFileSync(path.join(c.ws, proj.id, "docs", docId, "doc.md"), md);
  const built = await call("build_doc", { projectId: proj.id, docId, mode: "finalize", note: "首版" }, c);
  return { c, proj, ab, built };
}

test("record_publish 后 chain_status 报 lagging；get_guide 正常与未知主题", async () => {
  const c = ctx();
  const { proj, ab, built } = await fullDoc(c, { md: "# t\n\n![截图](assets/cap-a.png)\n" });
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.match(built.url, /^http:\/\/127\.0\.0\.1:\d+\/p\/[^/]+\//);
  assert.equal((await fetch(built.url)).status, 200);
  const rec = await call("record_publish", { projectId: proj.id, docId: "prd", channel: "dingtalk", channelDocId: "d1", url: "u" }, c);
  assert.equal(rec.ok, true, JSON.stringify(rec));
  await call("save_artboard_source", { projectId: proj.id, artboardId: ab.id, source: `function Component(){ return <div id="a">改</div>; }` }, c);
  const status = await call("chain_status", { projectId: proj.id }, c);
  assert.ok(status.findings.some((f) => f.code === "publish_lagging"));
  assert.ok(status.findings.some((f) => f.code === "doc_drifted"));
  const guide = await call("get_guide", { topic: "workflow" }, c);
  assert.ok(guide.content.includes("chain_status"));
  const badTopic = await call("get_guide", { topic: "nope" }, c);
  assert.equal(badTopic.ok, false);
  assert.ok(badTopic.error.message.includes("workflow"));
});

test("record_publish：doc.md 有未确认的开放问题标记时默认拦截，acknowledgeFindings:true 可跳过", async () => {
  const c = ctx();
  const { proj, built } = await fullDoc(c, { md: "# t\n\n![截图](assets/cap-a.png)\n\n某边界情况 **需要与研发确认**。\n" });
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.ok(built.findings.some((f) => f.code === "OPEN_QUESTION" && f.level === "error"), "finalize 结果里提前带出开放问题");

  const blocked = await call("record_publish", { projectId: proj.id, docId: "prd", channel: "dingtalk", channelDocId: "d1" }, c);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "CHECKS_FAILED");
  assert.ok(blocked.error.message.includes("需要与研发确认"));

  const acked = await call("record_publish", { projectId: proj.id, docId: "prd", channel: "dingtalk", channelDocId: "d1", acknowledgeFindings: true }, c);
  assert.equal(acked.ok, true, JSON.stringify(acked));
});

test("get_doc_kind：返回模板 + 撰写规范 + 元数据；未知类型列出可用类型", async () => {
  const c = ctx();
  const proj = await call("create_project", { name: "T" }, c);
  const k = await call("get_doc_kind", { projectId: proj.id, kind: "prd" }, c);
  assert.equal(k.label, "PRD");
  assert.equal(k.contextSource, "canvas");
  assert.ok(k.template.includes("<!-- protoflow:changelog -->"));
  assert.ok(k.writing.length > 10);
  const bad = await call("get_doc_kind", { projectId: proj.id, kind: "nope" }, c);
  assert.equal(bad.ok, false);
  assert.ok(bad.error.message.includes("prd"));
});

test("build_publish_pack previews 模式：每个 capture 除 htmlPath 外也带 http://127.0.0.1 的 url", async () => {
  const c = ctx();
  const proj = await call("create_project", { name: "T" }, c);
  const pg = await call("upsert_page", { projectId: proj.id, name: "pg" }, c);
  const ab = await call("upsert_artboard", { projectId: proj.id, pageId: pg.id, name: "板" }, c);
  await call("save_artboard_source", { projectId: proj.id, artboardId: ab.id, source: `function Component(){ return <div id="a">x</div>; }` }, c);
  await call("create_doc", { projectId: proj.id, kind: "prd" }, c);
  const bdir = path.join(c.ws, proj.id, "docs", "prd", ".build");
  fs.mkdirSync(bdir, { recursive: true });
  fs.writeFileSync(path.join(bdir, "captures.json"), JSON.stringify({ captures: [{ id: "cap-a", artboardId: ab.id, title: "A", annotationIds: [] }] }));
  await call("build_doc", { projectId: proj.id, docId: "prd", mode: "snapshot" }, c);

  const r = await call("build_publish_pack", { projectId: proj.id, docId: "prd", mode: "previews" }, c);
  assert.equal(r.ok, true);
  assert.equal(r.previews.length, 1);
  assert.match(r.previews[0].url, /^http:\/\/127\.0\.0\.1:\d+\/p\/[^/]+\//);
  assert.ok(!r.previews[0].url.includes("ann=1"), "截图是画板状态的干净图，不再往上叠标注编号");
  assert.equal((await fetch(r.previews[0].url)).status, 200);
});

test("export_canvas：写到 outDir 下，文件名 = 项目名 + .zip，内容是真实合法的 zip", async () => {
  const c = ctx();
  const proj = await call("create_project", { name: "招聘" }, c);
  const pg = await call("upsert_page", { projectId: proj.id, name: "pg" }, c);
  const ab = await call("upsert_artboard", { projectId: proj.id, pageId: pg.id, name: "板" }, c);
  await call("save_artboard_source", { projectId: proj.id, artboardId: ab.id, source: `function Component(){ return <div id="a">x</div>; }` }, c);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-mcp-export-"));
  const r = await call("export_canvas", { projectId: proj.id, outDir }, c);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.path, path.join(outDir, "招聘.zip"));
  assert.ok(fs.existsSync(r.path) && fs.statSync(r.path).size === r.bytes);
  assert.equal(fs.existsSync(path.join(c.ws, proj.id, ".export")), false, "不在项目目录留痕迹");
});

test("export_doc：写到 outDir 下，文件名 = 文档标题 + .zip；无版本时报 DOC_NOT_BUILT", async () => {
  const c = ctx();
  const { proj } = await fullDoc(c, { md: "# t\n\n![截图](assets/cap-a.png)\n" });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-mcp-export-"));
  const r = await call("export_doc", { projectId: proj.id, docId: "prd", outDir }, c);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.path, path.join(outDir, "t.zip"));
  assert.ok(fs.existsSync(r.path) && fs.statSync(r.path).size === r.bytes);

  const proj2 = await call("create_project", { name: "T2" }, c);
  await call("create_doc", { projectId: proj2.id, kind: "prd" }, c);
  const noVersion = await call("export_doc", { projectId: proj2.id, docId: "prd", outDir }, c);
  assert.equal(noVersion.ok, false);
  assert.equal(noVersion.error.code, "DOC_NOT_BUILT");
});
