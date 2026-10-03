import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { createHmac } from "node:crypto";
import { createStaticHandler } from "../core/localServer.js";
import { createLiveReload, injectLiveClient, pageEtag, liveClient, liveReloadEnabled } from "../core/liveReload.js";

// ---------------------------------------------------------------------------------------------
// 服务端：注入、ETag、HTTP 路由
// ---------------------------------------------------------------------------------------------

test("injectLiveClient：脚本插到 <head> 开头并带上 hash；没有 <head> 的不是完整页面，原样返回", () => {
  const etag = pageEtag("x");
  const out = injectLiveClient('<!DOCTYPE html><html><head lang="zh"><title>t</title></head><body></body></html>', etag);
  assert.match(out, /<head lang="zh"><script>\(function liveClient\(cfg, win\)/);
  assert.ok(out.includes(JSON.stringify({ hash: etag })));
  assert.ok(out.indexOf("<script>") < out.indexOf("<title>"), "要在任何 iframe 之前执行");
  assert.ok(!/<\/script>[\s\S]*<\/script>[\s\S]*<title>/.test(out), "脚本本身不能提前闭合 <script>");
  assert.equal(injectLiveClient("dynamic", etag), "dynamic");
});

test("pageEtag：同样内容同样结果，内容不同结果不同，带引号（HTTP ETag 格式）", () => {
  assert.equal(pageEtag("<p>a</p>"), pageEtag("<p>a</p>"));
  assert.notEqual(pageEtag("<p>a</p>"), pageEtag("<p>b</p>"));
  assert.match(pageEtag("a"), /^"[0-9a-f]{16}"$/);
});

test("liveReloadEnabled：只有 PROTOFLOW_LIVE=0 时关闭", () => {
  assert.equal(liveReloadEnabled({}), true);
  assert.equal(liveReloadEnabled({ PROTOFLOW_LIVE: "1" }), true);
  assert.equal(liveReloadEnabled({ PROTOFLOW_LIVE: "0" }), false);
});

const sign = (secret, target) => createHmac("sha256", secret).update(target).digest("hex");
function listen(handler) {
  return new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => resolve(s)); });
}
async function register(port, secret, projectId, dir) {
  const token = sign(secret, "register:" + path.resolve(dir));
  const res = await fetch(`http://127.0.0.1:${port}/__protoflow_register?token=${token}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, dir }),
  });
  return (await res.json()).key;
}
function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-live-"));
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ name: "live" }));
  fs.writeFileSync(path.join(dir, "content.txt"), "v1");
  return dir;
}
// 页面内容 = content.txt；界面偏好写进 HTML（模拟项目侧边栏的展开状态）；本地派生状态
// .protoflow/state.json 也写进 HTML（模拟画布的画板实测高度），localState: false 时不读；
// content 是 BROKEN 时渲染抛错。
const renderFromFile = (root, relPath, opts = {}) => {
  if (relPath !== "page.html") return null;
  const content = fs.readFileSync(path.join(root, "content.txt"), "utf8");
  if (content === "BROKEN") throw new Error("编译不过");
  const statePath = path.join(root, ".protoflow", "state.json");
  const state = opts.localState !== false && fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8") : "";
  return `<!DOCTYPE html><html><head><title>p</title></head><body data-ui='${JSON.stringify(opts.ui || {})}' data-state='${state}'>${content}</body></html>`;
};
async function withServer(t, projectsPath) {
  const server = await listen(createStaticHandler("live-secret", renderFromFile, projectsPath));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const { port } = server.address();
  const dir = mkProject();
  const key = await register(port, "live-secret", "live", dir);
  return { port, dir, url: (p) => `http://127.0.0.1:${port}/p/${encodeURIComponent(key)}/${p}` };
}

test("动态页面：GET 带 ETag 头并注入同一个 hash；HEAD 拿到同样的 ETag；源文件变了 ETag 跟着变；渲染失败回 500", async (t) => {
  const { dir, url } = await withServer(t);
  const get = await fetch(url("page.html"));
  const etag = get.headers.get("etag");
  assert.match(etag, /^"[0-9a-f]{16}"$/);
  assert.ok((await get.text()).includes(JSON.stringify({ hash: etag })));
  const head = await fetch(url("page.html"), { method: "HEAD" });
  assert.equal(head.headers.get("etag"), etag);

  fs.writeFileSync(path.join(dir, "content.txt"), "v2");
  assert.notEqual((await fetch(url("page.html"), { method: "HEAD" })).headers.get("etag"), etag);

  fs.writeFileSync(path.join(dir, "content.txt"), "BROKEN");
  assert.equal((await fetch(url("page.html"), { method: "HEAD" })).status, 500);
});

test("界面偏好不进 ETag：切过侧边栏之后，页面 HTML 里的偏好变了，ETag 不变", async (t) => {
  const projectsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pf-live-ui-")), "projects.json");
  const { port, url } = await withServer(t, projectsPath);
  const before = (await fetch(url("page.html"))).headers.get("etag");
  await fetch(`http://127.0.0.1:${port}/__protoflow_ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectNavOpen: true }) });
  const get = await fetch(url("page.html"));
  assert.ok((await get.text()).includes('"projectNavOpen":true'), "返回的页面照常带偏好");
  assert.equal(get.headers.get("etag"), before);
  assert.equal((await fetch(url("page.html"), { method: "HEAD" })).headers.get("etag"), before);
});

test("本地派生状态不进 ETag：页面自己写回 .protoflow/ 之后，返回的页面照常带上它，ETag 不变", async (t) => {
  const { dir, url } = await withServer(t);
  const before = (await fetch(url("page.html"))).headers.get("etag");
  fs.mkdirSync(path.join(dir, ".protoflow"));
  fs.writeFileSync(path.join(dir, ".protoflow", "state.json"), "h=480");
  const get = await fetch(url("page.html"));
  assert.ok((await get.text()).includes("data-state='h=480'"));
  assert.equal(get.headers.get("etag"), before);
  assert.equal((await fetch(url("page.html"), { method: "HEAD" })).headers.get("etag"), before);
});

test("PROTOFLOW_LIVE=0：不注入脚本、不带 ETag、没有 __protoflow_live 路由", async (t) => {
  const prev = process.env.PROTOFLOW_LIVE;
  process.env.PROTOFLOW_LIVE = "0";
  let ctx;
  try { ctx = await withServer(t); } finally { if (prev === undefined) delete process.env.PROTOFLOW_LIVE; else process.env.PROTOFLOW_LIVE = prev; }
  const get = await fetch(ctx.url("page.html"));
  assert.equal(get.headers.get("etag"), null);
  assert.ok(!(await get.text()).includes("liveClient"));
  assert.notEqual((await fetch(ctx.url("__protoflow_live"))).status, 200);
});

// 读 SSE 流，直到出现 predicate 满足的内容或超时。
function openEvents(u) {
  const chunks = [];
  const waiters = [];
  const req = http.get(u, (res) => {
    res.setEncoding("utf8");
    res.on("data", (c) => { chunks.push(c); waiters.slice().forEach((w) => w()); });
  });
  req.on("error", () => {});
  return {
    text: () => chunks.join(""),
    until(pred, ms) {
      return new Promise((resolve) => {
        const done = (ok) => { clearTimeout(timer); waiters.splice(waiters.indexOf(check), 1); resolve(ok); };
        const check = () => { if (pred(chunks.join(""))) done(true); };
        const timer = setTimeout(() => done(false), ms);
        waiters.push(check);
        check();
      });
    },
    close: () => req.destroy(),
  };
}

test("SSE（真实文件监听）：连上先收到 retry；改项目里的文件推 change", async (t) => {
  const { dir, url } = await withServer(t);
  const ev = openEvents(url("__protoflow_live"));
  t.after(() => ev.close());
  assert.ok(await ev.until((s) => s.includes("retry: 1000"), 2000), "连接建立");
  fs.writeFileSync(path.join(dir, "content.txt"), "v2");
  assert.ok(await ev.until((s) => s.includes("event: change"), 5000), "改文件后推 change");
});

// ---------------------------------------------------------------------------------------------
// 服务端：监听器生命周期（假的 fs.watch 和计时器）
// ---------------------------------------------------------------------------------------------

function fakeEnv() {
  const watchers = [];
  const timeouts = new Map();
  let seq = 0;
  const timers = {
    setTimeout: (fn, ms) => { const id = ++seq; timeouts.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { timeouts.delete(id); },
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {},
  };
  const watch = (root, opts, cb) => {
    const w = new EventEmitter();
    w.root = root; w.opts = opts; w.cb = cb; w.closed = false;
    w.close = () => { w.closed = true; };
    watchers.push(w);
    return w;
  };
  const runTimers = () => { const all = [...timeouts.entries()]; timeouts.clear(); all.forEach(([, t]) => t.fn()); };
  return { watchers, timers, watch, runTimers, pending: () => timeouts.size };
}
function fakeConn() {
  const req = new EventEmitter();
  const res = { out: "", writeHead() {}, write(s) { this.out += s; } };
  return { req, res, changes: () => (res.out.match(/event: change/g) || []).length };
}

test("监听器：第一个连接才开始监听（recursive），最后一个连接断开就关；同一项目共用一个监听器", () => {
  const env = fakeEnv();
  const live = createLiveReload({ watch: env.watch, timers: env.timers, statIno: () => 1, logFile: null });
  const a = fakeConn(), b = fakeConn();
  live.handleEvents(a.req, a.res, "/proj");
  live.handleEvents(b.req, b.res, "/proj");
  assert.equal(env.watchers.length, 1);
  assert.deepEqual(env.watchers[0].opts, { recursive: true });
  a.req.emit("close");
  assert.equal(env.watchers[0].closed, false, "还有连接，不关");
  b.req.emit("close");
  assert.equal(env.watchers[0].closed, true);
  assert.equal(live.watching, 0);
});

test("监听器：300ms 内的多次变化合并成一次推送；.git / node_modules / .protoflow 下的变化不推", () => {
  const env = fakeEnv();
  const live = createLiveReload({ watch: env.watch, timers: env.timers, statIno: () => 1, logFile: null });
  const c = fakeConn();
  live.handleEvents(c.req, c.res, "/proj");
  const w = env.watchers[0];
  w.cb("change", "canvases/main/pages/pg_1/artboards/ab_1/source.jsx");
  w.cb("change", "canvases/main/canvas.json");
  w.cb("rename", "docs/prd/doc.md");
  env.runTimers();
  assert.equal(c.changes(), 1);
  for (const f of [".protoflow/canvas.json", ".git/index", "node_modules/x/y.js", "sub/.DS_Store"]) w.cb("change", f);
  assert.equal(env.pending(), 0, "被忽略的路径不排队");
  env.runTimers();
  assert.equal(c.changes(), 1);
});

test("监听器出错：关掉旧的、稍后重建，并让所有页面检查一次（重建期间的改动可能没有事件）", () => {
  const env = fakeEnv();
  const live = createLiveReload({ watch: env.watch, timers: env.timers, statIno: () => 1, logFile: null });
  const c = fakeConn();
  live.handleEvents(c.req, c.res, "/proj");
  env.watchers[0].emit("error", new Error("boom"));
  assert.equal(env.watchers[0].closed, true);
  env.runTimers();
  assert.equal(env.watchers.length, 2, "重建");
  assert.equal(c.changes(), 1, "重建后广播一次");
});

// ---------------------------------------------------------------------------------------------
// 页面端：liveClient（假的 window）
// ---------------------------------------------------------------------------------------------

function fakeWindow({ pathname = "/p/proj/page.html", hidden = false, parent = null } = {}) {
  const listeners = {};
  const docListeners = {};
  const storage = new Map();
  const fetches = [];
  const sources = [];
  const body = { children: [], appendChild(el) { this.children.push(el); el.remove = () => { body.children.splice(body.children.indexOf(el), 1); }; } };
  const w = {
    reloads: 0, fetches, sources, body,
    location: { pathname, search: "", href: "http://127.0.0.1:1" + pathname, reload() { w.reloads++; } },
    document: {
      hidden, body,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({ setAttribute() {}, remove() {} }),
      addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); },
    },
    sessionStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    setTimeout: () => 0,
    scrollTo() {}, scrollX: 0, scrollY: 0,
    fetch: (u, opts) => new Promise((resolve, reject) => { fetches.push({ u, opts, resolve, reject }); }),
    EventSource: class { constructor(u) { this.u = u; this.handlers = {}; sources.push(this); } addEventListener(t, fn) { this.handlers[t] = fn; } },
    emit: (t) => (listeners[t] || []).forEach((fn) => fn()),
    emitDoc: (t) => (docListeners[t] || []).forEach((fn) => fn()),
  };
  w.parent = parent || w;
  return w;
}
const ok = (etag) => ({ ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === "etag" ? etag : null) } });
const status = (code) => ({ ok: false, status: code, headers: { get: () => null } });
const flush = () => new Promise((r) => setImmediate(r));

test("liveClient 顶层页面：开一条 SSE；第一次连上只查自己；ETag 相同不动，不同就 reload（此后不再检查）", async () => {
  const w = fakeWindow();
  liveClient({ hash: '"h1"' }, w);
  assert.equal(w.sources.length, 1);
  assert.equal(w.sources[0].u, "/p/proj/__protoflow_live");
  w.sources[0].onopen();
  assert.equal(w.fetches.length, 1);
  assert.deepEqual(w.fetches[0].opts, { method: "HEAD", cache: "no-store" });
  w.fetches[0].resolve(ok('"h1"'));
  await flush();
  assert.equal(w.reloads, 0);

  w.sources[0].handlers.change();
  w.fetches[1].resolve(ok('"h2"'));
  await flush();
  assert.equal(w.reloads, 1);
  w.sources[0].handlers.change();
  assert.equal(w.fetches.length, 2, "决定 reload 之后所有检查作废");
});

test("liveClient 单飞 + dirty：检查中又来变化只记标记，结束后再查一次；不会多发", async () => {
  const w = fakeWindow();
  liveClient({ hash: '"h1"' }, w);
  const change = w.sources[0].handlers.change;
  change(); change(); change();
  assert.equal(w.fetches.length, 1, "同一时间只有一个检查");
  w.fetches[0].resolve(ok('"h1"'));
  await flush();
  assert.equal(w.fetches.length, 2, "dirty → 再查一次");
  w.fetches[1].resolve(ok('"h1"'));
  await flush();
  assert.equal(w.fetches.length, 2, "没有新变化就停");
});

test("liveClient 网络错误：清掉 dirty、不重试（避免服务挂掉时的死循环）；下一次触发照常检查", async () => {
  const w = fakeWindow();
  liveClient({ hash: '"h1"' }, w);
  const change = w.sources[0].handlers.change;
  change(); change();
  w.fetches[0].reject(new TypeError("Failed to fetch"));
  await flush();
  assert.equal(w.fetches.length, 1, "不重试");
  w.sources[0].onopen(); w.sources[0].onopen(); // 重连
  assert.equal(w.fetches.length, 2);
});

test("liveClient 渲染失败（5xx）：不刷新、显示提示；之后检查成功就收起提示", async () => {
  const w = fakeWindow();
  liveClient({ hash: '"h1"' }, w);
  w.sources[0].handlers.change();
  w.fetches[0].resolve(status(500));
  await flush();
  assert.equal(w.reloads, 0);
  assert.equal(w.body.children.length, 1);
  w.sources[0].handlers.change();
  w.fetches[1].resolve(ok('"h1"'));
  await flush();
  assert.equal(w.body.children.length, 0);
});

test("liveClient 后台标签页：收到变化不查；切回前台时不管有没有变化都查一次", async () => {
  const w = fakeWindow({ hidden: true });
  liveClient({ hash: '"h1"' }, w);
  w.sources[0].onopen();
  w.sources[0].handlers.change();
  assert.equal(w.fetches.length, 0);
  w.document.hidden = false;
  w.emitDoc("visibilitychange");
  assert.equal(w.fetches.length, 1);
});

test("liveClient 子 iframe：父页面有 __pfLive 就注册上去、不自己开连接；父页面收到变化时一起检查；pagehide 注销", async () => {
  const top = fakeWindow();
  liveClient({ hash: '"top"' }, top);
  const child = fakeWindow({ pathname: "/p/proj/canvases/c/pages/pg/artboards/ab/preview.html", parent: top });
  liveClient({ hash: '"ab"' }, child);
  assert.equal(child.sources.length, 0, "不自己开 SSE");
  assert.equal(child.__pfLive, top.__pfLive, "孙页面也能找到顶层");

  top.sources[0].handlers.change();
  assert.equal(top.fetches.length, 1);
  assert.equal(child.fetches.length, 1, "子页面用自己的地址检查");
  child.fetches[0].resolve(ok('"ab2"'));
  top.fetches[0].resolve(ok('"top"'));
  await flush();
  assert.equal(child.reloads, 1, "只重新加载这块画板");
  assert.equal(top.reloads, 0);

  child.emit("pagehide");
  top.sources[0].handlers.change();
  assert.equal(child.fetches.length, 1, "注销后不再检查旧文档");
});

test("liveClient 第一次连上只查自己，重连才查全部（页面加载时不给每块画板都发一次 HEAD）", () => {
  const top = fakeWindow();
  liveClient({ hash: '"top"' }, top);
  const child = fakeWindow({ parent: top });
  liveClient({ hash: '"ab"' }, child);
  top.sources[0].onopen();
  assert.equal(child.fetches.length, 0);
  top.sources[0].onopen();
  assert.equal(child.fetches.length, 1);
});

test("liveClient 自动化浏览器（navigator.webdriver）不开 SSE，免得 networkidle 永远等不到；子页面也不会各自开连接", () => {
  const top = fakeWindow();
  top.navigator = { webdriver: true };
  liveClient({ hash: '"top"' }, top);
  assert.equal(top.sources.length, 0);
  const child = fakeWindow({ parent: top });
  child.navigator = { webdriver: true };
  liveClient({ hash: '"ab"' }, child);
  assert.equal(child.sources.length, 0);
});

test("liveClient reload 前记下滚动位置，重新加载后恢复", async () => {
  const w = fakeWindow();
  w.scrollX = 0; w.scrollY = 640;
  liveClient({ hash: '"h1"' }, w);
  w.sources[0].handlers.change();
  w.fetches[0].resolve(ok('"h2"'));
  await flush();
  // 模拟 reload 后的新文档：同一个 sessionStorage，新的 window 对象
  const again = fakeWindow();
  again.sessionStorage = w.sessionStorage;
  const scrolled = [];
  again.scrollTo = (o) => scrolled.push(o);
  again.setTimeout = (fn) => fn();
  liveClient({ hash: '"h2"' }, again);
  assert.deepEqual(scrolled[0], { left: 0, top: 640, behavior: "instant" }, "瞬间滚动，不受页面 scroll-behavior: smooth 影响");
  assert.equal(again.sessionStorage.getItem("__pf_live_scroll:/p/proj/page.html"), null, "用过就清掉");
});
