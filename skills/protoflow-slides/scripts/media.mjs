#!/usr/bin/env node
// media.mjs — 幻灯片里的音视频：准备素材、体检声音。要本机有 ffmpeg / ffprobe（PATH 上，或者 PROTOFLOW_FFMPEG 指到 ffmpeg）。
// 目标和做法见 ../references/media.md。
//
//   node media.mjs prepare <文件…> --out <幻灯片>/assets [--name <文件名>] [--lufs -18] [--tp -1.5] [--no-audio]
//     视频 → H.264 + AAC 的 .mp4（本来就是 H.264 就不重编码画面）、响度拉平、截一张 <名>-poster.jpg；
//     音频（背景音乐、旁白）→ 响度拉平的 .mp3。原文件不动；--no-audio 去掉视频的声音（只有底噪的片段）。
//   node media.mjs audit --projectId <项目> --deckId <幻灯片> [--dir <工作目录>]
//     列出页面里每段视频、背景音乐、旁白的格式、时长、响度、峰值，背景音乐按 playback.json 里的音量折算实际响度；
//     标出：格式浏览器放不稳、响度偏离其它片段太多、峰值太高会破音、几乎没声却会触发背景音乐避让、背景音乐盖过原声。
// 输出都是 JSON。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cli, SkillError } from "./lib/cli.mjs";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([\w-]+)$/.exec(argv[i]);
    if (m) out[m[1]] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    else out._.push(argv[i]);
  }
  return out;
}

// 找 ffmpeg / ffprobe：PROTOFLOW_FFMPEG → PATH → 常见安装位置
function findTool(name) {
  const env = process.env.PROTOFLOW_FFMPEG;
  const cands = [];
  if (env) cands.push(name === "ffmpeg" ? env : path.join(path.dirname(env), name));
  for (const dir of (process.env.PATH || "").split(path.delimiter)) if (dir) cands.push(path.join(dir, name));
  cands.push(`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`);
  const hit = cands.find((p) => fs.existsSync(p) || fs.existsSync(p + ".exe"));
  if (!hit) throw new SkillError("FFMPEG_NOT_FOUND", `找不到 ${name}：macOS 用 brew install ffmpeg，Windows 用 winget install ffmpeg，或者设 PROTOFLOW_FFMPEG=<ffmpeg 路径>`);
  return fs.existsSync(hit) ? hit : hit + ".exe";
}
const run = (tool, args) => {
  const r = spawnSync(findTool(tool), args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new SkillError("FFMPEG_FAILED", `${tool} ${args.slice(0, 6).join(" ")}…：${(r.stderr || "").trim().split("\n").slice(-3).join(" ")}`);
  return r;
};

function probe(file) {
  const j = JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]).stdout);
  const v = j.streams.find((s) => s.codec_type === "video" && !(s.disposition && s.disposition.attached_pic));
  const a = j.streams.find((s) => s.codec_type === "audio");
  return { sec: Number(j.format.duration) || null, video: v ? { codec: v.codec_name, pix: v.pix_fmt, w: v.width, h: v.height } : null, audio: a ? { codec: a.codec_name } : null };
}

