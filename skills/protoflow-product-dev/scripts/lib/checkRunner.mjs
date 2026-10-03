// checkRunner.mjs — 在子进程里跑某类文档的检查（../checks/_shared/ + ../checks/<类型>/ 下的 *.mjs）。
// 子进程 fork 而不是进程内跑：检查脚本死循环、抛错不会拖垮调用方，超时能真砍。
//
// 检查脚本的契约：export default function check(ctx) → [{ code, level, message, hint? }]
//   ctx = { docMd, docJson, assets: [文件名], docId }
//   level: "error" | "warn" | "info"。error 表示这份文档按产品研发流程的要求还不能对外发布。
import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKS = path.join(HERE, "..", "checks");
const CHILD = path.join(HERE, "checkChild.mjs");

export function checkModules(type) {
  const mods = [];
  for (const seg of ["_shared", type]) {
    const dir = path.join(CHECKS, seg);
    if (!seg || !fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) if (/\.m?js$/.test(f)) mods.push(path.join(dir, f));
  }
  return mods;
}

export async function runChecks(type, ctx, { timeoutMs = 5000 } = {}) {
  const modules = checkModules(type);
  if (!modules.length) return [];
  return new Promise((resolve) => {
    let done = false;
    const finish = (findings) => { if (done) return; done = true; clearTimeout(timer); try { child.kill("SIGKILL"); } catch {} resolve(findings); };
    const child = fork(CHILD, [], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
    const timer = setTimeout(() => finish([{ code: "CHECK_TIMEOUT", level: "warn", message: `检查执行超时（>${timeoutMs}ms），已跳过` }]), timeoutMs);
    child.on("message", (msg) => finish((msg && msg.findings) || []));
    child.on("error", () => finish([]));
    child.on("exit", (code) => { if (!done && code) finish([]); });
    child.send({ modules, ctx });
  });
}
