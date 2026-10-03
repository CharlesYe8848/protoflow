// core/video.js — 把一份 HTML 录成 MP4（框架）：给产品的"导出视频"用，不认识任何产品。
//
// 不按真实时间录屏（无头浏览器录屏掉帧、帧率不稳，也录不到声音），而是逐帧摆好再截图：
//   - 产品把内容分成一段段"场景"（幻灯片就是一页一个），每段给一个进入函数和时长；
//   - 进入场景后，页面里正在跑的 CSS 动画、过渡、Web Animations 全部暂停，按时间轴一帧帧拨到对应时刻；
//     正在播的 <video> 也暂停，按时刻 seek；
//   - 动画都放完、又没有在播的视频，后面就是静止画面：只截一张，按剩下的时长占位，不逐帧截；
//   - 声音不经过浏览器：产品按算好的时间轴给音轨（旁白、背景音乐），场景里在播的有声 <video> 的音轨
//     框架自己抽出来，最后用 ffmpeg 把画面和声音合成一个 MP4。
// 用 JS 定时器、requestAnimationFrame 自己驱动的动画控制不了，按截图那一刻的样子出。
//
// 要本机有 ffmpeg：PROTOFLOW_FFMPEG_PATH → PATH 里的 ffmpeg。没有就报错说明怎么装，不自动下载。
// 编码优先用硬件（macOS 的 VideoToolbox、Windows/Linux 的 NVENC 等，比 libx264 快几倍），不能用就退回 libx264；
// PROTOFLOW_VIDEO_ENCODER 可以指定（比如 libx264）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolveBrowserExecutable, closeBrowser } from "./pdf.js";

export function resolveFfmpeg() {
  const exe = process.env.PROTOFLOW_FFMPEG_PATH || "ffmpeg";
  const r = spawnSync(exe, ["-version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    throw Object.assign(new Error("导出 MP4 需要本机装 ffmpeg（macOS：brew install ffmpeg；Windows：winget install ffmpeg），或设置 PROTOFLOW_FFMPEG_PATH 指向 ffmpeg"), { code: "FFMPEG_MISSING" });
  }
  return exe;
}

const abortError = () => Object.assign(new Error("导出已取消"), { name: "AbortError", code: "ABORTED" });
const checkAbort = (signal) => { if (signal && signal.aborted) throw abortError(); };

// onLine：可选，逐行收 stdout（配合 -progress pipe:1 读编码进度）；signal：取消时杀掉 ffmpeg
function run(exe, args, onLine = null, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(abortError()); return; }
    const p = spawn(exe, args, { stdio: ["ignore", onLine ? "pipe" : "ignore", "pipe"], ...(signal ? { signal } : {}) });
    let err = "", buf = "";
    if (onLine) p.stdout.on("data", (d) => { buf += d; const lines = buf.split("\n"); buf = lines.pop(); lines.forEach(onLine); });
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    p.on("error", (e) => reject(e && e.name === "AbortError" ? abortError() : e));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 出错（${code}）：${err.trim().split("\n").slice(-3).join(" ")}`))));
  });
}

// 候选的硬件 H.264 编码器（按平台），码率定死：幻灯片画面简单，8M 对 1080p 足够清楚
const HW_ENCODERS = {
  darwin: ["h264_videotoolbox"],
  win32: ["h264_nvenc", "h264_qsv", "h264_amf"],
  linux: ["h264_nvenc"],
};
const encoderArgs = (name) => (name === "libx264"
  ? ["-c:v", "libx264", "-preset", "fast", "-crf", "20"]
  : ["-c:v", name, "-b:v", "8M", "-maxrate", "12M", "-bufsize", "16M"]);
const encoderCache = new Map(); // ffmpeg 路径 + 画面大小 → Promise<选中的编码器>（一个进程只试一次）

// 选编码器：列出来的不一定能用（比如装了 NVENC 版 ffmpeg 但没有 N 卡；VideoToolbox 不接太小的画面），
// 按真实画面大小编几帧试一下。异步：要试好几秒，不能卡住本地服务。
export function pickVideoEncoder(ffmpeg = resolveFfmpeg(), { width = 1920, height = 1080 } = {}) {
  if (process.env.PROTOFLOW_VIDEO_ENCODER) return Promise.resolve(process.env.PROTOFLOW_VIDEO_ENCODER);
  const key = `${ffmpeg} ${width}x${height}`;
  if (!encoderCache.has(key)) encoderCache.set(key, (async () => {
    const lines = [];
    await run(ffmpeg, ["-hide_banner", "-encoders"], (l) => lines.push(l)).catch(() => {});
    for (const name of HW_ENCODERS[process.platform] || []) {
      if (!lines.some((l) => l.split(/\s+/).includes(name))) continue;
      const ok = await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:r=25:d=0.2`,
        "-pix_fmt", "yuv420p", ...encoderArgs(name), "-f", "null", "-"]).then(() => true, () => false);
      if (ok) return name;
    }
    return "libx264";
  })());
  return encoderCache.get(key);
}

