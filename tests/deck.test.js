// 幻灯片（products/deck/）：每页一个 HTML、设计系统装进 design/ 跟着版本冻结；阅读页 1920×1080 画布、嵌入按固定
// 版本展开；导出单 HTML（全内嵌）和源文件包；草稿也能出单 HTML 给排版检查用；能当外部插件经配置加载。
// 以及流程 skill protoflow-slides 的排版检查脚本（真的起无头浏览器）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import JSZip from "jszip";
import { launch } from "puppeteer-core";
import { checkSlide, slideLayout, slideTitle, assetRefs, embedRefs, rewriteAssets, rewriteCssUrls } from "../products/deck/html.js";
import { parsePlayback, rewritePlaybackAssets } from "../products/deck/playback.js";
import { PRODUCTS, BUILTIN_CANDIDATES, assembleRegistry } from "../products/index.js";
import { loadPluginCandidates } from "../core/pluginLoader.js";
import { projectGraph } from "../core/projectGraph.js";
import { createTestHost } from "protoflow/sdk/testing";
import { resolveBrowserExecutable } from "../core/pdf.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SLIDES_SKILL = path.join(ROOT, "skills", "protoflow-slides");
const EXAMPLES = path.join(SLIDES_SKILL, "examples");

test("页的约定：一个 section；版式、标题、素材、嵌入标签都认得；素材和 CSS 里的相对地址能改写", () => {
  assert.deepEqual(checkSlide('<!-- 注释 -->\n<section data-layout="cover"><h1>A</h1></section>\n'), []);
  assert.equal(checkSlide("<div>x</div>").length, 1);
  assert.equal(slideLayout('<section class="x" data-layout="bullets">'), null, "不完整的不算");
  assert.equal(slideLayout('<section class="x" data-layout="bullets"><p>1</p></section>'), "bullets");
  assert.equal(slideTitle('<section><h2>背<b>景</b></h2></section>', 1), "背景");
  assert.equal(slideTitle('<section data-title="自定"><h2>x</h2></section>', 0), "自定");
  const html = '<section><img src="assets/a%20b.png"><div style="background:url(\'assets/bg.jpg\')"></div><pf-embed ref="sheet:s#汇总"></pf-embed></section>';
  assert.deepEqual(assetRefs(html), ["a b.png", "bg.jpg"]);
  assert.deepEqual(embedRefs(html), ["sheet:s#汇总"]);
  assert.ok(rewriteAssets(html, (r) => `v/1/${r}`).includes('src="v/1/assets/a%20b.png"'));
  assert.equal(rewriteCssUrls("a{src:url(assets/f.woff2)} b{background:url(data:x)}", (r) => `D(${r})`), "a{src:url(D(assets/f.woff2))} b{background:url(data:x)}");
});

test("放映配置：补默认值、校验页面和音频，并能按输出场景改写音频地址", () => {
  const text = JSON.stringify({
    schemaVersion: 1,
    autoAdvance: { enabled: true, defaultDurationMs: 6000, loop: true },
    backgroundAudio: { src: "assets/bgm.mp3" },
    slides: { "02-数据": { audio: { src: "assets/02.wav", volume: 0.8 }, advance: { on: "audio-ended", fallbackMs: 12000 } } },
  });
  const parsed = parsePlayback(text, { slideIds: ["01-封面", "02-数据"], assetFiles: ["bgm.mp3", "02.wav"] });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.backgroundAudio, { src: "assets/bgm.mp3", volume: 0.3, loop: true });
  assert.equal(parsed.value.slides["02-数据"].advance.fallbackMs, 12000);
  assert.equal(rewritePlaybackAssets(parsed.value, (p) => `v2/${p}`).slides["02-数据"].audio.src, "v2/assets/02.wav");
  assert.equal(parsePlayback(text, { slideIds: ["01-封面"], assetFiles: ["bgm.mp3", "02.wav"] }).code, "UNKNOWN_PLAYBACK_SLIDE");
  assert.equal(parsePlayback(text, { slideIds: ["01-封面", "02-数据"], assetFiles: ["bgm.mp3"] }).code, "PLAYBACK_AUDIO_MISSING");
  assert.equal(parsePlayback('{"schemaVersion":1,"backgroundAudio":{"src":"assets/a.ogg"}}').code, "UNSUPPORTED_AUDIO_FORMAT");
  // 背景音乐避让是可选的：写了才有，范围 0–1
  assert.equal(parsePlayback('{"schemaVersion":1,"backgroundAudio":{"src":"assets/b.mp3","duckVolume":0.06}}').value.backgroundAudio.duckVolume, 0.06);
  assert.equal(parsePlayback('{"schemaVersion":1,"backgroundAudio":{"src":"assets/b.mp3","duckVolume":1.5}}').code, "BAD_PLAYBACK_CONFIG");
  const proto = parsePlayback('{"schemaVersion":1,"slides":{"__proto__":{"audio":{"src":"assets/p.mp3"}}}}', { slideIds: ["__proto__"], assetFiles: ["p.mp3"] });
  assert.equal(proto.ok, true);
  assert.equal(Object.hasOwn(proto.value.slides, "__proto__"), true);
  assert.equal(proto.value.slides.__proto__.audio.src, "assets/p.mp3");
  const video = JSON.stringify({ schemaVersion: 1, slides: { "02-数据": { advance: { on: "video-ended", fallbackMs: 20000 } } } });
  assert.equal(parsePlayback(video, { slideIds: ["01-封面", "02-数据"], videoSlideIds: ["02-数据"] }).value.slides["02-数据"].advance.fallbackMs, 20000);
  assert.match(parsePlayback(video, { slideIds: ["01-封面", "02-数据"], videoSlideIds: [] }).message, /必须有 <video>/);
});

// 建一份幻灯片，design/ 换成样例 mono（跟 skill 里说的用法一样：整套拷进去）。example: null 就用起步样式。
async function setup(host, { example = "mono" } = {}) {
  const { id } = host.createProject("汇报");
  const c = async (name, args) => { const r = await host.call(name, { projectId: id, ...args }); assert.notEqual(r && r.ok, false, `${name}: ${JSON.stringify(r)}`); return r; };
  await c("create_sheet", { sheetId: "sales", title: "销售" });
  fs.writeFileSync(path.join(host.ws, id, "sheets", "sales", "sheet.json"), JSON.stringify({ schemaVersion: 1, title: "销售", sheets: [{ name: "汇总", rows: [["张三", "120"]] }] }));
  await c("build_sheet", { sheetId: "sales", note: "v1" });
  const created = await c("create_deck", { deckId: "pitch", title: "结账改版" });
  const dir = path.join(host.ws, id, "decks", "pitch");
  if (example) {
    fs.rmSync(path.join(dir, "design"), { recursive: true, force: true });
    fs.cpSync(path.join(EXAMPLES, example, "design"), path.join(dir, "design"), { recursive: true });
  }
  const write = (file, html) => fs.writeFileSync(path.join(dir, "slides", file), html);
  write("02-数据.html", '<section data-layout="figure"><h2>现在的数据</h2><div class="figure"><pf-embed ref="sheet:sales#汇总"></pf-embed></div></section>');
  write("03-流程.html", '<section data-layout="image-left"><figure class="contain"><img src="assets/logo.png" alt=""></figure><div class="text"><h2>新流程</h2><div class="mermaid">flowchart LR\n  A-->B</div></div></section>');
  fs.writeFileSync(path.join(dir, "assets", "logo.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  const built = await c("build_deck", { deckId: "pitch", note: "首版" });
  return { id, c, dir, write, created, built };
}

test("建 → 定版：design/ 跟 slides/ assets/ 一起冻结；嵌入固定版本；缺素材、页不合约定都拒绝", async () => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id, dir, write, created, built } = await setup(host);
    assert.equal(created.designDir, path.join(dir, "design"));
    assert.equal(built.slideCount, 3, "建的时候自带一页封面");
    const dj = JSON.parse(fs.readFileSync(path.join(dir, "deck.json"), "utf8"));
    assert.deepEqual(dj.versions[0].sources.filter((s) => s.via === "embed").map((s) => s.ref), ["sheet:sales@1#汇总"]);
    assert.ok(host.file(id, "decks/pitch/versions/1/design/mono.css"));
    assert.ok(host.file(id, "decks/pitch/versions/1/slides/02-数据.html"));
    assert.ok(host.file(id, "decks/pitch/versions/1/playback.json"));

    write("04-坏.html", "<div>不是 section</div>");
    assert.equal((await host.call("build_deck", { projectId: id, deckId: "pitch", note: "x" })).error.code, "BAD_SLIDE");
    write("04-坏.html", '<section data-layout="figure"><img src="assets/nope.png"></section>');
    assert.equal((await host.call("build_deck", { projectId: id, deckId: "pitch", note: "x" })).error.code, "ASSET_MISSING");
    fs.rmSync(path.join(dir, "slides", "04-坏.html"));

    fs.rmSync(path.join(dir, "design"), { recursive: true });
    fs.mkdirSync(path.join(dir, "design"));
    fs.writeFileSync(path.join(dir, "design", "new.css"), "section{color:red}");
    await host.call("build_deck", { projectId: id, deckId: "pitch", note: "换样式" });
    const v1 = host.render(id, "decks/pitch/preview.html", { query: "v=1" });
    assert.ok(v1.includes('href="versions/1/design/mono.css"') && !v1.includes("new.css"), "老版本用它当时的 design/");
  } finally { host.cleanup(); }
});

