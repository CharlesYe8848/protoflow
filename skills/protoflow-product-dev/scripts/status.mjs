#!/usr/bin/env node
// status.mjs — 产品研发流程的关系体检。框架只报引用的事实（谁引用了谁、过没过期，见项目图谱），
// "PRD 应该关联原型""上线公告应该基于 PRD"这类约定是这个 skill的，在这里检查。
//
//   node status.mjs <项目目录>
//
// 数据来自 CLI get_project 的项目图谱（graph，schemaVersion 1）；文档类型取产物的标签（labels）。
// 输出 { ok, findings:[{ code, level, target, message }] }：
//   PRD_NO_CANVAS          PRD 的最新版没有引用任何画布（截图没带出处，或者没截图也没声明）
//   RELEASE_NOTE_NO_PRD    上线公告的最新版没有引用任何文档
//   SOURCE_STALE / SOURCE_MISSING   最新版引用的内容变了 / 没了（来自图谱，附上本 skill 的建议）
//   NOT_BUILT              文档还没定过版
import path from "node:path";
import { cli, projectArgs, SkillError, runMain } from "./lib/cli.mjs";
import { docType } from "./check.mjs";

const SUPPORTED_GRAPH = 1;

export async function run(argv) {
  const [projectArg] = argv;
  if (!projectArg) throw new SkillError("USAGE", "用法：node status.mjs <项目目录>");
  const projectDir = path.resolve(projectArg);
  const { graph } = cli("get_project", projectArgs(projectDir));
  if (!graph || graph.schemaVersion !== SUPPORTED_GRAPH) {
    throw new SkillError("GRAPH_VERSION", `项目图谱 schemaVersion ${graph && graph.schemaVersion} 不是这个 skill支持的 ${SUPPORTED_GRAPH}`);
  }
  const findings = [];
  const add = (code, level, target, message) => findings.push({ code, level, target, message });
  for (const a of graph.artifacts) {
    const target = `${a.type}:${a.id}`;
    for (const s of a.sources || []) {
      if (s.status === "stale") add("SOURCE_STALE", "warn", target, `「${a.title}」v${a.head} 引用的内容变了：${s.reason}。按任务需要重截图或更新内容，再定新版本`);
      if (s.status === "missing") add("SOURCE_MISSING", "warn", target, `「${a.title}」v${a.head} 引用的 ${s.ref} 不在了：${s.reason}`);
    }
    if (a.type !== "doc") continue;
    const type = docType(a.labels);
    if (!a.head) { add("NOT_BUILT", "info", target, `「${a.title}」还没定过版`); continue; }
    const types = new Set((a.sources || []).map((s) => s.ref.split(":")[0]));
    if (type === "prd" && !types.has("canvas")) add("PRD_NO_CANVAS", "warn", target, `PRD「${a.title}」v${a.head} 没有引用任何画布：截图没用本 skill 的截图脚本（没带出处），或者没截图也没声明 sources`);
    if (type === "release-note" && !types.has("doc")) add("RELEASE_NOTE_NO_PRD", "warn", target, `上线公告「${a.title}」v${a.head} 没有引用任何文档：建文档时用 from，或定版时声明 sources:["doc:<prd>"]`);
  }
  return { ok: true, findings };
}

runMain(import.meta.url, run);
