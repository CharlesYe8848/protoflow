import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { resolveWorkspace, resolveCallWorkspace, resolveAuthor } from "../cli/context.js";

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
