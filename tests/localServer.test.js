import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { createHmac } from "node:crypto";
import { ensureLocalServer, toLocalUrl, createStaticHandler, resolveProjectsPath, singletonDecision } from "../core/localServer.js";

const tmpStatusPath = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-")), "server.json");
const spawnedPids = [];
after(() => { for (const pid of spawnedPids) { try { process.kill(pid); } catch {} } });

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
const sign = (secret, target) => createHmac("sha256", secret).update(target).digest("hex");

// fetch()/URL 在发请求前会自己把 ".." 从路径里解析掉（这就是这次会话早前踩过的 /etc/passwd 那个坑
// 的根源），没法用 fetch 测服务端的 containment 检查有没有真的挡住"跳出根目录"这种请求——
// http.request 的 path 是按原始字符串发到请求行上的，不会被预先规范化，才是正确的测试方式。
function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: rawPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

async function register(port, secret, projectId, dir) {
  const token = sign(secret, "register:" + path.resolve(dir));
  const res = await fetch(`http://127.0.0.1:${port}/__protoflow_register?token=${token}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, dir }),
  });
  return res.json();
}

test("注册后不带 token 就能通过 /p/<projectId>/<相对路径> 读到文件（本地 Host、路径检查通过后无需 token）；未注册的 key 404；containment 拦跳出根目录的相对路径", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-proj-"));
  fs.writeFileSync(path.join(dir, "canvas.html"), "<html>canvas</html>");
  fs.mkdirSync(path.join(dir, "pages"));
  fs.writeFileSync(path.join(dir, "pages", "preview.html"), "<html>preview</html>");
  const secret = "test-secret";
  const server = await listen(createStaticHandler(secret));
  const { port } = server.address();

  const { key } = await register(port, secret, "结账流程", dir);
  assert.equal(key, "结账流程", "没有冲突时 key 就是明文项目名，不是不透明串");

  const ok = await fetch(`http://127.0.0.1:${port}/p/${encodeURIComponent(key)}/canvas.html`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "<html>canvas</html>");
  assert.equal(ok.headers.get("cache-control"), "no-store");

  const nested = await fetch(`http://127.0.0.1:${port}/p/${encodeURIComponent(key)}/pages/preview.html`);
  assert.equal(nested.status, 200);
  assert.equal(await nested.text(), "<html>preview</html>");

  const unknownKey = await fetch(`http://127.0.0.1:${port}/p/nope/canvas.html`);
  assert.equal(unknownKey.status, 404, "没注册过的项目 key 直接 404");

  const escape = await rawGet(port, `/p/${encodeURIComponent(key)}/../../../etc/passwd`);
  assert.equal(escape.status, 403, "跳出注册根目录的相对路径要拒绝（用 http.request 发原始未规范化的路径，模拟不经过 URL 规范化的客户端）");

  server.close();
  server.closeAllConnections();
});

test("同一绝对目录重复注册拿回同一个 key（幂等）；不同目录撞同名项目按 -2/-3 后缀区分（同 core/store.js 的 uniqueProjectId 规则）", async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-a-"));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-b-"));
  const secret = "test-secret-2";
  const server = await listen(createStaticHandler(secret));
  const { port } = server.address();

  const r1 = await register(port, secret, "结账流程", dirA);
  const r1b = await register(port, secret, "结账流程", dirA);
  assert.equal(r1.key, "结账流程");
  assert.equal(r1b.key, "结账流程", "同一个目录重复注册应该拿回同一个 key，不是每次分配新的");

  const r2 = await register(port, secret, "结账流程", dirB);
  assert.equal(r2.key, "结账流程-2", "不同目录撞同名项目要加后缀区分");

  server.close();
  server.closeAllConnections();
});

test("/__protoflow_register 没有合法 token 一律拒绝——不能让任意调用方往注册表里塞任意目录（这一条不受「GET 不要求 token」影响：注册端点动态把任意目录接入这台共享服务，风险比读已知项目文件大得多，单独保留 token 鉴权）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-c-"));
  const secret = "test-secret-3";
  const server = await listen(createStaticHandler(secret));
  const { port } = server.address();

  const noToken = await fetch(`http://127.0.0.1:${port}/__protoflow_register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: "x", dir }),
  });
  assert.equal(noToken.status, 403);

  const ping = await fetch(`http://127.0.0.1:${port}/__protoflow_ping`);
  assert.equal(ping.status, 200);
  assert.equal(await ping.text(), "protoflow-local-server");

  server.close();
  server.closeAllConnections();
});

