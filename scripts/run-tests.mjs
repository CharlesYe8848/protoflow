#!/usr/bin/env node
// 跑测试的入口（npm test）。测试里到处 fs.mkdtempSync(os.tmpdir()) 建临时项目，却不清理——
// 跑一次留几百个目录，攒多了能把磁盘写满（实际发生过：系统临时目录里 8000+ 个 pf-* 目录、19G）。
// 这里给每次运行单独建一个临时根目录，用 TMPDIR 指给测试进程（os.tmpdir() 认这个变量），跑完
// 不管成败整个删掉。产品插件的配置也指到这个目录里（默认没有 = 只用内置产品），不读用户自己的配置。测试里拉起的后台服务状态文件也在这个目录下，目录一删它们会自己退出（见
// bin/protoflow-server.mjs 的单例自检）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const runTmp = fs.mkdtempSync(path.join(os.tmpdir(), "protoflow-test-run-"));
const testFiles = fs.readdirSync(path.join(root, "tests")).filter((f) => f.endsWith(".test.js")).map((f) => path.join("tests", f));
const args = ["--test", ...process.argv.slice(2), ...testFiles];

// 测试里建的项目、拉起的本地服务都不能碰用户自己的 ~/.protoflow：服务状态、项目登记表（"最近项目"只留 30 条，
// 测试项目会把用户的项目挤掉——真出过事）、插件配置都指到这次运行的临时目录。
function isolatedEnv(dir) {
  return {
    PROTOFLOW_SERVER_STATUS: path.join(dir, "server.json"),
    PROTOFLOW_PROJECTS_STATE: path.join(dir, "projects.json"),
    PROTOFLOW_CONFIG: path.join(dir, "protoflow.config.json"),
  };
}

let status = 1;
try {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env: { ...process.env, TMPDIR: runTmp, ...isolatedEnv(runTmp) } });
  status = r.status ?? 1;
} finally {
  fs.rmSync(runTmp, { recursive: true, force: true });
}
process.exit(status);