test("design/：新建时有起步样式；顶层 .css、.js 按文件名顺序全部加载（阅读页引用、单 HTML 内联），脚本在各页之前；子目录不直接加载", async () => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id, dir } = await setup(host, { example: null });
    assert.deepEqual(fs.readdirSync(path.join(dir, "design")), ["design.css"], "起步样式");
    fs.writeFileSync(path.join(dir, "design", "02-b.css"), "/*B-CSS*/");
    fs.writeFileSync(path.join(dir, "design", "01-a.css"), "/*A-CSS*/ section{background:url(fonts/bg.png)}");
    fs.writeFileSync(path.join(dir, "design", "01-a.js"), "/*A-JS*/");
    fs.mkdirSync(path.join(dir, "design", "fonts"));
    fs.writeFileSync(path.join(dir, "design", "fonts", "bg.png"), Buffer.from("89504e470d0a1a0a", "hex"));
    fs.writeFileSync(path.join(dir, "design", "fonts", "skip.css"), "/*SUBDIR*/");
    await host.call("build_deck", { projectId: id, deckId: "pitch", note: "多文件" });
    const html = host.render(id, "decks/pitch/preview.html");
    const at = (s) => html.indexOf(s);
    assert.ok(at('href="versions/2/design/01-a.css"') > 0 && at('href="versions/2/design/01-a.css"') < at('href="versions/2/design/02-b.css"')
      && at('href="versions/2/design/02-b.css"') < at('href="versions/2/design/design.css"'), "按文件名顺序");
    assert.ok(at('src="versions/2/design/01-a.js"') > 0 && at('src="versions/2/design/01-a.js"') < at('class="pf-slide"'), "design/ 的脚本先于各页");
    assert.ok(!html.includes("skip.css"), "子目录不直接加载");
    const one = (await host.export(id, "deck/pitch/html")).buffer.toString();
    assert.ok(one.indexOf("/*A-CSS*/") < one.indexOf("/*B-CSS*/") && one.includes("/*A-JS*/") && !one.includes("/*SUBDIR*/"));
    assert.ok(one.includes("url(data:image/png;base64,"), "样式里引用的子目录文件内嵌");
  } finally { host.cleanup(); }
});

test("样例和可选库：样例里的 pf-kit 跟 lib/ 一致；mono、swiss 共用的版式文件一致（改一处要同步）；同一份页面两个样例都能用", async () => {
  const read = (...p) => fs.readFileSync(path.join(SLIDES_SKILL, ...p), "utf8");
  for (const ex of ["mono", "swiss"]) {
    for (const f of ["pf-kit.css", "pf-kit.js"]) assert.equal(read("examples", ex, "design", f), read("lib", f), `${ex}/${f} 跟 lib/${f} 不一致`);
  }
  for (const f of ["layouts.css", "layouts.js"]) {
    const norm = (t) => t.replace(/由 (mono|swiss)\.css/, "由 X.css");
    assert.equal(norm(read("examples", "mono", "design", f)), norm(read("examples", "swiss", "design", f)), `${f} 两个样例不一致`);
  }
  const host = createTestHost(PRODUCTS);
  try {
    const { id, dir } = await setup(host, { example: "swiss" });
    await host.call("build_deck", { projectId: id, deckId: "pitch", note: "瑞士风" });
    assert.ok(host.render(id, "decks/pitch/preview.html").includes("versions/2/design/swiss.css"));
    assert.ok(fs.existsSync(path.join(dir, "design", "pf-kit.js")));
  } finally { host.cleanup(); }
});

test("完整示例：年终汇报有十页、通过页面约定并保留可打开的 v1", () => {
  const root = path.join(ROOT, "examples", "annual-review");
  const project = JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8"));
  const deck = JSON.parse(fs.readFileSync(path.join(root, "decks", "annual-review", "deck.json"), "utf8"));
  const slides = fs.readdirSync(path.join(root, "decks", "annual-review", "slides")).filter((f) => f.endsWith(".html")).sort();
  assert.equal(project.id, "annual-review");
  assert.equal(deck.head, 1);
  assert.equal(slides.length, 10);
  for (const file of slides) assert.deepEqual(checkSlide(fs.readFileSync(path.join(root, "decks", "annual-review", "slides", file), "utf8")), [], file);
  const version = JSON.parse(fs.readFileSync(path.join(root, "decks", "annual-review", "versions", "1.json"), "utf8"));
  assert.equal(Object.keys(version.files).filter((f) => f.startsWith("slides/")).length, 10);
  for (const { hash } of Object.values(version.files)) assert.ok(fs.existsSync(path.join(root, "objects", hash.slice(0, 2), hash)), hash);
});

test("截图的出处：assets 里图片旁边的 .source.json 定版时记进引用", async () => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id, c, dir } = await setup(host);
    fs.writeFileSync(path.join(dir, "assets", "logo.png.source.json"), JSON.stringify({ ref: "sheet:sales@1" }));
    await c("build_deck", { deckId: "pitch", note: "带出处" });
    const dj = JSON.parse(fs.readFileSync(path.join(dir, "deck.json"), "utf8"));
    assert.ok(dj.versions[1].sources.some((s) => s.via === "asset" && s.ref === "sheet:sales@1"));
  } finally { host.cleanup(); }
});

test("阅读页：每页包成 .pf-slide、1920×1080；design/ 和素材按版本路径；嵌入的表格；Mermaid 库放 lib/deck/", async () => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id } = await setup(host);
    const html = host.render(id, "decks/pitch/preview.html");
    assert.equal((html.match(/<div class="pf-slide" data-id=/g) || []).length, 3);
    assert.ok(html.includes('data-id="02-数据"') && html.includes("width:1920px;height:1080px"));
    assert.ok(html.includes(">张三</td>"), "嵌入的表格按固定版本展开");
    assert.ok(html.includes('src="versions/1/assets/logo.png"'));
    assert.ok(html.includes("../../lib/deck/mermaid.min.js") && fs.existsSync(path.join(host.ws, id, "lib", "deck", "mermaid.min.js")));
    assert.ok(html.includes("window.__pfDeck"), "给检查脚本的接口");
    assert.ok(html.includes('id="pfFilm"') && html.includes('id="pfThumbs"'), "阅读页提供左侧缩略图模式");
    assert.ok(html.includes("window.__PF_PNAV__"));
  } finally { host.cleanup(); }
});

