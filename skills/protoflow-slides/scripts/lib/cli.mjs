// cli.mjs — 这个 skill 的脚本（跟 protoflow-product-dev 的同名文件一样：skill 之间不互相引用，各带一份）调 protoflow 公开接口（CLI）的唯一入口。找 CLI 的顺序：
//   1. 环境变量 PROTOFLOW_CLI（CLI 脚本路径）
//   2. skill 所在仓库的 bin/protoflow-cli.js（skill 在 protoflow 仓库里时，版本一定一致）
//   3. PATH 上的 protoflow 命令（skill 被拷进 agent 的技能目录、protoflow 用 npm 装好了）
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_CLI = path.resolve(HERE, "../../../../bin/protoflow-cli.js");

function onPath(cmd) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const p = path.join(dir, cmd);
    if (dir && fs.existsSync(p)) return p;
  }
  return null;
}

// [可执行文件, ...前置参数]
function resolveCli() {
  if (process.env.PROTOFLOW_CLI) return [process.execPath, process.env.PROTOFLOW_CLI];
  if (fs.existsSync(REPO_CLI)) return [process.execPath, REPO_CLI];
  const bin = onPath("protoflow");
  if (bin) return [bin];
  throw new SkillError("CLI_NOT_FOUND", "找不到 protoflow CLI：设 PROTOFLOW_CLI=<protoflow 仓库>/bin/protoflow-cli.js，或者 npm i -g 装好 protoflow");
}

export class SkillError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function cli(tool, args) {
  const [cmd, ...pre] = resolveCli();
  const r = spawnSync(cmd, [...pre, tool, JSON.stringify(args)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let out;
  try { out = JSON.parse(r.stdout); } catch { throw new SkillError("CLI_FAILED", `protoflow ${tool} 没有返回 JSON：${(r.stderr || r.stdout || "").slice(0, 500)}`); }
  if (out && out.ok === false) throw new SkillError(out.error?.code || "CLI_FAILED", `protoflow ${tool}：${out.error?.message || "失败"}`);
  return out;
}

// 项目目录 → CLI 的 { projectId, dir }
export const projectArgs = (projectDir) => ({ projectId: path.basename(projectDir), dir: path.dirname(projectDir) });

// 以 main 身份运行时统一输出 JSON：成功打印结果，失败打印 { ok:false, error } 并以 1 退出。
export function runMain(importMetaUrl, fn) {
  if (!process.argv[1]) return;
  const invokedPath = fs.realpathSync(path.resolve(process.argv[1]));
  const modulePath = fs.realpathSync(fileURLToPath(importMetaUrl));
  if (invokedPath !== modulePath) return;
  fn(process.argv.slice(2)).then(
    (r) => { console.log(JSON.stringify(r, null, 2)); if (r && r.ok === false) process.exit(1); },
    (e) => { console.log(JSON.stringify({ ok: false, error: { code: e.code || "INTERNAL", message: e.message } }, null, 2)); process.exit(1); },
  );
}
