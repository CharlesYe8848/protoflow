// core/toolKit.js — 写 CLI 工具的公共零件（框架）：错误格式、项目参数、本地服务地址、引用参数、
// 导出写文件。框架工具（cli/tools.js）和各产品的工具（products/<产品>/tools.js）都用这一份。
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { toLocalUrl } from "./localServer.js";
import { pinRefs } from "./refs.js";

export const fail = (code, message, hint) => ({ ok: false, error: { code, message, ...(hint ? { hint } : {}) } });

export const dirParam = { dir: z.string().optional().describe("覆盖默认工作目录（项目所在父目录）；相对路径按当前工作目录解析；缺省用 PROTOFLOW_HOME 或启动时的 cwd") };
export const pid = {
  projectId: z.string().optional().describe("项目 id（同时也是项目文件夹名）；跟 url 二选一"),
  url: z.string().optional().describe("项目里任意一个预览页的地址（http://127.0.0.1:<端口>/p/<项目>/…，比如浏览器当前标签页），代替 projectId + dir"),
  ...dirParam,
};

// 给已有的 htmlPath/canvasPath 之类的 file:// 路径追加一个 http://127.0.0.1 出口，给打不开
// file:// 的浏览器工具用；起本地服务失败（比如沙箱禁止 spawn/bind 端口）不影响原有返回。
export async function withUrl(projectId, projectDir, absPath, obj) {
  try { return { ...obj, url: await toLocalUrl(absPath, { projectId, projectDir }) }; }
  catch { return obj; }
}

// 建产物的工具共用的 labels 参数（core/labels.js）。
export const labelsParam = z.array(z.string()).optional().describe(
  "标签，如 [\"product-dev/prd\"]。框架只存、在 get_project 的 graph 里原样返回，不解释含义；流程 skill 用它认出自己管的产物");

// 定版工具共用的 sources 参数（core/refs.js）。
export const sourcesParam = z.array(z.string()).optional().describe(
  "这一版基于项目里哪些产物，格式 类型:id@版本#子部位，如 <类型>:<id>@3（第 3 版整个）、<类型>:<id>@3#<子部位>（第 3 版的某一部分）；类型是产品名，子部位由各产品定义，项目的 AGENTS.md 里有各产品的写法。不写 @版本 就固定到对方当前最新版。用到了项目里其它产物的内容就写上，之后对方变了能知道这一版过期了。不传就沿用上一版声明的；传 [] 清空。截图等素材自带出处的会自动收进来，不用写");

// 校验并固定版本（不带 @n 的固定到对方当前最新版）。没传回 { sources: undefined }（沿用上一版声明的），
// 格式或目标不对回 { error }。resolvers 来自产品注册表。
export function pinSources(ctx, projectId, refs, resolvers) {
  if (refs == null) return { sources: undefined };
  const r = pinRefs(ctx.ws, projectId, refs, resolvers);
  return r.ok ? { sources: r.sources } : { error: r };
}

// 导出工具共用：把 { filename, buffer } 写到 outDir 下。
export function writeExport(outDir, out) {
  const outPath = path.resolve(outDir, out.filename);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out.buffer);
  return { ok: true, path: outPath, bytes: out.buffer.length };
}
