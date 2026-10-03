import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgentsDoc } from "../core/agentsDoc.js";
import { PRODUCTS } from "../products/index.js";

const agentsDoc = () => buildAgentsDoc({ projectId: "demo-project", projectName: "demo", products: PRODUCTS });

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertModificationClosure(content) {
  for (const term of ["get_project", "findings", "save_artboard_source", "idAudit", "write_annotations", "过期"]) {
    assert.ok(content.includes(term), `缺少修改闭环约定：${term}`);
  }
}

test("Skill 与 workflow 都包含已有原型的最低修改闭环", () => {
  const skill = read("skills/protoflow/SKILL.md");
  const workflow = read("guides/workflow.md");

  assert.ok(skill.includes("protoflow get_guide --topic workflow"), "入口 skill 用 CLI 写法");
  assert.ok(!/MCP/.test(skill), "入口 skill 只讲 CLI");
  assert.ok(workflow.includes("## 修改已有原型的闭环"));
  assertModificationClosure(skill);
  assertModificationClosure(workflow);
});

test("项目 AGENTS 为 CLI-only agent 保留同一修改闭环", () => {
  const agents = agentsDoc();
  assertModificationClosure(agents);
  assert.ok(agents.includes("protoflow get_guide --topic workflow"));
  assert.ok(!/MCP/.test(agents), "AGENTS.md 只讲 CLI");
  assert.ok(agents.includes("只改原型时不自动更新文档"));
});

test("表格（sheets/）作为独立产物，在 Skill/workflow/AGENTS 三处都能被发现", () => {
  const skill = read("skills/protoflow/SKILL.md");
  const workflow = read("guides/workflow.md");
  const agents = agentsDoc();
  for (const content of [skill, workflow, agents]) {
    assert.ok(content.includes("create_sheet") || content.includes("build_sheet") || content.includes("sheets/"));
    assert.ok(content.includes("sheet-schema"), "都应该指向 get_guide(\"sheet-schema\") 这份写法规范");
  }
});