test("__protoflow_state：注册项目后不带 token/cookie 就能保存派生状态，落盘到 .protoflow/<stateKey>.json，能通过已有 GET 路由读回来", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-state-"));
  const secret = "test-secret-5";
  const server = await listen(createStaticHandler(secret));
  const { port } = server.address();
  const { key } = await register(port, secret, "P", dir);

  const payload = { sidebarCollapsed: true, pages: { pg_1: { scale: 0.62, x: 10, y: -5 } } };
  const saved = await fetch(`http://127.0.0.1:${port}/p/${encodeURIComponent(key)}/__protoflow_state/canvas`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true });

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, ".protoflow", "canvas.json"), "utf8"));
  assert.deepEqual(onDisk, payload, "应该原样落到 <root>/.protoflow/<stateKey>.json");

  // 已有的通用 GET 路由应该能原样读回来，不用给这个文件另写专门的读接口
  const readBack = await fetch(`http://127.0.0.1:${port}/p/${encodeURIComponent(key)}/.protoflow/canvas.json`);
  assert.equal(readBack.status, 200);
  assert.deepEqual(await readBack.json(), payload);

  server.close();
  server.closeAllConnections();
});

test("__protoflow_shot：只截本项目的页面（地址由服务端拼）；图写进 .protoflow/shots/ 回绝对路径；没注入截图能力回 501", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-shot-"));
  const secret = "test-secret-shot";
  const calls = [];
  const capture = async (opts) => { calls.push(opts); return Buffer.from("ffd8ffe0", "hex"); };
  const server = await listen(createStaticHandler(secret, undefined, null, undefined, undefined, capture));
  const { port } = server.address();
  const { key } = await register(port, secret, "P", dir);
  const post = (body, k = key) => fetch(`http://127.0.0.1:${port}/p/${encodeURIComponent(k)}/__protoflow_shot`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  const ok = await post({ page: "decks/d/preview.html?v=2#3", selector: ".pf-slide", boxes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }], viewport: { width: 1200, height: 800 } });
  assert.equal(ok.status, 200);
  const r = await ok.json();
  assert.ok(r.path.startsWith(path.join(fs.realpathSync(dir), ".protoflow", "shots")) && fs.existsSync(r.path));
  assert.ok(r.dataUrl.startsWith("data:image/jpeg;base64,") && r.path.endsWith(".jpg"));
  assert.equal(calls[0].url, `http://127.0.0.1:${port}/p/${encodeURIComponent(key)}/decks/d/preview.html?v=2#3`, "打开的是本服务上这个项目的页面");
  assert.deepEqual(calls[0].viewport, { width: 1200, height: 800 });

  assert.equal((await post({ page: "http://evil.example/x.html", selector: "a", boxes: [] })).status, 400, "不接受任意网址");
  assert.equal((await post({ page: "/etc/x.html", selector: "a", boxes: [] })).status, 400);
  assert.equal((await post({ page: "decks/d/preview.html", selector: "a", boxes: [] }, "nope")).status, 404);
  server.close(); server.closeAllConnections();

  const bare = await listen(createStaticHandler(secret));
  const k2 = (await register(bare.address().port, secret, "P", dir)).key;
  const r2 = await fetch(`http://127.0.0.1:${bare.address().port}/p/${encodeURIComponent(k2)}/__protoflow_shot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page: "a.html", selector: "a", boxes: [] }) });
  assert.equal(r2.status, 501);
  bare.close(); bare.closeAllConnections();
});

test("__protoflow_state：未注册的项目 404；stateKey 带路径穿越字符拒绝；非对象/超限 body 拒绝", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-state2-"));
  const secret = "test-secret-6";
  const server = await listen(createStaticHandler(secret));
  const { port } = server.address();
  const { key } = await register(port, secret, "P", dir);

  const unknownProject = await fetch(`http://127.0.0.1:${port}/p/nope/__protoflow_state/canvas`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(unknownProject.status, 404, "没注册过的项目不能写状态");

  const badKey = await fetch(`http://127.0.0.1:${port}/p/${encodeURIComponent(key)}/__protoflow_state/${encodeURIComponent("../evil")}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(badKey.status, 400, "stateKey 要过 assertSafeSegment 同一道闸，不能靠它跳出 .protoflow 目录");

  const notObject = await fetch(`http://127.0.0.1:${port}/p/${encodeURIComponent(key)}/__protoflow_state/canvas`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "[1,2,3]",
  });
  assert.equal(notObject.status, 400, "顶层必须是普通对象，不接受数组");

  const tooBig = await fetch(`http://127.0.0.1:${port}/p/${encodeURIComponent(key)}/__protoflow_state/canvas`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ junk: "x".repeat(200 * 1024) }),
  });
  assert.equal(tooBig.status, 400, "超过大小上限应该拒绝，不是无限接受任意大小的 body");

  assert.ok(!fs.existsSync(path.join(dir, ".protoflow")), "以上全部应该被拒绝，不应该有任何文件被落盘");

  server.close();
  server.closeAllConnections();
});