test("自动翻页和音频：配置随版本冻结，阅读页有统一控制，单 HTML 内嵌音频，旧版本仍是手动模式", async () => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id, c, dir } = await setup(host);
    fs.writeFileSync(path.join(dir, "assets", "bgm.mp3"), Buffer.from("ID3-test-audio"));
    fs.writeFileSync(path.join(dir, "assets", "02.wav"), Buffer.from("RIFF-test-audio"));
    fs.writeFileSync(path.join(dir, "playback.json"), JSON.stringify({
      schemaVersion: 1,
      autoAdvance: { enabled: true, defaultDurationMs: 5000, loop: true },
      backgroundAudio: { src: "assets/bgm.mp3", volume: 0.25, loop: true },
      slides: { "02-数据": { audio: { src: "assets/02.wav" }, advance: { on: "audio-ended", fallbackMs: 10000 } } },
    }, null, 2));
    await c("build_deck", { deckId: "pitch", note: "加入自动放映" });

    const html = host.render(id, "decks/pitch/preview.html");
    assert.ok(html.includes('id="pfPlay"') && html.includes('id="pfAudio"'));
    assert.ok(html.includes("versions/2/assets/bgm.mp3") && html.includes("versions/2/assets/02.wav"));
    assert.ok(html.includes("play: playPlayback") && html.includes("pause: pausePlayback"));
    const old = host.render(id, "decks/pitch/preview.html", { query: "v=1" });
    assert.ok(!old.includes('id="pfPlay"'), "旧版本的默认手动配置不显示播放控制");

    const standalone = (await host.export(id, "deck/pitch/html")).buffer.toString();
    assert.ok(standalone.includes("data:audio/mpeg;base64,") && standalone.includes("data:audio/wav;base64,"));
    const zip = await JSZip.loadAsync((await host.export(id, "deck/pitch/zip")).buffer);
    assert.ok(Object.keys(zip.files).some((n) => n.endsWith("playback.json")));

    const cfgPath = path.join(dir, "playback.json");
    fs.writeFileSync(cfgPath, JSON.stringify({ schemaVersion: 1, slides: { "不存在": { advance: { on: "manual" } } } }));
    const invalid = await host.call("build_deck", { projectId: id, deckId: "pitch", note: "坏配置" });
    assert.equal(invalid.error.code, "UNKNOWN_PLAYBACK_SLIDE");
  } finally { host.cleanup(); }
});

