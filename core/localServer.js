// core/localServer.js — FS/进程边界模块（跟 store.js 同级），不是纯计算。
//
// 目的：很多 agent 自带的浏览器工具打不开 file://，只能走 http(s)://。这里给已经生成好的静态
// 文件（preview.html/canvas.html/PRD.preview.html/发布 previews）加一个通用的 http://127.0.0.1 出口。
//
// 通用性来自"独立于调用方进程、可探活可复用的共享后台服务"：每次 CLI 调用都是一次性进程，问的是
// 同一个问题——这台机器上有没有一个通用静态文件服务在跑，有就复用，没有就起一个（spawn detached，
// 问的人退出后它继续活着）。一台机器一个共享实例服务全部项目，不像
// HyperFrames 那样按项目分服务实例/端口——因为我们的服务器不需要它那套项目专属的编辑 API。
//
// URL 路由参照 HyperFrames 的思路（`#project/<name>` + `/api/projects/<name>/...`，服务端从不
// 把文件系统路径吐给浏览器）：对外 URL 是 `http://127.0.0.1:port/p/<projectId>/<项目内相对路径>`，
// 不是裸绝对路径。服务端维护一个内存注册表（projectId → 绝对项目根目录），`toLocalUrl()` 第一次
// 给某个项目生成 url 时顺带注册；共享一个服务器，不同目录可能撞同名项目，撞了照 core/store.js
// 的 uniqueProjectId 同一套规则加 -2/-3 后缀区分，不用 hash 这种不透明串（这次会话前半段刚把
// 项目目录从 proj_<timestamp> 改成人类可读 slug，URL 里用 hash 是反着来）。
//
// 状态文件（~/.protoflow/server.json，或 PROTOFLOW_SERVER_STATUS 覆盖）只记 { pid, port, secret,
// startedAt }，不含任何项目路径/id——这不是项目数据，跟 ~/.hyperframes/config.json 只放 CLI
// 运行时记账是一回事，不违反"项目自包含、不进全局目录"的原则。
//
// 项目注册表（projectId → 绝对项目根目录）跟随这个后台进程，但会落盘到 ~/.protoflow/projects.json
// （或 PROTOFLOW_PROJECTS_STATE 覆盖，或 createStaticHandler 第三个参数指定；不指定则不落盘），
// 每条 { id, dir, name, lastOpenedAt }，按 lastOpenedAt 倒序、截断到最近 30 条。作用有二：
// (1) 后台服务重启后自动 rehydrate，之前开着的标签页链接不失效，也不用等谁重新 render_*；
// (2) 给"最近打开的项目"列表一个数据源（GET /__protoflow_projects，只回 { id, name, lastOpenedAt }，
//     绝对路径 dir 不出浏览器）。这仍然是"这台机器对项目的视图/历史"这类运行时记账，不是项目数据；
//     rehydrate 时 project.json 已不在的条目直接剔除，不留死链接。跟 server.json 同一层级、同一口径。
//
// 本地可信项目预览：只监听 loopback；校验 Host/Origin；注册仍使用 HMAC。
// HTTP 文件入口只提供预览支持的类型，隐藏目录仅开放画布状态和截图预览。
// 文件路径逐层拒绝符号链接，并校验真实路径。项目内的 JSX/checks 仍属于可信代码。
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import lockfile from "proper-lockfile";
import { fileURLToPath } from "node:url";
import { createHmac, timingSafeEqual } from "node:crypto";
import { assertSafeSegment } from "./ids.js";
import { createLiveReload, liveReloadEnabled, pageEtag, injectLiveClient, LIVE_SEGMENT } from "./liveReload.js";
import { productsFingerprint } from "./pluginLoader.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PING_PATH = "/__protoflow_ping";
const EXPORT_PROGRESS_PATH = "/__protoflow_export_progress";
const EXPORT_PREVIEW_PATH = "/__protoflow_export_preview";
const PING_BODY = "protoflow-local-server";
const REGISTER_PATH = "/__protoflow_register";
const STATE_SEGMENT = "__protoflow_state";
const UI_PATH = "/__protoflow_ui";
const MAX_STATE_BYTES = 100 * 1024;

// 固定起始端口 + 冲突时向上扫描，不用 listen(0) 要 OS 随机分配——参照 HyperFrames 的
// findPortAndServe（固定 startPort=3002，被占用就往后探）：这台机器的 protoflow 后台服务
// 因此每次重启（睡眠唤醒/重启/手动 kill 之后被 ensureLocalServer 重新 spawn）基本都落回
// 同一个端口，不会每次都变成一个新随机数、让之前开着的标签页全部失效。真被占用了才继续往后找。
export const PREFERRED_PORT = 4287;
export const MAX_PORT_SCAN = 100;

