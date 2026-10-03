#!/usr/bin/env node
// bin/protoflow-cli.js — ProtoFlow 非交互 CLI。
// 工具定义在 cli/tools.js（框架的几个 + 各产品注册的），调用前的准备在 cli/context.js。agent 直接读写项目
// 里的正文文件，校验、定版、预览、导出这些文件做不了的事走这里。
//
// 用法：protoflow <工具> [--参数 值 …]   或   protoflow <工具> '<json 参数>'
//   protoflow --help                每个工具一行
//   protoflow help <工具>            这个工具的完整说明和参数
//   protoflow --selfcheck           打印工具数量后退出（脚本/CI 探活用）
//
// 参数跟工具的 schema 一致；要项目的工具可以用 --url <预览页地址> 代替 --projectId + --dir。
// --参数 值 的写法里，值是 JSON（数组、对象、数字、true/false）就按 JSON 解析，否则当字符串；
// 写成 @文件路径 就读这个文件的内容（长正文、JSON 不用在命令行里转义，比如 --content @draft.md）。
// 输出：结果 JSON 打印到 stdout；ok:false 时进程以非零退出码结束，便于脚本/CI 判断成败。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTools } from "../cli/tools.js";
import { loadRegistry } from "../products/index.js";
import { resolveWorkspace, prepareCall, resolveAuthor } from "../cli/context.js";
import { newId } from "../core/ids.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 按配置加载产品（内置 + protoflow.config.json 里的插件，去掉禁用的），工具表按这份注册表生成。
const registry = await loadRegistry();
const { TOOL_REGISTRY, TOOL_MAP } = createTools(registry);

// 描述的第一句（到第一个句号/分号），--help 列表里一行一个
function summary(desc) {
  const first = String(desc || "").split(/[。；;]/)[0];
  return first.length > 60 ? first.slice(0, 60) + "…" : first;
}

function printHelp() {
  console.log("用法: protoflow <工具> [--参数 值 …]    （或 protoflow <工具> '<json 参数>'）");
  console.log("要项目的工具可以用 --url <预览页地址> 代替 --projectId + --dir；值写成 @文件 就读文件内容。protoflow help <工具> 看完整说明和参数。\n");
  const w = Math.max(...TOOL_REGISTRY.map((t) => t.name.length));
  for (const t of TOOL_REGISTRY) console.log(`  ${t.name.padEnd(w)}  ${summary(t.description)}`);
}

// zod 字段 → "类型"、是否必填、说明
function describeField(field) {
  let f = field, optional = false;
  while (f && f._def && (f._def.typeName === "ZodOptional" || f._def.typeName === "ZodDefault")) { optional = true; f = f._def.innerType; }
  const type = { ZodString: "字符串", ZodNumber: "数字", ZodBoolean: "true/false", ZodArray: "JSON 数组", ZodObject: "JSON 对象", ZodEnum: "取值 " + ((f && f._def.values) || []).join("|") }[f && f._def && f._def.typeName] || "JSON";
  return { type, optional, desc: field.description || (f && f.description) || "" };
}

function printToolHelp(t) {
  console.log(`${t.name}\n\n${t.description}\n\n参数：`);
  for (const [k, v] of Object.entries(t.schema || {})) {
    const d = describeField(v);
    console.log(`  --${k}  ${d.type}${d.optional ? "，可选" : "，必填"}${d.desc ? "：" + d.desc : ""}`);
  }
}

// --key value … → 参数对象；值像 JSON 就按 JSON 解析
function parseFlags(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`认不出参数 ${argv[i]}：写成 --参数 值`);
    let v = m[2] !== undefined ? m[2] : (i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
    if (typeof v === "string" && v.startsWith("@") && v.length > 1) {
      const file = path.resolve(v.slice(1));
      if (!fs.existsSync(file)) throw new Error(`--${m[1]} 指向的文件不存在：${file}`);
      v = fs.readFileSync(file, "utf8");
      if (/\.json$/i.test(file)) { try { v = JSON.parse(v); } catch { /* 当字符串 */ } }
    } else if (/^[\[{]|^(true|false|null|-?\d+(\.\d+)?)$/.test(v)) { try { v = JSON.parse(v); } catch { /* 当字符串 */ } }
    args[m[1]] = v;
  }
  return args;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp();
    process.exit(cmd ? 0 : 1);
  }
  if (cmd === "help") {
    const t = TOOL_MAP[rest[0]];
    if (!t) { printHelp(); process.exit(rest[0] ? 1 : 0); }
    printToolHelp(t);
    return;
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
  try { args = rest.length && !rest[0].startsWith("--") ? JSON.parse(rest[0]) : parseFlags(rest); }
  catch (e) { console.error(`参数不对：${e.message}\n\nprotoflow help ${cmd} 查看参数`); process.exit(1); return; }

  const ctx = { ws: resolveWorkspace(), now: Date.now, genId: (p) => newId(p, Date.now), guidesDir: path.join(HERE, "..", "guides"), skillsDir: path.join(HERE, "..", "skills"), author: resolveAuthor() };
  let result;
  try { result = await t.handler(args, { ...ctx, ws: prepareCall(ctx, t, args) }); }
  catch (e) { result = { ok: false, error: { code: e.code || "INTERNAL", message: String(e.message || e) } }; }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result && result.ok === false ? 1 : 0);
}

main();