// 媒体文件的时长（毫秒，读不出来是 null）和有没有音轨。用 ffmpeg 自己的输出，不另外要 ffprobe。
export function probeMedia(file, ffmpeg = resolveFfmpeg()) {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr || "");
  return {
    durationMs: m ? Math.round(((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000) : null,
    hasAudio: /Stream #\S+.*: Audio:/.test(r.stderr || ""),
  };
}

// 在页面里装的逐帧控制器：暂停并接管动画和视频，按场景内的时刻摆好。
function installRecorder() {
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  };
  let anims = new Map(); // Animation → 它在场景时间轴上从哪一刻开始
  let videos = [];
  const scan = (t) => {
    for (const a of document.getAnimations()) {
      if (anims.has(a)) continue;
      const target = a.effect && a.effect.target;
      if (!visible(target && target.nodeType === 1 ? target : target && target.parentElement)) continue;
      a.pause();
      anims.set(a, t - (Number(a.currentTime) || 0));
    }
  };
  const loaded = (v) => (v.readyState >= 1 ? Promise.resolve() : new Promise((r) => {
    v.addEventListener("loadedmetadata", r, { once: true }); v.addEventListener("error", r, { once: true }); setTimeout(r, 5000);
  }));
  const seekVideo = (v, t) => {
    const d = v.duration;
    const at = !Number.isFinite(d) || d <= 0 ? 0 : v.loop ? (t / 1000) % d : Math.min(t / 1000, Math.max(0, d - 0.001));
    if (Math.abs(v.currentTime - at) < 0.0005 && v.readyState >= 2) return Promise.resolve();
    return new Promise((r) => { v.addEventListener("seeked", r, { once: true }); setTimeout(r, 10000); v.currentTime = at; });
  };
  window.__pfRecorder = {
    // 进入场景之后调：返回在播的视频（给时长、抽音轨）
    async begin() {
      anims = new Map();
      videos.forEach((v) => { delete v.play; }); // 上一段接管的视频还给页面
      videos = [...document.querySelectorAll("video")].filter((v) => !v.paused && visible(v));
      // 有没有声音要在暂停之前看：页面自己调的 play() 被这里的 pause() 打断会 reject，页面常见的兜底是
      // "被拦了就静音再播"——那之后 muted 就不准了
      const audible = videos.map((v) => !v.defaultMuted && !v.muted && v.volume > 0);
      // 接管期间不许页面再把它播起来（上面那种兜底会让视频按真实时间一直往前跑，逐帧 seek 截到的就是乱的帧）
      videos.forEach((v) => { v.play = () => Promise.resolve(); v.pause(); });
      await Promise.all(videos.map(loaded));
      scan(0);
      return videos.map((v, i) => ({
        src: v.currentSrc || v.src,
        durationMs: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null,
        loop: v.loop, audible: audible[i], volume: v.volume,
      }));
    },
    // 动画都放完的时刻（场景内毫秒）；有无限循环的动画或在播的视频就是 Infinity
    settleMs() {
      if (videos.length) return Infinity;
      let end = 0;
      for (const [a, start] of anims) {
        const e = a.effect && a.effect.getComputedTiming().endTime;
        end = Math.max(end, start + (Number.isFinite(e) ? e : Infinity));
      }
      return end;
    },
    async seek(t) {
      scan(t);
      for (const [a, start] of anims) { try { a.currentTime = Math.max(0, t - start); } catch (_e) { /* 已被移除的动画 */ } }
      await Promise.all(videos.map((v) => seekVideo(v, t)));
    },
  };
}

// 并行截图的工作页数：一半的核（截图、解码视频都吃 CPU），最多 4 个（每页都要装下整份 HTML，占内存）
const defaultWorkers = () => Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));

