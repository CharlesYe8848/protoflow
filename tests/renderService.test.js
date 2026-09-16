import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import { renderProjectView } from "../core/renderService.js";
import { createStaticHandler } from "../core/localServer.js";

const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1700000000000` };
function tmpWs() { return fs.mkdtempSync(path.join(os.tmpdir(), "pf-rs-")); }

// ws（父目录）+ projectId（文件夹名）→ 绝对项目根目录，就是 localServer 注册表里存的那个 root。
function scaffold() {
  const ws = tmpWs();
  const proj = store.createProject(ws, "结账流程", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "主流程" }, CTX);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "结账页" }, CTX);
  store.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="x">v1</div>; }`);
  return { ws, projectId: proj.id, root: path.join(ws, proj.id), pgId: pg.id, abId: ab.id };
}

test("renderProjectView：canvas.html / 画板 preview.html 实时渲染，其余路径返回 null 交回静态通道", () => {
  const { root, pgId, abId } = scaffold();

  const canvas = renderProjectView(root, "canvas.html");
  assert.match(canvas, /结账流程 · protoflow 画布/);
  assert.match(canvas, new RegExp(`data-artboard="${abId}"`));

  const preview = renderProjectView(root, `pages/${pgId}/artboards/${abId}/preview.html`);
  assert.match(preview, /v1/);
  assert.match(preview, /babel/);

  assert.equal(renderProjectView(root, `pages/${pgId}/artboards/${abId}/source.jsx`), null);
  assert.equal(renderProjectView(root, "lib/react.production.min.js"), null);
  assert.equal(renderProjectView(root, "docs/prd/preview.html"), null, "doc 阅读页是冻结版本产物，不是源文件投影，不拦");
});

test("核心：直接改磁盘上的 source.jsx（模拟通用 agent / 编辑器 Undo / git checkout），不调任何 render 工具，实时渲染立刻反映最新", () => {
  const { root, pgId, abId } = scaffold();
  const rel = `pages/${pgId}/artboards/${abId}/preview.html`;
  assert.match(renderProjectView(root, rel), /v1/);

  // 绕开 saveArtboardSource / render_preview，像 git checkout 一样直接覆盖源文件
  const srcPath = path.join(root, "pages", pgId, "artboards", abId, "source.jsx");
  fs.writeFileSync(srcPath, `function Component(){ return <div id="x">v2-reverted</div>; }`);

  const after = renderProjectView(root, rel);
  assert.match(after, /v2-reverted/);
  assert.doesNotMatch(after, /v1/);
});

test("核心：直接删掉磁盘上的画板目录后，canvas.html 实时渲染不再包含它——不需要重跑 render_canvas", () => {
  const { ws, projectId, root } = scaffold();
  const pg2 = store.upsertPage(ws, projectId, { name: "次流程" }, CTX);
  const ab2 = store.upsertArtboard(ws, projectId, pg2.id, { name: "临时画板" }, CTX).id;
  assert.match(renderProjectView(root, "canvas.html"), new RegExp(`data-artboard="${ab2}"`));

  // 直接改 page.json 摘掉画板引用（模拟外部编辑），不走 delete 工具
  const pgJson = path.join(root, "pages", pg2.id, "page.json");
  const pj = JSON.parse(fs.readFileSync(pgJson, "utf8"));
  pj.artboardIds = pj.artboardIds.filter((x) => x !== ab2);
  fs.writeFileSync(pgJson, JSON.stringify(pj, null, 2));

  assert.doesNotMatch(renderProjectView(root, "canvas.html"), new RegExp(`data-artboard="${ab2}"`));
});

test("经 createStaticHandler 走一遍 HTTP：磁盘上有一份过期的 canvas.html 也会被实时渲染绕过", async () => {
  const { root, projectId } = scaffold();
  const secret = "rs-secret";

  // 落一份明显过期/错误的 canvas.html
  fs.writeFileSync(path.join(root, "canvas.html"), "<html>STALE SNAPSHOT</html>");

  const server = http.createServer(createStaticHandler(secret, renderProjectView));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const token = (await import("node:crypto")).createHmac("sha256", secret).update("register:" + root).digest("hex");
  await fetch(`http://127.0.0.1:${port}/__protoflow_register?token=${token}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, dir: root }),
  });

  const res = await fetch(`http://127.0.0.1:${port}/p/${encodeURIComponent(projectId)}/canvas.html`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  const body = await res.text();
  assert.doesNotMatch(body, /STALE SNAPSHOT/);
  assert.match(body, /结账流程 · protoflow 画布/);

  server.close();
  server.closeAllConnections();
});

test("经 createStaticHandler 走一遍 HTTP：渲染抛错（画板不存在）时如实回 500，不静默退回静态文件", async () => {
  const { root, projectId, pgId } = scaffold();
  const secret = "rs-secret-2";

  const server = http.createServer(createStaticHandler(secret, renderProjectView));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const token = (await import("node:crypto")).createHmac("sha256", secret).update("register:" + root).digest("hex");
  await fetch(`http://127.0.0.1:${port}/__protoflow_register?token=${token}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, dir: root }),
  });

  const res = await fetch(`http://127.0.0.1:${port}/p/${encodeURIComponent(projectId)}/pages/${pgId}/artboards/ab_nope/preview.html`);
  assert.equal(res.status, 500);
  assert.match(await res.text(), /渲染失败/);

  server.close();
  server.closeAllConnections();
});
