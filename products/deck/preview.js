// products/deck/preview.js — 幻灯片阅读页（本地阅读页和单 HTML 导出共用）：每页是一个 1920×1080 的画布，按窗口
// 等比缩放；←/→、空格、PageUp/PageDown 翻页，Esc 总览，T 左侧缩略图，F 全屏，地址 #<页码> 记住看到哪一页，?v=<n> 看历史版本。
// 只用 protoflow/sdk 的稳定接口。
//
// 页面约定（页面脚本和检查脚本都靠它）：
//   - 每页包在 <div class="pf-slide" data-id="<页 id>"> 里，里面就是作者写的那个 <section>，框架把它定成 1920×1080；
//     section 里面怎么排归作者（页里的样式脚本、design/ 下全稿共用的 .css .js）。
//   - 翻到一页时在它的 section 上发 pf:enter，离开时发 pf:leave（冒泡，detail 是 { index, id }）。
//   - 切页用 visibility（.active），不用 display——隐藏的页也有布局，Mermaid、字体测量都算得对。
//   - window.__pfDeck = { count, ids, current(), show(i), overview(on), filmstrip(on), setMuted(m) } 给检查脚本逐页渲染、截图、导出用。
// 头部（项目侧边栏的位置、版本下拉、分享/导出菜单）跟表格、文档阅读页同一套视觉和交互。
// 选择和标注跟绘图阅读页一样：点击选中元素，⇧/⌘ 点击加入或移出，空白处拖动框选，⌘/Ctrl+A 全选当前页，
// Esc 取消；右键「标注」（面板和复制跟表格、绘图共用 core/ui.js 的 notePanelScript，只在本地预览启用）。
import { BRAND_CSS_VARS, DIAGRAM_PALETTE, FAVICON_LINK, FULLSCREEN_CSS, ICON_NOTE, ICON_SHARE, NOTE_PANEL_CSS, exportDownloadScript, exportMenuRowsHtml, fullscreenButtonHtml, fullscreenScript, notePanelScript } from "protoflow/sdk";
import { DECK_EXPORT_MENU } from "./exportMenu.js";
import { playbackEnabled, playbackHasAudio } from "./playback.js";

// 框架的通用图形配色 → Mermaid 的 themeVariables。
const MERMAID_THEME_VARS = {
  primaryColor: DIAGRAM_PALETTE.nodeFill, primaryTextColor: DIAGRAM_PALETTE.nodeText, primaryBorderColor: DIAGRAM_PALETTE.nodeBorder,
  lineColor: DIAGRAM_PALETTE.line, secondaryColor: DIAGRAM_PALETTE.secondaryFill, tertiaryColor: DIAGRAM_PALETTE.tertiaryFill,
  fontFamily: DIAGRAM_PALETTE.fontFamily,
};

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escapeScript = (s) => String(s).replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

