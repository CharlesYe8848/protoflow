// 依赖边界（docs/product-architecture.md §4.10、§4.11）：框架不引用产品；产品之间互不引用；产品只经
// "protoflow/sdk"（稳定）和 "protoflow/sdk/internal"（过渡）用框架，不直接 import core/*；
// skill 只用公开接口（CLI 输出、AGENTS.md 写明的文件布局）。
//
// 归属按目录：core/ 是框架，products/<名字>/ 是那个产品，skills/<名字>/ 是 skill。products/index.js
// 是把产品组装起来的注册表，跟 cli/、bin/ 一样属于入口层，不受限制。
//
// 现有违反列在 KNOWN_VIOLATIONS 里，每条写明哪个阶段清理。这张表只减不增：清理掉一条就删一条；
// 表里某条已经不存在了测试也会失败，提醒把它删掉。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// "from -> to"，模块写成 <归属>/<文件名>；阶段号见 docs/product-architecture.md §7。
const KNOWN_VIOLATIONS = {
};

// 文件的归属：framework / product:<名字> / entry（入口层，不检查）。
function ownerOf(abs) {
  const rel = path.relative(ROOT, abs).split(path.sep);
  if (rel[0] === "core") return "framework";
  if (rel[0] === "products" && rel.length > 2) return `product:${rel[1]}`;
  return "entry";
}
const label = (abs) => {
  const rel = path.relative(ROOT, abs).split(path.sep);
  return `${rel[0] === "core" ? "core" : rel[1]}/${rel[rel.length - 1].replace(/\.m?js$/, "")}`;
};

function scripts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? scripts(p) : /\.m?js$/.test(e.name) ? [p] : [];
  });
}

// 插件接口的包名 → 框架里的入口文件（package.json 的 exports）。
const SDK_ENTRIES = {
  "protoflow/sdk": path.join(ROOT, "core", "sdk.js"),
  "protoflow/sdk/internal": path.join(ROOT, "core", "sdk-internal.js"),
  "protoflow/sdk/testing": path.join(ROOT, "core", "sdk-testing.js"),
};
const SDK_FILES = new Set(Object.values(SDK_ENTRIES));

// 每个模块 import 了哪些本地文件：`import … from`、`export … from`、裸 `import "…"`、`import()`。
// 经包名引用的插件接口（protoflow/sdk*）也算，解析到 core/ 里对应的入口文件。
function localImports(file) {
  const src = fs.readFileSync(file, "utf8");
  const out = new Set();
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+\.m?js|protoflow\/[^"']+)["']/g)) {
    if (m[1].startsWith("protoflow/")) {
      if (!SDK_ENTRIES[m[1]]) throw new Error(`${path.relative(ROOT, file)}：不认识的包内路径 ${m[1]}（只有 ${Object.keys(SDK_ENTRIES).join("、")}）`);
      out.add(SDK_ENTRIES[m[1]]);
    } else out.add(path.resolve(path.dirname(file), m[1]));
  }
  return out;
}

// 跨层的引用是不是违反：框架 → 产品；产品 → 别的产品、入口层，或者绕过插件接口直接用框架模块。
function isViolation(from, to, dep) {
  if (from === to || from === "entry") return false;
  if (from === "framework") return to !== "framework";
  return !(to === "framework" && SDK_FILES.has(dep));
}

test("依赖边界：框架不引用产品，产品互不引用，产品只依赖框架；已知例外只减不增", () => {
  const found = [];
  for (const file of [...scripts(path.join(ROOT, "core")), ...scripts(path.join(ROOT, "products"))]) {
    for (const dep of localImports(file)) {
      if (isViolation(ownerOf(file), ownerOf(dep), dep)) found.push(`${label(file)} -> ${label(dep)}`);
    }
  }
  const known = Object.keys(KNOWN_VIOLATIONS);
  const fresh = found.filter((v) => !known.includes(v));
  assert.deepEqual(fresh, [], `新的越界引用（${fresh.length} 处）：\n${fresh.join("\n")}\n产品只能经 protoflow/sdk、protoflow/sdk/internal 依赖框架；框架不能依赖产品`);
  const stale = known.filter((v) => !found.includes(v));
  assert.deepEqual(stale, [], `这些已知例外已经清理掉了，从 KNOWN_VIOLATIONS 里删掉：\n${stale.join("\n")}`);
});

