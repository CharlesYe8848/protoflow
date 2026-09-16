#!/usr/bin/env node
// bin/protoflow-server.mjs — 被 core/localServer.js 的 ensureLocalServer() spawn 的后台进程本体。
// 不由用户直接调用；起来后从固定端口往上找一个空闲的监听（listenOnAvailablePort，见
// localServer.js），只绑 127.0.0.1，把 { pid, port, startedAt } 写进状态文件供
// ensureLocalServer() 探活复用，然后一直跑到被手动 kill 掉。
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { createStaticHandler, resolveStatusPath, resolveProjectsPath, listenOnAvailablePort } from "../core/localServer.js";
import { renderProjectView } from "../core/renderService.js";
import { runProjectExport } from "../core/exportService.js";

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
const server = http.createServer(createStaticHandler(secret, renderProjectView, projectsPath, runProjectExport));
// 固定起点往上扫，不用 listen(0)（OS 随机端口）——见 localServer.js 里 listenOnAvailablePort
// 的注释：这样重启后基本落回同一个端口，之前开着的标签页不会平白无故全部失效。
const port = await listenOnAvailablePort(server, "127.0.0.1");
fs.mkdirSync(path.dirname(statusPath), { recursive: true });
fs.writeFileSync(statusPath, JSON.stringify({ pid: process.pid, port, secret, startedAt: new Date().toISOString() }, null, 2));