function mkProject(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-recent-"));
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ id: name, name }));
  fs.writeFileSync(path.join(dir, "report.html"), "<html>" + name + "</html>");
  return dir;
}

test("resolveProjectsPath：默认在 ~/.protoflow/projects.json，env / 参数可覆盖", () => {
  assert.equal(resolveProjectsPath("/tmp/x/projects.json"), "/tmp/x/projects.json");
  const saved = process.env.PROTOFLOW_PROJECTS_STATE;
  delete process.env.PROTOFLOW_PROJECTS_STATE; // npm test 会指到临时目录，这里要看的是没设时的默认值
  try { assert.ok(resolveProjectsPath().endsWith(path.join(".protoflow", "projects.json"))); }
  finally { if (saved !== undefined) process.env.PROTOFLOW_PROJECTS_STATE = saved; }
  assert.equal(resolveProjectsPath(), saved ?? resolveProjectsPath(), "env 可覆盖");
});

test("GET /__protoflow_projects：返回最近打开的项目（最近的在前），只含 id/name/lastOpenedAt，不吐绝对路径 dir", async () => {
  const projectsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-pl-")), "projects.json");
  const secret = "test-secret-pl";
  const server = await listen(createStaticHandler(secret, undefined, projectsPath));
  const { port } = server.address();

  const dirA = mkProject("结账流程");
  const dirB = mkProject("员工档案");
  await register(port, secret, "结账流程", dirA);
  await new Promise((r) => setTimeout(r, 5));
  await register(port, secret, "员工档案", dirB); // 后注册 → 更"新"

  const res = await fetch(`http://127.0.0.1:${port}/__protoflow_projects`);
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.deepEqual(list.map((e) => e.name), ["员工档案", "结账流程"], "最近打开的排在前面");
  assert.deepEqual(Object.keys(list[0]).sort(), ["id", "lastOpenedAt", "name"], "只回这三个字段");
  assert.ok(!JSON.stringify(list).includes(dirA) && !JSON.stringify(list).includes(dirB), "绝对路径 dir 不出浏览器");

  // 重复注册 dirA → 它变回最新，且列表不长出重复项
  await register(port, secret, "结账流程", dirA);
  const list2 = await (await fetch(`http://127.0.0.1:${port}/__protoflow_projects`)).json();
  assert.deepEqual(list2.map((e) => e.name), ["结账流程", "员工档案"]);
  assert.equal(list2.length, 2, "重复注册刷新 lastOpenedAt，不新增一条");

  server.close();
  server.closeAllConnections();
});

