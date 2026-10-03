// core/sdk-testing.js — 插件作者的测试工具（"protoflow/sdk/testing"），docs/product-architecture.md §4.11。
//
// 在一个临时工作区里，用跟 CLI、本地服务同一套注册和分发把插件跑起来：建项目、调工具、渲染页面、
// 取版本文件、导出。插件不需要知道框架内部怎么组装。
//
//   const host = createTestHost([myPlugin]);          // 可以连同它依赖的别的插件一起传
//   const { id } = host.createProject("演示");
//   await host.call("create_note", { projectId: id, noteId: "a", content: "hi" });
//   const html = host.render(id, "notes/a/preview.html");
//   const out = await host.export(id, "note/a/md");
//   host.cleanup();
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRegistry } from "./plugin.js";
import { createProject } from "./store.js";
import { createProjectRenderer } from "./renderService.js";
import { runProjectExport } from "./exportService.js";
import { createEmbedder } from "./embed.js";

// 工具返回的预览地址会拉起本地服务、登记项目。没指定过就指到临时工作区里，测试项目不会进用户自己的
// "最近项目"列表（~/.protoflow/projects.json 只留 30 条，会把用户的项目挤掉）。
function isolateLocalServer(ws) {
  if (!process.env.PROTOFLOW_SERVER_STATUS) process.env.PROTOFLOW_SERVER_STATUS = path.join(ws, ".protoflow-test", "server.json");
  if (!process.env.PROTOFLOW_PROJECTS_STATE) process.env.PROTOFLOW_PROJECTS_STATE = path.join(ws, ".protoflow-test", "projects.json");
}

export function tempWorkspace(prefix = "pf-plugin-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// descriptors：插件描述（definePlugin / defineEntityProduct 的返回值）。注册失败（描述不合法、冲突……）直接抛，
// 带上原因——测试里这就是要修的问题。
export function createTestHost(descriptors, { ws = tempWorkspace(), now = 1700000000000 } = {}) {
  isolateLocalServer(ws);
  const reg = {};
  const candidates = descriptors.map((d, i) => ({ source: `test:${(d && d.type) || i}`, descriptor: d }));
  const { products, tools, skipped } = buildRegistry(candidates, { reg });
  if (skipped.length) throw new Error(`插件注册失败：${skipped.map((s) => `${s.source} ${s.reason}`).join("；")}`);
  const resolvers = Object.fromEntries(products.filter((p) => p.resolver).map((p) => [p.resolver.type, p.resolver]));
  const renderer = createProjectRenderer(products);
  const runExport = (projectRoot, subPath, opts) => runProjectExport(projectRoot, subPath, products, opts);
  Object.assign(reg, { products, resolvers, runExport, embed: createEmbedder(products) });

  let seq = 0;
  const ctx = { ws, now: () => now + (++seq) * 1000, genId: (prefix) => `${prefix}_t${++seq}`, author: "test" };
  const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]));
  const root = (pid) => path.join(ws, pid);

  return {
    ws, ctx, products, reg, tools: toolMap,
    createProject: (name) => createProject(ws, name, ctx, { products }),
    // 调一个插件工具，跟 CLI 一样：handler(args, ctx)，返回它的结果（失败是 { ok: false, error }）。
    async call(name, args = {}) {
      const t = toolMap[name];
      if (!t) throw new Error(`没有这个工具：${name}（有：${Object.keys(toolMap).join(", ")}）`);
      return t.handler(args, ctx);
    },
    // 本地服务对这个路径会返回的页面 HTML（产品主页面带项目侧边栏）；不是页面回 null。
    render: (pid, relPath, opts = {}) => renderer.renderProjectView(root(pid), relPath, opts),
    // 版本里文件的实际位置（<rootSeg>/<id>/versions/<n>/<路径>）。
    file: (pid, relPath) => renderer.resolveProjectFile(root(pid), relPath),
    // 导出：subPath 同本地服务的导出端点，<类型>/<id>/<格式>。返回 { filename, buffer, mime } 或 null。
    export: (pid, subPath, opts) => runExport(root(pid), subPath, opts),
    cleanup: () => fs.rmSync(ws, { recursive: true, force: true }),
  };
}
