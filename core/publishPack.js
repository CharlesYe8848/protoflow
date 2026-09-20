// core/publishPack.js — 截图流水线（PRD / 上线公告等用画布截图当上下文的文档类型的 sidecar，
// 不是文档基座的一部分）。三阶段：
//   previews — 校验 .build/captures.json，渲染 .build/previews/<captureId>.html
//   capture  — 无头浏览器按 actions 操作后自动截图，写 .build/exported-images/<captureId>.png（可选，
//              actions 表达不了的复杂交互可跳过、手动截图放同一位置）
//   seal     — 核对图片清单，把截图落进 docs/<docId>/assets/<captureId>.png + 写 .build/captures-manifest.json
import fs from "node:fs";
import path from "node:path";
import { applyCaptureMarkers, validateMarkers } from "./captureMarkers.js";
import { captureInputHash, readInputManifest } from "./captureProvenance.js";
import * as store from "./store.js";
import { buildPreviewHtml } from "./preview.js";
import { resolveBrowserExecutable } from "./headlessBrowser.js";

const fail = (code, message, hint) => ({ ok: false, error: { code, message, ...(hint ? { hint } : {}) } });

export async function buildPublishPack(ws, projectId, docId, mode, ctx) {
  const ddir = store.docDir(ws, projectId, docId);
  const buildDir = path.join(ddir, ".build");
  if (mode === "capture") {
    // Invalidate even when config/action/preview validation fails.
    fs.rmSync(path.join(buildDir, "exported-images"), { recursive: true, force: true });
    fs.rmSync(path.join(buildDir, "exported-images-manifest.json"), { force: true });
    fs.rmSync(path.join(buildDir, "captures-manifest.json"), { force: true });
  }
  if (!fs.existsSync(path.join(buildDir, "snapshot", "artboards"))) {
    return fail("VERSION_NOT_BUILT", `文档 ${docId} 尚未 build_doc(mode:"snapshot")`, "workflow");
  }
  const capsPath = path.join(buildDir, "captures.json");
  if (!fs.existsSync(capsPath)) return fail("CAPTURES_MISSING", `缺少 ${capsPath}`, "capture");
  const { captures = [] } = JSON.parse(fs.readFileSync(capsPath, "utf8"));
  if (!captures.length) return fail("CAPTURES_EMPTY", "captures.json 中 captures 为空", "capture");
  const ids = new Set();
  for (const c of captures) {
    if (!c.id || !/^[a-z0-9][a-z0-9-]*$/.test(c.id)) return fail("CAPTURE_BAD_ID", `capture id 不合法: ${c.id}`);
    if (ids.has(c.id)) return fail("CAPTURE_DUP_ID", `capture id 重复: ${c.id}`);
    ids.add(c.id);
    const markerError = validateMarkers(c.markers);
    if (markerError) return fail("CAPTURE_BAD_MARKER", `capture ${c.id}：${markerError}`);
  }
  if (mode === "previews") return buildPreviews(buildDir, captures);
  if (mode === "capture") return captureAll(buildDir, captures);
  if (mode === "seal") return seal(ddir, buildDir, captures, ctx);
  return fail("BAD_MODE", `mode 必须是 previews、capture 或 seal，收到 ${mode}`);
}

