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

test("--selfcheck 打印工具数量；--help 每个工具一行；help <工具> 列出完整说明和参数", () => {
  const self = execFileSync("node", [cliPath, "--selfcheck"], { encoding: "utf8" });
  assert.ok(self.includes("30 tools"));
  const help = execFileSync("node", [cliPath, "--help"], { encoding: "utf8" });
  const toolLines = help.split("\n").filter((l) => /^  [a-z_]+ /.test(l));
  assert.equal(toolLines.length, 30, "每个工具正好一行");
  assert.ok(toolLines.every((l) => l.length < 120), "每行是一句短说明，不是整段描述");
  const one = execFileSync("node", [cliPath, "help", "delete"], { encoding: "utf8" });
  assert.ok(one.includes("canvas=画布") && one.includes("--targetId  字符串，必填") && one.includes("--url"));
});

test("参数两种写法：--参数 值（值像 JSON 就按 JSON 解析）和一整个 JSON；--url 用预览页地址定位项目", () => {
  const ws = tmpDir();
  const proj = run(["create_project", "--name", "旗标", "--dir", ws]);
  const pg = run(["upsert_page", "--projectId", proj.id, "--dir", ws, "--name", "首页"]);
  assert.ok(pg.id.startsWith("pg_"));
  const draft = path.join(ws, "draft.md");
  fs.writeFileSync(draft, "# 周报\n\n正文 \"引号\" 和 $变量 都不用转义\n");
  const doc = run(["create_doc", "--projectId", proj.id, "--dir", ws, "--docId", "weekly", "--content", "@" + draft, "--labels", '["x/y"]']);
  assert.deepEqual(doc.labels, ["x/y"]);
  assert.equal(fs.readFileSync(doc.docMdPath, "utf8"), "# 周报\n\n正文 \"引号\" 和 $变量 都不用转义\n", "@文件 读的是文件内容");
  const gp = run(["get_project", "--projectId", proj.id, "--dir", ws, "--findings", "true"]);
  assert.ok(Array.isArray(gp.findings));
  // --url：预览页地址里的 /p/<key>/ 在本地预览服务的登记表里查项目目录（测试用临时登记表）
  const reg = path.join(tmpDir(), "projects.json");
  fs.writeFileSync(reg, JSON.stringify([{ id: "旗标-2", dir: path.join(ws, proj.id), name: "旗标" }]));
  const env = { ...process.env, PROTOFLOW_PROJECTS_STATE: reg };
  const byUrl = JSON.parse(execFileSync("node", [cliPath, "get_project", "--url", `http://127.0.0.1:4287/p/${encodeURIComponent("旗标-2")}/canvases/main/canvas.html`], { encoding: "utf8", env }));
  assert.equal(byUrl.project.id, proj.id, "key 跟文件夹名不同也能认出来");
  let err;
  try { execFileSync("node", [cliPath, "get_project", "--url", "http://127.0.0.1:4287/p/nope/"], { encoding: "utf8", env }); } catch (e) { err = JSON.parse(e.stdout); }
  assert.equal(err.error.code, "URL_NOT_FOUND");
  try { execFileSync("node", [cliPath, "get_project"], { encoding: "utf8", env }); } catch (e) { err = JSON.parse(e.stdout); }
  assert.equal(err.error.code, "PROJECT_REQUIRED");
});

test("未知命令与非法 JSON 参数都以非零退出码报错", () => {
  assert.throws(() => execFileSync("node", [cliPath, "nope"], { encoding: "utf8" }));
  assert.throws(() => execFileSync("node", [cliPath, "create_project", "{not json"], { encoding: "utf8" }));
});

test("端到端：纯 CLI 建项目→画板→保存→健康检查全绿，且项目自包含 AGENTS.md", () => {
  const ws = tmpDir();
  const proj = run(["create_project", JSON.stringify({ name: "结账流程", dir: ws })]);
  assert.equal(proj.id, "结账流程");
  assert.ok(fs.existsSync(path.join(ws, proj.id, "AGENTS.md")), "项目应自带 AGENTS.md，任何 agent 靠它就能接手");

  const pg = run(["upsert_page", JSON.stringify({ projectId: proj.id, name: "支付页", dir: ws })]);
  const ab = run(["upsert_artboard", JSON.stringify({ projectId: proj.id, pageId: pg.id, name: "确认订单", dir: ws })]);
  const saved = run(["save_artboard_source", JSON.stringify({
    projectId: proj.id, artboardId: ab.id, dir: ws,
    source: `function Component(){ return <div id="pay">Pay</div>; }`,
  })]);
  assert.equal(saved.ok, true);

  const status = run(["get_project", JSON.stringify({ projectId: proj.id, dir: ws, findings: true })]);
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

test("render_canvas 返回 http://127.0.0.1 的 url", () => {
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