test("自动翻页运行时：人点击后开始，暂停保留剩余时间，播到末页停止", async () => {
  const host = createTestHost(PRODUCTS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-deck-playback-"));
  let browser;
  try {
    const { id, c, dir, write } = await setup(host);
    write("03-流程.html", '<section data-layout="figure"><style>#accent-node{color:rgb(1, 2, 3)}</style><h2 id="accent-node">新流程</h2><div class="figure"><div class="mermaid">flowchart LR\n  A-->B</div></div></section>');
    fs.writeFileSync(path.join(dir, "playback.json"), JSON.stringify({
      schemaVersion: 1,
      autoAdvance: { enabled: true, defaultDurationMs: 500, loop: false },
      slides: {},
    }));
    await c("build_deck", { deckId: "pitch", note: "自动翻页" });
    const file = path.join(tmp, "deck.html");
    fs.writeFileSync(file, (await host.export(id, "deck/pitch/html")).buffer);
    browser = await launch({ headless: true, executablePath: (await resolveBrowserExecutable()).path, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector(".pf-slide .mermaid svg"), { timeout: 3000 });
    assert.equal(await page.evaluate(() => window.__pfDeck.current()), 0);

    await page.click("#pfFilm");
    assert.deepEqual(await page.evaluate(() => ({
      filmstrip: document.documentElement.classList.contains("pf-filmstrip"),
      thumbs: document.querySelectorAll(".pf-thumb").length,
      slides: document.querySelectorAll(".pf-slide").length,
      active: document.querySelector('.pf-thumb[aria-current="true"]')?.getAttribute("data-index"),
      asideDisplay: getComputedStyle(document.getElementById("pfThumbs")).display,
      stageMargin: getComputedStyle(document.getElementById("pfStage")).marginLeft,
    })), { filmstrip: true, thumbs: 3, slides: 3, active: "0", asideDisplay: "block", stageMargin: "286px" });
    assert.deepEqual(await page.evaluate(() => {
      const thumb = document.querySelector('.pf-thumb[data-index="2"]');
      const styled = thumb.querySelector("#pf-thumb-2-accent-node");
      const svg = thumb.querySelector(".mermaid svg");
      const ids = new Set([...svg.querySelectorAll("[id]")].map((el) => el.id));
      const refs = [...svg.querySelectorAll("*")].flatMap((el) => [...el.attributes].map((a) => a.value)).flatMap((value) => [...value.matchAll(/url\(\s*["']?#([^\s)'\"]+)/g)].map((m) => m[1]));
      return { styled: getComputedStyle(styled).color, allIdsScoped: [...ids].every((id) => id.startsWith("pf-thumb-2-")), refsResolve: refs.every((id) => ids.has(id)) };
    }), { styled: "rgb(1, 2, 3)", allIdsScoped: true, refsResolve: true }, "缩略图保留页内 #id 样式并重写 Mermaid/SVG 引用");
    await page.click('.pf-thumb[data-index="1"]');
    assert.deepEqual(await page.evaluate(() => ({ current: window.__pfDeck.current(), activeThumb: document.querySelector('.pf-thumb[aria-current="true"]')?.getAttribute("data-index"), activeSlide: document.querySelector(".pf-slide.active")?.getAttribute("data-id") })), { current: 1, activeThumb: "1", activeSlide: "02-数据" });
    await page.focus('.pf-thumb[data-index="0"]');
    await page.keyboard.press("Space");
    assert.equal(await page.evaluate(() => window.__pfDeck.current()), 0, "缩略图空格选择不会再冒泡触发全局下一页");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("pf-filmstrip")), false);
    await page.keyboard.press("KeyT");
    await page.click("#pfGrid");
    assert.deepEqual(await page.evaluate(() => ({ filmstrip: document.documentElement.classList.contains("pf-filmstrip"), overview: document.documentElement.classList.contains("pf-overview") })), { filmstrip: false, overview: true }, "总览和缩略图模式互斥");
    await page.click("#pfGrid");
    await page.evaluate(() => window.__pfDeck.show(0));
    await page.click("#pfPlay");
    await page.click("#pfFilm");
    assert.equal(await page.evaluate(() => window.__pfDeck.playing()), false, "进入缩略图模式会暂停自动放映");
    await page.keyboard.press("Escape");
    await page.click("#pfPlay");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await page.evaluate(() => window.__pfDeck.pause());
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.equal(await page.evaluate(() => window.__pfDeck.current()), 0, "暂停期间不消耗剩余时间");
    await page.evaluate(() => window.__pfDeck.play());
    await page.waitForFunction(() => window.__pfDeck.current() === 1, { timeout: 1500 });
    await page.waitForFunction(() => window.__pfDeck.current() === 2 && !window.__pfDeck.playing(), { timeout: 2000 });
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    host.cleanup();
  }
});

test("音频放映运行时：背景音跨页，旧旁白回调失效，旁白结束翻页，循环和边界导航不重播", async () => {
  const host = createTestHost(PRODUCTS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-deck-audio-"));
  let browser;
  try {
    const { id, c, dir } = await setup(host);
    fs.writeFileSync(path.join(dir, "assets", "bgm.mp3"), Buffer.from("ID3-test-audio"));
    fs.writeFileSync(path.join(dir, "assets", "01.wav"), Buffer.from("RIFF-one"));
    fs.writeFileSync(path.join(dir, "assets", "02.wav"), Buffer.from("RIFF-two"));
    fs.writeFileSync(path.join(dir, "playback.json"), JSON.stringify({
      schemaVersion: 1,
      autoAdvance: { enabled: true, defaultDurationMs: 500, loop: true },
      backgroundAudio: { src: "assets/bgm.mp3", volume: 0.2, loop: true },
      slides: {
        "01-封面": { audio: { src: "assets/01.wav" }, advance: { on: "audio-ended", fallbackMs: 500 } },
        "02-数据": { audio: { src: "assets/02.wav" }, advance: { on: "audio-ended", fallbackMs: 1200 } },
      },
    }));
    await c("build_deck", { deckId: "pitch", note: "音频状态机" });
    const file = path.join(tmp, "deck.html");
    fs.writeFileSync(file, (await host.export(id, "deck/pitch/html")).buffer);
    browser = await launch({ headless: true, executablePath: (await resolveBrowserExecutable()).path, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      window.__testAudios = [];
      window.Audio = class TestAudio {
        constructor(src) { this.src = src; this.currentTime = 0; this.playCount = 0; this.pauseCount = 0; this.muted = false; window.__testAudios.push(this); }
        play() { this.playCount += 1; return new Promise((resolve, reject) => { this.resolvePlay = resolve; this.rejectPlay = reject; }); }
        pause() { this.pauseCount += 1; }
        addEventListener() {}
      };
    });
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.click("#pfPlay");
    assert.deepEqual(await page.evaluate(() => window.__testAudios.map((a) => [a.src.startsWith("data:audio/mpeg"), a.playCount])), [[true, 1], [false, 1]]);

    await page.evaluate(() => window.__pfDeck.show(1));
    await page.evaluate(() => window.__testAudios[1].rejectPlay(new Error("late rejection")));
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(await page.evaluate(() => window.__pfDeck.current()), 1, "上一页的 play() 失败不能覆盖当前页的 fallback");
    await page.evaluate(() => window.__testAudios[2].onended());
    assert.equal(await page.evaluate(() => window.__pfDeck.current()), 2, "旁白结束后翻页");
    await page.waitForFunction(() => window.__pfDeck.current() === 0, { timeout: 1500 });

    const beforeBoundary = await page.evaluate(() => ({ count: window.__testAudios.length, plays: window.__testAudios.at(-1).playCount }));
    await page.evaluate(() => window.__pfDeck.show(-1));
    assert.deepEqual(await page.evaluate(() => ({ count: window.__testAudios.length, plays: window.__testAudios.at(-1).playCount })), beforeBoundary, "第一页继续向前不会重启旁白");

    await page.evaluate(() => { window.__testAudios[0].currentTime = 9; window.__testAudios.at(-1).currentTime = 4; window.__pfDeck.pause(); });
    const paused = await page.evaluate(() => ({ bgPause: window.__testAudios[0].pauseCount, narrationPause: window.__testAudios.at(-1).pauseCount }));
    assert.ok(paused.bgPause > 0 && paused.narrationPause > 0);
    await page.evaluate(() => window.__pfDeck.play());
    assert.deepEqual(await page.evaluate(() => ({ bgTime: window.__testAudios[0].currentTime, narrationTime: window.__testAudios.at(-1).currentTime, bgPlays: window.__testAudios[0].playCount, narrationPlays: window.__testAudios.at(-1).playCount })), { bgTime: 9, narrationTime: 4, bgPlays: 2, narrationPlays: 2 });

    await page.evaluate(() => window.__pfDeck.show(1));
    await page.evaluate(() => window.__testAudios.at(-1).rejectPlay(new Error("use fallback")));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await page.evaluate(() => window.__pfDeck.pause());
    await new Promise((resolve) => setTimeout(resolve, 350));
    await page.evaluate(() => window.__pfDeck.play());
    await page.evaluate(() => window.__testAudios.at(-1).rejectPlay(new Error("resume still unavailable")));
    await new Promise((resolve) => setTimeout(resolve, 900));
    assert.equal(await page.evaluate(() => window.__pfDeck.current()), 2, "fallback 暂停续播沿用剩余时间，不从完整时长重算");
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    host.cleanup();
  }
});

test("页里的视频：只在当前页播，autoplay 进页才播、翻走暂停；缩略图不加载；video-ended 等视频放完翻页", async () => {
  const host = createTestHost(PRODUCTS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-deck-video-"));
  let browser;
  try {
    const { id, c, dir, write } = await setup(host);
    fs.writeFileSync(path.join(dir, "assets", "a.mp4"), Buffer.from("fake-mp4"));
    fs.writeFileSync(path.join(dir, "assets", "a.jpg"), Buffer.from("ffd8ff", "hex"));
    write("02-数据.html", '<section data-layout="figure"><h2>演示</h2><video src="assets/a.mp4" poster="assets/a.jpg" autoplay muted controls></video></section>');
    write("03-流程.html", '<section data-layout="figure"><h2>录屏</h2><video src="assets/a.mp4" poster="assets/a.jpg" controls></video></section>');
    const playbackJson = (id) => JSON.stringify({ schemaVersion: 1, autoAdvance: { enabled: true, defaultDurationMs: 60000 }, slides: { [id]: { advance: { on: "video-ended", fallbackMs: 60000 } } } });
    fs.writeFileSync(path.join(dir, "playback.json"), playbackJson("01-封面"));
    const rejected = await host.call("build_deck", { projectId: id, deckId: "pitch", note: "封面等视频" });
    assert.match(rejected.error.message, /必须有 <video>/);
    fs.writeFileSync(path.join(dir, "playback.json"), playbackJson("02-数据"));
    await c("build_deck", { deckId: "pitch", note: "加视频" });
    const file = path.join(tmp, "deck.html");
    const html = (await host.export(id, "deck/pitch/html")).buffer.toString();
    assert.ok(html.includes('src="data:video/mp4;base64,'));
    fs.writeFileSync(file, html);

    browser = await launch({ headless: true, executablePath: (await resolveBrowserExecutable()).path, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      const P = HTMLMediaElement.prototype;
      Object.defineProperty(P, "paused", { configurable: true, get() { return this.__paused !== false; } });
      P.play = function () { this.__paused = false; this.__plays = (this.__plays || 0) + 1; return Promise.resolve(); };
      P.pause = function () { this.__paused = true; };
    });
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    const state = () => page.evaluate(() => Array.from(document.querySelectorAll("#pfDeck video")).map((v) => ({ plays: v.__plays || 0, paused: v.paused, autoplay: v.hasAttribute("autoplay") })));
    assert.deepEqual(await state(), [{ plays: 0, paused: true, autoplay: false }, { plays: 0, paused: true, autoplay: false }], "封面时别的页视频都不播，autoplay 被接管");

    await page.evaluate(() => window.__pfDeck.show(1));
    assert.deepEqual((await state()).map((v) => [v.plays, v.paused]), [[1, false], [0, true]], "进页才播 autoplay 的视频");
    await page.evaluate(() => window.__pfDeck.show(2));
    assert.deepEqual((await state()).map((v) => [v.plays, v.paused]), [[1, true], [0, true]], "翻走就暂停，不带 autoplay 的不自动播");

    await page.evaluate(() => window.__pfDeck.filmstrip(true));
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll("#pfThumbs video")).map((v) => [v.preload, v.hasAttribute("data-pf-autoplay"), v.hasAttribute("controls")])), [["none", false, false], ["none", false, false]]);
    await page.evaluate(() => window.__pfDeck.filmstrip(false));

    await page.evaluate(() => { window.__pfDeck.show(1); window.__pfDeck.play(); });
    assert.equal((await state())[0].plays, 2, "放映时 autoplay 已经在播，不重复开始");
    await page.evaluate(() => window.__pfDeck.pause());
    assert.equal((await state())[0].paused, true, "暂停放映时视频一起暂停");
    await page.evaluate(() => window.__pfDeck.play());
    assert.deepEqual((await state())[0], { plays: 3, paused: false, autoplay: false }, "继续放映时视频接着播");
    await page.evaluate(() => document.querySelectorAll("#pfDeck video")[0].dispatchEvent(new Event("ended")));
    assert.equal(await page.evaluate(() => window.__pfDeck.current()), 2, "视频放完翻页");
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    host.cleanup();
  }
});

test("背景音乐避让：写了 duckVolume 时有声视频一响就压低，停了恢复；默认静音，点「播放」打开声音", async () => {
  const host = createTestHost(PRODUCTS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-deck-duck-"));
  let browser;
  try {
    const { id, c, dir, write } = await setup(host);
    fs.writeFileSync(path.join(dir, "assets", "a.mp4"), Buffer.from("fake-mp4"));
    fs.writeFileSync(path.join(dir, "assets", "a.jpg"), Buffer.from("ffd8ff", "hex"));
    fs.writeFileSync(path.join(dir, "assets", "bgm.mp3"), Buffer.from("ID3-test-audio"));
    write("02-数据.html", '<section data-layout="figure"><h2>原声</h2><video src="assets/a.mp4" poster="assets/a.jpg" autoplay></video></section>');
    fs.writeFileSync(path.join(dir, "playback.json"), JSON.stringify({
      schemaVersion: 1, autoAdvance: { enabled: false },
      backgroundAudio: { src: "assets/bgm.mp3", volume: 0.3, loop: true, duckVolume: 0.05 },
    }));
    await c("build_deck", { deckId: "pitch", note: "避让" });
    const file = path.join(tmp, "deck.html");
    fs.writeFileSync(file, (await host.export(id, "deck/pitch/html")).buffer);
    browser = await launch({ headless: true, executablePath: (await resolveBrowserExecutable()).path, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      window.__testAudios = [];
      window.Audio = class TestAudio {
        constructor(src) { this.src = src; this.volume = 1; this.paused = true; window.__testAudios.push(this); }
        play() { this.paused = false; return Promise.resolve(); }
        pause() { this.paused = true; }
        addEventListener() {}
      };
      // 视频：模拟浏览器的自动播放策略——没人操作过页面时有声的 play() 被拒
      const P = HTMLMediaElement.prototype;
      Object.defineProperty(P, "paused", { configurable: true, get() { return this.__paused !== false; } });
      P.play = function () {
        if (!this.muted && !window.__gesture) return Promise.reject(new DOMException("blocked", "NotAllowedError"));
        this.__paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve();
      };
      P.pause = function () { this.__paused = true; this.dispatchEvent(new Event("pause")); };
    });
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    const audioState = () => page.evaluate(() => ({ pressed: document.getElementById("pfAudio").getAttribute("aria-pressed"), video: document.querySelector("#pfDeck video").muted }));
    assert.deepEqual(await audioState(), { pressed: "true", video: true }, "打开就是静音，按钮如实显示");
    await page.evaluate(() => window.__pfDeck.show(1));
    await page.waitForFunction(() => !document.querySelector("#pfDeck video").paused);
    assert.deepEqual(await audioState(), { pressed: "true", video: true }, "视频静音自动播，不会被浏览器拦");

    await page.evaluate(() => { window.__gesture = true; });
    await page.click("#pfPlay");
    assert.deepEqual(await audioState(), { pressed: "false", video: false }, "点「播放」顺带打开声音，正在播的视频也出声");
    assert.equal(await page.evaluate(() => window.__testAudios[0].muted), false, "背景音乐有声");
    const bgVolume = () => page.evaluate(() => window.__testAudios[0].volume);
    await page.waitForFunction(() => Math.abs(window.__testAudios[0].volume - 0.05) < 1e-6, { timeout: 2000 });
    await page.evaluate(() => window.__pfDeck.show(0));
    await page.waitForFunction(() => Math.abs(window.__testAudios[0].volume - 0.3) < 1e-6, { timeout: 2000 });
    assert.ok(Math.abs((await bgVolume()) - 0.3) < 1e-6, "翻走视频停了，背景音乐恢复");
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    host.cleanup();
  }
});

test("翻页事件：翻到一页在它的 section 上发 pf:enter、离开发 pf:leave（冒泡，带 index、id）；页里的脚本能用 design/ 里定义的东西", async () => {
  const host = createTestHost(PRODUCTS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-deck-events-"));
  let browser;
  try {
    const { id, dir, write } = await setup(host, { example: null });
    fs.writeFileSync(path.join(dir, "design", "lib.js"), "window.__log = []; window.logEvent = (e) => __log.push(e.type + ':' + e.detail.index + ':' + e.detail.id);");
    fs.writeFileSync(path.join(dir, "design", "listen.js"), "document.addEventListener('pf:enter', logEvent); document.addEventListener('pf:leave', logEvent);");
    write("02-数据.html", '<section class="p2"><h2>第二页</h2><script>(() => { const page = document.currentScript.closest("section"); page.addEventListener("pf:enter", () => { page.dataset.seen = "yes"; logEvent({ type: "own", detail: { index: 1, id: "p2" } }); }); })();</script></section>');
    await host.call("build_deck", { projectId: id, deckId: "pitch", note: "事件" });
    const file = path.join(tmp, "deck.html");
    fs.writeFileSync(file, (await host.export(id, "deck/pitch/html")).buffer);
    browser = await launch({ headless: true, executablePath: (await resolveBrowserExecutable()).path, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.evaluate(() => window.__pfDeck.show(1));
    await page.evaluate(() => window.__pfDeck.show(1)); // 同一页不重复发
    await page.evaluate(() => window.__pfDeck.show(0));
    assert.deepEqual(await page.evaluate(() => window.__log), ["pf:enter:0:01-封面", "pf:leave:0:01-封面", "own:1:p2", "pf:enter:1:02-数据", "pf:leave:1:02-数据", "pf:enter:0:01-封面"]);
    assert.equal(await page.evaluate(() => document.querySelector(".pf-deck .p2").dataset.seen), "yes");
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    host.cleanup();
  }
});

test("缩放：默认自适应窗口；＋/− 以舞台中心为锚点，超出舞台能滚动；缩放至 100%、自适应窗口；选框跟着滚动对齐", async () => {
  const host = createTestHost(PRODUCTS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-deck-zoom-"));
  let browser;
  try {
    const { id, c } = await setup(host);
    await c("build_deck", { deckId: "pitch", note: "缩放" });
    const file = path.join(tmp, "deck.html");
    fs.writeFileSync(file, (await host.export(id, "deck/pitch/html")).buffer);
    browser = await launch({ headless: true, executablePath: (await resolveBrowserExecutable()).path, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 700 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    const state = () => page.evaluate(() => {
      const stage = document.getElementById("pfStage"), r = document.querySelector(".pf-slide.active").getBoundingClientRect(), sr = stage.getBoundingClientRect();
      return { label: document.getElementById("pfZoomLabel").textContent, width: r.width, cx: r.left + r.width / 2 - sr.left, cy: r.top + r.height / 2 - sr.top,
        stageW: stage.clientWidth, stageH: stage.clientHeight, scrollW: stage.scrollWidth, scrollH: stage.scrollHeight };
    });
    const fitted = await state();
    assert.ok(fitted.width < fitted.stageW && fitted.scrollW <= fitted.stageW, "默认铺在舞台里、不滚动");
    assert.equal(fitted.label, Math.round(fitted.width / 1920 * 100) + "%");

    for (let i = 0; i < 4; i++) await page.click("#pfZoomIn");
    const zoomed = await state();
    assert.ok(Math.abs(zoomed.width - fitted.width * 1.2 ** 4) < 2, "每次放大 1.2 倍");
    assert.ok(zoomed.scrollW > zoomed.stageW && zoomed.scrollH > zoomed.stageH, "比舞台大就能滚动");
    assert.ok(Math.abs(zoomed.cx - zoomed.stageW / 2) < 2 && Math.abs(zoomed.cy - zoomed.stageH / 2) < 2, "以舞台中心为锚点，中心内容不跑");

    // 滚动后点一个元素，选框仍然框在它身上
    await page.evaluate(() => { const s = document.getElementById("pfStage"); s.scrollLeft += 120; s.scrollTop += 80; });
    // 挑一个在可视区里的文字元素，点它露出来的那部分
    const box = await page.evaluate(() => {
      const sr = document.getElementById("pfStage").getBoundingClientRect();
      for (const el of document.querySelectorAll(".pf-slide.active section *")) {
        if (!el.textContent.trim() || el.children.length) continue;
        const r = el.getBoundingClientRect();
        const x1 = Math.max(r.left, sr.left + 20), x2 = Math.min(r.right, sr.right - 20), y1 = Math.max(r.top, sr.top + 20), y2 = Math.min(r.bottom, sr.bottom - 20);
        if (x2 - x1 > 4 && y2 - y1 > 4) return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
      }
      return null;
    });
    assert.ok(box, "可视区里有可点的元素");
    await page.mouse.click(box.x, box.y);
    const sel = await page.evaluate(() => { const r = document.querySelector("#pfSel div:not(.pf-sel-hover)").getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
    assert.ok(sel.left <= box.x && box.x <= sel.right && sel.top <= box.y && box.y <= sel.bottom, "选框框住点中的元素，不因滚动偏移");

    await page.click("#pfZoomLabel");
    await page.click("#pfZoomReset");
    assert.equal((await state()).label, "100%");
    assert.equal(await page.evaluate(() => document.getElementById("pfZoomMenu").hidden), true, "选完关菜单");
    await page.click("#pfZoomLabel");
    await page.click("#pfZoomFit");
    const refit = await state();
    assert.equal(refit.label, fitted.label, "回到自适应窗口");
    await page.setViewport({ width: 1200, height: 800 });
    await page.waitForFunction((previousWidth) => document.querySelector(".pf-slide.active").getBoundingClientRect().width > previousWidth, {}, refit.width);
    assert.ok((await state()).width > refit.width, "自适应模式跟着窗口变大");
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    host.cleanup();
  }
});

test("引用和健康：页 id 做子部位；改了草稿报未定版", async () => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id, c, write } = await setup(host);
    await c("create_doc", { docId: "memo", content: "# 备忘\n" });
    await c("build_doc", { docId: "memo", note: "v1", sources: ["deck:pitch#02-数据"] });
    const graph = projectGraph(host.ws, id, host.products, host.reg.resolvers);
    assert.equal(graph.artifacts.find((a) => a.id === "memo").sources[0].ref, "deck:pitch@1#02-数据");
    assert.deepEqual(host.products.find((p) => p.type === "deck").health(host.ws, id), []);
    write("02-数据.html", '<section data-layout="figure"><h2>改了</h2></section>');
    assert.deepEqual(host.products.find((p) => p.type === "deck").health(host.ws, id).map((f) => f.code), ["deck_uncommitted"]);
    await c("build_deck", { deckId: "pitch", note: "v2" });
    const g2 = projectGraph(host.ws, id, host.products, host.reg.resolvers);
    assert.equal(g2.artifacts.find((a) => a.id === "memo").sources[0].status, "stale");
  } finally { host.cleanup(); }
});

test("导出：单 HTML 全内嵌（design/ 的 CSS、图片、Mermaid）；源文件包；草稿单 HTML 用没定版的改动", async () => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id, write } = await setup(host);
    const html = (await host.export(id, "deck/pitch/html")).buffer.toString();
    assert.ok(html.includes("--accent") && html.includes("data:image/png;base64,") && html.includes('id="pf-lib-mermaid"'));
    assert.ok(!html.includes('class="pf-export-entry"'));
    const zip = await JSZip.loadAsync((await host.export(id, "deck/pitch/zip")).buffer);
    const names = Object.keys(zip.files);
    assert.ok(names.some((n) => n.endsWith("slides/02-数据.html")) && names.some((n) => n.endsWith("design/mono.css")) && names.some((n) => n.endsWith("assets/logo.png")));
    write("04-新.html", '<section data-layout="end"><h2>草稿里的新页</h2></section>');
    const draft = (await host.export(id, "deck/pitch/draft-html")).buffer.toString();
    assert.ok(draft.includes("草稿里的新页") && !html.includes("草稿里的新页"));
  } finally { host.cleanup(); }
});

test("导出 PDF：每页一张 1920×1080（真起无头浏览器）", async () => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id } = await setup(host);
    const out = await host.export(id, "deck/pitch/pdf");
    assert.equal(out.mime, "application/pdf");
    assert.equal(out.buffer.subarray(0, 5).toString(), "%PDF-");
    const pages = (out.buffer.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
    assert.equal(pages, 3, "三页幻灯片就是三页 PDF（带 Mermaid 的页也不多出空白页）");
    assert.ok(/\/MediaBox\s*\[\s*0\s+0\s+1440\s+810\s*\]/.test(out.buffer.toString("latin1")), "页面是 16:9（1920×1080 像素 = 1440×810 点）");
  } finally { host.cleanup(); }
});

const HAS_FFMPEG = spawnSync(process.env.PROTOFLOW_FFMPEG_PATH || "ffmpeg", ["-version"]).status === 0;
// 单声道 16 位 PCM 的 WAV：ms 毫秒的正弦音
function wav(ms, hz = 440) {
  const rate = 8000, n = Math.round(rate * ms / 1000), buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / rate) * 8000), 44 + i * 2);
  return buf;
}

test("导出 MP4：每页时长按 playback.json（定时、旁白放完、视频放完），进场动画逐帧录，有音轨（真起无头浏览器 + ffmpeg）", { skip: !HAS_FFMPEG && "本机没有 ffmpeg" }, async (t) => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id, c, dir, write } = await setup(host);
    const assets = path.join(dir, "assets");
    fs.writeFileSync(path.join(assets, "n4.wav"), wav(2000));
    fs.writeFileSync(path.join(assets, "bgm.wav"), wav(500, 220));
    const clip = spawnSync(process.env.PROTOFLOW_FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=4", "-f", "lavfi", "-i", "sine=frequency=660:duration=4",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(assets, "clip.mp4")]);
    assert.equal(clip.status, 0, String(clip.stderr));
    write("04-动画.html", '<section class="p4"><style>.p4 h2{font-size:200px}.pf-slide.active .p4 h2{animation:p4in 1s linear both}@keyframes p4in{from{opacity:0}to{opacity:1}}</style><h2>淡入</h2></section>');
    // 铺满整页，方便逐帧对照源视频；autoplay：阅读页进这页会自己 play()
    write("05-视频.html", '<section style="padding:0"><video src="assets/clip.mp4" autoplay style="position:absolute;inset:0;width:1920px;height:1080px;object-fit:fill"></video></section>');
    fs.writeFileSync(path.join(dir, "playback.json"), JSON.stringify({
      schemaVersion: 1, autoAdvance: { enabled: true, defaultDurationMs: 1000 },
      backgroundAudio: { src: "assets/bgm.wav", volume: 0.3, loop: true, duckVolume: 0.05 },
      slides: {
        "02-数据": { advance: { on: "timer", durationMs: 1500 } },
        "04-动画": { audio: { src: "assets/n4.wav" }, advance: { on: "audio-ended" } },
        "05-视频": { advance: { on: "video-ended" } },
      },
    }));
    await c("build_deck", { deckId: "pitch", note: "加动画和视频" });
    const progress = [];
    const out = await host.export(id, "deck/pitch/mp4", { onProgress: (p) => progress.push(p) });
    assert.equal(out.mime, "video/mp4");
    assert.ok(progress.length > 3 && progress.every((p, i) => i === 0 || p.fraction >= progress[i - 1].fraction), "进度只增不减");
    assert.deepEqual([progress.at(-1).fraction, progress.at(-1).stage], [1, "完成"]);
    assert.ok(progress.some((p) => p.preview && p.preview.endsWith(".jpg")), "录画面时带着最近一帧当预览");
    assert.ok(progress.some((p) => p.meta && Math.abs(p.meta.durationMs - 9500) <= 120), "录完报总时长");
    assert.ok(progress.some((p) => p.stage === "录制画面") && progress.some((p) => p.stage === "合成视频"));
    assert.equal(out.buffer.subarray(4, 8).toString(), "ftyp");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-mp4-test-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const file = path.join(outDir, "out.mp4");
    fs.writeFileSync(file, out.buffer);
    const { probeMedia } = await import("protoflow/sdk");
    const info = probeMedia(file);
    assert.ok(Math.abs(info.durationMs - 9500) <= 120, `1000 + 1500 + 1000 + 2000（旁白）+ 4000（视频）≈ 9.5 秒，实际 ${info.durationMs}`);
    assert.ok(info.hasAudio, "有音轨");
    // 页里视频自己的声音（660Hz，背景音乐 220Hz）也要进成片：阅读页默认静音，导出前得取消
    const band = (ss) => { const r = spawnSync(process.env.PROTOFLOW_FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-ss", String(ss), "-t", "2", "-i", file, "-af", "bandpass=f=660:width_type=h:w=60,volumedetect", "-f", "null", "-"]); return Number((String(r.stderr).match(/mean_volume: (-?[\d.]+) dB/) || [])[1]); };
    assert.ok(band(6.5) - band(0.2) > 20, `视频页有视频原声：视频段 ${band(6.5)} dB，开头 ${band(0.2)} dB`);
    // 第 4 页（3.5 秒起）淡入：开头和 0.9 秒后的画面不一样
    const frameAt = (t) => spawnSync(process.env.PROTOFLOW_FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-ss", String(t), "-i", file, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"]).stdout;
    assert.notDeepEqual(frameAt(3.52), frameAt(4.4), "进场动画逐帧录了");
    assert.notDeepEqual(frameAt(6.0), frameAt(8.0), "页里的视频在动");
    // 视频那一页（5.5 秒起）每一帧都是源视频里该放的那一帧：成片第 t 秒 = 源的第 floor(t×30) 帧。
    // 录的时候视频要是自己在播（页面的"被打断就静音再播"），或者 seek 没到位就截，截到的帧会对不上、成片一卡一卡的。
    const gray = (args) => spawnSync(process.env.PROTOFLOW_FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", ...args, "-vf", "scale=96:54,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 }).stdout;
    const N = 96 * 54;
    const src = gray(["-i", path.join(assets, "clip.mp4")]);
    const diff = (a, ai, b, bi) => { let d = 0; for (let k = 0; k < N; k++) d += Math.abs(a[ai * N + k] - b[bi * N + k]); return d / N; };
    const out4 = gray(["-ss", "6.0", "-t", "2.4", "-i", file]); // 进场淡入过后，看 60 帧
    const wrong = [];
    for (let i = 0; i < out4.length / N; i++) {
      const at = 0.5 + i * 0.04, want = Math.floor(at * 30 + 1e-6);
      let best = -1, bestD = Infinity;
      for (let n = Math.max(0, want - 4); n <= Math.min(src.length / N - 1, want + 4); n++) { const d = diff(out4, i, src, n); if (d < bestD) { bestD = d; best = n; } }
      // 允许差半帧（成片 25fps 取帧的时刻跟源 30fps 的帧边界对不齐）；视频自己在播会往前跑好几帧
      if (best !== want && best !== want - 1) wrong.push(`${at.toFixed(2)}s:源第${want}帧→截到第${best}帧`);
    }
    assert.deepEqual(wrong, [], "视频页每一帧都对得上源视频");
  } finally { host.cleanup(); }
});

