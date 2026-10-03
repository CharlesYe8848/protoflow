// core/pageShot.js — 标注截图（框架）：用无头浏览器打开本地预览服务上的一个页面，截下其中一块区域，
// 把选中的东西按编号框出来。给标注面板用——复制给 agent 的文字里带上这张图的路径，agent 能看到人
// 指的是哪儿、长什么样，而不只是一串选择器和文字。不认识任何产品：截哪块（selector）、框哪些
// （boxes）都由页面自己算好传过来。
//
// 页面在浏览器里是按窗口大小排的版，所以无头浏览器用同一个视口打开同一个地址（含 ?查询 和 #锚点），
// 版面就跟人看到的一样；框的位置用"相对那块区域的比例"（0–1）传，跟缩放、分辨率无关。
// 为了看得清，按区域宽度把像素密度提到大约 1600px 宽（最多 2 倍）。
//
// 快：人点「标注」要等它，所以
//   - 右键菜单弹出时就先把浏览器启动起来（warmPageShot）；浏览器开着复用，闲置 IDLE_MS 后关掉；页面也留着：同一个地址（不算 #锚点）再截只改锚点，不重新加载——
//     页面内容变没变用本地服务回的 ETag 判断（跟实时刷新同一个口径），变了才重新加载；
//   - 不下载视频、音频（截图只要封面）；
//   - 不等网络空闲：load + 字体 + 页面自己给的 window.__pfPageReady（可选的 Promise，比如图表画完）；
//   - 出 JPEG（照片多的页 PNG 编码慢、文件大）。
// 页面在无头浏览器里 navigator.webdriver 为真，实时刷新不会开长连接。
import { resolveBrowserExecutable, closeBrowser } from "./pdf.js";

const TARGET_WIDTH = 1600;
const BOX_COLOR = "#2563eb";
const IDLE_MS = 5 * 60 * 1000;
const MAX_PAGES = 3;

let browserJob = null;       // Promise<Browser>
let idleTimer = null;
const pages = new Map();     // 不带锚点的地址 → { page, etag, used }
let queue = Promise.resolve(); // 截图一个一个来：共用的页面不能同时被两次截图改锚点、画框

// opts：url（完整地址）、selector（要截的那块）、boxes（[{ x, y, w, h }]，相对那块的比例；编号按顺序从 1 开始）、
//       viewport（{ width, height }，人那边的窗口大小）、areaWidth（那块在人那边的宽度，用来提前定像素密度）。
// 返回 JPEG 的 Buffer。
export function capturePageShot(opts) {
  const run = queue.then(() => capture(opts));
  queue = run.catch(() => {});
  return run;
}

async function capture({ url, selector, boxes = [], viewport = {}, areaWidth = 0, timeout = 20000 }) {
  const width = clampInt(viewport.width, 320, 3840, 1440);
  const height = clampInt(viewport.height, 240, 2160, 900);
  const scale = Math.min(2, Math.max(1, TARGET_WIDTH / (Number(areaWidth) > 0 ? Number(areaWidth) : width)));
  const browser = await getBrowser();
  touch();
  const entry = await pageFor(browser, url, { width, height, scale, timeout });
  const { page } = entry;
  try {
    const rect = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }, selector);
    if (!rect || rect.width < 1 || rect.height < 1) throw new Error(`页面里找不到要截的区域：${selector}`);
    await page.evaluate(drawBoxes, rect, boxes.map(normBox).filter(Boolean), BOX_COLOR);
    const buffer = await page.screenshot({ type: "jpeg", quality: 88, clip: rect, captureBeyondViewport: false });
    return Buffer.from(buffer);
  } finally {
    await page.evaluate(() => { const l = document.getElementById("__pf_shot_layer"); if (l) l.remove(); }).catch(() => {});
    touch();
  }
}

async function getBrowser() {
  if (browserJob) {
    const b = await browserJob.catch(() => null);
    if (b && b.connected) return b;
  }
  browserJob = (async () => {
    const { launch } = await import("puppeteer-core");
    const exe = await resolveBrowserExecutable();
    const b = await launch({ headless: true, executablePath: exe.path, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    b.on("disconnected", () => { browserJob = null; pages.clear(); });
    return b;
  })();
  return browserJob;
}

// 提前把浏览器启动起来（右键菜单弹出时调），人点「标注」时省掉启动那一两秒。
export function warmPageShot() {
  getBrowser().then(touch, () => {});
}

function touch() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(closeAll, IDLE_MS);
  if (idleTimer.unref) idleTimer.unref(); // 不因为它让进程留着
}

export async function closePageShots() { await closeAll(); }
async function closeAll() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  const job = browserJob;
  browserJob = null; pages.clear();
  const b = job && await job.catch(() => null);
  if (b) await closeBrowser(b);
}

