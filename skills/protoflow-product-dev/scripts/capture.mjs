#!/usr/bin/env node
// capture.mjs — 产品研发流程的截图脚本：按 captures.json 对**已定版的画布**截图，画上定位标记，
// 输出 PNG，并在每张图旁边写出处文件 <图>.source.json（{ ref: "canvas:<id>@<版本>#<画板>" }），
// 产物定版时框架自动把它收成引用（docs/product-architecture.md §4.4、§4.5）。
//
//   node capture.mjs <项目目录> <docId>                    读 docs/<docId>/captures.json，输出到 docs/<docId>/assets/
//   node capture.mjs <项目目录> --captures <文件> --out <目录>   任意位置的配置、任意输出目录（表格等也能用）
//   加 --urls                                              不截图，只打印每张图的地址、操作步骤和要写的出处文件（手动截图用）
//
// 只依赖 protoflow 的公开接口，不 import 它的内部模块：
//   - CLI：get_project（各画布的最新版本、有没有未定版的改动、画板在哪个画布哪个页面）、render_canvas（本地服务地址）
//   - 画布第 n 版画板的预览地址：canvases/<canvasId>/versions/<n>/pages/<pg>/artboards/<ab>/preview.html（本地服务上）
//   - 预览页 <meta name="protoflow-artboard" content='{"id","canvasWidth","canvasHeight"}'>：画板宽度
//   - 元素 id 与标准 DOM 操作（click / hover / wait）
// CLI 位置默认是本仓库的 bin/protoflow-cli.js，可用 PROTOFLOW_CLI 覆盖（./lib/cli.mjs）。
import fs from "node:fs";
import path from "node:path";
import { applyCaptureMarkers, validateMarkers } from "./lib/captureMarkers.js";
import { resolveBrowserExecutable } from "./lib/headlessBrowser.js";
import { cli, projectArgs, SkillError as CaptureError, runMain } from "./lib/cli.mjs";

export function parseArgs(argv) {
  const opts = { urls: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--urls") opts.urls = true;
    else if (a === "--captures") opts.captures = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else pos.push(a);
  }
  if (!pos[0]) throw new CaptureError("USAGE", "用法：node capture.mjs <项目目录> <docId> 或 <项目目录> --captures <文件> --out <目录> [--urls]");
  opts.projectDir = path.resolve(pos[0]);
  if (pos[1]) {
    const docDir = path.join(opts.projectDir, "docs", pos[1]);
    opts.captures ||= path.join(docDir, "captures.json");
    opts.out ||= path.join(docDir, "assets");
  }
  if (!opts.captures || !opts.out) throw new CaptureError("USAGE", "缺少 captures.json 或输出目录：传 <docId>，或者同时传 --captures 和 --out");
  opts.captures = path.resolve(opts.captures);
  opts.out = path.resolve(opts.out);
  return opts;
}

const KNOWN_ACTION_TYPES = new Set(["click", "hover", "wait"]);
export function validateActions(actions) {
  for (const a of actions || []) {
    if (!KNOWN_ACTION_TYPES.has(a.type)) return `未知的 action type: ${a.type}`;
    if ((a.type === "click" || a.type === "hover") && !a.selector) return `action type "${a.type}" 需要 selector`;
  }
  return null;
}

export function validateCaptures(captures) {
  if (!Array.isArray(captures) || !captures.length) throw new CaptureError("CAPTURES_EMPTY", "captures.json 中 captures 为空");
  const ids = new Set();
  for (const c of captures) {
    if (!c.id || !/^[a-z0-9][a-z0-9-]*$/.test(c.id)) throw new CaptureError("CAPTURE_BAD_ID", `capture id 不合法：${c.id}（kebab-case）`);
    if (ids.has(c.id)) throw new CaptureError("CAPTURE_DUP_ID", `capture id 重复：${c.id}`);
    ids.add(c.id);
    if (!c.artboardId) throw new CaptureError("CAPTURE_BAD_ARTBOARD", `capture ${c.id} 缺少 artboardId`);
    const markerError = validateMarkers(c.markers);
    if (markerError) throw new CaptureError("CAPTURE_BAD_MARKER", `capture ${c.id}：${markerError}`);
    const actionError = validateActions(c.actions);
    if (actionError) throw new CaptureError("CAPTURE_BAD_ACTION", `capture ${c.id}：${actionError}`);
  }
}