test("当外部插件用：内置列表里去掉它，改成配置里写目录路径，照样加载、注册", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-deck-cfg-"));
  const configPath = path.join(dir, "protoflow.config.json");
  fs.writeFileSync(configPath, JSON.stringify({ products: [path.join(ROOT, "products", "deck")] }));
  const builtins = BUILTIN_CANDIDATES.filter((c) => c.descriptor.type !== "deck");
  const reg = assembleRegistry((await loadPluginCandidates(builtins, { configPath })).candidates);
  assert.deepEqual(reg.skipped, []);
  assert.equal(reg.sources.deck, path.join(ROOT, "products", "deck"));
  assert.ok(reg.tools.some((t) => t.name === "build_deck"));
});

const runSkillScript = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(SLIDES_SKILL, "scripts", script), ...args],
    { encoding: "utf8", env: { ...process.env, PROTOFLOW_CLI: path.join(ROOT, "bin", "protoflow-cli.js") }, timeout: 180000 });
  return { status: r.status, out: JSON.parse(r.stdout) };
};

test("检查的时间线：按 playback.json 算每页从第几秒开始（计时 / 默认时长 / 手动停下）；背景音乐不够长报 BGM_SHORT；没被引用的素材报 UNUSED_ASSET（info，不算警告）", async () => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id, dir, write } = await setup(host);
    fs.rmSync(path.join(dir, "slides", "03-流程.html"));
    write("02-数据.html", '<section><h2>第二页</h2></section>');
    write("03-三.html", '<section><h2>第三页</h2><img src="assets/logo.png" alt="" style="width:200px;height:100px"></section>');
    write("04-完.html", '<section><h2>最后一页</h2></section>');
    fs.writeFileSync(path.join(dir, "assets", "bgm.wav"), wav(4000));
    fs.writeFileSync(path.join(dir, "assets", "old.png"), Buffer.from("89504e470d0a1a0a", "hex"));
    fs.writeFileSync(path.join(dir, "playback.json"), JSON.stringify({ schemaVersion: 1,
      autoAdvance: { enabled: true, defaultDurationMs: 2000 }, backgroundAudio: { src: "assets/bgm.wav", volume: 0.3, loop: false },
      slides: { "02-数据": { advance: { on: "timer", durationMs: 3000 } }, "04-完": { advance: { on: "manual" } } } }));
    const { out } = runSkillScript("check.mjs", ["--projectId", id, "--deckId", "pitch", "--dir", host.ws]);
    const t = out.timeline;
    assert.deepEqual(t.slides.map((r) => [r.id, r.startSec, r.sec, r.by]), [["01-封面", 0, 2, "timer"], ["02-数据", 2, 3, "timer"], ["03-三", 5, 2, "timer"], ["04-完", 7, null, "manual"]], JSON.stringify(t));
    assert.deepEqual([t.totalSec, t.stopsAt, t.backgroundAudio.sec, t.backgroundAudio.endsDuring], [7, "04-完", 4, "02-数据"]);
    const short = out.deckIssues.find((x) => x.code === "BGM_SHORT");
    assert.ok(short && short.level === "warn" && short.message.includes("02-数据"), JSON.stringify(out.deckIssues));
    const unused = out.deckIssues.find((x) => x.code === "UNUSED_ASSET");
    assert.ok(unused && unused.level === "info" && unused.message.includes("old.png") && !unused.message.includes("logo.png"));
    assert.deepEqual(out.unusedAssets.map((x) => x.file), ["old.png"]);
    assert.equal(out.warnings, out.deckIssues.filter((x) => x.level === "warn").length + out.slides.reduce((n, s) => n + s.issues.filter((x) => x.level === "warn").length, 0), "info 不算警告");

    // 音乐够长（或者循环）就不报
    fs.writeFileSync(path.join(dir, "assets", "bgm.wav"), wav(9000));
    assert.ok(!runSkillScript("check.mjs", ["--projectId", id, "--deckId", "pitch", "--dir", host.ws]).out.deckIssues.some((x) => x.code === "BGM_SHORT"));
  } finally { host.cleanup(); }
});