// 在同一个 http.Server 实例上按固定起点往上试 listen：某个端口 EADDRINUSE 就换下一个再试
// （bind 失败的 server 还没进入 listening 状态，可以在同一个实例上重新 listen，不用重建）。
// 扫描范围内全部占满才真正报错。
export function listenOnAvailablePort(server, host, startPort = PREFERRED_PORT, maxScan = MAX_PORT_SCAN) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const tryNext = () => {
      const onError = (err) => {
        server.removeListener("listening", onListening);
        if (err.code === "EADDRINUSE" && port < startPort + maxScan - 1) {
          port += 1;
          tryNext();
        } else {
          reject(err);
        }
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve(port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    };
    tryNext();
  });
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".md": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
};

// 限定 HTTP 静态读入口。项目源文件和凭据不需要经浏览器直接下载。
const PUBLIC_EXTENSIONS = new Set([
  ".html", ".htm", ".js", ".mjs", ".css", ".json", ".md",
  ".png", ".jpg", ".jpeg", ".svg", ".gif", ".ico", ".webp", ".avif",
  ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".webm", ".mp3", ".wav", ".pdf",
]);

function isPublicPath(relPath) {
  const segments = relPath.split("/");
  if (segments.some((s) => !s || s === ".." || s.includes("\\") || s.includes(":"))) return false;
  const hidden = segments.some((s) => s.startsWith("."));
  if (hidden && !/^\.protoflow\/[^./][^/]*\.json$/.test(relPath)) return false;
  return PUBLIC_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

// 未生成的动态 preview.html 也要检查已有父目录；写状态时同样复用。
function safeProjectPath(root, relPath) {
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, relPath);
  const relative = path.relative(realRoot, target);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return null;
  let current = realRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return null;
      const real = fs.realpathSync(current);
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
    } catch (e) {
      if (e.code === "ENOENT") break;
      throw e;
    }
  }
  return target;
}

// 读一个 JSON 对象请求体，超过 MAX_STATE_BYTES 或不是对象就回 400；成功才调 onObject(parsed)。
// 超限直接在这里写响应——不能靠 req.destroy() 打断再指望 "end" 事件去回 400：destroy() 可能把
// 响应还没写完的底层 socket 一起断了，客户端只会看到连接错误，收不到干净的 400。这里只是不再往
// body 里追加、提前回了响应，请求流照样继续被 drain 完、"end" 自然触发（被 responded 短路跳过）。
function readJsonObjectBody(req, res, onObject) {
  let body = "";
  let responded = false;
  req.on("data", (c) => {
    if (responded) return;
    body += c;
    if (body.length > MAX_STATE_BYTES) {
      responded = true;
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad Request");
    }
  });
  req.on("end", () => {
    if (responded) return;
    let parsed;
    try { parsed = JSON.parse(body); }
    catch { res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad Request"); return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad Request");
      return;
    }
    onObject(parsed);
  });
}

function isLocalRequest(req) {
  // 精确端口检查同时防止通过其它本地域名进行 DNS rebinding。
  const hosts = new Set([`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`]);
  if (!hosts.has(req.headers.host)) return false;
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return false;
  if (req.headers["sec-fetch-site"] !== "cross-site") return true;
  // 跨站也放行顶层文档导航（用户从别的页面/插件点链接跳过来的场景）——真正有泄露风险的
  // 是脚本发起的 fetch/XHR/img/iframe，那些的 Sec-Fetch-Dest 不会是 "document"，仍然会被挡。
  return req.headers["sec-fetch-mode"] === "navigate" && req.headers["sec-fetch-dest"] === "document";
}

export function resolveStatusPath(override) {
  return override || process.env.PROTOFLOW_SERVER_STATUS || path.join(os.homedir(), ".protoflow", "server.json");
}

export function resolveProjectsPath(override) {
  return override || process.env.PROTOFLOW_PROJECTS_STATE || path.join(os.homedir(), ".protoflow", "projects.json");
}

const RECENT_CAP = 30;

// 同一个绝对目录重复注册要拿回同一个 key（幂等）；同一个 key 被不同目录抢，后来者加 -2/-3
// 后缀——跟 core/store.js 的 uniqueProjectId 是同一条规则，只是这里是内存 Map 不是查文件系统。
function uniqueKey(byKey, base) {
  if (!byKey.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!byKey.has(candidate)) return candidate;
  }
}

