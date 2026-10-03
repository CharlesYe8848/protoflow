// core/video.js：把 HTML 录成 MP4 的框架部分（不认识任何产品）。这里测取消：录到一半取消，要很快停下、
// 以 AbortError 结束、不留临时目录。真起无头浏览器 + ffmpeg，本机没有 ffmpeg 就跳过。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { htmlToMp4 } from "../core/video.js";

const VIDEO_JS = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "core", "video.js")).href;

const HAS_FFMPEG = spawnSync(process.env.PROTOFLOW_FFMPEG_PATH || "ffmpeg", ["-version"]).status === 0;

test("取消：录到一半 abort，很快以 AbortError 结束，临时目录删掉；进度里带着最近一帧当预览", { skip: !HAS_FFMPEG && "本机没有 ffmpeg" }, async () => {
  // 一直转的动画：每一帧都要截，够录很久
  const html = '<!doctype html><style>@keyframes r{to{transform:rotate(360deg)}}h1{font-size:200px;animation:r 2s linear infinite}</style><h1>转</h1>';
  const ctrl = new AbortController();
  let preview = null;
  const started = Date.now();
  const job = htmlToMp4(html, {
    width: 640, height: 360, workers: 1, signal: ctrl.signal,
    scenes: [{ enter: "() => {}", durationMs: 60000 }],
    onProgress: (_f, stage, extra) => {
      if (stage === "录制画面" && extra && extra.preview && !preview) { preview = extra.preview; assert.ok(fs.existsSync(preview)); ctrl.abort(); }
    },
  });
  await assert.rejects(job, (e) => e.name === "AbortError" && e.code === "ABORTED");
  assert.ok(preview && preview.endsWith(".jpg"), "录的时候报了预览帧");
  assert.ok(Date.now() - started < 60000, "取消后很快停下，不会把 60 秒的画面都录完（机器忙时也留足余量）");
  // 只看这次录制自己的临时目录（预览帧就在里面）：全量测试时别的测试文件可能同时在录，目录名对比会误报
  assert.equal(fs.existsSync(path.dirname(preview)), false, "临时目录删掉了");
});

test("预览按成片顺序往后走：几段并行在录，预览也不在段之间来回跳", { skip: !HAS_FFMPEG && "本机没有 ffmpeg" }, async () => {
  // 4 段，每段一种底色（红绿蓝黄），都带一直转的动画（每段都要逐帧截，4 个工作页同时在录）
  const colors = [[255, 0, 0], [0, 200, 0], [0, 0, 255], [255, 220, 0]];
  const html = '<!doctype html><style>@keyframes r{to{transform:rotate(360deg)}}i{position:absolute;left:10px;top:10px;width:20px;height:20px;background:#fff;animation:r 1s linear infinite}</style><body style="margin:0"><i></i></body>';
  const seen = []; // 每次报进度时预览图属于第几段
  const colorOf = (file) => {
    const px = spawnSync(process.env.PROTOFLOW_FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", "crop=100:100:200:150,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]).stdout;
    let best = -1, bestD = Infinity;
    colors.forEach((c, k) => { const d = Math.abs(c[0] - px[0]) + Math.abs(c[1] - px[1]) + Math.abs(c[2] - px[2]); if (d < bestD) { bestD = d; best = k; } });
    return best;
  };
  let lastFile = null;
  await htmlToMp4(html, {
    width: 640, height: 360, workers: 4,
    scenes: colors.map((c) => ({ enter: `() => { document.body.style.background = "rgb(${c.join(",")})"; }`, durationMs: 1200 })),
    onProgress: (_f, stage, extra) => {
      if (stage !== "录制画面" || !extra || !extra.preview || extra.preview === lastFile) return;
      lastFile = extra.preview;
      if (fs.existsSync(extra.preview)) seen.push(colorOf(extra.preview));
    },
  });
  assert.ok(seen.length >= 4, `报了多次预览：${seen}`);
  assert.ok(seen.every((k, i) => i === 0 || k >= seen[i - 1]), `预览只往后走，不回跳：${seen.join(" ")}`);
});

// 在子进程里跑一段录制：跑完（成功或出错）进程必须自己退出——浏览器没关干净、定时器没清，进程就会挂着不退。
function runChild(code) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-mp4-test-"));
  const script = path.join(dir, "child.mjs");
  fs.writeFileSync(script, `import { htmlToMp4 } from ${JSON.stringify(VIDEO_JS)};\n${code}`);
  const r = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 120000, env: process.env });
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}
const ANIM = '<!doctype html><style>@keyframes r{to{transform:rotate(360deg)}}b{display:inline-block;font-size:80px;animation:r 1s linear infinite}</style><b>转</b>';

test("录完进程自己退出（几个独立浏览器都关干净）；某一页出错时报的是那个错，也不留浏览器", { skip: !HAS_FFMPEG && "本机没有 ffmpeg" }, () => {
  const ok = runChild(`const buf = await htmlToMp4(${JSON.stringify(ANIM)}, { width: 320, height: 180, workers: 3,
    scenes: [0, 1, 2].map(() => ({ enter: "() => {}", durationMs: 400 })) });
  console.log("OK", buf.length);`);
  assert.equal(ok.signal, null, `进程没有自己退出（被超时杀掉）：${ok.stderr}`);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^OK \d+/);
  const bad = runChild(`try {
    await htmlToMp4(${JSON.stringify(ANIM)}, { width: 320, height: 180, workers: 3,
      scenes: [0, 1, 2, 3].map((i) => ({ enter: i === 2 ? "() => { throw new Error('第三页坏了') }" : "() => {}", durationMs: 2000 })) });
    console.log("没报错");
  } catch (e) { console.log("ERR", e.name, e.message.split("\\n")[0]); }`);
  assert.equal(bad.signal, null, `出错后进程没有自己退出：${bad.stderr}`);
  assert.match(bad.stdout, /ERR .*第三页坏了/, "报的是出错那一页的错，不是别的工作页跟着停下的「已取消」");
});

test("closeBrowser：浏览器关掉后还活着的子进程（比如崩溃上报进程）一起清掉，不再拿着管道拖住 Node", { skip: process.platform === "win32" && "Windows 没有进程组" }, async () => {
  const { spawn } = await import("node:child_process");
  const { closeBrowser } = await import("../core/pdf.js");
  // 假的"浏览器"：自成进程组（跟 puppeteer 启动 Chrome 一样），再拉起一个继承了输出管道、自己不会退出的子进程
  const main = spawn(process.execPath, ["-e", `
    const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
    console.log(c.pid); process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);`], { detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const childPid = await new Promise((r) => main.stdout.once("data", (d) => r(Number(String(d).trim()))));
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.ok(alive(childPid));
  // 正常关闭只结束主进程（相当于 browser.close()），子进程会留下来
  await closeBrowser({ process: () => main, close: async () => { main.kill("SIGTERM"); await new Promise((r) => main.once("exit", r)); } });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(alive(childPid), false, "残留的子进程被清掉了");
  assert.ok(main.stdout.destroyed && main.stderr.destroyed, "Node 这边的管道断开了");
});