// opts：{ title, deckId, slides:[{ id, title, html }], playback, versions:[{ n, note, builtAt }], current, head,
//         headTags（design/ 的样式和脚本）, bodyTags（Mermaid 库）, standalone }
// 静音按钮：两个线性图标都放进去，按 aria-pressed 用 CSS 切换显示
const AUDIO_ICON_PATHS = {
  on: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  off: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6"/><path d="m21 9-5 6"/>',
};
// 控制栏的线性图标：24 格、描边、跟文字同色
const lineIcon = (d, cls = "") =>
  `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const AUDIO_ICONS = Object.entries(AUDIO_ICON_PATHS).map(([k, d]) => lineIcon(d, `pf-ico-${k}`)).join("");
// 缩略图：面状图标（左栏里四条横线），用 currentColor 填充跟其它按钮同色；总览：四宫格
const ICON_FILMSTRIP = '<svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true"><path d="M832 64a128 128 0 0 1 128 128v640a128 128 0 0 1-128 128H192a128 128 0 0 1-128-128V192a128 128 0 0 1 128-128h640zM384 128H192a64 64 0 0 0-63.552 56.512L128 192v640a64 64 0 0 0 56.512 63.552L192 896h192V128z m448 0H448v768h384a64 64 0 0 0 63.552-56.512L896 832V192a64 64 0 0 0-56.512-63.552L832 128z m-512 512v64H192v-64h128z m0-128v64H192V512h128z m0-128v64H192V384h128z m0-128v64H192V256h128z"/></svg>';
const ICON_OVERVIEW = lineIcon('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>');

export function renderDeckPageHtml(opts) {
  const { title, deckId = "", slides, playback, versions = [], current, head, headTags = "", bodyTags = "", standalone = false } = opts;
  const canPlay = playbackEnabled(playback);
  // 有背景音乐 / 旁白，或者页里有视频，就给静音按钮：默认静音，要靠它打开声音
  const hasAudio = playbackHasAudio(playback) || slides.some((s) => /<video\b/i.test(s.html));
  const local = !standalone; // 标注只在本地预览启用（复制出去的文本要指向项目里的源文件）
  const shareBtn = standalone ? "" : `<div class="pf-export-entry">
    <button class="pf-hdr-share" type="button" title="分享">${ICON_SHARE}<span class="pf-export-label">分享</span></button>
    <div class="pf-export-menu" hidden><div class="pf-export-menu__section">导出</div>${exportMenuRowsHtml(DECK_EXPORT_MENU)}</div>
  </div>`;
  const sections = slides.map((s) => `<div class="pf-slide" data-id="${esc(s.id)}" aria-label="${esc(s.title)}">\n${s.html}\n</div>`).join("\n");
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
${FAVICON_LINK}
<title>${esc(title)} · protoflow 幻灯片</title>
<style>
${BRAND_CSS_VARS}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;display:flex;flex-direction:column;background:#f6f7fb;color:#0f172a;font-family:"PingFang SC","Microsoft YaHei",-apple-system,sans-serif}
.pf-hdr{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;height:40px;padding:0 12px 0 8px;background:#fff;border-bottom:1px solid #e9ebef;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.pf-hdr-l,.pf-hdr-r{display:flex;align-items:center;gap:4px;min-width:0}
.pf-vsel{position:relative;font-size:12px}
.pf-vsel-btn{display:inline-flex;align-items:center;gap:5px;max-width:60vw;height:26px;padding:0 5px 0 7px;font:inherit;color:rgba(15,23,42,.75);background:transparent;border:0;border-radius:6px;cursor:pointer}
.pf-vsel-btn:hover,.pf-vsel-btn[aria-expanded="true"]{background:rgba(15,23,42,.06)}
.pf-vsel-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:#0f172a}
.pf-vsel-badge{flex:none;border-radius:999px;background:rgba(15,23,42,.06);color:#8a919c;padding:1px 6px;font-size:10.5px;line-height:1.4}
.pf-vsel-chev{width:11px;height:11px;flex:none;opacity:.45}
.pf-vsel-menu{position:absolute;left:0;top:calc(100% + 4px);width:250px;background:#fff;border:1px solid #e9ebef;border-radius:10px;box-shadow:0 8px 26px rgba(15,23,42,.12);padding:4px;z-index:60;max-height:62vh;overflow:auto}
.pf-vsel-menu[hidden]{display:none}
.pf-vsel-item{display:block;padding:7px 9px;border-radius:6px;text-decoration:none}
.pf-vsel-item:hover{background:#f6f7f9}
.pf-vsel-item.active{background:#f1f3f5}
.pf-vsel-item .t{display:block;font-size:12px;font-weight:500;color:#1a1d21;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-vsel-item .s{display:block;font-size:11px;color:#9aa1ab;margin-top:2px}
.pf-export-entry{position:relative}
.pf-hdr-share{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;font:12px -apple-system,"PingFang SC",sans-serif;color:rgba(15,23,42,.75);background:transparent;border:0;border-radius:6px;cursor:pointer}
.pf-hdr-share:hover{background:rgba(15,23,42,.06)}
.pf-hdr-share:disabled{opacity:.5;cursor:default}
.pf-export-menu{position:absolute;right:0;top:calc(100% + 8px);min-width:440px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:6px;z-index:60}
.pf-export-menu[hidden]{display:none}
.pf-export-menu__section{padding:8px 9px 4px;font-size:11px;font-weight:600;color:#94a3b8}
.pf-export-menu__item{display:flex;align-items:center;gap:12px;width:100%;padding:8px 9px;border:none;background:none;border-radius:9px;cursor:pointer;font-family:inherit;text-align:left}
.pf-export-menu__item:hover{background:#f8fafc}
.pf-export-menu__item svg{flex:none;width:28px;height:28px;padding:6px;border-radius:7px;background:#f1f5f9;color:#475569}
.pf-export-menu__body{flex:1;min-width:0;display:flex;flex-direction:column}
.pf-export-menu__body b{font-size:13px;font-weight:600;color:#0f172a}
.pf-export-menu__body span{font-size:11.5px;color:#94a3b8;margin-top:2px}
.pf-export-menu__action{flex:none;font-size:11.5px;color:#94a3b8}
.pf-stage{position:relative;flex:1;min-height:0;overflow:auto;user-select:none;-webkit-user-select:none}
.pf-sel{position:absolute;inset:0;pointer-events:none;z-index:4}
.pf-sel div{position:absolute;border:2px solid #3b73d1;background:rgba(59,115,209,.075);border-radius:4px}
.pf-sel .pf-sel-hover{border:1px dashed rgba(59,115,209,.7);background:none}
.pf-marquee{position:absolute;z-index:5;border:1px solid #3b73d1;background:rgba(59,115,209,.08);pointer-events:none}
.pf-marquee[hidden]{display:none}
html.pf-overview .pf-sel,html.pf-overview .pf-marquee,:fullscreen .pf-sel{display:none}
.pf-sizer{position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none}
html.pf-overview .pf-sizer,html.pf-print .pf-sizer,html.pf-capture .pf-sizer{display:none}
.pf-deck{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0}
.pf-slide{position:absolute;inset:0;visibility:hidden;overflow:hidden;background:#fff;box-shadow:0 2px 16px rgba(15,23,42,.10)}
.pf-slide.active{visibility:visible}
.pf-slide>section{position:relative;width:1920px;height:1080px;margin:0;box-sizing:border-box;overflow:hidden}
.pf-embed-slot{max-width:100%}
.pf-embed{display:flex;flex-direction:column;gap:8px;padding:28px 36px;border:3px dashed #cbd5e1;border-radius:16px;color:#475569;font-size:30px}
.pf-embed__title{font-weight:600;color:var(--pf-brand)}
.pf-ctrl{position:relative;flex:none;display:flex;align-items:center;justify-content:center;gap:8px;height:44px;font:12px -apple-system,"PingFang SC",sans-serif;color:#64748b}
.pf-ctrl button{min-width:30px;height:28px;border:0;border-radius:6px;background:transparent;color:#475569;cursor:pointer;font-size:14px}
.pf-ctrl button:hover{background:rgba(15,23,42,.06)}
.pf-ctrl button:disabled{opacity:.35;cursor:default}
.pf-ctrl .pf-play{font-size:12px;min-width:58px;padding:0 9px}
.pf-ctrl .pf-ico-btn{display:inline-flex;align-items:center;justify-content:center}
.pf-ico-btn svg{width:16px;height:16px}
.pf-audio .pf-ico-off,.pf-audio[aria-pressed="true"] .pf-ico-on{display:none}
.pf-audio[aria-pressed="true"] .pf-ico-off{display:block}
.pf-count-wrap{position:relative}
.pf-zoom{position:absolute;right:12px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:1px}
.pf-ctrl .pf-zoom__step{min-width:26px;height:26px;padding:0;font-size:18px;line-height:1;color:#667085}
.pf-ctrl .pf-zoom__label{min-width:48px;height:26px;padding:0 6px;font-size:12px;color:#475569;font-variant-numeric:tabular-nums}
.pf-ctrl .pf-zoom__label[aria-expanded="true"]{background:rgba(15,23,42,.06)}
.pf-zoom__menu{position:absolute;right:0;bottom:calc(100% + 8px);min-width:168px;display:flex;flex-direction:column;gap:1px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 4px 16px rgba(15,23,42,.12);padding:4px;z-index:60}
.pf-zoom__menu[hidden]{display:none}
.pf-ctrl .pf-zoom__menu button{height:auto;text-align:left;padding:7px 10px;font-size:13px;color:#334155}
.pf-ctrl .pf-zoom__menu button:hover{background:#f1f5f9}
html.pf-overview .pf-zoom{visibility:hidden}
.pf-ctrl .pf-count{min-width:64px;padding:0 8px;font:inherit;color:inherit;text-align:center;font-variant-numeric:tabular-nums}
.pf-ctrl .pf-count[aria-expanded="true"],.pf-ctrl #pfFilm[aria-pressed="true"]{background:rgba(15,23,42,.06)}
.pf-pagemenu{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);width:280px;max-height:62vh;overflow:auto;background:#fff;border:1px solid #e9ebef;border-radius:10px;box-shadow:0 8px 26px rgba(15,23,42,.12);padding:4px;z-index:60}
.pf-pagemenu[hidden]{display:none}
.pf-ctrl .pf-pagemenu-item{display:grid;grid-template-columns:28px 1fr;align-items:center;gap:6px;width:100%;height:auto;padding:7px 9px;border-radius:6px;font-size:12px;color:#1a1d21;text-align:left}
.pf-ctrl .pf-pagemenu-item:hover{background:#f6f7f9}
.pf-ctrl .pf-pagemenu-item.active{background:#f1f3f5;font-weight:600}
.pf-pagemenu-item .n{color:#9aa1ab;font-variant-numeric:tabular-nums;text-align:right}
.pf-pagemenu-item .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-thumbs{display:none;position:fixed;z-index:45;top:40px;bottom:44px;width:286px;padding:12px 10px;background:#f1f2f4;border-right:1px solid #dfe2e6;overflow:auto;overscroll-behavior:contain}
html.pf-filmstrip .pf-thumbs{display:block}
html.pf-filmstrip .pf-stage{margin-left:286px}
.pf-thumb{display:grid;grid-template-columns:28px 1fr;align-items:start;gap:8px;width:100%;margin:0 0 10px;padding:5px;border:0;border-radius:9px;background:transparent;color:#60656f;font:12px -apple-system,"PingFang SC",sans-serif;text-align:left;cursor:pointer}
.pf-thumb:hover{background:rgba(15,23,42,.055)}
.pf-thumb:focus-visible{outline:2px solid var(--pf-brand);outline-offset:1px}
.pf-thumb[aria-current="true"]{color:#0f172a;font-weight:600}
.pf-thumb[aria-current="true"] .pf-thumb-frame{border-radius:6px;box-shadow:0 0 0 3px var(--pf-brand),0 2px 8px rgba(15,23,42,.16)}
.pf-thumb-num{padding-top:3px;text-align:center;font-variant-numeric:tabular-nums}
.pf-thumb-frame{position:relative;width:224px;height:126px;overflow:hidden;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.16)}
.pf-thumb-canvas{position:absolute;left:0;top:0;width:1920px;height:1080px;transform:scale(.116666667);transform-origin:0 0;pointer-events:none}
.pf-thumb-canvas>section{width:1920px;height:1080px;margin:0;overflow:hidden}
html.pf-filmstrip .pf-thumb-canvas *,html.pf-filmstrip .pf-thumb-canvas *::before,html.pf-filmstrip .pf-thumb-canvas *::after{animation:none!important;transition:none!important}
html.pf-overview .pf-stage{overflow:auto}
html.pf-overview .pf-deck{position:static;transform:none!important;width:auto;height:auto;display:grid;grid-template-columns:repeat(auto-fill,346px);gap:28px;justify-content:center;padding:28px}
html.pf-overview .pf-slide{position:relative;inset:auto;visibility:visible;width:1920px;height:1080px;zoom:.18;cursor:pointer;border-radius:20px}
html.pf-overview .pf-slide.active{outline:14px solid var(--pf-brand)}
:fullscreen .pf-stage{background:#000}
/* 打印排版（导出 PDF 时切过去）：每页一张 1920×1080，不要头部、底栏、阴影 */
@page{size:1920px 1080px;margin:0}
html.pf-print,html.pf-print body{height:auto;background:#fff;display:block}
html.pf-print .pf-hdr,html.pf-print .pf-ctrl,html.pf-print .pf-thumbs{display:none}
html.pf-print .pf-stage{overflow:visible}
html.pf-print .pf-deck{position:static;transform:none!important;width:1920px;height:auto}
html.pf-print .pf-slide{position:relative;inset:auto;visibility:visible;width:1920px;height:1080px;box-shadow:none;break-after:page}
html.pf-print .pf-slide:last-child{break-after:auto}
/* 只打印幻灯片区域：Mermaid 等库渲染时会往 body 末尾塞临时元素，不排除会多出一张空白页 */
html.pf-print body>:not(.pf-stage){display:none!important}
/* 录视频排版（导出 MP4 时切过去）：当前页铺满 1920×1080 视口，不要头部、底栏、阴影 */
html.pf-capture .pf-hdr,html.pf-capture .pf-ctrl,html.pf-capture .pf-thumbs{display:none}
html.pf-capture .pf-stage{position:fixed;inset:0;overflow:hidden;background:#fff}
html.pf-capture .pf-deck{left:0!important;top:0!important;transform:none!important}
html.pf-capture .pf-slide{box-shadow:none}
html.pf-capture body>:not(.pf-stage){display:none!important}
:fullscreen .pf-slide{box-shadow:none}
${local ? NOTE_PANEL_CSS : ""}
${FULLSCREEN_CSS}
</style>
${headTags}
</head>
<body>
<header class="pf-hdr" data-pf-chrome>
  <div class="pf-hdr-l"><span data-pf-nav-slot></span><div id="pfDeckBar"></div></div>
  <div class="pf-hdr-r">${fullscreenButtonHtml()}${shareBtn}</div>
</header>
<aside class="pf-thumbs" id="pfThumbs" aria-label="幻灯片缩略图"></aside>
<main class="pf-stage" id="pfStage"><div class="pf-sizer" id="pfSizer"></div><div class="pf-deck" id="pfDeck">
${sections}
</div><div class="pf-sel" id="pfSel"></div><div class="pf-marquee" id="pfMarquee" hidden></div></main>
<nav class="pf-ctrl" data-pf-chrome>
  <button type="button" id="pfPrev" title="上一页（←）">‹</button>
  ${canPlay ? '<button type="button" id="pfPlay" class="pf-play" title="开始放映（P）" aria-pressed="false">▶ 播放</button>' : ""}
  <div class="pf-count-wrap"><button type="button" class="pf-count" id="pfCount" title="跳到指定页" aria-haspopup="true" aria-expanded="false"></button><div class="pf-pagemenu" id="pfPageMenu" role="menu" hidden></div></div>
  <button type="button" id="pfNext" title="下一页（→）">›</button>
  ${hasAudio ? '<button type="button" id="pfAudio" class="pf-ico-btn pf-audio" title="取消静音（M）" aria-pressed="true">' + AUDIO_ICONS + '</button>' : ""}
  <button type="button" id="pfFilm" class="pf-ico-btn" title="左侧缩略图（T）" aria-pressed="false">${ICON_FILMSTRIP}</button>
  <button type="button" id="pfGrid" class="pf-ico-btn" title="总览（Esc）">${ICON_OVERVIEW}</button>
  <div class="pf-zoom">
    <button type="button" id="pfZoomOut" class="pf-zoom__step" title="缩小" aria-label="缩小">−</button>
    <button type="button" id="pfZoomLabel" class="pf-zoom__label" title="缩放" aria-expanded="false">100%</button>
    <button type="button" id="pfZoomIn" class="pf-zoom__step" title="放大" aria-label="放大">＋</button>
    <div class="pf-zoom__menu" id="pfZoomMenu" hidden>
      <button type="button" id="pfZoomReset">缩放至 100%</button>
      <button type="button" id="pfZoomFit">自适应窗口</button>
    </div>
  </div>
</nav>
${bodyTags}
<script>
var __PF_DECK__ = ${escapeScript(JSON.stringify({ title, deckId, local, versions, current, head, playback, mermaidVars: MERMAID_THEME_VARS }))};
${appScript()}
<\/script>
${local ? `<script>${notePanelScript()}<\/script>` : ""}
<script>${fullscreenScript()}<\/script>
${standalone ? "" : `<script>${shareScript()}<\/script>`}
</body></html>`;
}

