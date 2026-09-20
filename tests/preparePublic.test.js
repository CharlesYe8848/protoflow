import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-public-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, "source"); fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(new URL("../scripts/prepare-public.mjs", import.meta.url), path.join(root, "scripts/prepare-public.mjs"));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  const write = (name, text) => { const dest = path.join(root, name); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
  const run = dest => spawnSync(process.execPath, [path.join(root, "scripts/prepare-public.mjs"), dest], { encoding: "utf8" });
  return { temp, root, write, run };
}

test("公开快照只带允许的当前文件；不复制历史、内部文档和被忽略的产物，不覆盖已有目录", t => {
  const { temp, root, write, run } = fixture(t);
  write("README.md", "public"); write("core/main.js", "export const ready = true;");
  write("skills/protoflow/SKILL.md", "skill entry");
  write("docs/skill-evaluation.md", "routing cases");
  write("docs/superpowers/private.md", "private"); write(".claude/RESUME.md", "private");
  write(".gitignore", "examples/**/lib/\n"); write("examples/checkout/lib/generated.js", "generated");
  execFileSync("git", ["add", "."], { cwd: root });
  const dest = path.join(temp, "public");
  const result = run(dest); assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(dest, "README.md"), "utf8"), "public");
  assert.equal(fs.readFileSync(path.join(dest, "skills/protoflow/SKILL.md"), "utf8"), "skill entry");
  assert.equal(fs.readFileSync(path.join(dest, "docs/skill-evaluation.md"), "utf8"), "routing cases");
  for (const name of [".git", ".claude", "docs/superpowers", "examples/checkout/lib"]) assert.equal(fs.existsSync(path.join(dest, name)), false, name);
  fs.writeFileSync(path.join(dest, "README.md"), "keep");
  assert.notEqual(run(dest).status, 0); assert.equal(fs.readFileSync(path.join(dest, "README.md"), "utf8"), "keep");
});

test("公开快照拒绝经符号链接写回源仓库及复制符号链接文件", t => {
  const { temp, root, write, run } = fixture(t);
  write("README.md", "public");
  const alias = path.join(temp, "alias"); fs.symlinkSync(root, alias, "dir");
  assert.notEqual(run(path.join(alias, "nested/public")).status, 0);
  assert.equal(fs.existsSync(path.join(root, "nested")), false);
  fs.mkdirSync(path.join(root, "core")); fs.symlinkSync(path.join(root, "README.md"), path.join(root, "core/link.js"));
  const dest = path.join(temp, "public"); assert.notEqual(run(dest).status, 0);
  assert.equal(fs.existsSync(dest), false);
});
