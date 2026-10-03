// core/liveReload.js — 页面实时刷新：agent、编辑器、git checkout 改了项目里的源文件，浏览器里开着的
// 页面自己跟上，不用手动刷新。方案见 docs/superpowers/specs/2026-09-25-live-reload-design.md。
//
// 职责分两半：文件监听决定"什么时候检查"，渲染结果的 hash 决定"要不要刷新"；SSE 重连、切回前台
// 补上漏掉的检查。不需要任何产品声明依赖——页面都从 renderView 出来，渲染函数本身就是"这个页面依赖
// 什么"的唯一真相；多事件、无关文件都会被 hash 过滤掉。
//   服务端  项目有页面开着时才监听它（按 SSE 连接数引用计数），300ms 合并，经
//           GET /p/<key>/__protoflow_live 推一个不带内容的 "change"。
//   页面端  liveClient()：每个标签页只有顶层页面开一条 SSE，同源子 iframe（画布的画板）注册到它上面；
//           收到 change 就各自 HEAD 自己的地址，拿 ETag 跟加载时注入的 hash 比，不同就 reload。
//
// 跟 localServer 一样不认识任何产品，只认"页面 HTML"这一层。localServer 负责：用不带界面偏好、
// 不读本地派生状态（renderView 的 localState: false）的渲染结果算 ETag——这两样是页面/用户自己写回
// 的，不算内容；动态页面经 injectLiveClient() 输出并带 ETag 头；把 __protoflow_live 路由交给
// handleEvents()。
// 开关：PROTOFLOW_LIVE=0 时 localServer 不创建它，页面回到手动刷新。调试：PROTOFLOW_LIVE_DEBUG=<文件>
// 把每次广播、每次检查（路径、耗时）追加写进这个文件（后台服务的 stdout 是丢掉的）。
// 拆除：删本文件、tests/liveReload.test.js、localServer 里引用它的几行。renderView 的 localState
// 选项（core/renderService.js、画布 store.js 一行）可以留着，也可以一并删。
import fs from "node:fs";
import { createHash } from "node:crypto";

export const LIVE_SEGMENT = "__protoflow_live";
const DEBOUNCE_MS = 300;
const HEARTBEAT_MS = 30000;
const REWATCH_DELAY_MS = 1000;
// 只为少触发几次检查：正确性靠 hash，这里漏写哪个目录都不会判错。.protoflow/ 是页面自己写的派生状态。
const IGNORED = /(^|[\\/])(\.git|node_modules|\.protoflow|\.DS_Store)([\\/]|$)/;

export function liveReloadEnabled(env = process.env) {
  return env.PROTOFLOW_LIVE !== "0";
}

// ETag 口径：渲染结果原样取 hash（不做空白归一化——页面上看得出的差别都算变化）。
export function pageEtag(html) {
  return `"${createHash("sha256").update(String(html), "utf8").digest("hex").slice(0, 16)}"`;
}

// 页面端脚本插到 <head> 开头：顶层页面的 __pfLive 在解析到任何 iframe 之前就存在，子页面起来时父页面
// 一定已经就绪，不需要"谁先起、谁接管谁"的协议。没有 <head> 的不是完整页面，原样返回。
export function injectLiveClient(html, etag) {
  const s = String(html);
  const m = /<head(\s[^>]*)?>/i.exec(s);
  if (!m) return s;
  const script = `<script>(${liveClient.toString()})(${JSON.stringify({ hash: etag })});</script>`;
  const at = m.index + m[0].length;
  return s.slice(0, at) + script + s.slice(at);
}