function appScript() {
  return `(function(){
  var D = __PF_DECK__;
  var stage = document.getElementById("pfStage"), deck = document.getElementById("pfDeck");
  var slides = Array.prototype.slice.call(deck.querySelectorAll(".pf-slide"));
  var count = document.getElementById("pfCount"), prev = document.getElementById("pfPrev"), next = document.getElementById("pfNext");
  var playBtn = document.getElementById("pfPlay"), audioBtn = document.getElementById("pfAudio");
  var filmBtn = document.getElementById("pfFilm"), thumbs = document.getElementById("pfThumbs");
  var playback = D.playback || { autoAdvance: { enabled: false, defaultDurationMs: 8000, loop: false }, slides: {} };
  var cur = 0;
  // 有静音按钮就默认静音：没人操作过页面时浏览器不让有声的媒体自动播，与其先试、被拦了再悄悄静音
  // （按钮却还显示有声），不如一开始就静音，点静音按钮或「播放」再出声——点击本身就让浏览器放行。
  var playing = false, muted = !!audioBtn, timer = null, timerDue = 0, remainingMs = null;
  var activePlaybackSlide = -1, advanceMode = "manual", narration = null, background = null;
  // 页里的 <video> 由阅读页统一管：所有页一直在 DOM 里（隐藏页只是 visibility:hidden），不接管的话 autoplay
  // 的视频会在看不见的页里一起响。所以 autoplay 改成标记，只在进到那一页时从头播；翻走就暂停。
  slides.forEach(function(el){ el.querySelectorAll("video").forEach(function(v){
    if (v.hasAttribute("autoplay")) { v.removeAttribute("autoplay"); v.setAttribute("data-pf-autoplay", ""); }
    v.pause(); v.muted = muted || v.defaultMuted;
  }); });
  var watched = null;  // 放映中 video-ended 页在等的那个视频：{ v, ended, error, fallbackMs, resume }
  function slideVideos(i){ return slides[i] ? Array.prototype.slice.call(slides[i].querySelectorAll("video")) : []; }
  function pauseVideos(except){ slides.forEach(function(el, k){ if (k !== except) slideVideos(k).forEach(function(v){ if (!v.paused) v.pause(); }); }); }
  function autoOn(){ return !!(playback.autoAdvance && playback.autoAdvance.enabled); }
  function unwatchVideo(){
    if (!watched) return;
    watched.v.removeEventListener("ended", watched.ended); watched.v.removeEventListener("error", watched.error);
    watched = null;
  }
  function watchVideo(v, fallbackMs){
    unwatchVideo();
    var w = { v: v, fallbackMs: fallbackMs, resume: false };
    w.ended = function(){ if (watched === w && playing && autoOn()) advance(); };
    w.error = function(){ if (watched === w && playing && autoOn()) scheduleAdvance(fallbackMs); };
    v.addEventListener("ended", w.ended); v.addEventListener("error", w.error);
    watched = w;
    return w;
  }
  function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  // 缩放：默认自适应窗口，跟着舞台大小走；放大缩小后记成绝对比例（100% = 1920×1080 原尺寸），比舞台大就滚动着看。
  // 全屏是放映，始终自适应。
  var ZOOM_MIN = 0.1, ZOOM_MAX = 4, userZoom = null, scale = 1;
  var sizer = document.getElementById("pfSizer"), zoomLabel = document.getElementById("pfZoomLabel"), zoomMenu = document.getElementById("pfZoomMenu");
  function fit(){
    var fs = document.documentElement.classList.contains("pf-fs");
    // 全屏时铺满屏幕，平时四周留一点边
    var fitScale = Math.min(stage.clientWidth / 1920, stage.clientHeight / 1080) * (fs ? 1 : 0.94);
    scale = fs || userZoom == null ? fitScale : userZoom;
    // 比舞台小就居中，比舞台大就从左上角铺开（居中的负偏移滚不到）
    deck.style.left = Math.max(0, (stage.clientWidth - 1920 * scale) / 2) + "px";
    deck.style.top = Math.max(0, (stage.clientHeight - 1080 * scale) / 2) + "px";
    deck.style.transform = "scale(" + scale + ")";
    // 滚动范围用一个按缩放后尺寸撑开的占位块给出：transform 撑出的滚动范围浏览器更新得不及时，紧接着设滚动位置会被旧范围截断
    sizer.style.width = Math.max(stage.clientWidth, 1920 * scale) + "px";
    sizer.style.height = Math.max(stage.clientHeight, 1080 * scale) + "px";
    zoomLabel.textContent = Math.round(scale * 100) + "%";
    drawSelection();
  }
  // 以舞台上的 (clientX, clientY) 为锚点缩放，锚点下的内容不动；不给锚点就用舞台中心
  function zoomTo(next, clientX, clientY){
    next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    var r = stage.getBoundingClientRect();
    var px = clientX == null ? stage.clientWidth / 2 : clientX - r.left, py = clientY == null ? stage.clientHeight / 2 : clientY - r.top;
    var u = (stage.scrollLeft + px - parseFloat(deck.style.left)) / scale, v = (stage.scrollTop + py - parseFloat(deck.style.top)) / scale;
    userZoom = next; fit();
    stage.scrollLeft = parseFloat(deck.style.left) + u * scale - px;
    stage.scrollTop = parseFloat(deck.style.top) + v * scale - py;
  }
  function zoomFit(){ userZoom = null; fit(); stage.scrollLeft = 0; stage.scrollTop = 0; }
  function zoomMenuOpen(o){ zoomMenu.hidden = !o; zoomLabel.setAttribute("aria-expanded", o ? "true" : "false"); }
  function updatePlaybackButtons(){
    if (playBtn) {
      playBtn.textContent = playing ? "Ⅱ 暂停" : "▶ 播放";
      playBtn.title = playing ? "暂停放映（P）" : "开始放映（P）";
      playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
    }
    if (audioBtn) {
      audioBtn.title = muted ? "取消静音（M）" : "静音（M）";
      audioBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    }
  }
  function slidePlayback(i){
    var id = slides[i] && slides[i].getAttribute("data-id");
    return playback.slides && playback.slides[id] || {};
  }
  function clearAdvance(keepRemaining){
    if (timer) {
      if (keepRemaining) remainingMs = Math.max(0, timerDue - Date.now());
      clearTimeout(timer);
    }
    timer = null; timerDue = 0;
    if (!keepRemaining) remainingMs = null;
  }
  function scheduleAdvance(ms){
    clearAdvance(false);
    remainingMs = Math.max(0, Number(ms) || 0);
    timerDue = Date.now() + remainingMs;
    timer = setTimeout(function(){ timer = null; timerDue = 0; remainingMs = null; advance(); }, remainingMs);
  }
  function stopNarration(){
    if (!narration) return;
    narration.onended = null; narration.onerror = null;
    narration.pause();
    try { narration.currentTime = 0; } catch (_e) {}
    narration = null;
  }
  function leavePlaybackSlide(){
    clearAdvance(false);
    stopNarration();
    unwatchVideo();
    activePlaybackSlide = -1;
    advanceMode = "manual";
  }
  function media(cfg){
    var a = new Audio(cfg.src);
    a.preload = "auto"; a.volume = cfg.volume; a.muted = muted;
    ["play", "pause", "ended"].forEach(function(t){ a.addEventListener(t, updateDuck); });
    return a;
  }
  // 背景音乐避让：playback.json 给 backgroundAudio 写了 duckVolume 时，当前页的旁白或有声视频在响，背景音乐
  // 渐变压到这个音量，停了再渐变回去。没写就不避让。渐变用定时器不用 rAF：后台标签页里 rAF 不跑。
  var duckTimer = null, duckTarget = null;
  function foregroundSounding(){
    if (narration && !narration.paused && !narration.ended) return true;
    return slideVideos(cur).some(function(v){ return !v.paused && !v.ended && !v.muted && v.volume > 0; });
  }
  function updateDuck(){
    var cfg = playback.backgroundAudio;
    if (!background || !cfg || cfg.duckVolume == null) return;
    var target = foregroundSounding() ? cfg.duckVolume : cfg.volume;
    if (target === duckTarget) return;
    duckTarget = target;
    if (duckTimer) clearInterval(duckTimer);
    var from = background.volume, step = 0, STEPS = 10;
    duckTimer = setInterval(function(){
      step++; background.volume = Math.max(0, Math.min(1, from + (target - from) * step / STEPS));
      if (step >= STEPS) { clearInterval(duckTimer); duckTimer = null; }
    }, 30);
  }
  slides.forEach(function(el, k){ slideVideos(k).forEach(function(v){
    ["play", "pause", "ended", "volumechange"].forEach(function(t){ v.addEventListener(t, updateDuck); });
  }); });
  function playMedia(a, rejected){
    var p;
    try { p = a.play(); } catch (_e) { if (rejected) rejected(); return; }
    if (p && p.catch) p.catch(function(){ if (rejected) rejected(); });
  }
  function finishPlayback(){
    playing = false;
    if (background) background.pause();
    leavePlaybackSlide();
    updatePlaybackButtons();
  }
  function advance(){
    if (!playing) return;
    if (cur < slides.length - 1) show(cur + 1);
    else if (playback.autoAdvance && playback.autoAdvance.loop) show(0);
    else finishPlayback();
  }
  function enterPlaybackSlide(){
    leavePlaybackSlide();
    activePlaybackSlide = cur;
    var slideToken = cur;
    var cfg = slidePlayback(cur);
    var auto = playback.autoAdvance || {};
    var rule = cfg.advance || (auto.enabled ? { on: "timer", durationMs: auto.defaultDurationMs } : { on: "manual" });
    advanceMode = rule.on || "manual";
    if (cfg.audio) {
      narration = media(cfg.audio);
      var currentNarration = narration;
      function stillCurrent(){ return narration === currentNarration && activePlaybackSlide === slideToken && cur === slideToken; }
      narration.onended = function(){ if (stillCurrent() && playing && auto.enabled && advanceMode === "audio-ended") advance(); };
      narration.onerror = function(){ if (stillCurrent() && playing && auto.enabled && advanceMode === "audio-ended") scheduleAdvance(rule.fallbackMs || auto.defaultDurationMs || 8000); };
      playMedia(narration, function(){ if (stillCurrent() && playing && auto.enabled && advanceMode === "audio-ended") scheduleAdvance(rule.fallbackMs || auto.defaultDurationMs || 8000); });
    }
    if (auto.enabled && advanceMode === "timer") scheduleAdvance(rule.durationMs || auto.defaultDurationMs || 8000);
    // 等这一页第一个视频放完；没有视频或放不了按 fallbackMs 继续
    if (advanceMode === "video-ended") {
      var fallbackMs = rule.fallbackMs || auto.defaultDurationMs || 8000;
      var v = slideVideos(cur)[0];
      if (!v) { if (auto.enabled) scheduleAdvance(fallbackMs); }
      else {
        var w = watchVideo(v, fallbackMs);
        if (v.paused || v.ended) {
          try { v.currentTime = 0; } catch (_e) {}
          playMedia(v, function(){ if (watched === w && playing && auto.enabled) scheduleAdvance(fallbackMs); });
        }
      }
    }
  }
  function playPlayback(){
    if (playing) return;
    playing = true;
    if (playback.backgroundAudio) {
      if (!background) { background = media(playback.backgroundAudio); background.loop = !!playback.backgroundAudio.loop; }
      playMedia(background);
      duckTarget = null; updateDuck();
    }
    if (activePlaybackSlide === cur) {
      if (narration) {
        var resumedNarration = narration, resumedSlide = cur, resumeHasFallback = remainingMs != null;
        playMedia(narration, function(){
          var r = slidePlayback(resumedSlide).advance || {};
          if (!resumeHasFallback && narration === resumedNarration && activePlaybackSlide === resumedSlide && cur === resumedSlide && playing && playback.autoAdvance && playback.autoAdvance.enabled && advanceMode === "audio-ended") scheduleAdvance(r.fallbackMs || playback.autoAdvance.defaultDurationMs || 8000);
        });
      }
      if (watched && watched.resume) {
        var resumed = watched, resumeHadFallback = remainingMs != null;
        resumed.resume = false;
        playMedia(resumed.v, function(){ if (!resumeHadFallback && watched === resumed && playing && autoOn()) scheduleAdvance(resumed.fallbackMs); });
      }
      if (remainingMs != null) scheduleAdvance(remainingMs);
    } else enterPlaybackSlide();
    updatePlaybackButtons();
  }
  function pausePlayback(){
    if (!playing) return;
    playing = false;
    if (background) background.pause();
    if (narration) narration.pause();
    if (watched && !watched.v.paused) { watched.v.pause(); watched.resume = true; }
    clearAdvance(true);
    updatePlaybackButtons();
  }
  // 用户点「播放」就是要开始放映，顺带打开声音
  function togglePlayback(){
    if (playing) { pausePlayback(); return; }
    if (muted && audioBtn) setMuted(false);
    playPlayback();
  }
  function setMuted(m){
    muted = m;
    if (background) background.muted = muted;
    if (narration) narration.muted = muted;
    slides.forEach(function(el, k){ slideVideos(k).forEach(function(v){ v.muted = muted || v.defaultMuted; }); });
    updatePlaybackButtons();
  }
  function toggleMute(){ setMuted(!muted); }
  // 放映生命周期：离开的那页根节点上发 pf:leave，翻到的那页发 pf:enter（冒泡；detail 是 { index, id }）。
  // 页面和 design/ 的脚本靠它做进场动画、开始 / 停止交互，不用自己盯 .active。
  function lifecycle(el, type){
    var root = el && el.firstElementChild;
    if (!root) return;
    try { root.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: { index: slides.indexOf(el), id: el.getAttribute("data-id") } })); }
    catch (e) { setTimeout(function(){ throw e; }); }
  }
  function show(i, push){
    var target = Math.max(0, Math.min(slides.length - 1, i));
    if (target === cur && slides[cur] && slides[cur].classList.contains("active")) return;
    leavePlaybackSlide();
    var left = slides[cur] && slides[cur].classList.contains("active") ? slides[cur] : null;
    cur = target;
    clearSelection();
    slides.forEach(function(el, k){ el.classList.toggle("active", k === cur); });
    lifecycle(left, "pf:leave");
    lifecycle(slides[cur], "pf:enter");
    count.textContent = (cur + 1) + " / " + slides.length;
    pageMenuOpen(false);
    prev.disabled = cur === 0; next.disabled = cur === slides.length - 1;
    if (push !== false) history.replaceState(null, "", location.pathname + location.search + "#" + (cur + 1));
    syncFilmstrip();
    pauseVideos(cur);
    if (!document.documentElement.classList.contains("pf-overview")) slideVideos(cur).forEach(function(v){
      if (!v.hasAttribute("data-pf-autoplay")) return;
      try { v.currentTime = 0; } catch (_e) {}
      v.muted = muted || v.defaultMuted; // 上次被拦后退成的静音不带到这次
      // 兜底：没有静音按钮（视频是脚本后加的）又被浏览器拦了有声自动播，就退一步静音播，画面照样动
      playMedia(v, function(){ if (!v.muted) { v.muted = true; playMedia(v); } });
    });
    if (playing) enterPlaybackSlide();
  }
  function replaceUrlIds(value, idMap){
    return String(value).replace(/url\\(\\s*(["']?)#([^\\s)'"]+)\\1\\s*\\)/g, function(all, quote, id){ return idMap[id] ? "url(" + quote + "#" + idMap[id] + quote + ")" : all; });
  }
  function scopeCloneIds(root, prefix){
    var idMap = {};
    var nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll("[id]")));
    nodes.forEach(function(el){ var id = el.getAttribute && el.getAttribute("id"); if (id) idMap[id] = prefix + id; });
    nodes.forEach(function(el){ var id = el.getAttribute && el.getAttribute("id"); if (id) el.setAttribute("id", idMap[id]); });
    var idRefs = { "for": 1, "aria-activedescendant": 1, "aria-controls": 1, "aria-describedby": 1, "aria-details": 1, "aria-errormessage": 1, "aria-flowto": 1, "aria-labelledby": 1, "aria-owns": 1, "headers": 1 };
    [root].concat(Array.prototype.slice.call(root.querySelectorAll("*"))).forEach(function(el){
      Array.prototype.slice.call(el.attributes || []).forEach(function(attr){
        var value = replaceUrlIds(attr.value, idMap);
        if ((attr.name === "href" || attr.name === "xlink:href") && value.charAt(0) === "#" && idMap[value.slice(1)]) value = "#" + idMap[value.slice(1)];
        if (idRefs[attr.name]) value = value.split(/\\s+/).map(function(id){ return idMap[id] || id; }).join(" ");
        if (value !== attr.value) el.setAttribute(attr.name, value);
      });
    });
    return idMap;
  }
  function rewriteCloneStyles(root, idMap){
    function regexEscape(value){ return String(value).replace(/[^a-zA-Z0-9_]/g, function(ch){ return "\\\\" + ch; }); }
    var entries = Object.keys(idMap).sort(function(a, b){ return b.length - a.length; }).map(function(id){
      var escaped = window.CSS && CSS.escape ? CSS.escape(id) : regexEscape(id);
      var next = window.CSS && CSS.escape ? CSS.escape(idMap[id]) : regexEscape(idMap[id]);
      return [new RegExp("#" + regexEscape(escaped) + "(?![a-zA-Z0-9_-])", "g"), "#" + next];
    });
    function rules(list){
      Array.prototype.forEach.call(list || [], function(rule){
        if (typeof rule.selectorText === "string") {
          var selector = rule.selectorText; entries.forEach(function(pair){ selector = selector.replace(pair[0], pair[1]); });
          try { rule.selectorText = selector; } catch (_e) {}
        }
        if (rule.style) Array.prototype.forEach.call(rule.style, function(name){ var value = rule.style.getPropertyValue(name), next = replaceUrlIds(value, idMap); if (next !== value) rule.style.setProperty(name, next, rule.style.getPropertyPriority(name)); });
        if (rule.cssRules) rules(rule.cssRules);
      });
    }
    root.querySelectorAll("style").forEach(function(style){ try { rules(style.sheet && style.sheet.cssRules); } catch (_e) {} });
  }
  function renderFilmstrip(){
    thumbs.textContent = "";
    slides.forEach(function(slide, k){
      var button = document.createElement("div"); button.className = "pf-thumb"; button.setAttribute("role", "button"); button.tabIndex = 0; button.setAttribute("data-index", String(k)); button.setAttribute("aria-label", "第 " + (k + 1) + " 页：" + (slide.getAttribute("aria-label") || ""));
      var num = document.createElement("span"); num.className = "pf-thumb-num"; num.textContent = String(k + 1);
      var frame = document.createElement("div"); frame.className = "pf-thumb-frame";
      var canvas = document.createElement("div"); canvas.className = "pf-thumb-canvas"; canvas.setAttribute("aria-hidden", "true");
      var content = slide.firstElementChild && slide.firstElementChild.cloneNode(true);
      // 缩略图里的视频只留封面（poster），不加载、不播放
      if (content) content.querySelectorAll("video").forEach(function(v){
        v.removeAttribute("data-pf-autoplay"); v.removeAttribute("controls"); v.preload = "none"; v.muted = true;
      });
      var idMap = content ? scopeCloneIds(content, "pf-thumb-" + k + "-") : {};
      if (content) canvas.appendChild(content);
      frame.appendChild(canvas); button.appendChild(num); button.appendChild(frame);
      button.addEventListener("click", function(){ show(k); });
      button.addEventListener("keydown", function(e){ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); show(k); } });
      thumbs.appendChild(button);
      if (content) rewriteCloneStyles(content, idMap);
    });
    syncFilmstrip();
  }
  function syncFilmstrip(){
    var buttons = thumbs.querySelectorAll(".pf-thumb");
    buttons.forEach(function(button, k){ button.setAttribute("aria-current", k === cur ? "true" : "false"); });
    if (document.documentElement.classList.contains("pf-filmstrip") && buttons[cur]) buttons[cur].scrollIntoView({ block: "nearest" });
  }
  function filmstrip(on){
    if (on) {
      pausePlayback();
      document.documentElement.classList.remove("pf-overview");
      renderFilmstrip();
    }
    document.documentElement.classList.toggle("pf-filmstrip", !!on);
    filmBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) syncFilmstrip();
    fit();
  }
  // 总览：全部页缩成网格，点一页回到放映
  function overview(on){
    if (on) { pausePlayback(); filmstrip(false); pauseVideos(-1); clearSelection(); }
    document.documentElement.classList.toggle("pf-overview", on);
    if (on) { var a = slides[cur]; if (a) a.scrollIntoView({ block: "center" }); } else fit();
  }
  slides.forEach(function(el, k){ el.addEventListener("click", function(){ if (document.documentElement.classList.contains("pf-overview")) { overview(false); show(k); } }); });
  filmBtn.addEventListener("click", function(){ filmstrip(!document.documentElement.classList.contains("pf-filmstrip")); });
  document.getElementById("pfGrid").addEventListener("click", function(){ overview(!document.documentElement.classList.contains("pf-overview")); });
  document.getElementById("pfZoomIn").addEventListener("click", function(){ zoomTo(scale * 1.2); });
  document.getElementById("pfZoomOut").addEventListener("click", function(){ zoomTo(scale / 1.2); });
  document.getElementById("pfZoomReset").addEventListener("click", function(){ zoomMenuOpen(false); zoomTo(1); });
  document.getElementById("pfZoomFit").addEventListener("click", function(){ zoomMenuOpen(false); zoomFit(); });
  zoomLabel.addEventListener("click", function(e){ e.stopPropagation(); zoomMenuOpen(zoomMenu.hidden); });
  document.addEventListener("click", function(e){ if (!zoomMenu.hidden && !zoomMenu.contains(e.target) && e.target !== zoomLabel) zoomMenuOpen(false); });
  // 触控板捏合（浏览器发成 Ctrl+滚轮）、⌘/Ctrl+滚轮、Safari 的 gesture 事件：以指针为锚点缩放。普通滚轮照常滚动。
  function zoomable(){ return !document.documentElement.classList.contains("pf-overview") && !document.documentElement.classList.contains("pf-fs"); }
  stage.addEventListener("wheel", function(e){
    if (!(e.ctrlKey || e.metaKey) || !zoomable()) return;
    e.preventDefault(); zoomTo(scale * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
  }, { passive: false });
  var gestureBase = 1;
  stage.addEventListener("gesturestart", function(e){ if (!zoomable()) return; e.preventDefault(); gestureBase = scale; });
  stage.addEventListener("gesturechange", function(e){ if (!zoomable()) return; e.preventDefault(); zoomTo(gestureBase * e.scale, e.clientX, e.clientY); });
  stage.addEventListener("gestureend", function(e){ if (zoomable()) e.preventDefault(); });
  window.__pfDeck = {
    count: slides.length,
    ids: slides.map(function(el){ return el.getAttribute("data-id"); }),
    current: function(){ return cur; },
    show: function(i){ show(i, false); },
    overview: overview,
    filmstrip: filmstrip,
    play: playPlayback,
    pause: pausePlayback,
    playing: function(){ return playing; },
    setMuted: setMuted,
    selection: function(){ return selectedInfos(); },
  };
  // 页码下拉：点「18 / 23」列出全部页（页码 + 标题），点一页直接跳过去
  var pageMenu = document.getElementById("pfPageMenu");
  function pageMenuOpen(o){
    if (o === !pageMenu.hidden) return;
    if (o) {
      pageMenu.textContent = "";
      slides.forEach(function(slide, k){
        var item = document.createElement("button"); item.type = "button"; item.setAttribute("role", "menuitem");
        item.className = "pf-pagemenu-item" + (k === cur ? " active" : "");
        var n = document.createElement("span"); n.className = "n"; n.textContent = String(k + 1);
        var t = document.createElement("span"); t.className = "t"; t.textContent = slide.getAttribute("aria-label") || slide.getAttribute("data-id") || "";
        item.appendChild(n); item.appendChild(t);
        item.addEventListener("click", function(){ pageMenuOpen(false); show(k); });
        pageMenu.appendChild(item);
      });
    }
    pageMenu.hidden = !o;
    count.setAttribute("aria-expanded", o ? "true" : "false");
    if (o) { var a = pageMenu.children[cur]; if (a) { a.scrollIntoView({ block: "center" }); a.focus(); } }
  }
  count.addEventListener("click", function(){ pageMenuOpen(pageMenu.hidden); });
  document.addEventListener("click", function(e){ if (!e.target.closest || !e.target.closest(".pf-count-wrap")) pageMenuOpen(false); });
  // 菜单里 ↑/↓ 挪焦点、Enter 跳页、Esc 关；按键不再落到全局的翻页快捷键上
  pageMenu.addEventListener("keydown", function(e){
    var items = Array.prototype.slice.call(pageMenu.children), i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); var j = Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))); items[j].focus(); }
    else if (e.key === "Escape") { pageMenuOpen(false); count.focus(); }
    else if (e.key !== "Enter" && e.key !== " " && e.key !== "Tab") return;
    e.stopPropagation();
  });
  if (playBtn) playBtn.addEventListener("click", togglePlayback);
  if (audioBtn) audioBtn.addEventListener("click", toggleMute);
  prev.addEventListener("click", function(){ show(cur - 1); });
  next.addEventListener("click", function(){ show(cur + 1); });
  // 全屏用框架的（顶部菜单栏的全屏按钮），F 键是它的快捷键
  function toggleFull(){ if (window.__pfFullscreen) window.__pfFullscreen.toggle(); }
  document.addEventListener("keydown", function(e){
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    // 标注菜单、面板里的按键归它们自己（Esc 关面板由 notePanelScript 处理，这里不能再拿去开总览）
    if (e.target && e.target.closest && e.target.closest(".pf-context,.pf-note")) return;
    if (e.key === "Escape" && window.__pfNote && window.__pfNote.isOpen()) return;
    // ⌘/Ctrl+A：选中当前页的全部元素，不让浏览器把整页的界面文字一起选上
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "a" || e.key === "A")) { e.preventDefault(); selectAll(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape" && !zoomMenu.hidden) { zoomMenuOpen(false); return; }
    if (e.key === "Escape" && selected.length) { clearSelection(); return; }
    if (["ArrowRight","ArrowDown","PageDown"," "].indexOf(e.key) >= 0) { e.preventDefault(); show(cur + 1); }
    else if (["ArrowLeft","ArrowUp","PageUp"].indexOf(e.key) >= 0) { e.preventDefault(); show(cur - 1); }
    else if (e.key === "Home") show(0);
    else if (e.key === "End") show(slides.length - 1);
    else if (e.key === "f" || e.key === "F") toggleFull();
    else if (e.key === "t" || e.key === "T") filmstrip(!document.documentElement.classList.contains("pf-filmstrip"));
    else if ((e.key === "p" || e.key === "P") && playBtn) togglePlayback();
    else if ((e.key === "m" || e.key === "M") && audioBtn) toggleMute();
    else if (e.key === "Escape" && !document.fullscreenElement) {
      if (document.documentElement.classList.contains("pf-filmstrip")) filmstrip(false);
      else overview(!document.documentElement.classList.contains("pf-overview"));
    }
  });
  document.addEventListener("visibilitychange", function(){ if (document.hidden) pausePlayback(); });
  // 盯舞台自己的尺寸而不是窗口：项目栏展开/收起只改 body 的左边距，窗口不变、不发 resize
  if (window.ResizeObserver) new ResizeObserver(function(){ fit(); }).observe(stage);
  else window.addEventListener("resize", fit);
  // 地址栏里改 #<页码>（或浏览器前进后退）也跟着翻
  window.addEventListener("hashchange", function(){ var n = Number((location.hash || "").slice(1)); if (n > 0 && n - 1 !== cur) show(n - 1, false); });
  // 全屏就是放映：从缩略图或总览进全屏，先退回单页
  document.addEventListener("fullscreenchange", function(){
    if (document.fullscreenElement) {
      if (document.documentElement.classList.contains("pf-filmstrip")) filmstrip(false);
      if (document.documentElement.classList.contains("pf-overview")) overview(false);
    }
    setTimeout(fit, 0);
  });

  // Mermaid：代码块换成图，所有页一起渲染（隐藏的页用 visibility，布局还在，尺寸算得对）。
  if (window.mermaid) {
    deck.querySelectorAll("pre > code.language-mermaid").forEach(function(code){
      var div = document.createElement("div"); div.className = "mermaid"; div.textContent = code.textContent;
      code.parentNode.replaceWith(div);
    });
    window.mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: D.mermaidVars });
    var mermaidDone = window.mermaid.run();
    window.__pfPageReady = mermaidDone; // 标注截图等图画完再截（core/pageShot.js）
    if (mermaidDone && mermaidDone.then) mermaidDone.then(function(){ drawSelection(); if (document.documentElement.classList.contains("pf-filmstrip")) renderFilmstrip(); });
  }

${selectionScript()}

  // 版本下拉：跟表格、文档阅读页同一套视觉；切换版本是整页跳转（?v=<n>）。
  var bar = document.getElementById("pfDeckBar");
  var CHEV = '<svg class="pf-vsel-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  var w = document.createElement("div"); w.className = "pf-vsel";
  var btn = document.createElement("button"); btn.type = "button"; btn.className = "pf-vsel-btn"; btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = '<span class="pf-vsel-name">' + esc(D.title) + '</span>' + (D.current !== D.head ? '<span class="pf-vsel-badge">v' + D.current + '</span>' : '') + CHEV;
  var menu = document.createElement("div"); menu.className = "pf-vsel-menu"; menu.hidden = true;
  D.versions.slice().sort(function(a, b){ return b.n - a.n; }).forEach(function(v){
    var a = document.createElement("a");
    a.className = "pf-vsel-item" + (v.n === D.current ? " active" : "");
    a.href = location.pathname + (v.n === D.head ? "" : "?v=" + v.n);
    a.innerHTML = '<span class="t">' + esc(v.note || D.title) + '</span><span class="s">v' + v.n + (v.builtAt ? " · " + esc(v.builtAt.slice(0, 10)) : "") + '</span>';
    menu.appendChild(a);
  });
  function setOpen(o){ menu.hidden = !o; btn.setAttribute("aria-expanded", o ? "true" : "false"); }
  btn.addEventListener("click", function(e){ e.stopPropagation(); setOpen(menu.hidden); });
  document.addEventListener("click", function(){ setOpen(false); });
  w.appendChild(btn); w.appendChild(menu); bar.appendChild(w);

  fit();
  var h = Number((location.hash || "").slice(1));
  show(h > 0 ? h - 1 : 0, false);
  updatePlaybackButtons();
})();`;
}

