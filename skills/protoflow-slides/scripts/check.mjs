#!/usr/bin/env node
// check.mjs — 幻灯片检查：用草稿（不用先定版）出一份单 HTML，在无头浏览器里按放映的样子逐页渲染，只查"坏没坏"，
// 不管好不好看（那要看截图、对照 references/principles.md 自己判断）。
//   error（必须改）：
//     OVERFLOW        内容超出 1920×1080 画布（会被裁掉）
//     TEXT_CLIPPED    文字在自己的框里放不下（框设了 overflow 隐藏）
//     METRIC_WRAP     指标或大数字发生换行（单位应移到说明里，或缩短数字）
//     ASSET_FAILED    本地资源没加载出来（图片、字体、视频……）
//     SCRIPT_ERROR    脚本报错（没接住的异常、console.error；可选库写错图标名、图表类型也走这里）
//     EXTERNAL        依赖外部地址（导出的单 HTML 离线打不开）
//     NO_SECTION      这一页没有 section
//   warn（带位置，判断是不是有意的）：
//     OVERLAP         两块内容互相压住（文字压在装饰图上可能正是想要的）
//     SMALL_TEXT      字号小于 24px（1920 宽的画布上，投出去看不清）
//     STYLE_LEAK      页里 <style> 的规则改到了别的页、阅读页界面或整个页面（该写在本页范围内，或者放进 design/）
//     BGM_SHORT       自动放映时，背景音乐在放到最后一页之前就放完了（整份稿子）
//   info（只是告诉你）：
//     UNUSED_ASSET    assets/ 里没被页面、design/、playback.json 引用的文件（每次定版都会冻结进去）
// 只看渲染结果：尺寸按元素的实际位置算，不猜 CSS。
//
// 时间线（timeline）：按 playback.json 和壳子的翻页规则（计时 / 等这页第一个视频放完 / 等旁白放完 / 手动）算出自动放映时
// 每页从第几秒开始、停多久、全片多长、背景音乐够不够。视频、音频的时长在浏览器里读；不含加载延迟（实测每页零点一秒左右）。
//
// 用法：node check.mjs --projectId <项目> --deckId <幻灯片> [--dir <工作目录>] [--shots <截图目录>]
// 输出 JSON：{ ok, deckId, slideCount, errors, warnings, deckIssues:[…], slides:[{ index, id, issues:[{ code, level, message }] }],
//            timeline, unusedAssets }；
// 有 error 时退出码 1。--shots 给了就把每页截成 <页 id>.png（1920×1080；页 id 不以数字开头就在前面补序号）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cli, SkillError } from "./lib/cli.mjs";
import { resolveBrowserExecutable } from "./lib/headlessBrowser.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(\w+)$/.exec(argv[i]);
    if (m) out[m[1]] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  }
  return out;
}

