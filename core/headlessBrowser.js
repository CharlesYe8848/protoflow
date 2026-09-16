// core/headlessBrowser.js — 只回答"本地有没有能用的 Chrome/Chromium 可执行文件、在哪"这一件事，
// 不管"怎么开无头浏览器截图"（那部分在 core/publishPack.js 的 capture 阶段）。单独成文件是为了
// 把 puppeteer-core/@puppeteer/browsers 相关的调用都收在这一处——以后想换成 playwright-core，
// 只用改这一个文件，截图逻辑本身不用动。
//
// 分层优先级抄的是 hyperframes 自己的做法（读过它打包后的源码确认，不是猜的）：环境变量覆盖 →
// 系统已经装好的 Chrome → 本地缓存过的下载 → 真的去下载一份（优先 chrome-headless-shell，专门
// 给无头截图用的精简版，不是完整版 Chrome）。开发机大概率已经装了 Chrome，没必要每次都重新下载
// 一个几百 MB 的浏览器；只有前几层都找不到才会真的触发下载。
import os from "node:os";
import path from "node:path";
import {
  computeSystemExecutablePath,
  getInstalledBrowsers,
  install,
  resolveBuildId,
  detectBrowserPlatform,
  Browser,
  ChromeReleaseChannel,
} from "@puppeteer/browsers";

// 所有项目共用同一份缓存，不跟着某个 project 走——下载一次，所有 ProtoFlow 项目截图都能用。
export const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".protoflow", "browsers");

// 纯逻辑，不碰文件系统/网络：给一串"候选来源→找没找到"的结果，按优先级顺序取第一个真的找到的。
// 单独抠出来是为了能在不启动任何浏览器、不碰真实文件系统的情况下，测试"优先级顺序对不对"这件事。
export function pickBrowserExecutable(candidates) {
  for (const c of candidates) if (c && c.path) return c;
  return null;
}

// 真正做发现工作的异步函数：依次探测各个来源，把结果交给上面的纯函数去选。探测本身会碰文件系统
// （computeSystemExecutablePath 内部会 accessSync 已知安装路径、getInstalledBrowsers 会扫缓存目录），
// 找不到才会触发下载——这几步天然是异步 I/O，没法做成纯函数，属于这个模块里唯一没法脱离真实环境
// 测试的部分。
export async function resolveBrowserExecutable(cacheDir = DEFAULT_CACHE_DIR) {
  const candidates = [];

  const envPath = process.env.PROTOFLOW_CHROME_PATH;
  candidates.push(envPath ? { source: "env", path: envPath } : null);

  try {
    candidates.push({ source: "system", path: computeSystemExecutablePath({ browser: Browser.CHROME, channel: ChromeReleaseChannel.STABLE }) });
  } catch {
    candidates.push(null);
  }

  try {
    const installed = await getInstalledBrowsers({ cacheDir });
    const shell = installed.find((b) => b.browser === Browser.CHROMEHEADLESSSHELL);
    candidates.push(shell ? { source: "cache", path: shell.executablePath } : null);
  } catch {
    candidates.push(null);
  }

  const picked = pickBrowserExecutable(candidates);
  if (picked) return picked;

  const platform = detectBrowserPlatform();
  if (!platform) throw new Error(`无法为当前平台（${os.platform()} ${os.arch()}）下载 Chrome，请设置 PROTOFLOW_CHROME_PATH 指向本机已有的 Chrome 可执行文件`);
  const buildId = await resolveBuildId(Browser.CHROMEHEADLESSSHELL, platform, ChromeReleaseChannel.STABLE);
  const installed = await install({ cacheDir, browser: Browser.CHROMEHEADLESSSHELL, platform, buildId, unpack: true });
  return { source: "download", path: installed.executablePath };
}