test("注册表落盘 + 重启 rehydrate：换一个 handler 实例（模拟后台服务重启）指向同一个 projects.json，之前注册过的项目不用重新注册就能读、也在 /__protoflow_projects 里；project.json 已不在的条目 rehydrate 时剔除", async () => {
  const projectsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-rh-")), "projects.json");
  const secret = "test-secret-rh";

  const s1 = await listen(createStaticHandler(secret, undefined, projectsPath));
  const p1 = s1.address().port;
  const dirLive = mkProject("在世项目");
  const dirGone = mkProject("将被删项目");
  const { key: keyLive } = await register(p1, secret, "在世项目", dirLive);
  await register(p1, secret, "将被删项目", dirGone);
  s1.close(); s1.closeAllConnections();

  assert.ok(fs.existsSync(projectsPath), "注册后应已落盘");
  const onDisk = JSON.parse(fs.readFileSync(projectsPath, "utf8"));
  assert.equal(onDisk.length, 2);
  assert.ok(onDisk.every((e) => e.id && e.dir && e.name && e.lastOpenedAt), "每条 { id, dir, name, lastOpenedAt } 齐全（dir 只在盘上，不经端点）");

  // 删掉其中一个项目的 project.json，再"重启"
  fs.rmSync(path.join(dirGone, "project.json"));

  const s2 = await listen(createStaticHandler(secret, undefined, projectsPath));
  const p2 = s2.address().port;

  // 没有重新 register，仍然能读到在世项目的文件（rehydrate 生效）
  const readBack = await fetch(`http://127.0.0.1:${p2}/p/${encodeURIComponent(keyLive)}/report.html`);
  assert.equal(readBack.status, 200);
  assert.equal(await readBack.text(), "<html>在世项目</html>");

  const list = await (await fetch(`http://127.0.0.1:${p2}/__protoflow_projects`)).json();
  assert.deepEqual(list.map((e) => e.name), ["在世项目"], "project.json 没了的项目 rehydrate 时被剔除，不留死链接");
  assert.deepEqual(JSON.parse(fs.readFileSync(projectsPath, "utf8")).map((e) => e.name), ["在世项目"], "剔除后的列表回写了盘");

  s2.close(); s2.closeAllConnections();
});

test("没有 projectsPath 时不落盘、不 rehydrate（保持纯静态 handler 可用）", async () => {
  const secret = "test-secret-np";
  const server = await listen(createStaticHandler(secret)); // 第三参数缺省
  const { port } = server.address();
  const dir = mkProject("临时");
  await register(port, secret, "临时", dir);
  const list = await (await fetch(`http://127.0.0.1:${port}/__protoflow_projects`)).json();
  assert.deepEqual(list.map((e) => e.name), ["临时"], "内存态列表照样有（端点不依赖落盘）");
  server.close();
  server.closeAllConnections();
});

test("ensureLocalServer：首次调用起后台服务，二次调用复用同一端口；toLocalUrl 拿到 /p/<projectId>/... 形态的地址（不带 token），真能读到文件内容", async () => {
  const statusPath = tmpStatusPath();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-project-"));
  // 用一个非动态视图的文件名当静态读通道的探针——canvas.html / 画板 preview.html 现在由
  // renderProjectView 实时渲染（见 renderService.test.js），会拦掉裸静态读。
  const filePath = path.join(dir, "report.html");
  fs.writeFileSync(filePath, "<html>hi</html>");

  const r1 = await ensureLocalServer({ statusPath });
  assert.ok(Number.isInteger(r1.port));
  assert.ok(typeof r1.secret === "string" && r1.secret.length > 0);
  spawnedPids.push(JSON.parse(fs.readFileSync(statusPath, "utf8")).pid);

  const r2 = await ensureLocalServer({ statusPath });
  assert.equal(r2.port, r1.port, "第二次应复用同一个后台服务，而不是各起各的");

  const url = await toLocalUrl(filePath, { statusPath, projectId: "端口演示", projectDir: dir });
  const expected = `http://127.0.0.1:${r1.port}/p/${encodeURIComponent("端口演示")}/report.html`;
  assert.equal(url, expected, `url 应该是干净路由形态（项目名经 URL 编码但解码后就是明文，不是裸绝对路径也不是不透明哈希），不带 token，实际: ${url}`);
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "<html>hi</html>");
});

test("toLocalUrl：absPath 不在 projectDir 之内时明确报错，不是静默生成一个打不开的 url", async () => {
  const statusPath = tmpStatusPath();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-outside-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-outside2-"));
  try {
    await assert.rejects(
      () => toLocalUrl(path.join(outside, "x.html"), { statusPath, projectId: "p", projectDir: dir }),
      /不在 projectDir/,
    );
  } finally {
    // toLocalUrl 内部 ensureLocalServer() 先跑，即使后面因为 containment 检查抛错，daemon 已经起了
    try { spawnedPids.push(JSON.parse(fs.readFileSync(statusPath, "utf8")).pid); } catch {}
  }
});