function buildPreviews(buildDir, captures) {
  const snapArts = path.join(buildDir, "snapshot", "artboards");
  for (const c of captures) {
    if (!fs.existsSync(path.join(snapArts, c.artboardId, "source.jsx"))) {
      return fail("CAPTURE_REF_NOT_FOUND", `capture ${c.id} 引用的画板 ${c.artboardId} 不在本文档快照中`);
    }
  }
  const outDir = path.join(buildDir, "previews");
  fs.rmSync(path.join(buildDir, "exported-images"), { recursive: true, force: true });
  fs.rmSync(path.join(buildDir, "exported-images-manifest.json"), { force: true });
  fs.rmSync(path.join(buildDir, "captures-manifest.json"), { force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const c of captures) {
    const source = fs.readFileSync(path.join(snapArts, c.artboardId, "source.jsx"), "utf8");
    const annPath = path.join(snapArts, c.artboardId, "annotations.md");
    const annotationsMd = fs.existsSync(annPath) ? fs.readFileSync(annPath, "utf8") : "";
    // .build/previews/<id>.html 到项目级 lib/ 是 ../../../../lib（previews→.build→docId→docs→root）
    fs.writeFileSync(path.join(outDir, `${c.id}.html`),
      buildPreviewHtml({ artboardId: c.artboardId, source, libRelPath: "../../../../lib", annotationsMd }));
  }
  fs.mkdirSync(path.join(buildDir, "exported-images"), { recursive: true });
  fs.writeFileSync(path.join(buildDir, "previews-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    inputHash: captureInputHash(buildDir, captures),
  }, null, 2));
  return { ok: true, mode: "previews", previews: captures.map((c) => ({ captureId: c.id, artboardId: c.artboardId, title: c.title, actions: c.actions || [], htmlPath: path.join(outDir, `${c.id}.html`) })) };
}

const KNOWN_ACTION_TYPES = new Set(["click", "hover", "wait"]);
export function validateActions(actions) {
  for (const a of actions || []) {
    if (!KNOWN_ACTION_TYPES.has(a.type)) return `未知的 action type: ${a.type}`;
    if ((a.type === "click" || a.type === "hover") && !a.selector) return `action type "${a.type}" 需要 selector`;
  }
  return null;
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

async function captureOne(browser, htmlPath, canvasWidth, actions, markers, destPath) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: canvasWidth, height: 900, deviceScaleFactor: 2 });
    await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });
    await runActions(page, actions);
    await page.evaluate(() => document.fonts.ready);
    let height = 1;
    for (let i = 0; i < 4; i++) {
      const measured = await page.evaluate(() => Math.ceil(document.getElementById("root")?.scrollHeight || document.body.scrollHeight));
      height = Math.max(height, measured);
      await page.setViewport({ width: canvasWidth, height, deviceScaleFactor: 2 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => document.fonts.ready);
      const settled = await page.evaluate(() => Math.ceil(document.getElementById("root")?.scrollHeight || document.body.scrollHeight));
      if (settled === measured) break;
      height = Math.max(height, settled);
    }
    await page.setViewport({ width: canvasWidth, height, deviceScaleFactor: 2 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => document.fonts.ready);
    const finalHeight = await page.evaluate(() => Math.ceil(document.getElementById("root")?.scrollHeight || document.body.scrollHeight));
    if (finalHeight > height) throw new Error(`截图内容高度在 4 轮布局后仍未稳定（${height} → ${finalHeight}）`);
    let screenshotHeight = height;
    let markerDiagnostics = [];
    if (markers?.length) {
      const layout = await applyCaptureMarkers(page, markers);
      screenshotHeight = layout.screenshotHeight;
      markerDiagnostics = layout.diagnostics;
    }
    await page.screenshot({
      path: destPath,
      type: "png",
      ...(screenshotHeight > height ? {
        clip: { x: 0, y: 0, width: canvasWidth, height: screenshotHeight },
        captureBeyondViewport: true,
      } : {}),
    });
    return { markerDiagnostics, screenshotHeight };
  } finally {
    await page.close();
  }
}

