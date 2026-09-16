#!/usr/bin/env node
// mcp/server.js — ProtoFlow MCP stdio 入口
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOL_REGISTRY } from "./tools.js";
import { newId } from "../core/ids.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 默认工作目录：PROTOFLOW_HOME 优先；否则用进程启动时的 cwd——MCP server 通常由 agent 从它正在
// 打开的仓库里启动，项目因此天然落在"调用方自己选的目录"里，而不是某个固定的全局位置。
export function resolveWorkspace(env = process.env) {
  return env.PROTOFLOW_HOME || process.cwd();
}

// 单次工具调用可用 args.dir 覆盖默认工作目录（相对路径按 process.cwd() 解析）。
// MCP 的 registerTool 包装器与 bin/protoflow-cli.js 共用这一条逻辑，保证两个入口对
// "项目地址 = ws（父目录）+ projectId（文件夹名）" 的解析方式完全一致。
export function resolveCallWorkspace(ctx, args) {
  return args && args.dir ? path.resolve(args.dir) : ctx.ws;
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

export function buildInstructions() {
  return [
    "ProtoFlow：原型（画板 JSX）→ 标注 → PRD 版本 → 发布包 → 渠道文档 的全链路工具。",
    "每层产物登记上游内容指纹，chain_status 随时算出过期行动清单（改了原型后必跑）。",
    "你负责写内容（JSX/标注/captures.json/PRD.md），工具负责校验、登记、构建、组包。",
    '首次使用先调 get_guide("workflow") 了解完整流程；各环节写作规范见 get_guide 的对应主题。',
  ].join("\n");
}

export function createServer() {
  const server = new McpServer({ name: "protoflow", version: "0.1.0" }, { instructions: buildInstructions() });
  const ctx = { ws: resolveWorkspace(), now: Date.now, genId: (p) => newId(p, Date.now), guidesDir: path.join(HERE, "..", "guides"), author: resolveAuthor() };
  for (const t of TOOL_REGISTRY) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.schema }, async (args) => {
      let result;
      try {
        const callCtx = { ...ctx, ws: resolveCallWorkspace(ctx, args) };
        result = await t.handler(args ?? {}, callCtx);
      }
      catch (e) { result = { ok: false, error: { code: "INTERNAL", message: String(e.message || e) } }; }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], ...(result && result.ok === false ? { isError: true } : {}) };
    });
  }
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--selfcheck")) {
    console.log(`protoflow-mcp selfcheck: ${TOOL_REGISTRY.length} tools, workspace=${resolveWorkspace()}`);
    process.exit(0);
  }
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