// 请求路径只认两类：/p/<projectId>/<相对路径>（读文件，必须是已注册项目根目录之下，且不能靠
// 相对路径跳出这个根目录，不要求 token/cookie——见文件头「鉴权模型」）、/__protoflow_register
// （登记一个项目根目录，仍然要求 secret 签的 token——调用方是我们自己已经拿到 secret 的可信 Node
// 进程，不是浏览器）。
//
// renderView(projectRoot, relPath, { ui, query }) 可选（query 是地址 ? 后面的原始字符串）：GET /p/<key>/<相对路径> 命中已注册项目、过了 containment
// 检查后，先问它这条路径要不要**实时渲染**（返回 HTML 字符串），返回非空就直接回，磁盘上有没有
// 那个文件都不看；返回 null 才落到静态文件通道。protoflow 用它把 canvas.html / 画板 preview.html
// 变成源文件的实时投影（见 core/renderService.js）。缺省是"永远 null" —— 本模块保持通用静态服务，
// 由 bin/protoflow-server.mjs 在入口处注入真正的 renderView。
//
// resolveFile(projectRoot, relPath) 可选：renderView 回 null 之后、读静态文件之前，问这条路径实际
// 对应磁盘上哪个文件（绝对路径），回 null 就按 relPath 原样读。protoflow 用它把
// docs/<id>/versions/<n>/assets/x 这类地址按版本清单解析到对象库（core/versionStore.js）——URL 不变，
// 文件不在那个位置。内容类型仍按请求路径的扩展名定（对象文件没有扩展名）；解析出来的路径同样要在
// 项目根目录内、不经过符号链接。
//
// captureShot({ url, selector, boxes, viewport, areaWidth }) 可选：标注截图（core/pageShot.js，由 bin/protoflow-server.mjs 注入），
// 返回 JPEG Buffer；captureShot.warm() 可选，提前把浏览器启动起来。没注入时截图请求回 501，页面照样能标注，只是不带图。
export function createStaticHandler(secret, renderView = () => null, projectsPath = null, runExport = () => null, resolveFile = () => null, captureShot = null) {
  const byKey = new Map(); // projectId（可能带 -2 后缀） → 绝对项目根目录
  const byDir = new Map(); // 绝对项目根目录 → 已分配的 key
  let recent = []; // [{ id, dir, name, lastOpenedAt }]，最近打开在前，最多 RECENT_CAP 条
  // 页面实时刷新（core/liveReload.js）；PROTOFLOW_LIVE=0 时为 null，下面几处都跳过。
  const live = liveReloadEnabled() ? createLiveReload() : null;

  function readProjectName(root) {
    try {
      const n = JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8")).name;
      if (typeof n === "string" && n.trim()) return n;
    } catch { /* 用目录名兜底 */ }
    return path.basename(root);
  }

  function persistRecent() {
    if (!projectsPath) return;
    try {
      fs.mkdirSync(path.dirname(projectsPath), { recursive: true });
      fs.writeFileSync(projectsPath, JSON.stringify(recent, null, 2));
    } catch { /* 落盘失败不影响服务本身，下次注册会再写一遍 */ }
  }

  function touchRecent(id, root) {
    recent = recent.filter((e) => e.dir !== root);
    recent.unshift({ id, dir: root, name: readProjectName(root), lastOpenedAt: new Date().toISOString() });
    if (recent.length > RECENT_CAP) recent = recent.slice(0, RECENT_CAP);
    persistRecent();
  }

  // 启动时把上次落盘的注册表读回来：project.json 还在的才恢复，剔除死链接，重排、截断、回写。
  if (projectsPath && fs.existsSync(projectsPath)) {
    let saved = [];
    try { saved = JSON.parse(fs.readFileSync(projectsPath, "utf8")); } catch { saved = []; }
    if (Array.isArray(saved)) {
      for (const e of saved) {
        if (!e || typeof e.id !== "string" || typeof e.dir !== "string") continue;
        const root = path.resolve(e.dir);
        if (byKey.has(e.id) || byDir.has(root)) continue;
        if (!fs.existsSync(path.join(root, "project.json"))) continue;
        byKey.set(e.id, root);
        byDir.set(root, e.id);
        recent.push({
          id: e.id, dir: root,
          name: typeof e.name === "string" && e.name.trim() ? e.name : path.basename(root),
          lastOpenedAt: typeof e.lastOpenedAt === "string" ? e.lastOpenedAt : "",
        });
      }
      recent.sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)));
      recent = recent.slice(0, RECENT_CAP);
      persistRecent();
    }
  }

  function registerDir(projectId, absDir) {
    const root = path.resolve(absDir);
    let key = byDir.get(root);
    if (!key) {
      key = uniqueKey(byKey, projectId);
      byKey.set(key, root);
      byDir.set(root, key);
    }
    touchRecent(key, root); // 重复注册也刷新 lastOpenedAt（"最近打开"要跟着动）
    return key;
  }

  // 通用的按 key 存取派生状态：POST /p/<projectId>/__protoflow_state/<stateKey>，body 是任意
  // JSON 对象，落到 <root>/.protoflow/<stateKey>.json。这是本地服务器第一次真正写磁盘（上面的
  // registerDir 只写内存）——写入面收得很窄：stateKey 过 assertSafeSegment（跟 projectId/pageId
  // 挡路径穿越用的是同一道闸），文件名固定拼死不接受调用方指定完整路径。不额外要求 token/cookie，
  // 只要求 key 是已注册过的项目——跟读文件同一个鉴权模型（见文件头注释）。
  function handleSaveState(req, res, rawKey, rawStateKey) {
    let key, stateKey;
    try { key = decodeURIComponent(rawKey); stateKey = decodeURIComponent(rawStateKey); }
    catch { res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad Request"); return; }

    const root = byKey.get(key);
    if (!root) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found"); return; }
    try { assertSafeSegment(stateKey); }
    catch { res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad Request"); return; }

    readJsonObjectBody(req, res, (parsed) => {
      try {
        const target = safeProjectPath(root, path.join(".protoflow", stateKey + ".json"));
        if (!target) { res.writeHead(403).end("Forbidden"); return; }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify(parsed, null, 2));
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain" }).end("Internal Error");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    });
  }

  // 用户级界面偏好（不是项目数据）：POST /__protoflow_ui，body 是 JSON 对象，浅合并进注册表同目录的
  // ui.json（~/.protoflow/ui.json；测试里跟着 PROTOFLOW_SERVER_STATUS 换到临时目录）。比如项目侧边栏
  // 展开与否（projectNavOpen）、幻灯片缩略图栏开没开和宽度（deckThumbsOpen / deckThumbsWidth）——
  // 都跨项目生效，所以不放进任何一个项目的 .protoflow/。
  // 服务端返回页面时读它、把初始状态直接写进 HTML（见 renderView 的第三个参数），不用前端再请求。
  const uiPath = projectsPath ? path.join(path.dirname(projectsPath), "ui.json") : null;
  function readUi() {
    if (!uiPath) return {};
    try { const v = JSON.parse(fs.readFileSync(uiPath, "utf8")); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
    catch { return {}; }
  }
  function handleSaveUi(req, res) {
    readJsonObjectBody(req, res, (parsed) => {
      if (!uiPath) { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true })); return; }
      try {
        fs.mkdirSync(path.dirname(uiPath), { recursive: true });
        fs.writeFileSync(uiPath, JSON.stringify({ ...readUi(), ...parsed }, null, 2));
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain" }).end("Internal Error");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    });
  }

  // 导出：POST /p/<projectId>/__protoflow_export/<subPath>（subPath 如 "canvas/zip" 或
  // "doc/<docId>/html"，格式段见 core/exportFormats.js）。runExport 由 bin/protoflow-server.mjs
  // 注入（core/exportService.js），返回 { filename, buffer, mime }——一份文件的字节，不落盘到
  // 项目目录（落盘只发生在系统临时目录，打完包立刻删）。响应直接把字节发回去，浏览器那边走
  // "另存为"选目录，不是我们替用户定一个固定导出路径。
  // 导出进度：页面发导出请求时在查询串里带一个自己生成的任务号（?job=…），导出过程中产品报的进度按任务号记在
  // 这里；页面同时轮询 GET /__protoflow_export_progress?job=… 拿 { fraction, stage, meta, preview }，
  // preview 是预览图的序号（产品报了"现在渲染到的画面"才有，没有是 0），变了就去
  // GET /__protoflow_export_preview?job=… 取那张图。导出结束后留一会儿再删（最后一次轮询可能晚到）。
  // 任务号只是页面自己认领进度用的，不是凭据。
  // 取消：页面中断导出请求（关掉进度弹窗点「取消」），连接一断就通过 signal 通知产品停下。
  const exportJobs = new Map(); // 任务号 → { fraction, stage, meta, preview（序号）, previewFile }
  const JOB_RE = /^[A-Za-z0-9_-]{8,64}$/;
  const jobOf = (rawQuery) => { const j = new URLSearchParams(rawQuery || "").get("job"); return j && exportJobs.get(j) || null; };
  function handleExportProgress(res, rawQuery) {
    const p = jobOf(rawQuery);
    const body = p ? { fraction: p.fraction, stage: p.stage, meta: p.meta || {}, preview: p.preview || 0 } : {};
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  }
  function handleExportPreview(res, rawQuery) {
    const p = jobOf(rawQuery);
    let buf = null;
    try { if (p && p.previewFile) buf = fs.readFileSync(p.previewFile); } catch { /* 导出已结束、临时文件删了 */ }
    if (!buf) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found"); return; }
    const type = /\.png$/i.test(p.previewFile) ? "image/png" : "image/jpeg";
    res.writeHead(200, { "Content-Type": type, "Content-Length": buf.length }).end(buf);
  }

  async function handleExport(res, rawKey, rawSub, rawQuery) {
    let key, sub;
    try { key = decodeURIComponent(rawKey); sub = decodeURIComponent(rawSub); }
    catch { res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad Request"); return; }
    const root = byKey.get(key);
    if (!root) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found"); return; }
    if (sub.includes("..") || sub.includes("\0")) { res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad Request"); return; }
    const job = new URLSearchParams(rawQuery || "").get("job");
    const tracked = job && JOB_RE.test(job) ? job : null;
    const onProgress = tracked ? ({ fraction, stage, meta, preview }) => {
      const prev = exportJobs.get(tracked) || {};
      const next = { fraction, stage, meta: { ...(prev.meta || {}), ...(meta || {}) }, preview: prev.preview || 0, previewFile: prev.previewFile };
      if (preview && preview !== prev.previewFile) { next.previewFile = preview; next.preview = (prev.preview || 0) + 1; }
      exportJobs.set(tracked, next);
    } : undefined;
    if (tracked) exportJobs.set(tracked, { fraction: 0, stage: "", meta: {}, preview: 0 });
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    let out;
    try { out = await runExport(root, sub, { onProgress, signal: abort.signal }); }
    catch (e) {
      if (abort.signal.aborted) return; // 页面取消了，连接已经断了，不用回

      const msg = "导出失败: " + String((e && e.message) || e);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(msg) });
      res.end(msg);
      return;
    }
    if (!out || !out.filename || !out.buffer) { res.writeHead(501, { "Content-Type": "text/plain" }).end("Not Implemented"); return; }
    // 文件名常是中文，普通 filename= 只保证 ASCII——带一份 RFC 5987 的 filename*，现代浏览器按它
    // 取真实文件名，老客户端退回 ASCII 兜底（非 ASCII 字符换成 "_"，不影响能不能存下来）。
    const asciiFallback = out.filename.replace(/[^\x20-\x7e]/g, "_");
    const disposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`;
    res.writeHead(200, { "Content-Type": out.mime || "application/zip", "Content-Disposition": disposition, "Content-Length": out.buffer.length });
    res.end(out.buffer);
  }

  // 标注截图：POST /p/<projectId>/__protoflow_shot，body { page, selector, boxes, viewport, areaWidth }；body 是 { warm: true } 时
  // 只提前启动浏览器（右键菜单弹出时发），马上回。page 是这个项目里
  // 的相对地址（可带 ?查询 和 #锚点），服务端拼成自己的地址交给无头浏览器打开——只截本项目的页面，不接受
  // 任意网址。图写到 <项目>/.protoflow/shots/（实时刷新不看 .protoflow/，写图不会触发页面刷新），只留最近
  // SHOT_KEEP 张；回 { path（绝对路径，给 agent 读）, dataUrl（给面板显示缩略图）}。
  const SHOT_KEEP = 40;
  function handleShot(req, res, rawKey) {
    let key;
    try { key = decodeURIComponent(rawKey); } catch { res.writeHead(400).end("Bad Request"); return; }
    const root = byKey.get(key);
    if (!root) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found"); return; }
    if (!captureShot) { res.writeHead(501, { "Content-Type": "text/plain" }).end("Not Implemented"); return; }
    readJsonObjectBody(req, res, async (body) => {
      if (body.warm === true) {
        if (captureShot.warm) captureShot.warm();
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
        return;
      }
      const page = typeof body.page === "string" ? body.page : "";
      const pagePath = page.split(/[?#]/)[0];
      if (!pagePath || pagePath.startsWith("/") || !isPublicPath(pagePath) || typeof body.selector !== "string" || !Array.isArray(body.boxes)) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad Request");
        return;
      }
      try {
        const url = `http://127.0.0.1:${req.socket.localPort}/p/${encodeURIComponent(key)}/${page}`;
        const img = await captureShot({ url, selector: body.selector, boxes: body.boxes.slice(0, 50), viewport: body.viewport || {}, areaWidth: Number(body.areaWidth) || 0 });
        const dir = safeProjectPath(root, path.join(".protoflow", "shots"));
        if (!dir) { res.writeHead(403).end("Forbidden"); return; }
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
        const file = path.join(dir, `${stamp}-${Math.random().toString(36).slice(2, 6)}.jpg`);
        fs.writeFileSync(file, img);
        const old = fs.readdirSync(dir).filter((f) => /\.(jpg|png)$/.test(f)).sort();
        for (const f of old.slice(0, Math.max(0, old.length - SHOT_KEEP))) fs.rmSync(path.join(dir, f), { force: true });
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, path: file, dataUrl: "data:image/jpeg;base64," + img.toString("base64") }));
      } catch (e) {
        const msg = "截图失败: " + String((e && e.message) || e);
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(msg) }).end(msg);
      }
    });
  }

  function handleRegister(req, res, rawQuery) {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch { res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad Request"); return; }
      const { projectId, dir } = parsed || {};
      if (typeof projectId !== "string" || !projectId || typeof dir !== "string" || !dir) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad Request");
        return;
      }
      const absDir = path.resolve(dir);
      const token = new URLSearchParams(rawQuery || "").get("token") || "";
      if (!validToken(secret, "register:" + absDir, token)) {
        res.writeHead(403, { "Content-Type": "text/plain" }).end("Forbidden");
        return;
      }
      const key = registerDir(projectId, absDir);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ key }));
    });
  }

  return (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!isLocalRequest(req)) { res.writeHead(403).end("Forbidden"); return; }
    const [rawPath, rawQuery] = req.url.split("?");

    if (req.method === "POST" && rawPath === REGISTER_PATH) { handleRegister(req, res, rawQuery); return; }
    if (req.method === "POST" && rawPath === UI_PATH) { handleSaveUi(req, res); return; }
    if (req.method === "POST") {
      const stateMatch = new RegExp(`^/p/([^/]+)/${STATE_SEGMENT}/([^/]+)$`).exec(rawPath);
      if (stateMatch) { handleSaveState(req, res, stateMatch[1], stateMatch[2]); return; }
      const exportMatch = /^\/p\/([^/]+)\/__protoflow_export\/(.+)$/.exec(rawPath);
      if (exportMatch) {
        const job = new URLSearchParams(rawQuery || "").get("job");
        handleExport(res, exportMatch[1], exportMatch[2], rawQuery).finally(() => { if (job) setTimeout(() => exportJobs.delete(job), 10000).unref(); });
        return;
      }
      const shotMatch = /^\/p\/([^/]+)\/__protoflow_shot$/.exec(rawPath);
      if (shotMatch) { handleShot(req, res, shotMatch[1]); return; }
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain" }).end("Method Not Allowed");
      return;
    }
    if (rawPath === EXPORT_PROGRESS_PATH) { handleExportProgress(res, rawQuery); return; }
    if (rawPath === EXPORT_PREVIEW_PATH) { handleExportPreview(res, rawQuery); return; }
    if (rawPath === PING_PATH) {
      res.writeHead(200, { "Content-Type": "text/plain" }).end(PING_BODY);
      return;
    }

    // "最近打开的项目"列表——给整站画布左上角的项目切换器用。只回浏览器要的三个字段，
    // 绝对路径 dir 不出去（对齐"服务端从不把文件系统路径吐给浏览器"）。不要求 token（同 GET 读文件）。
    if (rawPath === "/__protoflow_projects") {
      const body = JSON.stringify(recent.map((e) => ({ id: e.id, name: e.name, lastOpenedAt: e.lastOpenedAt })));
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }

    const m = /^\/p\/([^/]+)\/(.*)$/.exec(rawPath);
    if (!m) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found"); return; }
    let key, relPath;
    // 项目根地址 /p/<key>/ 就是 index.html（项目入口由 renderView 提供）
    try { key = decodeURIComponent(m[1]); relPath = decodeURIComponent(m[2]) || "index.html"; }
    catch { res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad Request"); return; }

    const root = byKey.get(key);
    if (!root) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found"); return; }
    if (live && req.method === "GET" && relPath === LIVE_SEGMENT) { live.handleEvents(req, res, root); return; }
    if (relPath.includes("..") || relPath.includes("\0")) {
      res.writeHead(403, { "Content-Type": "text/plain" }).end("Forbidden");
      return;
    }
    if (!isPublicPath(relPath)) { res.writeHead(403).end("Forbidden"); return; }
    let filePath;
    try { filePath = safeProjectPath(root, relPath); }
    catch { res.writeHead(404).end("Not Found"); return; }
    if (!filePath) { res.writeHead(403).end("Forbidden"); return; }
    const resolvedRoot = fs.realpathSync(root);
    const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    if (filePath !== resolvedRoot && !filePath.startsWith(rootWithSep)) {
      res.writeHead(403, { "Content-Type": "text/plain" }).end("Forbidden");
      return;
    }

    // 实时渲染优先：canvas.html / 画板 preview.html 每次都按源文件当前内容现算一份，不看磁盘上
    // 那份可能已经过期的落盘快照（见 renderView 注释 / core/renderService.js）。渲染抛错（源码
    // 编译不过、画板不存在……）如实回 500，不静默退回静态文件。
    // 实时刷新的 ETag 只算内容：不带界面偏好（ui.json，侧边栏展开与否）、不读本地派生状态
    // （.protoflow/，比如画布自己写回的画板实测高度）另渲染一份来算——这两样也会进 HTML，不排除的话
    // 页面自己写回一次状态、用户切一下侧边栏，下次检查都会白刷一次。HEAD 不回正文，只做这一次。
    let dynamicHtml = null, etag = null;
    const started = performance.now();
    try {
      const query = rawQuery || "";
      const plain = live ? renderView(root, relPath, { query, localState: false }) : null;
      if (plain != null) etag = pageEtag(plain);
      dynamicHtml = live && req.method === "HEAD" ? plain : renderView(root, relPath, { ui: readUi(), query });
    }
    catch (e) {
      const msg = "渲染失败: " + String((e && e.message) || e);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(msg) });
      res.end(req.method === "HEAD" ? undefined : msg);
      return;
    }
    if (dynamicHtml != null) {
      const buf = Buffer.from(etag ? injectLiveClient(dynamicHtml, etag) : String(dynamicHtml), "utf8");
      if (etag) {
        res.setHeader("ETag", etag);
        if (req.method === "HEAD") live.noteCheck(relPath, performance.now() - started);
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": buf.length });
      res.end(req.method === "HEAD" ? undefined : buf);
      return;
    }

    try {
      const resolved = resolveFile(root, relPath);
      if (resolved) filePath = safeProjectPath(root, path.relative(root, resolved));
    } catch { filePath = null; }
    if (!filePath) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found"); return; }

    let stat;
    try { stat = fs.statSync(filePath); }
    catch { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found"); return; }
    if (!stat.isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found"); return; }
    const contentType = CONTENT_TYPES[path.extname(relPath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, "Content-Length": stat.size });
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  };
}

function signPath(secret, target) {
  return createHmac("sha256", secret).update(target).digest("hex");
}

function validToken(secret, target, token) {
  if (!token) return false;
  const expected = Buffer.from(signPath(secret, target), "hex");
  const given = Buffer.from(token, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code !== "ESRCH"; }
}

function pingOk(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: PING_PATH, timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(res.statusCode === 200 && body === PING_BODY));
      res.on("error", () => resolve(false));
      res.on("aborted", () => resolve(false));
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

// 一份状态文件只该对应一个活着的服务。状态文件只记一个进程，记录一旦被别的进程覆盖或失效，
// 下一次 ensureLocalServer 就会在下一个空闲端口另起一个，旧的却一直活着没人管——实际出现过
// 4287~4290 同时开着四个服务、只有一个在状态文件里的情况。所以由服务自己定期对照状态文件：
//   记录的就是自己                  → keep
//   记录的是另一个还活着的进程      → exit（自己是孤儿，让位）
//   没有记录 / 记录的进程已经死了   → reclaim（把记录改回指向自己，工具下次直接复用，不再另起）
export function singletonDecision(status, selfPid, pidAlive = isPidAlive) {
  if (status && status.pid === selfPid) return "keep";
  if (status && pidAlive(status.pid)) return "exit";
  return "reclaim";
}
export { readStatus };

function readStatus(statusPath) {
  try { return JSON.parse(fs.readFileSync(statusPath, "utf8")); }
  catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function liveStatus(statusPath) {
  const s = readStatus(statusPath);
  if (!s || !Number.isInteger(s.port) || s.port < 1 || s.port > 65535
    || typeof s.secret !== "string" || !s.secret || !isPidAlive(s.pid)) return null;
  return await pingOk(s.port) ? s : null;
}

// 正在跑的服务加载的产品集跟现在的配置不一致（改了 protoflow.config.json、插件代码变了）：它得换掉。
// 服务把启动时算的指纹写在状态文件里（bin/protoflow-server.mjs），这里现算一份比对。没有这个字段的是
// 升级前起的老服务，也换掉一次（换的时候落回同一个端口，开着的标签页不失效）。
const productsStale = (s) => s.productsFingerprint !== productsFingerprint();

// 停掉产品集过期的服务，等它真的退出（端口放出来，新服务还能落回同一个端口，开着的标签页不失效）。
async function stopStale(s) {
  try { process.kill(s.pid, "SIGTERM"); } catch { return; }
  for (let i = 0; i < 40 && isPidAlive(s.pid); i++) await sleep(50);
  if (isPidAlive(s.pid)) { try { process.kill(s.pid, "SIGKILL"); } catch { /* 已经退出 */ } }
}

// 探活复用；没有可复用的服务就 spawn 一个 detached 后台进程并轮询到它就绪。一次次 CLI 调用问到的
// 都是同一个共享后台服务。返回值带 secret，供
// toLocalUrl() 签名/注册用；secret 只应该流向"生成 URL"这一步，不要再往外传。
export async function ensureLocalServer(opts = {}) {
  const requestedPath = path.resolve(resolveStatusPath(opts.statusPath));
  fs.mkdirSync(path.dirname(requestedPath), { recursive: true });
  // 父目录可能经由符号链接访问；统一锁和子进程使用的状态路径。
  const statusPath = path.join(fs.realpathSync(path.dirname(requestedPath)), path.basename(requestedPath));
  const existing = await liveStatus(statusPath);
  if (existing && !productsStale(existing)) return { port: existing.port, secret: existing.secret };

  let compromised;
  const release = await lockfile.lock(statusPath, {
    realpath: false,
    stale: 20000,
    update: 2000,
    retries: { retries: 150, factor: 1, minTimeout: 200, maxTimeout: 200 },
    onCompromised: (err) => { compromised = err; },
  });
  let child;
  let finished;
  try {
    // 其他调用方可能已在等待锁期间启动成功；瞬时探活失败也在锁内重试。
    let current = await liveStatus(statusPath);
    if (current && productsStale(current)) { await stopStale(current); current = null; }
    else if (!current && isPidAlive(readStatus(statusPath)?.pid)) {
      await sleep(200);
      current = await liveStatus(statusPath);
      if (!current) throw new Error("本地服务进程仍在运行但未响应，请稍后重试");
    }
    if (compromised) throw compromised;
    if (current) return { port: current.port, secret: current.secret };

    const serverScript = path.join(HERE, "..", "bin", "protoflow-server.mjs");
    child = spawn(process.execPath, [serverScript], {
      detached: true,
      // 启动阶段保留 IPC：调用方异常退出时，尚未就绪的服务也应退出。
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, PROTOFLOW_SERVER_STATUS: statusPath },
    });
    let failure;
    finished = new Promise((resolve) => {
      child.once("error", (err) => { failure = err; resolve(); });
      child.once("exit", (code, signal) => {
        failure ||= new Error(`本地服务启动失败（${signal || code}）`);
        resolve();
      });
    });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (compromised) throw compromised;
      if (failure) throw failure;
      const s = await liveStatus(statusPath);
      if (s && s.pid === child.pid) {
        if (child.connected) child.disconnect();
        child.unref();
        child = null;
        return { port: s.port, secret: s.secret };
      }
      await sleep(50);
    }
    throw new Error("本地静态文件服务启动超时");
  } finally {
    if (child) {
      // 必须等失败的启动者退出后才交还锁，避免它稍后又发布状态。
      child.kill("SIGKILL");
      await finished;
    }
    if (!compromised) await release();
  }
}

