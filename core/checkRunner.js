// core/checkRunner.js — 发现某文档类型的所有 check 模块并在子进程里跑。
// 决策：子进程 fork（不是进程内 Promise.race）——进程内超时对同步死循环是假的，子进程边界让
// hang 不炸 server、超时能真砍，以后要加权限位（--allow-fs-read 之类）也有地方加。
import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkDirsFor } from "./docKinds.js";

const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), "checkRunnerChild.mjs");

function discoverModules(projectDir, kind) {
  const mods = [];
  for (const dir of checkDirsFor(projectDir, kind)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".mjs") || f.endsWith(".js")) mods.push(path.join(dir, f));
    }
  }
  return mods;
}

// ctx 给 check 模块：{ docMd, docJson, assets:[文件名], docId, versionN }
export async function runChecks(projectDir, kind, ctx, { timeoutMs = 5000 } = {}) {
  const modules = discoverModules(projectDir, kind);
  if (!modules.length) return [];
  return new Promise((resolve) => {
    let done = false;
    const finish = (findings) => { if (done) return; done = true; clearTimeout(timer); try { child.kill("SIGKILL"); } catch {} resolve(findings); };
    const child = fork(CHILD, [], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
    const timer = setTimeout(() => finish([{ code: "CHECK_TIMEOUT", level: "warn", message: `check 执行超时（>${timeoutMs}ms），已跳过` }]), timeoutMs);
    child.on("message", (msg) => finish((msg && msg.findings) || []));
    child.on("error", () => finish([]));
    child.on("exit", (code) => { if (!done && code) finish([]); });
    child.send({ modules, ctx });
  });
}