// 在页面里跑：检查当前显示的这一页。k 是画布的缩放比例，所有尺寸换算回 1920×1080 的画布像素。
function inspectSlide({ index }) {
  const slides = document.querySelectorAll(".pf-deck .pf-slide");
  const slide = slides[index];
  const sec = slide && slide.querySelector(":scope > section");
  const issues = [];
  const add = (code, level, message) => issues.push({ code, level, message });
  if (!sec) return { id: slide && slide.dataset.id, issues: [{ code: "NO_SECTION", level: "error", message: "这一页没有 section" }] };

  const R = sec.getBoundingClientRect();
  const k = R.width / 1920;
  const describe = (el) => {
    const text = (el.innerText || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 24);
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "";
    return `<${el.tagName.toLowerCase()}${cls}>${text ? `「${text}」` : ""}`;
  };
  const visible = (el) => {
    if (el.closest("[aria-hidden='true'],[data-check-ignore]")) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const all = [...sec.querySelectorAll("*")].filter(visible);
  const CONTENT = "h1,h2,h3,h4,h5,h6,p,li,blockquote,cite,img,svg,video,table,figure,pre,.mermaid,.pf-embed-slot,strong,span";

  // 超出画布：有内容的元素（文字、图、表）伸到了 section 外面
  const reported = new Set();
  for (const el of all) {
    if (!el.matches(CONTENT)) continue;
    const r = el.getBoundingClientRect();
    const over = Math.max(R.left - r.left, r.right - R.right, R.top - r.top, r.bottom - R.bottom) / k;
    if (over > 2 && ![...reported].some((p) => p.contains(el))) {
      reported.add(el);
      add("OVERFLOW", "error", `${describe(el)} 超出画布 ${Math.round(over)}px`);
    }
  }
  // 文字在自己的框里放不下
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (!/(hidden|clip)/.test(cs.overflow + cs.overflowY + cs.overflowX) || el === sec) continue;
    if (!(el.innerText || "").trim()) continue;
    if (el.scrollHeight - el.clientHeight > 2 || el.scrollWidth - el.clientWidth > 2) add("TEXT_CLIPPED", "error", `${describe(el)} 里的内容放不下，被裁掉了`);
  }
  // 指标 / 大数字必须一行展示。它们即使没超出画布，内部换行也会破坏视觉层级；Range 的总高度明显超过
  // 一行 line-height 就说明已经折成两行。单位放到下面的说明里，不跟数字挤在一起。
  for (const el of sec.querySelectorAll('[data-layout="metrics"] .metric strong, [data-layout="big-number"] .number')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    const height = el.getBoundingClientRect().height / k;
    if (height > line * 1.35) add("METRIC_WRAP", "error", `${describe(el)} 换成了多行；缩短数字，单位移到下面的说明里`);
  }
  // 互相压住：叶子级内容块两两比较，不是包含关系、重叠面积超过较小者的 8%。铺满大半画布（≥ 80%）的图是背景，不算。
  const isBackground = (el) => {
    if (!el.matches("img,svg,video,picture")) return false;
    const r = el.getBoundingClientRect();
    return (r.width * r.height) / (R.width * R.height) >= 0.8;
  };
  const BLOCK = "h1,h2,h3,h4,h5,h6,p,li,blockquote,cite,img,table,pre,video,.mermaid,.pf-embed-slot";
  const blocks = all.filter((el) => !isBackground(el) && el.matches(BLOCK) && !all.some((o) => o !== el && el.contains(o) && o.matches(BLOCK)));
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const a = blocks[i], b = blocks[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w <= 0 || h <= 0) continue;
    const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
    if (smaller > 0 && (w * h) / smaller > 0.08) add("OVERLAP", "warn", `${describe(a)} 和 ${describe(b)} 互相压住了（有意叠放的可以不管）`);
  }
  // 字太小（computed font-size 是画布上的 CSS 像素，缩放不影响）
  const small = new Set();
  for (const el of all) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest(".mermaid,svg")) continue; // 图里的字下面按显示高度算
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 24) small.add(`${describe(el)} ${Math.round(size)}px`);
  }
  for (const t of sec.querySelectorAll("svg text, svg foreignObject span, svg foreignObject p, svg foreignObject div")) {
    if (!(t.textContent || "").trim()) continue;
    const h = t.getBoundingClientRect().height / k;
    if (h > 0 && h < 20) small.add(`图里的「${t.textContent.trim().slice(0, 12)}」约 ${Math.round(h)}px 高`);
  }
  if (small.size) add("SMALL_TEXT", "warn", `字号小于 24px：${[...small].slice(0, 5).join("；")}${small.size > 5 ? ` 等 ${small.size} 处` : ""}`);
  // 外部地址（属性里写的；样式里的外部地址在加载时按网络请求查）
  const ext = [...sec.querySelectorAll("[src],[href],[poster]")].map((el) => el.getAttribute("src") || el.getAttribute("href") || el.getAttribute("poster")).filter((u) => /^(https?:)?\/\//i.test(u));
  if (ext.length) add("EXTERNAL", "error", `引用了外部地址：${ext.slice(0, 3).join("、")}（下载到 assets/ 里用）`);

  // 页里的样式改到了别处：逐条看本页 <style> 的规则（进 @media 这类分组，伪元素去掉再匹配），命中别的页、阅读页界面、
  // 或者 html / body 本身就报。缩略图栏里是各页的克隆，不算。解析不了的规则跳过。
  const leaks = [];
  const pageNo = (el) => [...slides].indexOf(el.closest(".pf-slide")) + 1;
  const visit = (rules) => {
    for (const rule of rules || []) {
      if (rule.cssRules && !rule.selectorText) { visit(rule.cssRules); continue; }
      if (!rule.selectorText) continue;
      for (const raw of rule.selectorText.split(",")) {
        const sel = raw.replace(/::?(before|after|first-line|first-letter|placeholder|marker|selection|backdrop)\b/g, "").trim() || "*";
        let hits;
        try { hits = [...document.querySelectorAll(sel)]; } catch { continue; }
        const where = new Set();
        for (const el of hits) {
          if (el.closest(".pf-thumbs")) continue;
          if (el === document.documentElement || el === document.body) where.add("整个页面");
          else if (!el.closest(".pf-slide")) where.add("阅读页界面");
          else if (el.closest(".pf-slide") !== slide) where.add(`第 ${pageNo(el)} 页`);
        }
        if (where.size) leaks.push(`\`${raw.trim()}\` 改到了${[...where].slice(0, 4).join("、")}`);
      }
    }
  };
  for (const st of sec.querySelectorAll("style")) { try { visit(st.sheet && st.sheet.cssRules); } catch { /* 跨域等读不了的跳过 */ } }
  if (leaks.length) add("STYLE_LEAK", "warn", `页里的样式影响到了别处：${leaks.slice(0, 4).join("；")}${leaks.length > 4 ? ` 等 ${leaks.length} 条` : ""}。写在本页范围内（section 加个类名，规则以它开头），几页共用的放进 design/`);

  return { id: slide.dataset.id, issues };
}

