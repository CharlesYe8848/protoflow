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
    "画板支持静态展示与 React 状态交互。根据本次目的自主选择静态、交互或混合表达，遵循用户明确要求，不强制所有控件可交互或补齐完整业务流程；编写或修改画板前读取 artboard 指南。",
    "ProtoFlow：创建和修改可点击的产品原型、元素标注，以及基于原型交付带截图的 PRD 和上线说明。已有项目沿用原结构；纯需求讨论或生产应用开发不自动创建项目。",
    "chain_status 只读计算变更影响，不更新校验基线；修改后检查，只检查时不自动修复或发布。",
    "你负责写内容（JSX/标注/captures.json/PRD.md），工具负责校验、登记、构建、组包。",
    '首次使用先调 get_guide({topic:"workflow"})，按场景选择必要步骤；写作规范按需读取对应主题。只交付用户要求的产物。',
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