test("HTTP 文件边界：拒绝隐藏文件、符号链接和不支持的类型，只放行派生状态（老的截图预览页特例已去掉）", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-boundary-"));
  const dir = path.join(temp, "project");
  fs.mkdirSync(dir);
  const write = (name, text = "fixture") => { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  write(".env"); write(".git/config"); write("nested/.env.json"); write("key.pem");
  write(".protoflow/canvas.json", "{}"); write("docs/prd/.build/previews/cart.html", "preview");
  write("docs/prd/.build/captures.json", "{}"); write("assets/icon.svg", "<svg/>");
  fs.writeFileSync(path.join(temp, "outside.json"), "OUTSIDE");
  fs.symlinkSync(path.join(temp, "outside.json"), path.join(dir, "leak.json"));
  fs.symlinkSync(path.join(dir, ".env"), path.join(dir, "alias.json"));
  fs.symlinkSync(temp, path.join(dir, "linked-dir"), "dir");
  const server = await listen(createStaticHandler("boundary", (_root, rel) => rel.endsWith("preview.html") ? "dynamic" : null));
  t.after(() => { server.close(); server.closeAllConnections(); fs.rmSync(temp, { recursive: true, force: true }); });
  const { port } = server.address();
  await register(port, "boundary", "P", dir);
  for (const name of [".env", ".git/config", "nested/.env.json", "key.pem", "leak.json", "alias.json", "linked-dir/outside.json", "linked-dir/preview.html", "docs/prd/.build/captures.json", "docs/prd/.build/previews/cart.html", "%2eenv", "nested%5c.env.json"]) {
    assert.equal((await rawGet(port, `/p/P/${name}`)).status, 403, name);
  }
  for (const name of [".protoflow/canvas.json", "assets/icon.svg", "pages/new/preview.html"]) {
    assert.equal((await rawGet(port, `/p/P/${name}`)).status, 200, name);
  }
});

test("状态写入拒绝符号链接目录和文件，不修改目录外数据", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-state-boundary-"));
  const dir = path.join(temp, "project"); fs.mkdirSync(dir);
  const outside = path.join(temp, "outside"); fs.mkdirSync(outside);
  const victim = path.join(outside, "canvas.json"); fs.writeFileSync(victim, '{"keep":true}');
  const server = await listen(createStaticHandler("state-boundary"));
  t.after(() => { server.close(); server.closeAllConnections(); fs.rmSync(temp, { recursive: true, force: true }); });
  const { port } = server.address(); await register(port, "state-boundary", "P", dir);
  const save = () => fetch(`http://127.0.0.1:${port}/p/P/__protoflow_state/canvas`, { method: "POST", body: '{"changed":true}' });
  fs.symlinkSync(outside, path.join(dir, ".protoflow"), "dir");
  assert.equal((await save()).status, 403);
  fs.unlinkSync(path.join(dir, ".protoflow")); fs.mkdirSync(path.join(dir, ".protoflow"));
  fs.symlinkSync(victim, path.join(dir, ".protoflow", "canvas.json"));
  assert.equal((await save()).status, 403);
  assert.equal(fs.readFileSync(victim, "utf8"), '{"keep":true}');
});

test("HTTP 拒绝外部 Host 和跨站写入，接受本地同源请求", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-origin-"));
  const server = await listen(createStaticHandler("origin"));
  t.after(() => { server.close(); server.closeAllConnections(); fs.rmSync(dir, { recursive: true, force: true }); });
  const { port } = server.address(); await register(port, "origin", "P", dir);
  const base = `http://127.0.0.1:${port}`;
  const wrongHost = await new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: "/__protoflow_projects", headers: { Host: `attacker.example:${port}` } }, res => { res.resume(); resolve(res.statusCode); }).on("error", reject);
  });
  assert.equal(wrongHost, 403);
  for (const headers of [{ Origin: "https://attacker.example" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" }]) {
    const r = await fetch(base + "/p/P/__protoflow_state/canvas", { method: "POST", headers, body: "{}" });
    assert.equal(r.status, 403);
  }
  assert.ok(!fs.existsSync(path.join(dir, ".protoflow")));
  assert.equal((await fetch(base + "/p/P/__protoflow_state/canvas", { method: "POST", headers: { Origin: base }, body: "{}" })).status, 200);
});

