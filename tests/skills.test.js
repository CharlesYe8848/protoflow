// skills/ 下每个 skill 的格式检查：frontmatter 的 name 跟目录名一致、有描述；SKILL.md 里提到的
// references/、scripts/ 文件都在；入口 skill 的路由表里列出了每个流程 skill（新增流程忘了加路由会失败）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");

// SKILL.md frontmatter 的 name / description（支持 >- 折叠写法）
function frontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  const out = {};
  if (!m) return out;
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === ">-" || value === "|" || value === ">") {
      const parts = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) parts.push(lines[++i].trim());
      value = parts.join(" ");
    }
    out[kv[1]] = value.replace(/^"(.*)"$/, "$1");
  }
  return out;
}
function listSkills(dir) {
  return fs.readdirSync(dir).sort()
    .filter((n) => !n.startsWith(".") && fs.existsSync(path.join(dir, n, "SKILL.md")))
    .map((n) => { const fm = frontmatter(fs.readFileSync(path.join(dir, n, "SKILL.md"), "utf8")); return { name: fm.name || n, dir: n, description: fm.description || "" }; });
}

test("每个 skill：name = 目录名，描述写清什么时候用，SKILL.md 引用的文件都存在", () => {
  const skills = listSkills(SKILLS);
  assert.ok(skills.length >= 2);
  for (const s of skills) {
    assert.equal(s.name, s.dir, `${s.dir} 的 frontmatter name 要跟目录名一致`);
    assert.ok(s.description.length >= 40, `${s.name} 的描述太短，写清什么时候用、什么时候不用`);
    const md = fs.readFileSync(path.join(SKILLS, s.dir, "SKILL.md"), "utf8");
    for (const [, rel] of md.matchAll(/`((?:references|scripts)\/[\w./-]+\.\w+)`/g)) {
      assert.ok(fs.existsSync(path.join(SKILLS, s.dir, rel)), `${s.name}/SKILL.md 提到的 ${rel} 不存在`);
    }
  }
});

test("流程 skill 都在入口 skill 的路由表里，描述里指回入口", () => {
  const router = fs.readFileSync(path.join(SKILLS, "protoflow", "SKILL.md"), "utf8");
  for (const s of listSkills(SKILLS).filter((x) => x.name !== "protoflow")) {
    assert.ok(router.includes(`\`${s.name}\``), `入口 skill 的路由表里没有 ${s.name}`);
    assert.ok(router.includes(`**${s.name}**`), `入口 skill 里没有 ${s.name} 的契约（输入 → 输出，什么时候选它）`);
    assert.ok(s.description.includes("/protoflow"), `${s.name} 的描述要写"不确定时先看 /protoflow"`);
  }
});