// 选择 + 标注：跟绘图阅读页同一套交互。拼进 appScript 的闭包里，直接用 stage、slides、cur、D。
// 可选中的是当前页 <section> 里的元素：点到哪个就选哪个，但点在一段文字里的 <b>/<span> 上算选中这段文字，
// 点在图片、SVG、Mermaid、嵌入、表格里面算选中它整个。框选和全选只挑"内容单元"：文字段落（自己有字、
// 里面只有行内元素）和上面这些整块的东西，不挑纯排版用的容器，不然一框就把外层卡片、整页都选上。
function selectionScript() {
  return `
  var selLayer = document.getElementById("pfSel"), marquee = document.getElementById("pfMarquee");
  var ATOMIC = "svg,img,video,canvas,picture,iframe,table,.mermaid,.pf-embed-slot";
  var INLINE = { A:1, ABBR:1, B:1, BR:1, CODE:1, EM:1, I:1, KBD:1, LABEL:1, MARK:1, S:1, SMALL:1, SPAN:1, STRONG:1, SUB:1, SUP:1, U:1 };
  var selected = [], hovered = null, drag = null;
  function curSection(){ var s = slides[cur]; return s && s.firstElementChild; }
  function selecting(){ return !document.documentElement.classList.contains("pf-overview") && !document.fullscreenElement; }
  function visible(el){ var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function isTextBlock(el){
    if (!el.textContent.trim()) return false;
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (!INLINE[c.tagName] || c.matches(ATOMIC)) return false;
    return true;
  }
  function isUnit(el){ return el.matches(ATOMIC) || isTextBlock(el); }
  function units(){
    var out = [], root = curSection();
    (function walk(el){
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        if (/^(SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName)) continue;
        if (isUnit(c)) { if (visible(c)) out.push(c); } else walk(c);
      }
    })(root || document.createElement("div"));
    return out;
  }
  // 指针下的元素：落在整块东西或文字段落里就取它；不然取指针下那个元素本身（卡片、分栏之类的容器）；
  // 落在页面空白（section 本身）或页外返回 null，用来开始框选。
  function hitAt(target){
    var root = curSection();
    if (!root || !target || !root.contains(target) || target === root) return null;
    // 取最外层的那个：嵌入里的表格算嵌入，段落里的 <b> 算段落——跟框选、全选挑出来的单元一致
    var unit = null;
    for (var el = target; el && el !== root; el = el.parentElement) if (isUnit(el)) unit = el;
    return unit || target;
  }
  function boxDiv(el, cls){
    // 选框层在舞台里，放大后舞台滚动时它跟着内容走，所以要加上滚动距离
    var base = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
    var d = document.createElement("div"); if (cls) d.className = cls;
    d.style.left = (r.left - base.left + stage.scrollLeft - 3) + "px"; d.style.top = (r.top - base.top + stage.scrollTop - 3) + "px";
    d.style.width = (r.width + 6) + "px"; d.style.height = (r.height + 6) + "px";
    return d;
  }
  function drawSelection(){
    selLayer.innerHTML = "";
    if (hovered && selected.indexOf(hovered) < 0 && !drag) selLayer.appendChild(boxDiv(hovered, "pf-sel-hover"));
    selected.forEach(function(el){ selLayer.appendChild(boxDiv(el)); });
  }
  function setSelection(list){ selected = list; drawSelection(); }
  function clearSelection(){ hovered = null; setSelection([]); }
  function selectAll(){ if (selecting()) setSelection(units()); }
  function toggle(el){ var i = selected.indexOf(el); if (i >= 0) selected.splice(i, 1); else selected.push(el); drawSelection(); }

  // 按下：元素 → 选中（⇧/⌘/Ctrl 加入或移出）；空白 → 框选。捕获阶段：页里的脚本拦了 mousedown 也照样收得到。
  stage.addEventListener("mousedown", function(e){
    if (e.button !== 0 || !selecting()) return;
    // 按在滚动条上不算框选
    var sr = stage.getBoundingClientRect();
    if (e.clientX - sr.left >= stage.clientWidth || e.clientY - sr.top >= stage.clientHeight) return;
    var hit = hitAt(e.target), additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (hit) { if (additive) toggle(hit); else setSelection([hit]); return; }
    drag = { x: e.clientX, y: e.clientY, additive: additive, moved: false, base: additive ? selected.slice() : [] };
  }, true);
  stage.addEventListener("mousemove", function(e){
    if (drag || !selecting()) return;
    var h = hitAt(e.target);
    if (h !== hovered) { hovered = h; drawSelection(); }
  });
  stage.addEventListener("mouseleave", function(){ if (hovered) { hovered = null; drawSelection(); } });
  document.addEventListener("mousemove", function(e){
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 4) return;
    drag.moved = true;
    var base = stage.getBoundingClientRect();
    var x1 = Math.min(drag.x, e.clientX), y1 = Math.min(drag.y, e.clientY), x2 = Math.max(drag.x, e.clientX), y2 = Math.max(drag.y, e.clientY);
    marquee.hidden = false;
    marquee.style.left = (x1 - base.left + stage.scrollLeft) + "px"; marquee.style.top = (y1 - base.top + stage.scrollTop) + "px";
    marquee.style.width = (x2 - x1) + "px"; marquee.style.height = (y2 - y1) + "px";
    var next = drag.base.slice();
    units().forEach(function(el){
      var r = el.getBoundingClientRect();
      if (r.right >= x1 && r.left <= x2 && r.bottom >= y1 && r.top <= y2 && next.indexOf(el) < 0) next.push(el);
    });
    setSelection(next);
  });
  document.addEventListener("mouseup", function(){
    if (!drag) return;
    if (!drag.moved && !drag.additive) clearSelection();
    marquee.hidden = true;
    drag = null;
  });
  document.addEventListener("fullscreenchange", function(){ if (document.fullscreenElement) clearSelection(); });

  // 选中元素的描述：在这一页 section 里的路径（标签 + 类名 + 同类序号，有 id 就从 id 开始），加上文字或来源。
  // 嵌入在源文件里写的是 <pf-embed>，阅读页展开成了 .pf-embed-slot，路径到它为止、按源文件的写法记。
  function stepOf(el){
    if (el.matches(".pf-embed-slot")) return "pf-embed";
    var s = el.tagName.toLowerCase();
    var cls = Array.prototype.filter.call(el.classList, function(c){ return c.indexOf("pf-") !== 0; }).slice(0, 2);
    if (cls.length) s += "." + cls.join(".");
    var same = 0, idx = 0;
    for (var c = el.parentElement.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === el.tagName) { same++; if (c === el) idx = same; }
    return same > 1 ? s + ":nth-of-type(" + idx + ")" : s;
  }
  function pathOf(el){
    var root = curSection(), parts = [];
    for (var n = el; n && n !== root; n = n.parentElement) {
      if (n.id && !n.closest(".pf-embed-slot")) { parts.unshift("#" + n.id); return parts.join(" > "); }
      parts.unshift(stepOf(n));
    }
    return ["section"].concat(parts).join(" > ");
  }
  function clip(t, n){ t = String(t || "").replace(/\\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; }
  function infoOf(el){
    var info = { path: pathOf(el), tag: el.tagName.toLowerCase() };
    if (el.matches(".pf-embed-slot")) info.embed = el.getAttribute("data-pf-embed");
    else if (el.matches(".mermaid")) info.what = "Mermaid 图";
    else if (el.tagName === "IMG" || el.tagName === "VIDEO") info.src = el.getAttribute("src") || "";
    var text = clip(el.innerText || el.textContent, 80);
    if (text && !info.embed && !info.what) info.text = text;
    return info;
  }
  function selectedInfos(){ return selected.map(infoOf); }

  // ---- 标注（只在本地预览）：右键 → 标注 → 复制给 agent ----
  if (D.local) {
    var SLIDE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
    var srcOf = function(s){ var r = /\\/(?:versions\\/\\d+\\/)?([^?#]*)$/.exec(s); return s.indexOf("data:") === 0 ? "(内嵌数据)" : r ? r[1] : s; };
    var elementLine = function(i, k){
      var parts = ["path: " + i.path];
      if (i.embed) parts.push("embed: " + i.embed);
      if (i.what) parts.push(i.what);
      if (i.src) parts.push("src: " + srcOf(i.src));
      if (i.text) parts.push("text: " + JSON.stringify(i.text));
      return "  " + (k + 1) + ". " + parts.join("   ");
    };
    var annotationText = function(ctx, note){
      var lines = [];
      if (String(note || "").trim()) lines.push(String(note).trim(), "");
      var m = /^\\/p\\/([^/]+)\\//.exec(location.pathname);
      lines = lines.concat(window.__pfNote.header({
        projectId: m ? decodeURIComponent(m[1]) : "", kind: "deck",
        source: "decks/" + D.deckId + "/slides/" + ctx.id + ".html", version: D.current, head: D.head,
      }));
      lines.push("deck: " + D.title + " (" + D.deckId + ")");
      lines.push("slide: " + (ctx.index + 1) + " / " + slides.length + " · " + ctx.title + " (" + ctx.id + ")" + (ctx.layout ? " · layout: " + ctx.layout : ""));
      if (ctx.infos.length) { lines.push("elements:"); ctx.infos.forEach(function(i, k){ lines.push(elementLine(i, k)); }); }
      else lines.push("elements: （整页）");
      return lines.join("\\n");
    };
    var openNotePanel = function(){
      var slide = slides[cur], section = curSection();
      if (location.hash !== "#" + (cur + 1)) history.replaceState(null, "", location.pathname + location.search + "#" + (cur + 1));
      var ctx = { index: cur, id: slide.getAttribute("data-id"), title: slide.getAttribute("aria-label") || "",
        layout: section && section.getAttribute("data-layout") || "", infos: selectedInfos() };
      var one = ctx.infos[0];
      var main = ctx.infos.length === 1 ? (one.text || one.embed || one.what || one.path) : ctx.infos.length > 1 ? "已选 " + ctx.infos.length + " 个元素" : "整页：" + (ctx.title || ctx.id);
      window.__pfNote.open({
        key: D.current + "/" + ctx.id + "/" + ctx.infos.map(function(i){ return i.path; }).join("|"),
        title: "幻灯片标注", icon: SLIDE_ICON,
        main: main, meta: "第 " + (cur + 1) + " 页 · v" + D.current,
        placeholder: "写下希望本地 agent 怎么改这一页…",
        hint: "复制内容会包含源文件、页、版本、选中元素的位置和文字，以及这一页的截图（选中的按编号框出）。",
        compose: function(note){ return annotationText(ctx, note); },
        // 截图：本地服务用无头浏览器打开这一页（地址里的 #页码 定位），截这一页、按选中顺序编号框出
        shot: { selector: '.pf-slide[data-id="' + ctx.id.replace(/["\\\\]/g, "\\\\$&") + '"]', boxes: window.__pfNote.boxesIn(slide, selected) },
      });
    };
    stage.addEventListener("contextmenu", function(e){
      if (!selecting() || !curSection()) return;
      e.preventDefault();
      var hit = hitAt(e.target);
      if (hit && selected.indexOf(hit) < 0) setSelection([hit]);
      window.__pfNote.warmShot(); // 选「标注」之前就让截图用的浏览器先起来
      window.__pfNote.menu(e.clientX, e.clientY, stage, [{ id: "annotate", label: "标注", icon: ${JSON.stringify(ICON_NOTE)}, run: openNotePanel }]);
    });
  }`;
}

function shareScript() {
  return `(function(){
  ${exportDownloadScript()}
  var entry = document.querySelector(".pf-export-entry");
  if (!entry) return;
  var btn = entry.querySelector(".pf-hdr-share"), menu = entry.querySelector(".pf-export-menu");
  var m = /^\\/p\\/([^\\/]+)\\/decks\\/([^\\/]+)\\/preview\\.html$/.exec(location.pathname);
  if (!m) { btn.disabled = true; btn.title = "仅在 protoflow 预览服务中可导出"; return; }
  var key = m[1], deckId = decodeURIComponent(m[2]);
  btn.addEventListener("click", function(e){ e.stopPropagation(); menu.hidden = !menu.hidden; });
  menu.querySelectorAll(".pf-export-menu__item").forEach(function(item){
    item.addEventListener("click", function(){
      menu.hidden = true;
      __pfDownloadExport("/p/" + key + "/__protoflow_export/deck/" + encodeURIComponent(deckId) + "/" + item.getAttribute("data-format"), btn);
    });
  });
  document.addEventListener("click", function(e){ if (!menu.hidden && !entry.contains(e.target)) menu.hidden = true; });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") menu.hidden = true; });
})();`;
}
