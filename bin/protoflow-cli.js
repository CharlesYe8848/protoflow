#!/usr/bin/env node
// bin/protoflow-cli.js — ProtoFlow 非交互 CLI。
// 与 mcp/server.js 共用同一份 TOOL_REGISTRY/core，不重复业务逻辑；MCP 不在场时，
// 项目依然能被同一套代码校验/构建——这是让"数据/工具解耦"真正成立的那一半。
//
// 用法：protoflow <tool_name> ['<json_args>']
//   protoflow --help                列出全部子命令
//   protoflow --selfcheck           打印工具数量后退出（脚本/CI 探活用）
//
// 参数结构与对应的 MCP 工具完全一致（见 protoflow --help 里每个命令的 description），
// 额外都支持一个 dir 字段：覆盖默认工作目录（项目所在父目录），缺省为 PROTOFLOW_HOME 或当前 cwd。
// 输出：结果 JSON 打印到 stdout；ok:false 时进程以非零退出码结束，便于脚本/CI 判断成败。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_REGISTRY, TOOL_MAP } from "../mcp/tools.js";
import { resolveWorkspace, resolveCallWorkspace, resolveAuthor } from "../mcp/server.js";
import { newId } from "../core/ids.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log("用法: protoflow <tool_name> ['<json_args>']\n");
  console.log("子命令与 protoflow MCP 的工具一一对应（同一份 TOOL_REGISTRY），额外都支持 dir 字段覆盖工作目录：\n");
  for (const t of TOOL_REGISTRY) console.log(`  ${t.name}\n    ${t.description}\n`);
}

async function main() {
  const [cmd, rawArgs] = process.argv.slice(2);

  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp();
    process.exit(cmd ? 0 : 1);
  }
  if (cmd === "--selfcheck") {
    console.log(`protoflow-cli selfcheck: ${TOOL_REGISTRY.length} tools, defaultDir=${resolveWorkspace()}`);
    return;
  }

  const t = TOOL_MAP[cmd];
  if (!t) {
    console.error(`未知命令: ${cmd}\n\n--help 查看可用命令列表`);
    process.exit(1);
  }

  let args;
  try { args = rawArgs ? JSON.parse(rawArgs) : {}; }
  catch (e) { console.error(`第二个参数不是合法 JSON: ${e.message}`); process.exit(1); return; }

  const ctx = { ws: resolveWorkspace(), now: Date.now, genId: (p) => newId(p, Date.now), guidesDir: path.join(HERE, "..", "guides"), author: resolveAuthor() };
  const callCtx = { ...ctx, ws: resolveCallWorkspace(ctx, args) };

  let result;
  try { result = await t.handler(args, callCtx); }
  catch (e) { result = { ok: false, error: { code: "INTERNAL", message: String(e.message || e) } }; }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result && result.ok === false ? 1 : 0);
}

main();