// 响度：整体（I）、真峰值（TP）、最响的瞬时值（M，判断是不是只有底噪）
function loudness(file) {
  const err = run("ffmpeg", ["-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr;
  const I = Number((/\n\s+I:\s+(-?[\d.]+) LUFS/.exec(err) || [])[1]);
  const TP = Number((/Peak:\s+(-?[\d.]+) dBFS/.exec(err.slice(err.lastIndexOf("True peak"))) || [])[1]);
  const moments = [...err.matchAll(/\sM:\s*(-?[\d.]+)/g)].map((m) => Number(m[1])).filter(Number.isFinite);
  return { I: Number.isFinite(I) ? I : null, TP: Number.isFinite(TP) ? TP : null, Mmax: moments.length ? Math.max(...moments) : null };
}

// 两遍 loudnorm：先测，再按测到的值线性增益（保留原来的起伏；线性做不到时 ffmpeg 自己退回动态处理）
function loudnormFilter(file, lufs, tp) {
  const err = run("ffmpeg", ["-nostats", "-i", file, "-vn", "-af", `loudnorm=I=${lufs}:TP=${tp}:LRA=20:print_format=json`, "-f", "null", "-"]).stderr;
  const j = JSON.parse(err.slice(err.lastIndexOf("{"), err.lastIndexOf("}") + 1));
  return `loudnorm=I=${lufs}:TP=${tp}:LRA=20:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i, AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i;
const slug = (name) => name.replace(/\.[^.]+$/, "").replace(/[\s/\\?%*:|"<>]+/g, "-");

function prepare(files, args) {
  if (!files.length || !args.out) throw new SkillError("USAGE", "用法：node media.mjs prepare <文件…> --out <幻灯片>/assets [--name <文件名>] [--lufs -18] [--tp -1.5] [--no-audio]");
  if (args.name && files.length > 1) throw new SkillError("USAGE", "--name 只能配一个文件");
  const lufs = Number(args.lufs || -18), tp = Number(args.tp || -1.5);
  fs.mkdirSync(args.out, { recursive: true });
  const results = [];
  for (const file of files) {
    if (!fs.existsSync(file)) throw new SkillError("NOT_FOUND", `文件不存在：${file}`);
    const info = probe(file);
    const base = args.name || slug(path.basename(file));
    if (VIDEO_EXT.test(file) || info.video) {
      if (!info.video) throw new SkillError("NO_VIDEO", `${file} 里没有画面`);
      const out = path.join(args.out, `${base}.mp4`);
      if (path.resolve(out) === path.resolve(file)) throw new SkillError("SAME_FILE", `输出会覆盖原文件：${out}，用 --name 换个名字`);
      // 浏览器稳的画面：H.264 + yuv420p；是的话直接拷，不重编码
      const copyVideo = info.video.codec === "h264" && info.video.pix === "yuv420p";
      const vArgs = copyVideo ? ["-c:v", "copy"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"];
      const keepAudio = info.audio && args["no-audio"] !== "true";
      const aArgs = keepAudio ? ["-af", loudnormFilter(file, lufs, tp), "-c:a", "aac", "-b:a", "192k", "-ar", "48000"] : ["-an"];
      run("ffmpeg", ["-v", "error", "-y", "-i", file, "-map", "0:v:0", ...(keepAudio ? ["-map", "0:a:0"] : []), ...vArgs, ...aArgs, "-movflags", "+faststart", out]);
      const poster = path.join(args.out, `${base}-poster.jpg`);
      const at = Math.min(0.5, (info.sec || 1) / 4);
      run("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", out, "-frames:v", "1", "-q:v", "3", poster]);
      results.push({ from: file, video: out, poster, sec: probe(out).sec, reencoded: !copyVideo, audio: keepAudio ? loudness(out) : "无" });
    } else if (AUDIO_EXT.test(file) || info.audio) {
      const out = path.join(args.out, `${base}.mp3`);
      if (path.resolve(out) === path.resolve(file)) throw new SkillError("SAME_FILE", `输出会覆盖原文件：${out}，用 --name 换个名字`);
      run("ffmpeg", ["-v", "error", "-y", "-i", file, "-vn", "-af", loudnormFilter(file, lufs, tp), "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", out]);
      results.push({ from: file, audio: out, sec: probe(out).sec, loudness: loudness(out) });
    } else throw new SkillError("UNSUPPORTED", `不认识的文件：${file}（只处理视频和音频）`);
  }
  return { ok: true, target: { lufs, tp }, results, next: "页里改用新文件（视频配 poster），再跑 check.mjs" };
}

// ---- audit ----
const db = (v) => 20 * Math.log10(v);
const round = (n) => (n == null ? null : Math.round(n * 10) / 10);

function audit(args) {
  if (!args.projectId || !args.deckId) throw new SkillError("USAGE", "用法：node media.mjs audit --projectId <项目> --deckId <幻灯片> [--dir <工作目录>]");
  const project = cli("get_project", { projectId: args.projectId, ...(args.dir ? { dir: args.dir } : {}) });
  const deckDir = path.join(project.projectDir, "decks", args.deckId);
  if (!fs.existsSync(deckDir)) throw new SkillError("DECK_NOT_FOUND", `没有这份幻灯片：${deckDir}`);
  const playback = fs.existsSync(path.join(deckDir, "playback.json")) ? JSON.parse(fs.readFileSync(path.join(deckDir, "playback.json"), "utf8")) : {};
  const slidesDir = path.join(deckDir, "slides");
  const pages = fs.readdirSync(slidesDir).filter((f) => /^[^.].*\.html$/.test(f)).sort();

  // 页里的视频（第一个 src；带 muted 的不算会响）
  const clips = [];
  for (const f of pages) {
    const html = fs.readFileSync(path.join(slidesDir, f), "utf8");
    for (const m of html.matchAll(/<video\b[^>]*>/gi)) {
      const src = (/\bsrc\s*=\s*"assets\/([^"]+)"/i.exec(m[0]) || [])[1];
      if (src) clips.push({ page: f.replace(/\.html$/, ""), kind: "video", file: decodeURIComponent(src), muted: /\bmuted\b/i.test(m[0]) });
    }
  }
  for (const [id, cfg] of Object.entries(playback.slides || {})) {
    const src = cfg && cfg.audio && /^assets\/(.+)$/.exec(cfg.audio.src || "");
    if (src) clips.push({ page: id, kind: "narration", file: decodeURIComponent(src[1]), volume: cfg.audio.volume ?? 1 });
  }
  const bg = playback.backgroundAudio;
  const issues = [];
  const add = (code, level, message) => issues.push({ code, level, message });

  const rows = clips.map((c) => {
    const p = path.join(deckDir, "assets", c.file);
    if (!fs.existsSync(p)) { add("MISSING", "error", `${c.page}：assets/${c.file} 不存在`); return { ...c, missing: true }; }
    const info = probe(p);
    const loud = info.audio ? loudness(p) : null;
    return { ...c, sec: round(info.sec), video: info.video && `${info.video.codec} ${info.video.w}×${info.video.h}`, audio: info.audio ? info.audio.codec : null, I: round(loud && loud.I), TP: round(loud && loud.TP), Mmax: round(loud && loud.Mmax) };
  }).filter((r) => !r.missing);

  for (const r of rows) {
    if (r.kind === "video" && r.video && !/^h264 /.test(r.video)) add("CODEC", "warn", `${r.page}：${r.file} 是 ${r.video.split(" ")[0]}，浏览器放不稳，用 prepare 转成 H.264`);
    if (r.kind === "video" && r.audio && !r.muted && r.Mmax != null && r.Mmax < -30) add("NEAR_SILENT", "warn", `${r.page}：${r.file} 最响的瞬间也只有 ${r.Mmax} LUFS，基本是底噪，但没静音——播放时会把背景音乐压下去，造成冷场。加 muted，或者 prepare --no-audio`);
    if (r.TP != null && r.TP > -1 && !r.muted) add("PEAK", "warn", `${r.page}：${r.file} 峰值 ${r.TP} dBTP，接音箱可能破音，用 prepare 拉平`);
  }
  // 会响的视频之间的响度差：离中位数超过 3 LU 就提醒
  const sounding = rows.filter((r) => r.kind === "video" && r.audio && !r.muted && r.I != null && (r.Mmax == null || r.Mmax >= -30));
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const mid = median(sounding.map((r) => r.I));
  for (const r of sounding) if (Math.abs(r.I - mid) > 3) add("LOUDNESS", "warn", `${r.page}：${r.file} ${r.I} LUFS，比其它片段（中位 ${mid}）${r.I > mid ? "响" : "轻"} ${Math.abs(r.I - mid).toFixed(1)} LU，用 prepare 拉到一致`);

  let background = null;
  if (bg && /^assets\//.test(bg.src || "")) {
    const p = path.join(deckDir, bg.src);
    if (!fs.existsSync(p)) add("MISSING", "error", `背景音乐 ${bg.src} 不存在`);
    else {
      const info = probe(p), loud = loudness(p);
      const vol = bg.volume ?? 0.3;
      background = { file: bg.src.slice("assets/".length), sec: round(info.sec), I: round(loud.I), TP: round(loud.TP), volume: vol,
        effectiveI: round(loud.I + db(vol)), ...(bg.duckVolume != null ? { duckVolume: bg.duckVolume, duckedI: round(loud.I + db(bg.duckVolume)) } : {}) };
      if (mid != null) {
        background.belowClips = round(mid - background.effectiveI);
        if (background.effectiveI > mid - 3) add("BGM_LOUD", "warn", `背景音乐实际约 ${background.effectiveI} LUFS，跟视频原声（中位 ${mid}）差不多响，会盖过说话声：调低 volume，或者写 duckVolume`);
        if (bg.duckVolume == null && sounding.length) add("NO_DUCK", "info", "有会响的视频但没写 duckVolume：视频说话时背景音乐不会让开");
        if (background.duckedI != null && background.effectiveI - background.duckedI > 16) add("DUCK_DEEP", "info", `避让从 ${background.effectiveI} 压到 ${background.duckedI} LUFS，差 ${(background.effectiveI - background.duckedI).toFixed(0)} LU；照片页、视频页交替多的时候，音乐会一起一落，可以把 duckVolume 调高一点`);
      }
    }
  }
  return { ok: !issues.some((x) => x.level === "error"), deckId: args.deckId, clips: rows, background, medianClipI: mid, issues };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args._;
  let out;
  if (cmd === "prepare") out = prepare(rest, args);
  else if (cmd === "audit") out = audit(args);
  else throw new SkillError("USAGE", "用法：node media.mjs prepare <文件…> --out <目录> | audit --projectId <项目> --deckId <幻灯片>");
  console.log(JSON.stringify(out, null, 2));
  if (out.ok === false) process.exitCode = 1;
}

try { main(); } catch (e) {
  console.log(JSON.stringify({ ok: false, error: { code: e.code || "FAILED", message: e.message } }, null, 2));
  process.exitCode = 1;
}
