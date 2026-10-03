#!/usr/bin/env node
// check.mjs — 产品研发流程的文档检查：按文档类型跑 ./checks/_shared/ + ./checks/<类型>/ 下的检查脚本。
//
//   node check.mjs <项目目录> <docId> [--type prd|release-note]
//
// 检查的是草稿 docs/<docId>/doc.md（定版前、发布前各跑一次）。类型取 --type，否则取 doc.json 的
// 标签 labels（"product-dev/<类型>"）。输出 { ok, docId, type, findings, errorCount }；有 error
// 级发现项时 ok:false 并以 1 退出——按这个 skill，有 error 的文档不对外发布，除非用户明确接受。
// 只读 AGENTS.md 写明的文件布局（docs/<docId>/doc.md、doc.json、assets/），不 import protoflow 内部模块。
import fs from "node:fs";
import path from "node:path";
import { SkillError, runMain } from "./lib/cli.mjs";
import { runChecks } from "./lib/checkRunner.mjs";

// 这个 skill 给自己管的文档打的标签：product-dev/prd、product-dev/release-note。
export const LABEL_PREFIX = "product-dev/";

// 文档类型：--type 覆盖，否则取标签（doc.json 的 labels，或项目图谱里产物的 labels）。
export function docType(labels, override) {
  if (override) return override;
  const hit = (labels || []).find((l) => l.startsWith(LABEL_PREFIX));
  return hit ? hit.slice(LABEL_PREFIX.length) : null;
}

export async function run(argv) {
  const typeAt = argv.indexOf("--type");
  const override = typeAt >= 0 ? argv[typeAt + 1] : null;
  const [projectArg, docId] = argv.filter((a, i) => !a.startsWith("--") && (typeAt < 0 || i !== typeAt + 1));
  if (!projectArg || !docId) throw new SkillError("USAGE", "用法：node check.mjs <项目目录> <docId> [--type prd|release-note]");
  const docDir = path.join(path.resolve(projectArg), "docs", docId);
  const mdPath = path.join(docDir, "doc.md");
  if (!fs.existsSync(mdPath)) throw new SkillError("DOC_NOT_FOUND", `找不到 ${mdPath}`);
  const jsonPath = path.join(docDir, "doc.json");
  const docJson = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : {};
  const type = docType(docJson.labels, override);
  const assetsDir = path.join(docDir, "assets");
  const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter((f) => !f.endsWith(".source.json")) : [];
  const findings = await runChecks(type, { docMd: fs.readFileSync(mdPath, "utf8"), docJson, assets, docId });
  const errorCount = findings.filter((f) => f.level === "error").length;
  return { ok: errorCount === 0, docId, type, findings, errorCount };
}

runMain(import.meta.url, run);