test("媒体脚本（media.mjs）：prepare 转成 H.264 + AAC、响度拉到 -18 LUFS、截封面，--no-audio 去掉声音；audit 查出冷场、破音、响度偏离、背景音乐太响", { skip: !HAS_FFMPEG && "本机没有 ffmpeg" }, async () => {
  const host = createTestHost(PRODUCTS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-media-"));
  try {
    const { id, dir, write } = await setup(host, { example: null });
    const make = (name, vol) => spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "3", "-af", `volume=${vol}`, "-c:v", "mpeg4", "-c:a", "aac", path.join(tmp, name)]);
    make("loud.mp4", 8); make("quiet.mp4", 0.001); make("mid.mp4", 1);
    const assets = path.join(dir, "assets");
    const prep = runSkillScript("media.mjs", ["prepare", path.join(tmp, "loud.mp4"), "--out", assets, "--name", "clip"]).out;
    assert.equal(prep.ok, true, JSON.stringify(prep));
    const r = prep.results[0];
    assert.equal(r.reencoded, true, "mpeg4 要转成 H.264");
    assert.ok(Math.abs(r.audio.I + 18) < 1.5 && r.audio.TP <= -1, JSON.stringify(r.audio));
    assert.ok(fs.existsSync(path.join(assets, "clip-poster.jpg")));
    const mute = runSkillScript("media.mjs", ["prepare", path.join(tmp, "quiet.mp4"), "--out", assets, "--name", "silent", "--no-audio"]).out;
    assert.equal(mute.results[0].audio, "无");

    // audit：原样放进去的几段（没处理）
    for (const f of ["loud.mp4", "quiet.mp4", "mid.mp4"]) fs.copyFileSync(path.join(tmp, f), path.join(assets, f));
    fs.writeFileSync(path.join(assets, "bgm.wav"), wav(3000));
    write("02-数据.html", '<section><video src="assets/clip.mp4" poster="assets/clip-poster.jpg"></video></section>');
    write("03-流程.html", '<section><video src="assets/quiet.mp4"></video></section>');
    write("04-响.html", '<section><video src="assets/loud.mp4"></video></section>');
    write("05-中.html", '<section><video src="assets/mid.mp4"></video></section>');
    write("06-静.html", '<section><video src="assets/quiet.mp4" muted></video></section>');
    fs.writeFileSync(path.join(dir, "playback.json"), JSON.stringify({ schemaVersion: 1, backgroundAudio: { src: "assets/bgm.wav", volume: 1 } }));
    const a = runSkillScript("media.mjs", ["audit", "--projectId", id, "--deckId", "pitch", "--dir", host.ws]).out;
    const codes = a.issues.map((x) => `${x.code}:${x.message.split("：")[0]}`);
    assert.ok(codes.includes("NEAR_SILENT:03-流程") && !codes.includes("NEAR_SILENT:06-静"), "只有底噪又没静音的报；静音的不报：" + codes);
    assert.ok(codes.includes("PEAK:04-响") && codes.includes("LOUDNESS:04-响"), codes.join(","));
    assert.ok(codes.some((c) => c.startsWith("BGM_LOUD")) && codes.some((c) => c.startsWith("NO_DUCK")), codes.join(","));
    assert.ok(a.clips.find((c) => c.file === "mid.mp4").video.startsWith("mpeg4") && codes.includes("CODEC:05-中"));
    assert.ok(!codes.some((c) => c.endsWith(":02-数据") && !c.startsWith("LOUDNESS")), "准备过的那段没有格式、破音问题：" + codes);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); host.cleanup(); }
});