// 每块画板在哪个画布、那个画布的最新版本、画板地址。只截已定版的画布：地址里带版本号，截图可复现，
// 出处能写成 canvas:<画布>@<版本>#<画板>。
function planCaptures(projectDir, captures) {
  const gp = cli("get_project", projectArgs(projectDir));
  const canvases = new Map((gp.graph?.artifacts || []).filter((a) => a.type === "canvas").map((a) => [a.id, a]));
  if (!canvases.size) throw new CaptureError("NO_CANVAS", "项目里没有画布");
  // 画布没有未定版的改动时，工作副本的页面结构就是最新版的结构（下面会检查）。
  const where = new Map();
  for (const pg of gp.project.pages || []) for (const ab of pg.artboards || []) where.set(ab.id, { canvasId: pg.canvasId, pageId: pg.id, hasSource: ab.hasSource });
  const rc = cli("render_canvas", { ...projectArgs(projectDir), canvasId: [...canvases.keys()][0] });
  if (!rc.url) throw new CaptureError("NO_SERVER", "拿不到本地预览服务地址（render_canvas 没有返回 url）");
  const base = /^(.*?\/p\/[^/]+\/)/.exec(rc.url)[1];
  return captures.map((c) => {
    const w = where.get(c.artboardId);
    if (!w || !w.hasSource) throw new CaptureError("CAPTURE_REF_NOT_FOUND", `capture ${c.id} 引用的画板 ${c.artboardId} 不存在或没有源码`);
    const canvas = canvases.get(w.canvasId);
    if (!canvas || !canvas.head) throw new CaptureError("CANVAS_NOT_BUILT", `画布 ${w.canvasId} 还没有定过版，先 build_canvas(note:"…")，截图只截已定版的画布`);
    if (canvas.dirty) throw new CaptureError("CANVAS_DIRTY", `画布 ${w.canvasId} 有 v${canvas.head} 之后没定版的改动，先 build_canvas(note:"…") 再截图，否则截到的不是现在的原型`);
    return {
      capture: c,
      url: `${base}canvases/${encodeURIComponent(w.canvasId)}/versions/${canvas.head}/pages/${w.pageId}/artboards/${c.artboardId}/preview.html`,
      ref: `canvas:${w.canvasId}@${canvas.head}#${c.artboardId}`,
      canvasVersion: canvas.head,
    };
  });
}

async function readArtboardMeta(url) {
  const html = await (await fetch(url)).text();
  const m = /<meta name="protoflow-artboard" content="([^"]*)"/.exec(html);
  if (!m) throw new CaptureError("NO_ARTBOARD_META", `预览页缺少 <meta name="protoflow-artboard">：${url}`);
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
}

async function runActions(page, actions) {
  for (const a of actions || []) {
    if (a.type === "click") {
      await page.waitForSelector(a.selector, { timeout: 5000 });
      await page.click(a.selector);
    } else if (a.type === "hover") {
      await page.waitForSelector(a.selector, { timeout: 5000 });
      await page.hover(a.selector);
    }
    if (a.ms) await new Promise((resolve) => setTimeout(resolve, a.ms));
  }
}

const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const contentHeight = (page) => page.evaluate(() => Math.ceil(document.getElementById("root")?.scrollHeight || document.body.scrollHeight));