// 在页面里跑：按 playback 配置和壳子的翻页规则排出自动放映的时间线。媒体时长用新建的元素读元数据（不影响页面上的）。
async function playbackTimeline() {
  const pb = (window.__PF_DECK__ && window.__PF_DECK__.playback) || {};
  const auto = pb.autoAdvance || {};
  const slides = [...document.querySelectorAll(".pf-deck .pf-slide")];
  const durationOf = (src, tag) => new Promise((resolve) => {
    if (!src) return resolve(null);
    const el = document.createElement(tag);
    el.preload = "metadata"; el.muted = true;
    const done = (v) => { clearTimeout(t); el.removeAttribute("src"); resolve(v); };
    const t = setTimeout(() => done(null), 8000);
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    el.src = src;
  });
  const bg = pb.backgroundAudio || null;
  const bgmSec = bg ? await durationOf(bg.src, "audio") : null;
  const rows = [];
  let t = 0, stopsAt = null;
  for (let i = 0; i < slides.length; i++) {
    const id = slides[i].getAttribute("data-id");
    const cfg = (pb.slides && pb.slides[id]) || {};
    const rule = cfg.advance || (auto.enabled ? { on: "timer", durationMs: auto.defaultDurationMs } : { on: "manual" });
    const fallback = (rule.fallbackMs || auto.defaultDurationMs || 8000) / 1000;
    let sec = null, by = rule.on;
    if (!auto.enabled || rule.on === "manual") by = "manual";
    else if (rule.on === "timer") sec = (rule.durationMs || auto.defaultDurationMs || 8000) / 1000;
    else if (rule.on === "video-ended") {
      const v = slides[i].querySelector("video");
      sec = v ? await durationOf(v.currentSrc || v.getAttribute("src"), "video") : null;
      if (sec == null) { sec = fallback; by = "video-ended（读不到视频时长，按 fallbackMs）"; }
    } else if (rule.on === "audio-ended") {
      sec = cfg.audio ? await durationOf(cfg.audio.src, "audio") : null;
      if (sec == null) { sec = fallback; by = "audio-ended（读不到旁白时长，按 fallbackMs）"; }
    }
    rows.push({ id, startSec: +t.toFixed(1), sec: sec == null ? null : +sec.toFixed(1), by });
    if (sec == null) { stopsAt = id; break; }
    t += sec;
  }
  const last = rows[rows.length - 1];
  const out = { auto: !!auto.enabled, loop: !!auto.loop, totalSec: +t.toFixed(1), stopsAt, slides: rows };
  if (bg) {
    out.backgroundAudio = { sec: bgmSec == null ? null : +bgmSec.toFixed(1), loop: !!bg.loop };
    if (bgmSec != null && !bg.loop && out.auto) {
      const endsIn = rows.find((r) => r.startSec + (r.sec == null ? Infinity : r.sec) > bgmSec);
      out.backgroundAudio.endsDuring = endsIn ? endsIn.id : null;
      if (stopsAt) out.backgroundAudio.leftOnLastSec = +(bgmSec - last.startSec).toFixed(1);
    }
  }
  return out;
}