test("异步导出返回下载文件，异步错误返回 500", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-async-export-"));
  const server = await listen(createStaticHandler("secret", undefined, null, async (_root, sub) => {
    await Promise.resolve();
    if (sub === "doc/prd/fail") throw new Error("Word 生成失败");
    return { filename: "测试.docx", buffer: Buffer.from("word-bytes"), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  }));
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const { port } = server.address();
  const { key } = await register(port, "secret", "export", dir);
  const base = `http://127.0.0.1:${port}/p/${key}/__protoflow_export/doc/prd`;
  const response = await fetch(base + "/docx", { method: "POST" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /wordprocessingml/);
  assert.match(response.headers.get("content-disposition"), /\.docx/);
  assert.equal(await response.text(), "word-bytes");
  const failed = await fetch(base + "/fail", { method: "POST" });
  assert.equal(failed.status, 500);
  assert.match(await failed.text(), /Word 生成失败/);
});


test("导出进度：请求带 ?job=，导出过程中产品报的进度能按任务号轮询到；没带任务号或任务号不对拿到空对象", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-export-progress-"));
  let release, reported;
  const reachedHalf = new Promise((r) => { reported = r; });
  const server = await listen(createStaticHandler("secret", undefined, null, async (_root, _sub, { onProgress } = {}) => {
    onProgress({ fraction: 0.5, stage: "录制画面" });
    reported();
    await new Promise((r) => { release = r; });
    return { filename: "a.mp4", buffer: Buffer.from("mp4"), mime: "video/mp4" };
  }));
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const { port } = server.address();
  const { key } = await register(port, "secret", "export", dir);
  const origin = `http://127.0.0.1:${port}`;
  const pending = fetch(`${origin}/p/${key}/__protoflow_export/deck/d/mp4?job=job12345abc`, { method: "POST" });
  await reachedHalf;
  const progress = (job) => fetch(`${origin}/__protoflow_export_progress?job=${job}`).then((r) => r.json());
  assert.deepEqual(await progress("job12345abc"), { fraction: 0.5, stage: "录制画面", meta: {}, preview: 0 });
  assert.deepEqual(await progress("nope"), {});
  release();
  const done = await pending;
  assert.equal(done.status, 200);
  assert.equal(await done.text(), "mp4");
});

test("导出进度弹窗：产品报的预览图按序号取；页面中断请求时导出收到取消信号", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-export-preview-"));
  const frame = path.join(dir, "f1.jpg");
  fs.writeFileSync(frame, Buffer.from("fake-jpeg"));
  let reported, aborted;
  const reachedFrame = new Promise((r) => { reported = r; });
  const gotAbort = new Promise((r) => { aborted = r; });
  const server = await listen(createStaticHandler("secret", undefined, null, async (_root, _sub, { onProgress, signal } = {}) => {
    onProgress({ fraction: 0.3, stage: "录制画面", preview: frame, meta: { durationMs: 12000 } });
    reported();
    await new Promise((_, reject) => signal.addEventListener("abort", () => { aborted(); reject(new Error("aborted")); }));
  }));
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const { port } = server.address();
  const { key } = await register(port, "secret", "export", dir);
  const origin = `http://127.0.0.1:${port}`;
  const ctrl = new AbortController();
  const pending = fetch(`${origin}/p/${key}/__protoflow_export/deck/d/mp4?job=jobpreview1`, { method: "POST", signal: ctrl.signal }).catch(() => "aborted");
  await reachedFrame;
  const p = await fetch(`${origin}/__protoflow_export_progress?job=jobpreview1`).then((r) => r.json());
  assert.deepEqual(p, { fraction: 0.3, stage: "录制画面", meta: { durationMs: 12000 }, preview: 1 });
  const img = await fetch(`${origin}/__protoflow_export_preview?job=jobpreview1&v=1`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.equal(await img.text(), "fake-jpeg");
  assert.equal((await fetch(`${origin}/__protoflow_export_preview?job=nope1234`)).status, 404);
  ctrl.abort();
  await gotAbort; // 连接断了，导出收到取消信号
  assert.equal(await pending, "aborted");
});