test("检查（protoflow-slides/scripts/check.mjs）：真渲染；error 是超出画布、指标换行、资源加载失败、脚本报错、外部地址；重叠、小字、页里样式改到别处是 warn；正常的页没问题", async () => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id, write } = await setup(host);
    const many = Array.from({ length: 14 }, (_, i) => `<li>第 ${i + 1} 条要点，内容比较长，一行放不下就会换行</li>`).join("");
    write("04-太多.html", `<section data-layout="bullets"><h2>塞太多了</h2><ul>${many}</ul></section>`);
    write("05-压住.html", '<section data-layout="statement"><h2>标题</h2><p style="margin-top:-120px;font-size:18px">被压住的说明</p></section>');
    write("06-缺图.html", '<section><img src="assets/nope.png" alt="" style="width:400px;height:300px"></section>');
    write("07-报错.html", '<section class="p7"><h2>报错</h2><script>(() => { const page = document.currentScript.closest("section"); page.addEventListener("pf:enter", () => { throw new Error("第七页坏了"); }); })();</script></section>');
    write("08-写错.html", '<section data-layout="icon-grid"><h2>写错名字</h2><i data-icon="no-such-icon"></i></section>');
    write("09-外链.html", '<section><h2>外链</h2><img src="https://example.com/a.png" alt=""></section>');
    write("10-漏样式.html", '<section class="p10"><style>h2{letter-spacing:.1em} .p10 p{color:var(--accent)}</style><h2>全局样式</h2><p>只改本页的没事</p></section>');
    write("11-自由.html", '<section class="p11"><style>.p11{background:#fdf6ec}.p11 h2{font-size:120px;color:#e8693c}</style><h2>自由写的一页</h2></section>');
    write("12-指标换行.html", '<section class="p12" data-layout="metrics"><style>.p12 .metric strong{white-space:normal}</style><h2>目标</h2><div class="metrics"><div class="metric"><strong>7,000<br><small>万</small></strong><span>年度收入</span></div></div></section>');
    const shots = fs.mkdtempSync(path.join(os.tmpdir(), "pf-deck-shots-"));
    const r = spawnSync(process.execPath, [path.join(SLIDES_SKILL, "scripts", "check.mjs"), "--projectId", id, "--deckId", "pitch", "--dir", host.ws, "--shots", shots],
      { encoding: "utf8", env: { ...process.env, PROTOFLOW_CLI: path.join(ROOT, "bin", "protoflow-cli.js") }, timeout: 120000 });
    const out = JSON.parse(r.stdout);
    const codes = Object.fromEntries(out.slides.map((s) => [s.id, s.issues.map((x) => `${x.level}:${x.code}`)]));
    const dump = JSON.stringify(out, null, 1);
    assert.equal(r.status, 1, "有 error 退出码 1");
    for (const ok of ["01-封面", "02-数据", "11-自由"]) assert.deepEqual(codes[ok], [], `${ok} 应该没问题：${dump}`);
    assert.ok(codes["04-太多"].includes("error:OVERFLOW"), dump);
    assert.ok(codes["05-压住"].includes("warn:OVERLAP") && codes["05-压住"].includes("warn:SMALL_TEXT"), dump);
    assert.ok(codes["06-缺图"].includes("error:ASSET_FAILED"), dump);
    assert.ok(out.slides.find((s) => s.id === "07-报错").issues.some((x) => x.code === "SCRIPT_ERROR" && x.message.includes("第七页坏了")), "翻到这页才出的错算这一页的");
    assert.ok(out.deckIssues.some((x) => x.code === "SCRIPT_ERROR" && x.message.includes("no-such-icon")), "可选库写错图标名：加载时报的算整份稿子的");
    assert.ok(codes["09-外链"].includes("error:EXTERNAL"), dump);
    assert.ok(codes["12-指标换行"].includes("error:METRIC_WRAP"), dump);
    const leak = out.slides.find((s) => s.id === "10-漏样式").issues.find((x) => x.code === "STYLE_LEAK");
    assert.ok(leak && leak.level === "warn" && leak.message.includes("`h2`") && !leak.message.includes(".p10 p"), dump);
    assert.equal(fs.readdirSync(shots).filter((f) => f.endsWith(".png")).length, 12, "每页一张截图");
  } finally { host.cleanup(); }
});