// 页面里内嵌的视频（data: 地址）换成"每帧都是关键帧"的代理文件。手机拍的视频几秒甚至整段才一个关键帧，
// 逐帧 seek 时浏览器每次都要从关键帧解到目标帧，越往后越慢，超时就截到上一帧（成片一卡一卡的）。
// 代理顺手缩到画面大小以内（不放大），解码更快；页面也从几十 MB 的内嵌数据变成引用旁边的文件，打开快。
// 音轨原样保留（有声视频的声音从它抽）。每次导出现转，不缓存（实测只省半分钟，不值得多一套缓存要维护）。
async function proxyVideos(html, dir, ffmpeg, { width, height, onEach, signal }) {
  const found = new Map(); // data 地址 → 代理文件名
  const re = /data:video\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
  for (const m of html.matchAll(re)) if (!found.has(m[0])) found.set(m[0], null);
  let n = 0;
  for (const uri of found.keys()) {
    const src = mediaFile(uri, dir, `src-${n}`);
    const name = `proxy-${n++}.mp4`;
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", src,
      "-vf", `scale=w='min(iw,${width})':h='min(ih,${height})':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16", "-g", "1", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart",
      path.join(dir, name)], null, signal).then(() => found.set(uri, name), () => { /* 转不了就留原样 */ });
    checkAbort(signal);
    fs.rmSync(src, { force: true });
    if (onEach) onEach(n, found.size);
  }
  return html.replace(re, (m) => found.get(m) || m);
}

// data: 地址 → 临时文件；本地文件地址 → 路径；别的（http）交给 ffmpeg 自己读。
function mediaFile(src, dir, n) {
  if (src.startsWith("data:")) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(src);
    if (!m) return null;
    const file = path.join(dir, `video-${n}.${(m[1].split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "")}`);
    fs.writeFileSync(file, m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3])));
    return file;
  }
  if (src.startsWith("file:")) return decodeURIComponent(new URL(src).pathname);
  return src || null;
}

// html：完整的页面（自包含，不依赖本地服务）。opts：
//   width / height   视口和画面大小（CSS 像素）
//   fps              帧率，缺省 25
//   ready            可选：页面里执行的函数源码，返回 true 表示画好了（同 htmlToPdf）
//   prepare          可选：页面里执行的函数源码，开录前调一次（比如隐藏页面自己的控件、停掉自带的放映）
//   scenes           [{ enter, durationMs }]：enter 是页面里执行的函数源码，切到这一段；durationMs 是毫秒数，
//                    或 ({ videos }) => 毫秒数（videos 是进入后在播的视频 [{ durationMs, loop, audible }]）
//   workers          可选：几个页面并行截，缺省按 CPU 核数（最多 4）
//   onProgress       可选：(fraction 0–1, stage, { preview, meta }) 进度：stage 是给人看的一句"在做什么"，
//                    preview 是最近截好的一帧（图片文件路径，给进度弹窗实时预览），meta.durationMs 录完后才有
//   signal           可选：AbortSignal，取消时停下（关浏览器、杀 ffmpeg），返回的 Promise 以 AbortError 结束
//   audio            可选：(timeline) => [{ file | buffer, startMs, durationMs?, volume?, loop?, volumeRanges? }]
//                    timeline = { durationMs, scenes: [{ startMs, durationMs, videos }], soundingRanges: [{ startMs, endMs }] }
//                    （soundingRanges 是场景里有声视频在响的时段，给背景音乐避让用）；
//                    volumeRanges: [{ startMs, endMs, volume }] 这些时段换成这个音量
// 返回 MP4 的 Buffer（H.264 + AAC）。
// 同一时间只录一个：每个都要占满 CPU（几个工作页 + ffmpeg），同时录几个只会一起慢、把机器拖垮。后来的排队。
let queue = Promise.resolve();
export function htmlToMp4(html, opts = {}) {
  const onProgress = opts.onProgress;
  if (onProgress) onProgress(0, "排队中");
  const job = queue.then(() => { checkAbort(opts.signal); return recordMp4(html, opts); });
  queue = job.catch(() => {});
  return job;
}

// 进程被杀掉（比如重启本地服务）时来不及删临时目录，几千张截图会一直留着：开录前把放了很久没动的清掉。
const TMP_PREFIX = "pf-mp4-";
const STALE_MS = 6 * 60 * 60 * 1000;
function removeStaleTmp() {
  const root = os.tmpdir();
  let names = [];
  try { names = fs.readdirSync(root); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(TMP_PREFIX)) continue;
    const dir = path.join(root, name);
    try { if (Date.now() - fs.statSync(dir).mtimeMs > STALE_MS) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 别的进程正在删 */ }
  }
}

async function recordMp4(html, { width = 1920, height = 1080, fps = 25, ready = null, prepare = null, scenes = [], audio = null, timeout = 20000, workers = defaultWorkers(), onProgress = null, signal = null } = {}) {
  if (!scenes.length) throw new Error("htmlToMp4：没有场景");
  const ffmpeg = resolveFfmpeg();
  removeStaleTmp();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
  try {
    const file = path.join(tmp, "page.html");
    const frameMs = 1000 / fps;
    // 每段的时长取整到整帧：各段单独编码后首尾相接，不取整会一段段累积误差，声音跟着错位
    const sceneDuration = (scene, videos) => {
      const ms = typeof scene.durationMs === "function" ? scene.durationMs({ videos }) : scene.durationMs;
      return Math.max(1, Math.round(ms / frameMs)) * frameMs;
    };
    const results = new Array(scenes.length); // 每段：{ frames: [{ file, durationMs }], durationMs, videos, audio: [{ file, volume, loop, soundingMs }] }
    // 进度：准备视频 0–5%，录画面 5–85%（各段截到的时长占比的平均），等最后几段编完 85–95%，拼接加声音 95–100%
    let shown = 0; // 只增不减（几个工作页交错报、浮点误差都可能让算出来的数往回跳一点）
    // 预览图：按成片顺序走——成片里最靠前、还没录完的那一段的最新一帧。几段是并行在录的，要是直接拿"刚截的
    // 那一帧"，画面会在几段之间来回跳（一会儿后面、一会儿前面）；这样只会往后推进，跟最终成片的顺序一致。
    const sceneLatest = new Array(scenes.length).fill(null);
    const previewFrame = () => {
      const j = results.findIndex((r) => !r);
      if (j === -1) { const last = results[results.length - 1]; return last ? last.frames[last.frames.length - 1].file : null; }
      if (sceneLatest[j]) return sceneLatest[j];
      const prev = j > 0 && results[j - 1]; // 这一段还没开始截：停在上一段的最后一帧
      return prev ? prev.frames[prev.frames.length - 1].file : null;
    };
    const report = (fraction, stage, extra = {}) => {
      shown = Math.max(shown, Math.min(1, fraction));
      if (onProgress) onProgress(shown, stage, { preview: previewFrame(), ...extra });
    };
    const sceneDone = new Array(scenes.length).fill(0);
    // 几段并行在截，"第几段"没有意义，只报总的比例
    const reportCapture = () => report(0.05 + 0.8 * sceneDone.reduce((a, b) => a + b, 0) / scenes.length, "录制画面");
    const encoderJob = pickVideoEncoder(ffmpeg, { width, height }); // 跟准备视频同时试
    report(0, "准备视频");
    fs.writeFileSync(file, await proxyVideos(html, tmp, ffmpeg, { width, height, onEach: (k, total) => report(0.05 * k / total, "准备视频"), signal }));
    report(0.05, "打开页面");
    let encoder = await encoderJob;

    // ---- 边录边编码：每录完一段就排进编码队列，编成一小段只有画面的 MP4（一次只编一段，少跟录制抢 CPU）；
    // 全部录完后只把各段首尾拼起来、混入声音。硬件编码中途失败就改用 libx264，之前用别的编码器编的段最后重编，
    // 保证拼接的各段参数一致。
    const segments = new Array(scenes.length); // 第 i 段：{ file, encoder }
    let encodeQueue = Promise.resolve();
    let encodeError = null;
    const encodeSegment = async (i) => {
      const r = results[i];
      const list = path.join(tmp, `seg-${i}.txt`);
      fs.writeFileSync(list, r.frames.map((f) => `file '${f.file.replace(/'/g, "'\\''")}'\nduration ${(f.durationMs / 1000).toFixed(4)}`).join("\n")
        + `\nfile '${r.frames[r.frames.length - 1].file.replace(/'/g, "'\\''")}'\n`); // 最后一张要再写一遍，ffmpeg 才认它的时长
      const out = path.join(tmp, `seg-${i}.mp4`);
      const args = (enc) => ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list,
        "-vf", `fps=${fps},scale=${width}:${height},format=yuv420p`, "-an", ...encoderArgs(enc), "-r", String(fps), "-t", (r.durationMs / 1000).toFixed(3), out];
      try { await run(ffmpeg, args(encoder), null, signal); }
      catch (e) {
        if (encoder === "libx264" || e.code === "ABORTED") throw e;
        encoder = "libx264";
        await run(ffmpeg, args(encoder), null, signal);
      }
      segments[i] = { file: out, encoder };
    };
    const queueSegment = (i) => {
      encodeQueue = encodeQueue.then(() => (encodeError ? null : encodeSegment(i))).catch((e) => { encodeError = encodeError || e; });
    };

    // ---- 录画面：每个工作页一个独立的浏览器。同一个浏览器里开多个页面，截图都挤在它的同一个出图进程里排队，
    // 实测 4 个页面只比 1 个快一半；分开成独立浏览器快将近一倍。
    // 关浏览器：不管成功、出错还是取消，每个都一定关掉（不然进程和临时目录会残留）；一个工作页出错，其他的马上停。
    const { launch } = await import("puppeteer-core");
    const exe = await resolveBrowserExecutable();
    const browsers = new Set();
    let stopped = false;
    const stopAll = () => { stopped = true; for (const b of browsers) closeBrowser(b); };
    const onAbort = () => stopAll();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    let next = 0;
    const worker = async () => {
      const browser = await launch({ headless: true, executablePath: exe.path, args: ["--no-sandbox", "--disable-setuid-sandbox", "--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
      browsers.add(browser);
      if (stopped) return; // 还在启动时别的工作页已经出错了：最后统一关
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: Math.max(timeout, 120000) });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      if (ready) await page.waitForFunction(`(${ready})()`, { timeout }).catch(() => { /* 画不完也照样出 */ });
      if (prepare) await page.evaluate(`(${prepare})()`);
      await page.evaluate(installRecorder);
      let last = -1, shot = 0;
      const tag = `b${[...browsers].indexOf(browser)}`;
      const enter = async (i) => {
        await page.evaluate(`(${scenes[i].enter})()`);
        const videos = await page.evaluate(() => window.__pfRecorder.begin());
        return { videos, durationMs: sceneDuration(scenes[i], videos) };
      };
      while (next < scenes.length && !stopped) {
        const i = next++;
        // 上一段不是这个工作页截的：先把上一段放到结尾（不截），切场景时的离场效果才跟顺着放一样
        if (i > 0 && last !== i - 1) {
          const prev = await enter(i - 1);
          await page.evaluate((ms) => window.__pfRecorder.seek(ms), prev.durationMs);
        }
        const { videos, durationMs } = await enter(i);
        const frames = [];
        const capture = async (ms) => {
          const f = path.join(tmp, `${tag}-${String(shot++).padStart(6, "0")}.jpg`);
          fs.writeFileSync(f, await page.screenshot({ type: "jpeg", quality: 90, optimizeForSpeed: true }));
          frames.push({ file: f, durationMs: ms });
          sceneLatest[i] = f;
        };
        // 动画和视频逐帧：拨到时刻 t 截一张；动画都放完（又没有在播的视频）或到了结尾，这一张占满剩下的时长
        for (let k = 0; ; k++) {
          checkAbort(signal);
          if (stopped) throw abortError();
          const t = k * frameMs;
          const settle = await page.evaluate((ms) => window.__pfRecorder.seek(ms).then(() => window.__pfRecorder.settleMs()), t);
          if (t >= settle || t + frameMs >= durationMs - 0.5) { await capture(durationMs - t); break; }
          await capture(frameMs);
          sceneDone[i] = t / durationMs;
          if (shot % 10 === 0) reportCapture();
        }
        sceneDone[i] = 1;
        const audio = [];
        for (const v of videos) {
          if (!v.audible || !v.src) continue;
          const src = mediaFile(v.src, tmp, `${tag}-${i}-${audio.length}`);
          if (!src || !probeMedia(src, ffmpeg).hasAudio) continue;
          audio.push({ file: src, volume: v.volume, loop: v.loop, soundingMs: v.loop || v.durationMs == null ? durationMs : Math.min(durationMs, v.durationMs) });
        }
        results[i] = { frames, durationMs, videos: videos.map(({ src: _src, ...v }) => v), audio };
        last = i;
        queueSegment(i);
        reportCapture();
      }
    };
    let firstError = null; // 最先出的那个错（别的工作页跟着停下时报的"已取消"不算）
    await Promise.allSettled(Array.from({ length: Math.max(1, Math.min(workers, scenes.length)) }, () =>
      worker().catch((e) => { if (!firstError) firstError = e; stopAll(); throw e; })));
    if (signal) signal.removeEventListener("abort", onAbort);
    await Promise.allSettled([...browsers].map(closeBrowser));
    if (firstError || (signal && signal.aborted)) {
      await encodeQueue; // 后台正在编的那段停下来再删临时目录
      checkAbort(signal);
      throw firstError;
    }

    // ---- 等最后几段编完；编码器中途换过的，把用旧编码器编的段重编
    const reportEncode = () => report(0.85 + 0.1 * segments.filter(Boolean).length / scenes.length, "合成视频");
    const timer = setInterval(reportEncode, 500);
    try {
      await encodeQueue;
      if (encodeError) throw encodeError;
      for (let i = 0; i < scenes.length; i++) if (segments[i].encoder !== encoder) await encodeSegment(i);
    } finally { clearInterval(timer); }

    const videoTracks = [];
    const timeline = { durationMs: 0, scenes: [], soundingRanges: [] };
    for (const r of results) {
      const startMs = timeline.durationMs;
      for (const a of r.audio) {
        videoTracks.push({ file: a.file, startMs, durationMs: r.durationMs, volume: a.volume, loop: a.loop });
        timeline.soundingRanges.push({ startMs, endMs: startMs + a.soundingMs });
      }
      timeline.scenes.push({ startMs, durationMs: r.durationMs, videos: r.videos });
      timeline.durationMs += r.durationMs;
    }

    // ---- 拼接各段（画面直接复制，不重新编码）+ 混入声音
    fs.writeFileSync(path.join(tmp, "segments.txt"), segments.map((g) => `file '${g.file.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
    const tracks = [...videoTracks, ...((audio && audio(timeline)) || [])].map((a, i) => {
      if (a.file) return a;
      const f = path.join(tmp, `audio-${i}`);
      fs.writeFileSync(f, a.buffer);
      return { ...a, file: f };
    });
    const total = timeline.durationMs / 1000;
    const args = ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "segments.txt")];
    for (const a of tracks) args.push(...(a.loop ? ["-stream_loop", "-1"] : []), "-i", a.file);
    const graph = [];
    tracks.forEach((a, i) => {
      const base = a.volume == null ? 1 : a.volume;
      const ranges = (a.volumeRanges || []).map((r) => `between(t,${(r.startMs - (a.startMs || 0)) / 1000},${(r.endMs - (a.startMs || 0)) / 1000})*${r.volume - base}`);
      const vol = ranges.length ? `volume='${base}+${ranges.join("+")}':eval=frame` : `volume=${base}`;
      const delay = Math.max(0, Math.round(a.startMs || 0));
      graph.push(`[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${((a.durationMs ?? timeline.durationMs) / 1000).toFixed(3)},asetpts=PTS-STARTPTS,${vol},adelay=${delay}|${delay},apad[a${i}]`);
    });
    // amix 按输入数平分音量（各路都补齐成一样长，比例恒定），再乘回来
    if (tracks.length) graph.push(`${tracks.map((_, i) => `[a${i}]`).join("")}amix=inputs=${tracks.length}:duration=longest:dropout_transition=0,volume=${tracks.length},atrim=0:${total.toFixed(3)}[a]`);
    args.push("-map", "0:v", "-c:v", "copy");
    if (tracks.length) args.push("-filter_complex", graph.join(";"), "-map", "[a]", "-c:a", "aac", "-b:a", "192k");
    const out = path.join(tmp, "out.mp4");
    report(0.95, "合成视频", { meta: { durationMs: timeline.durationMs } });
    args.push("-progress", "pipe:1", "-nostats", "-t", total.toFixed(3), "-movflags", "+faststart", out);
    await run(ffmpeg, args, (line) => {
      const m = /^out_time_ms=(\d+)/.exec(line); // 名字叫 ms，其实是微秒（ffmpeg 的历史命名）
      if (m && total > 0) report(0.95 + 0.05 * Math.min(1, Number(m[1]) / 1e6 / total), "合成视频");
    }, signal);
    report(1, "完成");
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