async function captureAll(buildDir, captures) {
  for (const c of captures) {
    const err = validateActions(c.actions);
    if (err) return fail("CAPTURE_BAD_ACTION", `capture ${c.id}：${err}`);
  }
  const previewsDir = path.join(buildDir, "previews");
  for (const c of captures) {
    if (!fs.existsSync(path.join(previewsDir, `${c.id}.html`))) {
      return fail("PREVIEW_MISSING", `capture ${c.id} 的预览页不存在，先跑 build_publish_pack mode:"previews"`, "capture");
    }
  }
  const inputHash = captureInputHash(buildDir, captures);
  const previewManifest = readInputManifest(path.join(buildDir, "previews-manifest.json"));
  if (previewManifest?.inputHash !== inputHash) {
    return fail("PREVIEW_STALE", "截图配置或文档快照已变化，先重新运行 build_publish_pack mode:\"previews\"", "capture");
  }
  const imgDir = path.join(buildDir, "exported-images");
  fs.mkdirSync(imgDir, { recursive: true });
  const snapArts = path.join(buildDir, "snapshot", "artboards");

  const { launch } = await import("puppeteer-core");
  const executable = await resolveBrowserExecutable();
  const browser = await launch({ headless: true, executablePath: executable.path, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const images = [];
    for (const c of captures) {
      const metaPath = path.join(snapArts, c.artboardId, "meta.json");
      const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
      const htmlPath = path.join(previewsDir, `${c.id}.html`);
      const destPath = path.join(imgDir, `${c.id}.png`);
      try {
        const captured = await captureOne(browser, htmlPath, meta.canvasWidth || 1440, c.actions, c.markers, destPath);
        images.push({ captureId: c.id, file: `${c.id}.png`, ...captured });
      } catch (error) {
        fs.rmSync(imgDir, { recursive: true, force: true });
        fs.rmSync(path.join(buildDir, "exported-images-manifest.json"), { force: true });
        return fail("CAPTURE_FAILED", `capture ${c.id}：${error.message}`);
      }
    }
    fs.writeFileSync(path.join(buildDir, "exported-images-manifest.json"), JSON.stringify({
      schemaVersion: 1, inputHash, images: images.map(({ captureId, file }) => ({ captureId, file })),
    }, null, 2));
    return { ok: true, mode: "capture", browserSource: executable.source, images };
  } finally {
    await browser.close();
  }
}

function seal(ddir, buildDir, captures, ctx) {
  const inputHash = captureInputHash(buildDir, captures);
  const previewManifest = readInputManifest(path.join(buildDir, "previews-manifest.json"));
  if (previewManifest?.inputHash !== inputHash) {
    return fail("PREVIEW_STALE", "截图配置或文档快照已变化，先重新运行 build_publish_pack mode:\"previews\"", "capture");
  }
  const imageManifest = readInputManifest(path.join(buildDir, "exported-images-manifest.json"));
  if (imageManifest && imageManifest.inputHash !== inputHash) {
    return fail("IMAGES_STALE", "自动截图产物与当前配置或快照不一致，请重新运行 capture", "capture");
  }
  const imgDir = path.join(buildDir, "exported-images");
  const pngs = fs.existsSync(imgDir) ? fs.readdirSync(imgDir).filter((f) => f.endsWith(".png")) : [];
  for (const c of captures) {
    if (!pngs.includes(`${c.id}.png`)) return fail("IMAGE_MISSING", `缺少截图 ${c.id}.png（应放在 .build/exported-images/）`, "capture");
  }
  const expected = new Set(captures.map((c) => `${c.id}.png`));
  for (const f of pngs) if (!expected.has(f)) return fail("IMAGE_UNEXPECTED", `多出未在 captures.json 声明的图片 ${f}`);

  // 落进 docs/<docId>/assets/——doc.md 用 ![](assets/<captureId>.png) 引用，跟粘贴的图同一处。
  const assetsDir = path.join(ddir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  for (const c of captures) fs.copyFileSync(path.join(imgDir, `${c.id}.png`), path.join(assetsDir, `${c.id}.png`));

  const manifest = {
    schemaVersion: 2, sealedAt: new Date(ctx.now()).toISOString(), inputHash,
    images: captures.map((c) => ({ captureId: c.id, file: `${c.id}.png`, artboardId: c.artboardId, title: c.title })),
  };
  fs.writeFileSync(path.join(buildDir, "captures-manifest.json"), JSON.stringify(manifest, null, 2));
  return { ok: true, mode: "seal", imageCount: manifest.images.length };
}
