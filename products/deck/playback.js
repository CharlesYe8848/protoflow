// products/deck/playback.js — 幻灯片放映配置：解析、校验，以及按预览/导出场景改写音频地址。
// playback.json 是幻灯片正文的一部分，跟 slides/、assets/、design/ 一起进入版本；旧版本没有它时按手动翻页处理。

export const DEFAULT_PLAYBACK = Object.freeze({
  schemaVersion: 1,
  autoAdvance: Object.freeze({ enabled: false, defaultDurationMs: 8000, loop: false }),
  slides: Object.freeze({}),
});

export const DEFAULT_PLAYBACK_JSON = JSON.stringify(DEFAULT_PLAYBACK, null, 2) + "\n";

const AUDIO_EXTENSIONS = new Set(["mp3", "wav"]);
const MIN_DURATION_MS = 500;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

const plainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const bad = (message, code = "BAD_PLAYBACK_CONFIG") => ({ ok: false, code, message });

function bool(v, fallback, at) {
  if (v == null) return { ok: true, value: fallback };
  return typeof v === "boolean" ? { ok: true, value: v } : bad(`${at} 应为 true 或 false`);
}

function number(v, fallback, at, { min = 0, max = Infinity } = {}) {
  if (v == null) return { ok: true, value: fallback };
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? { ok: true, value: v }
    : bad(`${at} 应为 ${min}–${max} 之间的数字`);
}