// 使用独立状态目录，所有测试只清理自己启动的进程。
function isolatedServer(t) {
  const statusPath = tmpStatusPath();
  t.after(() => {
    try { process.kill(JSON.parse(fs.readFileSync(statusPath, "utf8")).pid); } catch {}
    try {
      for (const pid of fs.readFileSync(path.join(path.dirname(statusPath), "starts.jsonl"), "utf8").trim().split("\n")) {
        try { process.kill(Number(pid)); } catch {}
      }
    } catch {}
    fs.rmSync(path.dirname(statusPath), { recursive: true, force: true });
  });
  return statusPath;
}

test("同进程并发冷启动：所有调用共享服务且启动锁释放", async (t) => {
  const statusPath = isolatedServer(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => ensureLocalServer({ statusPath })));
  assert.equal(new Set(results.map((s) => s.port)).size, 1);
  assert.equal(new Set(results.map((s) => s.secret)).size, 1);
  assert.equal(fs.existsSync(statusPath + ".lock"), false);
  assert.deepEqual(fs.readdirSync(path.dirname(statusPath)).filter((p) => p.endsWith(".tmp")), []);
});

test("独立 CLI 进程并发冷启动：只 spawn 一个后台服务", async (t) => {
  const statusPath = isolatedServer(t);
  const logPath = path.join(path.dirname(statusPath), "starts.jsonl");
  const preload = path.join(path.dirname(statusPath), "observe.mjs");
  fs.writeFileSync(preload, `import fs from 'node:fs';
    if (process.argv[1]?.endsWith('protoflow-server.mjs'))
      fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.pid) + String.fromCharCode(10));`);
  const moduleUrl = new URL("../core/localServer.js", import.meta.url).href;
  const code = `import { ensureLocalServer } from ${JSON.stringify(moduleUrl)};
    const result = await ensureLocalServer({ statusPath: ${JSON.stringify(statusPath)} });
    console.log(result.port);`;
  const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${preload}` };
  const results = await Promise.allSettled(Array.from({ length: 5 }, () =>
    promisify(execFile)(process.execPath, ["--input-type=module", "-e", code], { env, timeout: 40000 })));
  for (const result of results) if (result.status === "rejected") throw result.reason;
  assert.equal(new Set(results.map((r) => r.value.stdout.trim())).size, 1);
  assert.equal(fs.readFileSync(logPath, "utf8").trim().split("\n").length, 1);
});

test("残留锁和损坏状态可恢复", async (t) => {
  const statusPath = isolatedServer(t);
  fs.writeFileSync(statusPath, '{broken');
  fs.mkdirSync(statusPath + ".lock");
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(statusPath + ".lock", old, old);
  const result = await ensureLocalServer({ statusPath });
  assert.equal((await fetch(`http://127.0.0.1:${result.port}/__protoflow_ping`)).status, 200);
  assert.equal(fs.existsSync(statusPath + ".lock"), false);
});

