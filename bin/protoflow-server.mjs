#!/usr/bin/env node
// bin/protoflow-server.mjs — 被 core/localServer.js 的 ensureLocalServer() spawn 的后台进程本体。
// 不由用户直接调用；起来后从固定端口往上找一个空闲的监听（listenOnAvailablePort，见
// localServer.js），只绑 127.0.0.1，把 { pid, port, startedAt } 写进状态文件供
// ensureLocalServer() 探活复用。之后定期对照状态文件做单例自检：被别的活服务顶替就自己退出，
// 记录失效就把记录收回来（见 core/localServer.js 的 singletonDecision），不会再堆出孤儿进程。
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { capturePageShot, warmPageShot } from "../core/pageShot.js";
capturePageShot.warm = warmPageShot;
import { createStaticHandler, resolveStatusPath, resolveProjectsPath, listenOnAvailablePort, readStatus, singletonDecision } from "../core/localServer.js";
// 在加载较重的渲染依赖前监听启动者退出；就绪后服务独立存活。
const managed = typeof process.send === "function";
let ready = false;
process.on("disconnect", () => { if (!ready) process.exit(1); });
if (managed && !process.connected) process.exit(1);
// 收到终止信号就退出。要显式写：导出 PDF / MP4、标注截图开着无头浏览器时，puppeteer 自己挂了 SIGTERM 的监听
// （只关浏览器），有监听 Node 就不再按默认行为退出，服务会杀不掉。退出时 puppeteer 会顺手杀掉它起的浏览器。
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => process.exit(0));
// 渲染、导出都按产品注册表分发，注册表按配置加载（内置 + protoflow.config.json 里的插件）；localServer
// 本身不认识任何产品。启动时的产品集指纹写进状态文件，CLI 发现配置变了会换掉这个服务（core/localServer.js）。
const { loadRegistry } = await import("../products/index.js");
const { productsFingerprint } = await import("../core/pluginLoader.js");
const fingerprint = productsFingerprint();
const { renderProjectView, resolveProjectFile, runProjectExport } = await loadRegistry();

// 每次起服务生成一个新 secret：谁能读它谁才能给任意绝对路径签出合法 token（见 localServer.js
// 顶部注释）。只写进状态文件（同一用户本机可读），不会被打印到日志/stdout。
const secret = randomBytes(32).toString("hex");
// 注册表落盘文件跟 server.json 同目录——ensureLocalServer 用 PROTOFLOW_SERVER_STATUS 把状态文件
// 换到别处（测试用临时目录）时，projects.json 也跟着过去，不会污染用户真实的 ~/.protoflow/。
const statusPath = resolveStatusPath();
const projectsPath = resolveProjectsPath(path.join(path.dirname(statusPath), "projects.json"));
// renderProjectView 让 canvas.html / 画板 preview.html 成为 source.jsx / annotations / 项目结构的
// 实时投影：任何 agent、编辑器 Undo、git checkout 改了源文件，刷新浏览器即最新，不依赖谁记得重跑
// render_*，也不再有落盘 HTML 与源文件不一致的中间态。
const server = http.createServer(createStaticHandler(secret, renderProjectView, projectsPath, runProjectExport, resolveProjectFile, capturePageShot));
// 固定起点往上扫，不用 listen(0)（OS 随机端口）——见 localServer.js 里 listenOnAvailablePort
// 的注释：这样重启后基本落回同一个端口，之前开着的标签页不会平白无故全部失效。
const port = await listenOnAvailablePort(server, "127.0.0.1");
const startedAt = new Date().toISOString();
function writeStatus() {
  const tempPath = `${statusPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify({ pid: process.pid, port, secret, startedAt, productsFingerprint: fingerprint }, null, 2), { mode: 0o600 });
    fs.renameSync(tempPath, statusPath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}
fs.mkdirSync(path.dirname(statusPath), { recursive: true });
if (managed && !process.connected) process.exit(1);
writeStatus();
ready = true;

// 单例自检（规则见 core/localServer.js 的 singletonDecision）：被别的活服务顶替就退出，记录失效
// 就把记录收回来。状态文件所在目录都没了（比如测试的临时目录被删）说明这套环境已经不用了，也退出。
const SINGLETON_CHECK_MS = Number(process.env.PROTOFLOW_SINGLETON_CHECK_MS) || 5000;
setInterval(() => {
  if (!fs.existsSync(path.dirname(statusPath))) { server.close(); process.exit(0); }
  const decision = singletonDecision(readStatus(statusPath), process.pid);
  if (decision === "exit") { server.close(); process.exit(0); }
  if (decision === "reclaim") { try { writeStatus(); } catch { /* 下一轮再试 */ } }
}, SINGLETON_CHECK_MS).unref();
