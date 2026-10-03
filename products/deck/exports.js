// products/deck/exports.js — 幻灯片的导出格式：PDF、MP4、单个 HTML、源文件包（.zip）。导出最新版。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipDirectory, safeFileName, htmlToPdf, htmlToMp4, probeMedia } from "protoflow/sdk";
import { DECK_EXPORT_MENU } from "./exportMenu.js";
import { deckStandaloneHtml } from "./page.js";
import * as deckStore from "./store.js";
import { parsePlayback } from "./playback.js";

function buildHtml(ws, pid, deckId, ctx = {}) {
  const out = deckStandaloneHtml(ws, pid, deckId, { embed: ctx.embed });
  return out && { filename: `${out.name}.html`, buffer: Buffer.from(out.html, "utf8"), mime: "text/html" };
}

// 图表、流程图都画完了（PDF、MP4 都等它）
const READY = "() => ![...document.querySelectorAll('.mermaid')].some((m) => !m.querySelector('svg')) && ![...document.querySelectorAll('section .chart[data-chart]')].some((c) => !c.querySelector('svg') && !c.hasAttribute('data-chart-unknown'))";

// PDF：单 HTML 在无头浏览器里打开，等图表、流程图画完，切到打印排版（每页一张 1920×1080）再出。
async function buildPdf(ws, pid, deckId, ctx = {}) {
  const out = deckStandaloneHtml(ws, pid, deckId, { embed: ctx.embed });
  if (!out) return null;
  const buffer = await htmlToPdf(out.html, {
    width: 1920, height: 1080,
    ready: READY,
    beforePrint: "() => { if (window.__pfDeck) window.__pfDeck.pause(); document.documentElement.classList.add('pf-print'); }",
  });
  return { filename: `${out.name}.pdf`, buffer, mime: "application/pdf" };
}

// 合并重叠的时段（背景音乐避让用：旁白和有声视频同时响只压一次）
function mergeRanges(ranges) {
  const out = [];
  for (const r of [...ranges].sort((a, b) => a.startMs - b.startMs)) {
    const last = out[out.length - 1];
    if (last && r.startMs <= last.endMs) last.endMs = Math.max(last.endMs, r.endMs);
    else out.push({ ...r });
  }
  return out;
}

// MP4：按 playback.json 放一遍——每页多长跟放映时一样（定时、旁白放完、视频放完；没开自动翻页的页按
// defaultDurationMs），进场动画、页里的视频逐帧录，旁白、背景音乐（含避让）、有声视频合成音轨。
async function buildMp4(ws, pid, deckId, ctx = {}) {
  const dj = deckStore.readDeckJson(ws, pid, deckId);
  const out = deckStandaloneHtml(ws, pid, deckId, { embed: ctx.embed });
  if (!out) return null;
  const version = deckStore.openDeckVersion(ws, pid, deckId, dj.head);
  const slides = deckStore.readVersionSlides(version);
  const parsed = parsePlayback(version.readText("playback.json"));
  if (!parsed.ok) throw Object.assign(new Error(parsed.message), { code: parsed.code });
  const playback = parsed.value;
  const auto = playback.autoAdvance;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "protoflow-mp4-"));
  try {
    // 音频从版本里取出来落成文件（ffmpeg 读、量时长）
    const files = new Map();
    const audioFile = (src) => {
      if (!files.has(src)) {
        const f = path.join(tmp, `${files.size}-${path.basename(src)}`);
        fs.writeFileSync(f, version.read(src));
        files.set(src, { file: f, durationMs: probeMedia(f).durationMs });
      }
      return files.get(src);
    };
    const scenes = slides.map((s, i) => {
      const cfg = playback.slides[s.id] || {};
      const rule = cfg.advance || { on: "timer", durationMs: auto.defaultDurationMs };
      const fallback = rule.fallbackMs || auto.defaultDurationMs;
      const narration = cfg.audio && audioFile(cfg.audio.src);
      // video-ended 的页放映时会播第一个视频（不管有没有 autoplay），这里也一样
      const playFirst = rule.on === "video-ended" ? `var v=document.querySelectorAll(".pf-deck .pf-slide")[${i}].querySelector("video");if(v&&v.paused)v.play().catch(function(){});` : "";
      return {
        enter: `() => { window.__pfDeck.show(${i}); ${playFirst} }`,
        durationMs: rule.on === "timer" ? rule.durationMs
          : rule.on === "audio-ended" ? (narration && narration.durationMs) || fallback
          : rule.on === "video-ended" ? ({ videos }) => (videos[0] && videos[0].durationMs) || fallback
          : auto.defaultDurationMs,
        narration: narration && { ...narration, volume: cfg.audio.volume },
      };
    });
    const buffer = await htmlToMp4(out.html, {
      width: 1920, height: 1080,
      ready: READY,
      onProgress: ctx.progress,
      signal: ctx.signal,
      // 阅读页默认静音（浏览器不让没人点过的页面出声）；录制按"页面上听得到的声音"收视频音轨，所以先取消静音
      prepare: "() => { if (window.__pfDeck) { window.__pfDeck.pause(); window.__pfDeck.setMuted(false); } document.documentElement.classList.add('pf-capture'); }",
      scenes,
      audio: (timeline) => {
        const tracks = [];
        const sounding = [...timeline.soundingRanges];
        scenes.forEach((s, i) => {
          if (!s.narration) return;
          const { startMs, durationMs } = timeline.scenes[i];
          tracks.push({ file: s.narration.file, startMs, durationMs, volume: s.narration.volume });
          sounding.push({ startMs, endMs: startMs + Math.min(durationMs, s.narration.durationMs || durationMs) });
        });
        const bg = playback.backgroundAudio;
        if (bg) {
          tracks.push({ file: audioFile(bg.src).file, startMs: 0, volume: bg.volume, loop: bg.loop,
            volumeRanges: bg.duckVolume == null ? [] : mergeRanges(sounding).map((r) => ({ ...r, volume: bg.duckVolume })) });
        }
        return tracks;
      },
    });
    return { filename: `${out.name}.mp4`, buffer, mime: "video/mp4" };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function buildSourceZip(ws, pid, deckId) {
  const dj = deckStore.readDeckJson(ws, pid, deckId);
  if (!dj || !dj.head) return null;
  const version = deckStore.openDeckVersion(ws, pid, deckId, dj.head);
  const name = safeFileName(dj.title || deckId, deckId);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "protoflow-export-"));
  try {
    for (const rel of version.list()) {
      const dest = path.join(tmp, name, ...rel.split("/"));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, version.read(rel));
    }
    return { filename: `${name}.zip`, buffer: zipDirectory(tmp), mime: "application/zip" };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// 草稿的单 HTML：不在菜单里，给排版检查（流程 skill protoflow-slides 的检查脚本）用，不用为了检查先定版。
function buildDraftHtml(ws, pid, deckId, ctx = {}) {
  const out = deckStandaloneHtml(ws, pid, deckId, { embed: ctx.embed, draft: true });
  return out && { filename: `${out.name}-草稿.html`, buffer: Buffer.from(out.html, "utf8"), mime: "text/html" };
}

const BUILD = { pdf: { build: buildPdf, mime: "application/pdf" }, mp4: { build: buildMp4, mime: "video/mp4" }, html: { build: buildHtml, mime: "text/html" }, zip: { build: buildSourceZip, mime: "application/zip" } };
export const DECK_EXPORTS = [
  ...DECK_EXPORT_MENU.map((f) => ({ ...f, ...BUILD[f.id] })),
  { id: "draft-html", label: "草稿 HTML", hidden: true, build: buildDraftHtml, mime: "text/html" },
];