test("子进程启动失败释放锁，后续调用可重试", async (t) => {
  const statusPath = isolatedServer(t);
  const preload = path.join(path.dirname(statusPath), "fail.mjs");
  fs.writeFileSync(preload, "process.exit(23);");
  const previous = process.env.NODE_OPTIONS;
  try {
    process.env.NODE_OPTIONS = `--import=${preload}`;
    await assert.rejects(ensureLocalServer({ statusPath }), /启动失败/);
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
  assert.equal(fs.existsSync(statusPath + ".lock"), false);
  const result = await ensureLocalServer({ statusPath });
  assert.ok(result.port);
});

test("存活进程持续探活失败：不另起服务且释放锁", async (t) => {
  const statusPath = isolatedServer(t);
  const server = await listen((_req, res) => res.writeHead(503).end());
  t.after(() => { server.close(); server.closeAllConnections(); });
  fs.writeFileSync(statusPath, JSON.stringify({ pid: process.pid, port: server.address().port, secret: "test" }));
  try {
    await assert.rejects(ensureLocalServer({ statusPath }), /仍在运行但未响应/);
    assert.equal(fs.existsSync(statusPath + ".lock"), false);
    assert.equal(JSON.parse(fs.readFileSync(statusPath, "utf8")).pid, process.pid);
  } finally {
    // 此用例记录的是测试进程，清理钩子不能把它当作后台服务结束。
    fs.unlinkSync(statusPath);
  }
});


test("启动超时会终止子进程并释放锁", async (t) => {
  const statusPath = isolatedServer(t);
  const preload = path.join(path.dirname(statusPath), "slow.mjs");
  const logPath = path.join(path.dirname(statusPath), "starts.jsonl");
  fs.writeFileSync(preload, `import fs from 'node:fs';
    fs.writeFileSync(${JSON.stringify(logPath)}, String(process.pid));
    await new Promise(resolve => setTimeout(resolve, 15000));`);
  const previous = process.env.NODE_OPTIONS;
  try {
    process.env.NODE_OPTIONS = `--import=${preload}`;
    await assert.rejects(ensureLocalServer({ statusPath }), /启动超时/);
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
  const pid = Number(fs.readFileSync(logPath, "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.equal(fs.existsSync(statusPath + ".lock"), false);
  assert.equal(fs.existsSync(statusPath), false);
});

test("singletonDecision：状态文件记的是自己就留着；记的是另一个活进程就退出让位；没记录或记录的进程已死就把记录收回来", () => {
  const alive = new Set([111, 222]);
  const pidAlive = (p) => alive.has(p);
  assert.equal(singletonDecision({ pid: 111 }, 111, pidAlive), "keep");
  assert.equal(singletonDecision({ pid: 222 }, 111, pidAlive), "exit");
  assert.equal(singletonDecision({ pid: 999 }, 111, pidAlive), "reclaim");
  assert.equal(singletonDecision(null, 111, pidAlive), "reclaim");
});

test("后台服务单例自检（真实进程）：状态文件被改成指向别的活进程时，旧服务自己退出，不再堆成孤儿；记录失效时把记录收回来", async () => {
  const prev = process.env.PROTOFLOW_SINGLETON_CHECK_MS;
  process.env.PROTOFLOW_SINGLETON_CHECK_MS = "200";
  try {
    // 记录失效 → 收回
    const statusA = tmpStatusPath();
    await ensureLocalServer({ statusPath: statusA });
    const a = JSON.parse(fs.readFileSync(statusA, "utf8"));
    spawnedPids.push(a.pid);
    fs.writeFileSync(statusA, JSON.stringify({ ...a, pid: 999999 }));
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(JSON.parse(fs.readFileSync(statusA, "utf8")).pid, a.pid, "记录指向的进程已死，服务把记录改回指向自己");

    // 被别的活进程顶替 → 退出
    fs.writeFileSync(statusA, JSON.stringify({ ...a, pid: process.pid }));
    await new Promise((r) => setTimeout(r, 800));
    let stillAlive = true;
    try { process.kill(a.pid, 0); } catch { stillAlive = false; }
    assert.equal(stillAlive, false, "状态文件记的是另一个活进程时，这个服务就是孤儿，自己退出");
  } finally {
    if (prev === undefined) delete process.env.PROTOFLOW_SINGLETON_CHECK_MS; else process.env.PROTOFLOW_SINGLETON_CHECK_MS = prev;
  }
});

test("POST /__protoflow_ui：用户级界面偏好浅合并落到注册表同目录的 ui.json；返回页面时通过 renderView 第三个参数带给渲染层", async () => {
  const projectsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pf-srv-ui-")), "projects.json");
  const uiPath = path.join(path.dirname(projectsPath), "ui.json");
  const secret = "test-secret-ui";
  let seen = null;
  const server = await listen(createStaticHandler(secret, (_root, relPath, opts) => {
    if (relPath === "canvas.html") { seen = opts; return "<html></html>"; }
    return null;
  }, projectsPath));
  const { port } = server.address();
  const post = (body) => fetch(`http://127.0.0.1:${port}/__protoflow_ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body });

  try {
    assert.equal((await post(JSON.stringify({ projectNavOpen: true }))).status, 200);
    assert.equal((await post(JSON.stringify({ other: 1 }))).status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(uiPath, "utf8")), { projectNavOpen: true, other: 1 }, "浅合并，不覆盖掉别的键");
    assert.equal((await post("[1,2]")).status, 400, "只接受 JSON 对象");
    assert.equal((await post("x".repeat(200 * 1024))).status, 400, "有大小上限");

    const dir = mkProject("结账流程");
    await register(port, secret, "结账流程", dir);
    await fetch(`http://127.0.0.1:${port}/p/${encodeURIComponent("结账流程")}/canvas.html?v=2`);
    assert.deepEqual(seen, { ui: { projectNavOpen: true, other: 1 }, query: "v=2" }, "地址 ? 后面的部分也带给渲染层");
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