test("依赖边界：产品目录下只有产品自己的模块，框架目录下没有产品模块", () => {
  const products = fs.existsSync(path.join(ROOT, "products")) ? fs.readdirSync(path.join(ROOT, "products"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
  assert.ok(products.length >= 3, `产品目录：${products.join(", ")}`);
  const leaked = scripts(path.join(ROOT, "core")).map((f) => path.basename(f)).filter((f) => /^(canvas|doc|sheet|diagram)[A-Z]/.test(f));
  assert.deepEqual(leaked, [], "看名字像产品模块的文件留在了 core/");
});

// 各产品从过渡接口（protoflow/sdk/internal）用了几处（文件 × 名字）。只减不增：清掉一处就把数字改小；
// 要新增得改这张表，等于显式批准，并在 core/sdk-internal.js 里写明去向。不在表里的产品（新产品）必须是 0。
const INTERNAL_USES = { canvas: 5, doc: 2, diagram: 2 };

test("插件接口：过渡接口的使用按产品只减不增，新产品不准用", () => {
  const counts = {};
  for (const file of scripts(path.join(ROOT, "products"))) {
    const owner = ownerOf(file);
    if (!owner.startsWith("product:")) continue;
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']protoflow\/sdk\/internal["']/g)) {
      const n = m[1].split(",").map((x) => x.trim()).filter(Boolean).length;
      const name = owner.slice("product:".length);
      counts[name] = (counts[name] || 0) + n;
    }
  }
  const names = new Set([...Object.keys(counts), ...Object.keys(INTERNAL_USES)]);
  const diff = [...names].filter((n) => (counts[n] || 0) !== (INTERNAL_USES[n] || 0))
    .map((n) => `${n}：表里 ${INTERNAL_USES[n] || 0}，实际 ${counts[n] || 0}`);
  assert.deepEqual(diff, [], `过渡接口的使用数跟 INTERNAL_USES 对不上（变少了就把表改小；变多了要先想清楚为什么稳定接口不够用）：\n${diff.join("\n")}`);
});

test("插件接口：包名 protoflow/sdk* 解析得到，稳定接口和过渡接口不重名", async () => {
  const sdk = await import("protoflow/sdk");
  const internal = await import("protoflow/sdk/internal");
  const both = Object.keys(sdk).filter((k) => k in internal);
  assert.deepEqual(both, [], "同一个名字不该同时在稳定接口和过渡接口里");
  assert.ok(Object.keys(sdk).length > 20);
});

test("插件接口：示例插件（examples/plugin-*）只用稳定接口 protoflow/sdk 和自己目录里的文件", () => {
  const dirs = fs.readdirSync(path.join(ROOT, "examples")).filter((d) => d.startsWith("plugin-")).map((d) => path.join(ROOT, "examples", d));
  assert.ok(dirs.length >= 1, "examples/plugin-note 挪走了，这条测试会空跑");
  const bad = [];
  for (const dir of dirs) for (const file of scripts(dir)) for (const dep of localImports(file)) {
    if (dep !== SDK_ENTRIES["protoflow/sdk"] && !dep.startsWith(dir + path.sep)) bad.push(`${path.relative(ROOT, file)} -> ${path.relative(ROOT, dep)}`);
  }
  assert.deepEqual(bad, [], `示例插件越过了稳定接口：\n${bad.join("\n")}`);
});

test("依赖边界：绘图的 engine 层只依赖 npm 包和自己目录里的文件，以后能原样单独抽出去", () => {
  const engine = path.join(ROOT, "products", "diagram", "engine");
  const files = scripts(engine);
  assert.ok(files.length >= 3, "engine 目录挪走了，这条测试会空跑");
  const bad = [];
  for (const file of files) {
    for (const dep of localImports(file)) if (!dep.startsWith(engine + path.sep)) bad.push(`${path.relative(ROOT, file)} -> ${path.relative(ROOT, dep)}`);
  }
  assert.deepEqual(bad, [], `engine 引用了自己目录以外的文件：\n${bad.join("\n")}`);
});

function walkScripts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walkScripts(p);
    return /\.(m?js|cjs)$/.test(e.name) ? [p] : [];
  });
}

test("依赖边界：skill 只 import 自己目录里的文件和 npm 包，不碰 protoflow 内部模块", () => {
  const skillsRoot = path.join(ROOT, "skills");
  const skills = fs.readdirSync(skillsRoot).filter((d) => fs.statSync(path.join(skillsRoot, d)).isDirectory());
  assert.ok(skills.length >= 2, "skills/ 下至少有入口和产品研发流程两个 skill（防止目录挪走后这条测试空跑）");
  const bad = [];
  for (const skill of skills) {
    const base = path.join(skillsRoot, skill);
    for (const file of walkScripts(base)) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
        const target = path.resolve(path.dirname(file), m[1]);
        if (!target.startsWith(base + path.sep)) bad.push(`${path.relative(ROOT, file)} -> ${m[1]}`);
      }
    }
  }
  assert.deepEqual(bad, [], `skill 引用了自己目录以外的文件（应改用 CLI 公开接口）：\n${bad.join("\n")}`);
});
