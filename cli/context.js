// cli/context.js — CLI 每次调用工具前的准备：默认工作目录、单次调用的 dir 覆盖、用预览页地址定位项目、
// 修改人。工具定义在 cli/tools.js，入口是 bin/protoflow-cli.js。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveProjectsPath } from "../core/localServer.js";

// 默认工作目录：PROTOFLOW_HOME 优先；否则用进程启动时的 cwd（agent 在哪个目录下跑命令，项目就落在哪），
// 不是某个固定的全局位置。
export function resolveWorkspace(env = process.env) {
  return env.PROTOFLOW_HOME || process.cwd();
}

// 单次工具调用可用 args.dir 覆盖默认工作目录（相对路径按 process.cwd() 解析）。项目地址 = ws（父目录）
// + projectId（文件夹名）。
export function resolveCallWorkspace(ctx, args) {
  return args && args.dir ? path.resolve(args.dir) : ctx.ws;
}

// 预览页地址 → { projectId, dir }。地址里 /p/<key>/ 的 key 是本地预览服务给项目登记的名字（重名时会带
// -2 这类后缀，不一定等于文件夹名），在登记表 ~/.protoflow/projects.json 里查出项目根目录。查不到回 null。
export function projectFromUrl(url, projectsPath = resolveProjectsPath()) {
  const m = /\/p\/([^/?#]+)/.exec(String(url || ""));
  if (!m) return null;
  let key;
  try { key = decodeURIComponent(m[1]); } catch { return null; }
  let list = [];
  try { list = JSON.parse(fs.readFileSync(projectsPath, "utf8")); } catch { /* 还没有登记表 */ }
  const hit = (Array.isArray(list) ? list : []).find((e) => e && e.id === key && e.dir);
  return hit ? { projectId: path.basename(hit.dir), dir: path.dirname(hit.dir) } : null;
}

// 一次工具调用前的准备：传了 url 就换成 projectId + dir；工具要项目却两样都没有就报错。
// 返回这次调用用的工作目录；参数不对抛带 code 的错误。
export function prepareCall(ctx, tool, args) {
  if (args.url && !args.projectId) {
    const p = projectFromUrl(args.url);
    if (!p) throw Object.assign(new Error(`认不出 ${args.url} 是哪个项目：要是本地预览服务给出的地址（/p/<项目>/…），且这个项目打开过`), { code: "URL_NOT_FOUND" });
    args.projectId = p.projectId;
    args.dir = p.dir;
  }
  if (tool.schema && "projectId" in tool.schema && "url" in tool.schema && !args.projectId) {
    throw Object.assign(new Error("要传 projectId（加 dir）或 url"), { code: "PROJECT_REQUIRED" });
  }
  return resolveCallWorkspace(ctx, args);
}

// 文档修改人（进 PRD 修改记录表的「修改人」列）：显式 PROTOFLOW_AUTHOR 优先，否则取本机登录
// 用户名（os.userInfo()，跨平台），再不行留空。build_doc 仍可用 author 参数逐次覆盖。
export function resolveAuthor(env = process.env) {
  if (env.PROTOFLOW_AUTHOR) return env.PROTOFLOW_AUTHOR;
  try {
    return os.userInfo().username || "";
  } catch {
    return "";
  }
}
