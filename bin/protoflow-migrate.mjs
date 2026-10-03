#!/usr/bin/env node
// bin/protoflow-migrate.mjs — 把工作区里旧格式的项目迁到当前格式（project.json 的 formatVersion，见
// core/store.js FORMAT_VERSION）。运行时代码只认当前格式，旧项目会报 FORMAT_OUTDATED，跑一次这个就行。
//
//   node bin/protoflow-migrate.mjs [工作区目录]            预演：列出每个项目要改什么，不动文件
//   node bin/protoflow-migrate.mjs [工作区目录] --apply    执行：每个项目先整份备份到
//                                                          <工作区>/.protoflow-backup/<时间>/<项目>/，再迁移
//
// 要迁的内容由框架（core/migrate.js）和各产品注册描述里的 migrate 声明；可重复执行，已是当前格式的跳过。
import fs from "node:fs";
import path from "node:path";
import { migrateProject, projectNeedsMigration } from "../core/migrate.js";
import { loadRegistry, LEGACY_PROJECT_MIGRATIONS } from "../products/index.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ws = path.resolve(args.find((a) => !a.startsWith("--")) || process.cwd());

const { products, skipped } = await loadRegistry();
for (const s of skipped) console.log(`（插件 ${s.source} 没有加载：${s.reason}）`);
const outdated = fs.existsSync(ws) ? fs.readdirSync(ws).filter((d) => projectNeedsMigration(ws, d, products)) : [];
if (!outdated.length) { console.log(`${ws} 下的项目都是当前格式，不用迁移`); process.exit(0); }

console.log(`工作区：${ws}\n${APPLY ? "执行迁移" : "预演（加 --apply 执行）"}\n`);
const backupRoot = path.join(ws, ".protoflow-backup", new Date().toISOString().replace(/[:.]/g, "-"));
let failed = 0;
for (const pid of outdated) {
  try {
    if (APPLY) fs.cpSync(path.join(ws, pid), path.join(backupRoot, pid), { recursive: true });
    const r = migrateProject(ws, pid, products, { apply: APPLY, legacy: LEGACY_PROJECT_MIGRATIONS });
    console.log(`${pid}（格式 ${r.from} → ${r.to}）`);
    for (const c of r.changes) console.log(`  - ${c}`);
    if (r.failed.length) failed++;
  } catch (e) {
    failed++;
    console.log(`${pid}：失败，${e.message}`);
  }
}
if (APPLY) console.log(`\n备份在 ${backupRoot}`);
else console.log("\n以上为计划；确认无误后加 --apply 执行。");
process.exit(failed ? 1 : 0);