// 视口宽度用画板宽度，高度按内容实际撑开量出来（最多 4 轮，布局还在变就报错，不截半截）。
async function captureOne(browser, url, canvasWidth, actions, markers, destPath) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: canvasWidth, height: 900, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: "networkidle0" });
    await runActions(page, actions);
    await page.evaluate(() => document.fonts.ready);
    let height = 1;
    for (let i = 0; i < 4; i++) {
      const measured = await contentHeight(page);
      height = Math.max(height, measured);
      await page.setViewport({ width: canvasWidth, height, deviceScaleFactor: 2 });
      await settle(page);
      await page.evaluate(() => document.fonts.ready);
      const settled = await contentHeight(page);
      if (settled === measured) break;
      height = Math.max(height, settled);
    }
    await page.setViewport({ width: canvasWidth, height, deviceScaleFactor: 2 });
    await settle(page);
    await page.evaluate(() => document.fonts.ready);
    const finalHeight = await contentHeight(page);
    if (finalHeight > height) throw new Error(`截图内容高度在 4 轮布局后仍未稳定（${height} → ${finalHeight}）`);
    let screenshotHeight = height;
    let markerDiagnostics = [];
    if (markers?.length) {
      const layout = await applyCaptureMarkers(page, markers);
      screenshotHeight = layout.screenshotHeight;
      markerDiagnostics = layout.diagnostics;
    }
    await page.screenshot({
      path: destPath, type: "png",
      ...(screenshotHeight > height ? { clip: { x: 0, y: 0, width: canvasWidth, height: screenshotHeight }, captureBeyondViewport: true } : {}),
    });
    return { markerDiagnostics, screenshotHeight };
  } finally {
    await page.close();
  }
}

// 整批要么全部成功，要么输出目录不动：先写到临时目录，全部截完才挪过去。
async function captureAll(plan, outDir) {
  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(path.dirname(outDir), ".capture-"));
  const { launch } = await import("puppeteer-core");
  const executable = await resolveBrowserExecutable();
  const browser = await launch({ headless: true, executablePath: executable.path, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const images = [];
    for (const p of plan) {
      const c = p.capture;
      const meta = await readArtboardMeta(p.url);
      const file = `${c.id}.png`;
      try {
        const shot = await captureOne(browser, p.url, meta.canvasWidth || 1440, c.actions, c.markers, path.join(tmp, file));
        fs.writeFileSync(path.join(tmp, `${file}.source.json`), JSON.stringify({ ref: p.ref }, null, 2) + "\n");
        images.push({ captureId: c.id, file, ref: p.ref, ...shot });
      } catch (e) {
        throw new CaptureError("CAPTURE_FAILED", `capture ${c.id}：${e.message}`);
      }
    }
    fs.mkdirSync(outDir, { recursive: true });
    for (const name of fs.readdirSync(tmp)) fs.renameSync(path.join(tmp, name), path.join(outDir, name));
    return { browserSource: executable.source, images };
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function run(argv) {
  const opts = parseArgs(argv);
  if (!fs.existsSync(opts.captures)) throw new CaptureError("CAPTURES_MISSING", `找不到 ${opts.captures}`);
  const { captures } = JSON.parse(fs.readFileSync(opts.captures, "utf8"));
  validateCaptures(captures);
  const plan = planCaptures(opts.projectDir, captures);
  if (opts.urls) {
    return {
      ok: true, mode: "urls", canvasVersion: plan[0].canvasVersion,
      captures: plan.map((p) => ({
        captureId: p.capture.id, title: p.capture.title || "", url: p.url, actions: p.capture.actions || [],
        saveAs: path.join(opts.out, `${p.capture.id}.png`),
        sourceFile: { path: path.join(opts.out, `${p.capture.id}.png.source.json`), content: { ref: p.ref } },
      })),
    };
  }
  const r = await captureAll(plan, opts.out);
  return { ok: true, mode: "capture", canvasVersion: plan[0].canvasVersion, outDir: opts.out, ...r };
}

runMain(import.meta.url, run);