// assets/ 里没被引用的文件：在页面、design/ 的文本、playback.json 里找 "assets/<文件>"；截图的出处文件（.source.json）不算。
function unusedAssets(deckDir) {
  const assetsDir = path.join(deckDir, "assets");
  if (!fs.existsSync(assetsDir)) return [];
  const files = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(assetsDir, rel), { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r); else if (!r.endsWith(".source.json")) files.push(r);
    }
  };
  walk("");
  const texts = [];
  const read = (dir, re) => { if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (re.test(f)) texts.push(fs.readFileSync(path.join(dir, f), "utf8")); };
  read(path.join(deckDir, "slides"), /\.html$/);
  read(path.join(deckDir, "design"), /\.(css|js)$/);
  if (fs.existsSync(path.join(deckDir, "playback.json"))) texts.push(fs.readFileSync(path.join(deckDir, "playback.json"), "utf8"));
  const all = texts.join("\n");
  const referenced = (f) => all.includes(`assets/${f}`) || all.includes(`assets/${encodeURI(f)}`);
  return files.filter((f) => !referenced(f)).map((f) => ({ file: f, bytes: fs.statSync(path.join(assetsDir, f)).size }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId || !args.deckId) throw new SkillError("USAGE", "用法：node check.mjs --projectId <项目> --deckId <幻灯片> [--dir <工作目录>] [--shots <截图目录>]");
  const common = { projectId: args.projectId, ...(args.dir ? { dir: args.dir } : {}) };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-deck-check-"));
  try {
    const exported = cli("export_deck", { ...common, deckId: args.deckId, format: "draft-html", outDir: tmp });
    const pageUrl = pathToFileURL(exported.path).href;
    const { launch } = await import("puppeteer-core");
    const executable = await resolveBrowserExecutable();
    const browser = await launch({ headless: true, executablePath: executable.path, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
      const page = await browser.newPage();
      // 运行中收集：脚本错误、没加载出来的本地资源、外部请求。翻页前清空，翻到一页后收到的算这一页的。
      let bucket = [];
      const note = (code, message, url) => bucket.push({ code, message, url });
      page.on("pageerror", (e) => note("SCRIPT_ERROR", `脚本报错：${String(e.message || e).split("\n")[0]}`));
      page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) note("SCRIPT_ERROR", `console.error：${m.text().slice(0, 160)}`); });
      page.on("request", (r) => { if (/^https?:/i.test(r.url())) note("EXTERNAL", `请求了外部地址：${r.url().slice(0, 120)}（下载到 assets/ 里用）`, r.url()); });
      page.on("requestfailed", (r) => { if (r.url().startsWith("file:") && r.url() !== pageUrl) note("ASSET_FAILED", `没加载出来：${decodeURIComponent(r.url().split("/").pop())}`, r.url()); });
      const drain = () => { const out = bucket; bucket = []; return [...new Map(out.map((x) => [x.code + x.message, x])).values()].map((x) => ({ ...x, level: "error" })); };
      // 加载时就请求的资源（所有页在同一个网页里，图片一开始都会加载）：按引用这个地址的元素归到那一页；
      // 样式里引用的找不到元素，留在整份稿子上。
      const slideOfUrl = (url) => page.evaluate((u) => {
        const slides = [...document.querySelectorAll(".pf-deck .pf-slide")];
        const el = [...document.querySelectorAll(".pf-deck .pf-slide [src], .pf-deck .pf-slide [poster], .pf-deck .pf-slide [href]")]
          .find((e) => e.src === u || e.poster === u || e.href === u || e.currentSrc === u);
        return el ? slides.indexOf(el.closest(".pf-slide")) : -1;
      }, url);

      // 视口取成画布按 1:1 显示的大小（阅读页留 0.94 的边，头部 40、底栏 44）
      await page.setViewport({ width: 2050, height: 1240, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]); // 不要进场动效，量到的是最终位置
      await page.goto(pageUrl, { waitUntil: "load" });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await new Promise((r) => setTimeout(r, 300)); // 字体到了以后页面脚本可能再排一次版
      await page.evaluate(() => window.__pfDeck.pause());
      const hasMermaid = await page.evaluate(() => !!document.querySelector(".mermaid"));
      if (hasMermaid) await page.waitForFunction(() => [...document.querySelectorAll(".mermaid")].every((m) => m.querySelector("svg") || m.getAttribute("data-processed")), { timeout: 15000 }).catch(() => {});
      const loadIssues = drain(); // 加载时出的问题：能认出是哪页的资源就归那页，其余（脚本初始化、design/ 里的资源）算整份稿子的
      const deckIssues = [], bySlide = {};
      for (const x of loadIssues) {
        const at = x.url ? await slideOfUrl(x.url) : -1;
        if (at >= 0) (bySlide[at] = bySlide[at] || []).push(x); else deckIssues.push(x);
      }
      const count = await page.evaluate(() => window.__pfDeck.count);
      if (args.shots) fs.mkdirSync(args.shots, { recursive: true });
      const slides = [];
      for (let i = 0; i < count; i++) {
        await page.evaluate((n) => window.__pfDeck.show(n), i);
        await new Promise((r) => setTimeout(r, 50));
        const r = await page.evaluate(inspectSlide, { index: i });
        r.issues.push(...(bySlide[i] || []), ...drain());
        slides.push({ index: i + 1, ...r });
        if (args.shots) {
          const el = await page.$(`.pf-deck .pf-slide:nth-child(${i + 1}) > section`);
          // 页 id 本来就带序号（01-封面）就直接用，不然前面补上序号
          const name = /^\d/.test(r.id) ? r.id : `${String(i + 1).padStart(2, "0")}-${r.id}`;
          if (el) await el.screenshot({ path: path.join(args.shots, `${name}.png`) });
        }
      }
      // 时间线（自动放映时每页从第几秒开始、背景音乐够不够）
      const timeline = await page.evaluate(playbackTimeline);
      const bgm = timeline.backgroundAudio;
      if (bgm && bgm.endsDuring && timeline.slides.length) {
        const lastRow = timeline.slides[timeline.slides.length - 1];
        if (bgm.endsDuring !== lastRow.id) deckIssues.push({ code: "BGM_SHORT", level: "warn",
          message: `背景音乐 ${bgm.sec} 秒，放到「${bgm.endsDuring}」时就没了，后面到「${lastRow.id}」还有 ${(lastRow.startSec - bgm.sec).toFixed(0)} 秒没有音乐（全片约 ${timeline.totalSec} 秒）：换长一点的、续接，或者 loop:true` });
      }
      // 没用到的素材
      const project = cli("get_project", common);
      const unused = unusedAssets(path.join(project.projectDir, "decks", args.deckId));
      if (unused.length) deckIssues.push({ code: "UNUSED_ASSET", level: "info",
        message: `assets/ 里有 ${unused.length} 个文件没被引用（共 ${(unused.reduce((n, x) => n + x.bytes, 0) / 1048576).toFixed(1)} MB），每次定版都会冻结进去：${unused.slice(0, 6).map((x) => x.file).join("、")}${unused.length > 6 ? " 等" : ""}。确定不用可以删` });

      const all = [...deckIssues, ...slides.flatMap((s) => s.issues)];
      const errors = all.filter((x) => x.level === "error").length;
      const warnings = all.filter((x) => x.level === "warn").length;
      const strip = (list) => list.map(({ url, ...x }) => x);
      for (const sl of slides) sl.issues = strip(sl.issues);
      const out = { ok: errors === 0, deckId: args.deckId, slideCount: count, errors, warnings, deckIssues: strip(deckIssues), slides, timeline, unusedAssets: unused, ...(args.shots ? { shots: path.resolve(args.shots) } : {}) };
      console.log(JSON.stringify(out, null, 2));
      process.exitCode = errors ? 1 : 0;
    } finally { await browser.close(); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: { code: e.code || "CHECK_FAILED", message: e.message } }, null, 2));
  process.exitCode = 1;
});
