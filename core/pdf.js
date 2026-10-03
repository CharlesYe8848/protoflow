// core/pdf.js — 把一份 HTML 渲染成 PDF（框架）：给产品的"导出 PDF"用，不认识任何产品。
//
// 用无头浏览器打开页面、等页面准备好（字体、页面自己的脚本画完图），再按页面自己的打印样式出 PDF。
// 页面怎么分页由页面决定（CSS 的 @page 和 break-after）；这里只负责找浏览器、开页面、出文件。
//
// 找浏览器的顺序：PROTOFLOW_CHROME_PATH → 本机装的 Chrome → 缓存过的下载 → 下载一份 chrome-headless-shell
// （缓存在 ~/.protoflow/browsers，所有项目共用）。puppeteer 相关的包按需加载，不导 PDF 就不加载。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BROWSER_CACHE_DIR = path.join(os.homedir(), ".protoflow", "browsers");

export async function resolveBrowserExecutable(cacheDir = BROWSER_CACHE_DIR) {
  if (process.env.PROTOFLOW_CHROME_PATH) return { source: "env", path: process.env.PROTOFLOW_CHROME_PATH };
  const b = await import("@puppeteer/browsers");
  try {
    const p = b.computeSystemExecutablePath({ browser: b.Browser.CHROME, channel: b.ChromeReleaseChannel.STABLE });
    if (p && fs.existsSync(p)) return { source: "system", path: p };
  } catch { /* 没装 Chrome */ }
  try {
    const shell = (await b.getInstalledBrowsers({ cacheDir })).find((x) => x.browser === b.Browser.CHROMEHEADLESSSHELL);
    if (shell) return { source: "cache", path: shell.executablePath };
  } catch { /* 没有缓存 */ }
  const platform = b.detectBrowserPlatform();
  if (!platform) throw new Error(`无法为当前平台（${os.platform()} ${os.arch()}）下载 Chrome，请设置 PROTOFLOW_CHROME_PATH 指向本机的 Chrome`);
  const buildId = await b.resolveBuildId(b.Browser.CHROMEHEADLESSSHELL, platform, b.ChromeReleaseChannel.STABLE);
  const installed = await b.install({ cacheDir, browser: b.Browser.CHROMEHEADLESSSHELL, platform, buildId, unpack: true });
  return { source: "download", path: installed.executablePath };
}

// 关掉一个无头浏览器，并保证不留东西：
//   - 正常关闭之后，再结束它的整个进程组。Chrome 顺带拉起的子进程（比如崩溃上报 crashpad handler）有时不会
//     跟着退出，变成没人管的孤儿进程；Chrome 升级后第一次启动时实测留下过。puppeteer 在 macOS/Linux 上让
//     Chrome 自成一个进程组，按组结束能一起清掉（Windows 没有进程组，跳过）；
//   - 断开 Node 这边接着的输出管道：残留的子进程还拿着管道时，Node 会一直等管道关闭，进程退不出去。
export async function closeBrowser(browser) {
  if (!browser) return;
  const proc = browser.process();
  await browser.close().catch(() => {});
  if (proc && proc.pid && process.platform !== "win32") { try { process.kill(-proc.pid, "SIGKILL"); } catch { /* 已经没了 */ } }
  if (proc) for (const s of [proc.stdin, proc.stdout, proc.stderr]) if (s && !s.destroyed) s.destroy();
}

// html：完整的页面（自包含，不依赖本地服务）。opts：
//   width / height   视口和纸张大小（CSS 像素），比如幻灯片的 1920×1080
//   ready            可选：在页面里执行的函数源码（字符串），返回 true 表示画好了；等它最多 timeout 毫秒
//   beforePrint      可选：在页面里执行的函数源码，出 PDF 前调一次（比如切到打印排版）
// 返回 PDF 的 Buffer。
export async function htmlToPdf(html, { width = 1920, height = 1080, ready = null, beforePrint = null, timeout = 20000 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-pdf-"));
  const file = path.join(tmp, "page.html");
  fs.writeFileSync(file, html);
  const { launch } = await import("puppeteer-core");
  const exe = await resolveBrowserExecutable();
  const browser = await launch({ headless: true, executablePath: exe.path, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]); // 静态文档不要动效
    await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    // 传进来的是函数源码字符串，要在页面里调用它（直接把字符串交给浏览器只会得到函数本身，不会执行）
    if (ready) await page.waitForFunction(`(${ready})()`, { timeout }).catch(() => { /* 画不完也照样出，不让导出失败 */ });
    if (beforePrint) await page.evaluate(`(${beforePrint})()`);
    const pdf = await page.pdf({ width: `${width}px`, height: `${height}px`, printBackground: true, preferCSSPageSize: true });
    return Buffer.from(pdf);
  } finally {
    await closeBrowser(browser);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