function audio(raw, at, { background = false } = {}) {
  if (!plainObject(raw)) return bad(`${at} 应为对象`);
  if (typeof raw.src !== "string" || !raw.src.trim()) return bad(`${at}.src 必填`);
  const src = raw.src.trim();
  if (!/^assets\/[^?#]+$/i.test(src) || src.split("/").some((p) => p === ".." || !p)) {
    return bad(`${at}.src 只能引用 assets/ 下的音频文件`);
  }
  const ext = (src.split(".").pop() || "").toLowerCase();
  if (!AUDIO_EXTENSIONS.has(ext)) return bad(`${at}.src 只支持 MP3 或 WAV：${src}`, "UNSUPPORTED_AUDIO_FORMAT");
  const volume = number(raw.volume, background ? 0.3 : 1, `${at}.volume`, { min: 0, max: 1 });
  if (!volume.ok) return volume;
  const out = { src, volume: volume.value };
  if (background) {
    const loop = bool(raw.loop, true, `${at}.loop`);
    if (!loop.ok) return loop;
    out.loop = loop.value;
    // 避让：当前页的旁白或有声视频在响时背景音乐压到这个音量。不写就不避让——要不要、压多低由写稿的人定。
    if (raw.duckVolume != null) {
      const duck = number(raw.duckVolume, null, `${at}.duckVolume`, { min: 0, max: 1 });
      if (!duck.ok) return duck;
      out.duckVolume = duck.value;
    }
  }
  return { ok: true, value: out };
}

function advance(raw, at, defaultDurationMs) {
  if (!plainObject(raw)) return bad(`${at} 应为对象`);
  const on = raw.on == null ? "timer" : raw.on;
  if (!["manual", "timer", "audio-ended", "video-ended"].includes(on)) return bad(`${at}.on 只能是 manual、timer、audio-ended 或 video-ended`);
  if (on === "manual") return { ok: true, value: { on } };
  if (on === "timer") {
    const duration = number(raw.durationMs, defaultDurationMs, `${at}.durationMs`, { min: MIN_DURATION_MS, max: MAX_DURATION_MS });
    return duration.ok ? { ok: true, value: { on, durationMs: duration.value } } : duration;
  }
  const fallback = number(raw.fallbackMs, defaultDurationMs, `${at}.fallbackMs`, { min: MIN_DURATION_MS, max: MAX_DURATION_MS });
  return fallback.ok ? { ok: true, value: { on, fallbackMs: fallback.value } } : fallback;
}

// opts：slideIds / assetFiles / videoSlideIds（页里有 <video> 的页）传了就同时校验引用；读取已定版本用于渲染时可以不传。
export function parsePlayback(text, { slideIds, assetFiles, videoSlideIds } = {}) {
  if (text == null || !String(text).trim()) return { ok: true, value: structuredClone(DEFAULT_PLAYBACK) };
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return bad(`playback.json 不是合法 JSON：${e.message}`); }
  if (!plainObject(raw)) return bad("playback.json 顶层应为对象");
  if (raw.schemaVersion !== 1) return bad("playback.json.schemaVersion 目前只能是 1");

  const aa = raw.autoAdvance == null ? {} : raw.autoAdvance;
  if (!plainObject(aa)) return bad("autoAdvance 应为对象");
  const enabled = bool(aa.enabled, false, "autoAdvance.enabled");
  if (!enabled.ok) return enabled;
  const duration = number(aa.defaultDurationMs, 8000, "autoAdvance.defaultDurationMs", { min: MIN_DURATION_MS, max: MAX_DURATION_MS });
  if (!duration.ok) return duration;
  const loop = bool(aa.loop, false, "autoAdvance.loop");
  if (!loop.ok) return loop;
  // 页面 id 来自文件名；用无原型对象，避免 `__proto__` 等合法 id 改写配置对象的原型。
  const value = { schemaVersion: 1, autoAdvance: { enabled: enabled.value, defaultDurationMs: duration.value, loop: loop.value }, slides: Object.create(null) };

  if (raw.backgroundAudio != null) {
    const r = audio(raw.backgroundAudio, "backgroundAudio", { background: true });
    if (!r.ok) return r;
    value.backgroundAudio = r.value;
  }

  const slides = raw.slides == null ? {} : raw.slides;
  if (!plainObject(slides)) return bad("slides 应为以页面 id 为键的对象");
  const knownSlides = slideIds ? new Set(slideIds) : null;
  for (const [id, cfg] of Object.entries(slides)) {
    if (knownSlides && !knownSlides.has(id)) return bad(`playback.json 引用了不存在的页面：${id}`, "UNKNOWN_PLAYBACK_SLIDE");
    if (!plainObject(cfg)) return bad(`slides.${id} 应为对象`);
    const out = {};
    if (cfg.audio != null) {
      const r = audio(cfg.audio, `slides.${id}.audio`);
      if (!r.ok) return r;
      out.audio = r.value;
    }
    if (cfg.advance != null) {
      const r = advance(cfg.advance, `slides.${id}.advance`, duration.value);
      if (!r.ok) return r;
      if (r.value.on === "audio-ended" && !out.audio) return bad(`slides.${id}.advance.on 是 audio-ended 时必须配置这一页的 audio`);
      if (r.value.on === "video-ended" && videoSlideIds && !videoSlideIds.includes(id)) return bad(`slides.${id}.advance.on 是 video-ended 时这一页里必须有 <video>`);
      out.advance = r.value;
    }
    value.slides[id] = out;
  }

  if (assetFiles) {
    const files = new Set(assetFiles);
    const missing = playbackAssetRefs(value).filter((src) => !files.has(src.slice("assets/".length)));
    if (missing.length) return bad(`playback.json 引用了 assets/ 下不存在的音频：${missing.join("、")}`, "PLAYBACK_AUDIO_MISSING");
  }
  return { ok: true, value };
}

export function playbackAssetRefs(playback) {
  const refs = [];
  if (playback && playback.backgroundAudio) refs.push(playback.backgroundAudio.src);
  for (const cfg of Object.values((playback && playback.slides) || {})) if (cfg.audio) refs.push(cfg.audio.src);
  return [...new Set(refs)];
}

export function rewritePlaybackAssets(playback, urlFor) {
  const out = structuredClone(playback || DEFAULT_PLAYBACK);
  if (out.backgroundAudio) out.backgroundAudio.src = urlFor(out.backgroundAudio.src);
  for (const cfg of Object.values(out.slides || {})) if (cfg.audio) cfg.audio.src = urlFor(cfg.audio.src);
  return out;
}

export function playbackHasAudio(playback) {
  return !!(playback && (playback.backgroundAudio || Object.values(playback.slides || {}).some((s) => s.audio)));
}

export function playbackEnabled(playback) {
  return !!(playback && (playback.autoAdvance && playback.autoAdvance.enabled || playbackHasAudio(playback)));
}