// opts 只给测试用：watch（替代 fs.watch）、timers、stat、debounceMs、logFile。
export function createLiveReload(opts = {}) {
  const watchFn = opts.watch || fs.watch;
  const timers = opts.timers || { setTimeout, clearTimeout, setInterval, clearInterval };
  const statIno = opts.statIno || ((root) => { try { return fs.statSync(root).ino; } catch { return null; } });
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  const logFile = opts.logFile !== undefined ? opts.logFile : process.env.PROTOFLOW_LIVE_DEBUG || null;
  const projects = new Map(); // root → { clients: Set<res>, watcher, ino, timer }
  let heartbeat = null;

  function log(line) {
    if (!logFile) return;
    try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`); } catch { /* 调试日志写不进去不影响服务 */ }
  }

  function broadcast(root, p) {
    log(`change ${root} → ${p.clients.size} 个连接`);
    for (const res of p.clients) res.write("event: change\ndata: 1\n\n");
  }

  function schedule(root, p) {
    if (p.timer) timers.clearTimeout(p.timer);
    p.timer = timers.setTimeout(() => { p.timer = null; if (p.clients.size) broadcast(root, p); }, debounceMs);
  }

  function stopWatch(p) {
    if (p.timer) { timers.clearTimeout(p.timer); p.timer = null; }
    if (p.watcher) { try { p.watcher.close(); } catch { /* 已经关了 */ } p.watcher = null; }
  }

  // 监听器出错、项目目录被整体替换（心跳时发现 inode 变了）：重建，并让所有页面检查一次——
  // 重建前后这段时间里的改动可能没有事件。
  function rewatch(root, p) {
    stopWatch(p);
    if (p.rewatchTimer) return;
    p.rewatchTimer = timers.setTimeout(() => {
      p.rewatchTimer = null;
      if (!p.clients.size || p.watcher) return;
      startWatch(root, p);
      broadcast(root, p);
    }, REWATCH_DELAY_MS);
  }

  function startWatch(root, p) {
    p.ino = statIno(root);
    try {
      p.watcher = watchFn(root, { recursive: true }, (_event, filename) => {
        if (filename && IGNORED.test(String(filename))) return;
        schedule(root, p);
      });
      p.watcher.on("error", () => { log(`watcher error ${root}`); rewatch(root, p); });
    } catch (e) {
      log(`watch failed ${root}: ${e && e.message}`);
      p.watcher = null;
      rewatch(root, p);
    }
  }

  // 心跳：注释行让连接保持活跃；顺带发现项目目录被替换（inode 变了或目录没了又回来）。
  function ensureHeartbeat() {
    if (heartbeat) return;
    heartbeat = timers.setInterval(() => {
      for (const [root, p] of projects) {
        for (const res of p.clients) res.write(": ping\n\n");
        const ino = statIno(root);
        if (ino !== p.ino) { log(`root replaced ${root}`); rewatch(root, p); }
      }
    }, HEARTBEAT_MS);
    if (heartbeat && heartbeat.unref) heartbeat.unref();
  }

  return {
    // GET /p/<key>/__protoflow_live —— root 已由 localServer 按 key 解析好。
    handleEvents(req, res, root) {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write("retry: 1000\n\n");
      let p = projects.get(root);
      if (!p) { p = { clients: new Set(), watcher: null, ino: null, timer: null, rewatchTimer: null }; projects.set(root, p); }
      p.clients.add(res);
      if (!p.watcher) startWatch(root, p);
      ensureHeartbeat();
      req.on("close", () => {
        p.clients.delete(res);
        if (p.clients.size) return;
        stopWatch(p);
        if (p.rewatchTimer) { timers.clearTimeout(p.rewatchTimer); p.rewatchTimer = null; }
        projects.delete(root);
        if (!projects.size && heartbeat) { timers.clearInterval(heartbeat); heartbeat = null; }
      });
    },
    noteCheck(relPath, ms) { log(`check ${relPath} ${ms.toFixed(0)}ms`); },
    // 测试用：当前在监听的项目数。
    get watching() { return [...projects.values()].filter((p) => p.watcher).length; },
  };
}

// ---------------------------------------------------------------------------------------------
// 页面端。以 toString() 内联进页面，所以不能引用本模块里的任何东西。第二个参数只给测试用（假的
// window）；页面里调用时不传，用真的 window。
//
// 每个页面实例一个闭包：自己的 hash、单飞状态、dirty。check()：
//   正在检查 → dirty = true，返回
//   HEAD 自己的地址 → ETag 相同：dirty ? 再查一次 : 结束
//                   → ETag 不同（或页面没了 404）：记滚动位置，reload，此后本页所有检查作废
//                   → 5xx（渲染失败）：显示角落提示，dirty ? 再查一次 : 结束
//                   → 网络错误：清掉 dirty，结束，不重试（下一次 change、重连、切回前台都会再查）
// "再查一次"只由 dirty 引起，dirty 只由外部触发置上，所以不会自己驱动自己循环。
// ---------------------------------------------------------------------------------------------
export function liveClient(cfg, win) {
  var w = win || window;
  if (w.__pfLive) return;
  var doc = w.document;
  var hash = cfg.hash;
  var dead = false, inflight = false, dirty = false, badge = null;
  var SCROLL_KEY = "__pf_live_scroll:" + w.location.pathname + w.location.search;

  // ---- 滚动位置：reload 前记下窗口和所有滚动过的元素，加载后分几次恢复（内容常常是脚本渲染的，
  // 一次恢复可能太早）。用户自己动了就不再恢复。用 setTimeout 不用 rAF（后台/自动化环境里 rAF 不可靠）。
  function selectorOf(el) {
    if (el.id) return "#" + el.id;
    var sel = el.tagName.toLowerCase() + (el.classList && el.classList[0] ? "." + el.classList[0] : "");
    return sel + "@" + Array.prototype.indexOf.call(doc.querySelectorAll(sel), el);
  }
  function findBySelector(key) {
    if (key.charAt(0) === "#") return doc.getElementById(key.slice(1));
    var at = key.lastIndexOf("@");
    return doc.querySelectorAll(key.slice(0, at))[Number(key.slice(at + 1))] || null;
  }
  function saveScroll() {
    try {
      var els = [];
      var all = doc.querySelectorAll("*");
      for (var i = 0; i < all.length && els.length < 20; i++) {
        if (all[i].scrollTop || all[i].scrollLeft) els.push([selectorOf(all[i]), all[i].scrollLeft, all[i].scrollTop]);
      }
      w.sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ x: w.scrollX, y: w.scrollY, els: els }));
    } catch (e) { /* 存不了就不恢复 */ }
  }
  function restoreScroll() {
    var saved;
    try { saved = JSON.parse(w.sessionStorage.getItem(SCROLL_KEY) || "null"); w.sessionStorage.removeItem(SCROLL_KEY); } catch (e) { return; }
    if (!saved) return;
    var touched = false;
    function mark() { touched = true; }
    ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (t) { w.addEventListener(t, mark, { once: true, capture: true }); });
    // behavior: "instant"：页面可能设了 scroll-behavior: smooth（文档阅读页就是），普通 scrollTo 会变成
    // 动画，后台标签页里动画甚至不走。
    function apply() {
      if (touched) return;
      w.scrollTo({ left: saved.x, top: saved.y, behavior: "instant" });
      saved.els.forEach(function (e) {
        var el = findBySelector(e[0]);
        if (el && el.scrollTo) el.scrollTo({ left: e[1], top: e[2], behavior: "instant" });
      });
    }
    [0, 150, 500, 1200].forEach(function (ms) { w.setTimeout(apply, ms); });
  }

  // ---- 渲染失败提示：固定在右下角，下次检查成功就收起。
  function showBadge(on) {
    if (!on) { if (badge) { badge.remove(); badge = null; } return; }
    if (badge || !doc.body) return;
    badge = doc.createElement("div");
    badge.textContent = "源文件当前渲染失败，显示的是上一版";
    badge.setAttribute("style", "position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:6px 10px;border-radius:6px;background:#0f172a;color:#fff;font:12px/1.4 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;box-shadow:0 4px 14px rgba(15,23,42,.25);pointer-events:none");
    doc.body.appendChild(badge);
  }

  function reload() {
    dead = true;
    saveScroll();
    w.location.reload();
  }

  function check() {
    if (dead) return;
    if (inflight) { dirty = true; return; }
    inflight = true;
    dirty = false;
    w.fetch(w.location.href, { method: "HEAD", cache: "no-store" }).then(function (r) {
      inflight = false;
      if (dead) return;
      if (r.ok) {
        showBadge(false);
        var tag = r.headers.get("ETag");
        if (tag && tag !== hash) { reload(); return; }
      } else if (r.status === 404) {
        reload(); // 页面没了（比如画板被删），如实显示
        return;
      } else if (r.status >= 500) {
        showBadge(true);
      }
      if (dirty) check();
    }, function () {
      inflight = false;
      dirty = false;
    });
  }

  // ---- 子页面：父页面同源且有 __pfLive 就注册上去，不自己开连接（每块画板一条会把浏览器对同一域名
  // 的 6 条连接占满）。把父页面的 __pfLive 挂到自己身上，孙页面也能找到它。
  var parentLive = null;
  try { if (w.parent && w.parent !== w && w.parent.__pfLive) parentLive = w.parent.__pfLive; } catch (e) { parentLive = null; }
  if (parentLive) {
    w.__pfLive = parentLive;
    var unregister = parentLive.register(check);
    w.addEventListener("pagehide", unregister);
    restoreScroll();
    return;
  }

  // ---- 顶层页面：开一条 SSE，维护注册表（自己 + 子页面）。
  var checks = [check];
  w.__pfLive = {
    register: function (fn) {
      checks.push(fn);
      return function () { var i = checks.indexOf(fn); if (i >= 0) checks.splice(i, 1); };
    },
  };
  function checkAll() {
    if (doc.hidden) return; // 后台不查，切回前台时统一查
    checks.slice().forEach(function (fn) { try { fn(); } catch (e) { /* 子页面已经不在了 */ } });
  }
  restoreScroll();
  // 自动化浏览器（puppeteer / playwright，navigator.webdriver 为真）不开连接：它们不需要实时刷新，
  // 而一直开着的 SSE 会让 waitUntil: "networkidle0" 永远等不到（截图脚本就是这么等页面就绪的）。
  if (w.navigator && w.navigator.webdriver) return;
  var route = /^\/p\/([^/]+)\//.exec(w.location.pathname);
  if (!route || typeof w.EventSource !== "function") return;
  var opened = false;
  var es = new w.EventSource("/p/" + route[1] + "/__protoflow_live");
  es.onopen = function () {
    // 第一次连上只查自己：补上"服务端渲染 → 连上"之间的空档，一条 HEAD；子页面刚加载完，不用查。
    // 之后的每次连上（断线重连、服务重启）都是可能漏了改动，全部查。
    if (!opened) { opened = true; if (!doc.hidden) check(); } else checkAll();
  };
  es.addEventListener("change", checkAll);
  doc.addEventListener("visibilitychange", function () { if (!doc.hidden) checkAll(); });
}
