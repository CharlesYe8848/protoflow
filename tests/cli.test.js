import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "protoflow-cli.js");
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "pf-cli-"));

function run(args, { expectFail = false } = {}) {
  try {
    const out = execFileSync("node", [cliPath, ...args], { encoding: "utf8" });
    if (expectFail) assert.fail("期望非零退出码，但成功了");
    return JSON.parse(out);
  } catch (e) {
    if (!expectFail) throw e;
    return JSON.parse(e.stdout);
  }
}

test("--selfcheck 打印工具数量；--help 列出全部子命令", () => {
  const self = execFileSync("node", [cliPath, "--selfcheck"], { encoding: "utf8" });
  assert.ok(self.includes("22 tools"));
  const help = execFileSync("node", [cliPath, "--help"], { encoding: "utf8" });
  assert.ok(help.includes("create_project"));
  assert.ok(help.includes("chain_status"));
});

test("未知命令与非法 JSON 参数都以非零退出码报错", () => {
  assert.throws(() => execFileSync("node", [cliPath, "nope"], { encoding: "utf8" }));
  assert.throws(() => execFileSync("node", [cliPath, "create_project", "{not json"], { encoding: "utf8" }));
});

test("端到端：不经过 MCP，纯 CLI 建项目→画板→保存→chain_status 全绿，且项目自包含 AGENTS.md", () => {
  const ws = tmpDir();
  const proj = run(["create_project", JSON.stringify({ name: "结账流程", dir: ws })]);
  assert.equal(proj.id, "结账流程");
  assert.ok(fs.existsSync(path.join(ws, proj.id, "AGENTS.md")), "项目应自带 AGENTS.md，脱离 MCP 也能被理解");

  const pg = run(["upsert_page", JSON.stringify({ projectId: proj.id, name: "支付页", dir: ws })]);
  const ab = run(["upsert_artboard", JSON.stringify({ projectId: proj.id, pageId: pg.id, name: "确认订单", dir: ws })]);
  const saved = run(["save_artboard_source", JSON.stringify({
    projectId: proj.id, artboardId: ab.id, dir: ws,
    source: `function Component(){ return <div id="pay">Pay</div>; }`,
  })]);
  assert.equal(saved.ok, true);

  const status = run(["chain_status", JSON.stringify({ projectId: proj.id, dir: ws })]);
  assert.deepEqual(status.findings, []);

  // 编译失败的保存：CLI 以非零退出码结束，脚本/CI 能据此判断成败
  const bad = run(["save_artboard_source", JSON.stringify({ projectId: proj.id, artboardId: ab.id, dir: ws, source: "function Component(){ return <div" })], { expectFail: true });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "COMPILE_ERROR");
});

test("dir 缺省时退回默认工作目录（PROTOFLOW_HOME）", () => {
  const ws = tmpDir();
  const out = execFileSync("node", [cliPath, "list_projects"], { encoding: "utf8", env: { ...process.env, PROTOFLOW_HOME: ws } });
  assert.deepEqual(JSON.parse(out).projects, []);
});

test("CLI 路径（不经过 MCP）跟 MCP 拿到的能力一样：render_canvas 也带 http://127.0.0.1 的 url", () => {
  const ws = tmpDir();
  const statusPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pf-cli-srv-")), "server.json");
  const env = { ...process.env, PROTOFLOW_SERVER_STATUS: statusPath };
  try {
    const proj = JSON.parse(execFileSync("node", [cliPath, "create_project", JSON.stringify({ name: "T", dir: ws })], { encoding: "utf8", env }));
    JSON.parse(execFileSync("node", [cliPath, "upsert_page", JSON.stringify({ projectId: proj.id, name: "pg", dir: ws })], { encoding: "utf8", env }));
    const out = execFileSync("node", [cliPath, "render_canvas", JSON.stringify({ projectId: proj.id, dir: ws })], { encoding: "utf8", env });
    // render_canvas 需要至少一个页面（已建），但没有画板时也能渲染出占位画布
    const r = JSON.parse(out);
    assert.equal(r.ok, true);
    assert.match(r.url, /^http:\/\/127\.0\.0\.1:\d+\/p\/[^/]+\//);
  } finally {
    try { process.kill(JSON.parse(fs.readFileSync(statusPath, "utf8")).pid); } catch {}
  }
});
