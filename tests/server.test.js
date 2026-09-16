import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { buildInstructions, resolveWorkspace, resolveCallWorkspace, resolveAuthor } from "../mcp/server.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("instructions 含工作流引导与工具引子", () => {
  const s = buildInstructions();
  assert.ok(s.includes("get_guide"));
  assert.ok(s.includes("chain_status"));
});

test("resolveWorkspace：优先 PROTOFLOW_HOME，缺省当前工作目录", () => {
  assert.equal(resolveWorkspace({ PROTOFLOW_HOME: "/tmp/x" }), "/tmp/x");
  assert.equal(resolveWorkspace({}), process.cwd());
});

test("resolveCallWorkspace：args.dir 覆盖默认 ws，未传则用默认 ws", () => {
  const ctx = { ws: "/default/ws" };
  assert.equal(resolveCallWorkspace(ctx, { dir: "/tmp/x" }), "/tmp/x");
  assert.equal(resolveCallWorkspace(ctx, {}), "/default/ws");
  assert.equal(resolveCallWorkspace(ctx, undefined), "/default/ws");
});

test("resolveAuthor：PROTOFLOW_AUTHOR 优先，缺省取本机登录用户名", () => {
  assert.equal(resolveAuthor({ PROTOFLOW_AUTHOR: "张三" }), "张三");
  const fallback = resolveAuthor({});
  assert.equal(fallback, os.userInfo().username);
  assert.ok(fallback.length > 0, "本机总有登录用户名，修改人列不再空缺");
});

test("--selfcheck 打印 22 个工具并退出 0", () => {
  const out = execFileSync("node", [path.join(root, "mcp", "server.js"), "--selfcheck"], { encoding: "utf8" });
  assert.ok(out.includes("22 tools"));
});