// 同一个地址（不算锚点）留着的页面：内容没变就只改锚点；变了、没有、视口不同就（重新）加载。
async function pageFor(browser, url, { width, height, scale, timeout }) {
  const [base, hash = ""] = url.split("#");
  let entry = pages.get(base);
  const etag = await currentEtag(base);
  const sameView = entry && entry.width === width && entry.height === height && entry.scale === scale;
  if (entry && sameView && etag && etag === entry.etag && !entry.page.isClosed()) {
    entry.used = Date.now();
    const changed = await entry.page.evaluate((h) => {
      if (location.hash === h) return false;
      location.hash = h; // 页面自己听 hashchange（幻灯片按 #页码 翻页）
      return true;
    }, hash ? "#" + hash : "");
    if (changed) await settle(entry.page, 120);
    return entry;
  }
  if (!entry || entry.page.isClosed()) {
    if (pages.size >= MAX_PAGES) {
      const oldest = [...pages.entries()].sort((a, b) => a[1].used - b[1].used)[0];
      pages.delete(oldest[0]);
      await oldest[1].page.close().catch(() => {});
    }
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]); // 截最终的样子，不截动画中间帧
    await page.setRequestInterception(true);
    page.on("request", (req) => (req.resourceType() === "media" ? req.abort() : req.continue()).catch(() => {}));
    entry = { page };
    pages.set(base, entry);
  }
  Object.assign(entry, { width, height, scale, used: Date.now() });
  await entry.page.setViewport({ width, height, deviceScaleFactor: scale });
  const res = await entry.page.goto(url, { waitUntil: "load", timeout }).catch(() => null);
  // 同一个地址只改锚点时 goto 不会重新加载；这里要的是真的重新加载一遍
  if (res === null || (res && res.url().split("#")[0] !== base)) await entry.page.reload({ waitUntil: "load", timeout }).catch(() => {});
  entry.etag = (res && res.headers().etag) || etag;
  await entry.page.evaluate(() => document.fonts && document.fonts.ready);
  await entry.page.evaluate((ms) => Promise.race([Promise.resolve(window.__pfPageReady), new Promise((r) => setTimeout(r, ms))]), 3000).catch(() => {});
  await settle(entry.page, 80);
  return entry;
}

async function currentEtag(url) {
  try { return (await fetch(url, { method: "HEAD" })).headers.get("etag"); } catch { return null; }
}

function settle(page, ms) { return page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms); }

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normBox(b) {
  if (!b || typeof b !== "object") return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Math.max(-1, Math.min(2, Number(v))) : null);
  const box = { x: n(b.x), y: n(b.y), w: n(b.w), h: n(b.h) };
  return Object.values(box).some((v) => v == null) ? null : box;
}

// 在页面里执行：固定定位的一层，按比例画框和编号。截完就删（页面留着给下次用）。
function drawBoxes(rect, boxes, color) {
  const layer = document.createElement("div");
  layer.id = "__pf_shot_layer";
  layer.style.cssText = `position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;z-index:2147483647`;
  boxes.forEach((b, i) => {
    const box = document.createElement("div");
    box.style.cssText = `position:absolute;left:${b.x * rect.width - 3}px;top:${b.y * rect.height - 3}px;width:${b.w * rect.width + 6}px;height:${b.h * rect.height + 6}px;`
      + `border:2px solid ${color};border-radius:3px;box-sizing:border-box`;
    const tag = document.createElement("div");
    tag.textContent = String(i + 1);
    // 编号贴在框的左上角外侧；框贴着截图边缘时放进框里，不然会被裁掉
    const tx = b.x * rect.width < 12 ? 2 : -11, ty = b.y * rect.height < 12 ? 2 : -11;
    tag.style.cssText = `position:absolute;left:${tx}px;top:${ty}px;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:${color};color:#fff;`
      + `font:600 12px/22px -apple-system,"PingFang SC",sans-serif;text-align:center;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.25)`;
    box.appendChild(tag);
    layer.appendChild(box);
  });
  document.body.appendChild(layer);
}