async function registerProject(projectId, absDir, { port, secret }) {
  const token = signPath(secret, "register:" + absDir);
  const res = await fetch(`http://127.0.0.1:${port}${REGISTER_PATH}?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, dir: absDir }),
  });
  if (!res.ok) throw new Error(`注册项目到本地服务失败: HTTP ${res.status}`);
  const { key } = await res.json();
  return key;
}

// opts 必须带 projectId + projectDir（项目根目录）；absPath 必须在 projectDir 之内，生成的 url
// 是 http://127.0.0.1:<port>/p/<projectId（可能带 -2 后缀）>/<项目内相对路径>，不再是裸绝对路径
// （见文件头注释）；GET 不要求 token，这个 url 长期有效，不随后台服务重启失效。
export async function toLocalUrl(absPath, opts = {}) {
  const { projectId, projectDir } = opts;
  if (!projectId || !projectDir) throw new Error("toLocalUrl 需要 opts.projectId 和 opts.projectDir");

  const { port, secret } = await ensureLocalServer(opts);
  const absDir = path.resolve(projectDir);
  const relFs = path.relative(absDir, path.resolve(absPath));
  if (relFs.startsWith("..") || path.isAbsolute(relFs)) {
    throw new Error(`toLocalUrl: ${absPath} 不在 projectDir（${projectDir}）之内`);
  }
  const relUrl = relFs.split(path.sep).join("/");

  const key = await registerProject(projectId, absDir, { port, secret });
  const encodedPath = relUrl.split("/").map(encodeURIComponent).join("/");
  return `http://127.0.0.1:${port}/p/${encodeURIComponent(key)}/${encodedPath}`;
}
