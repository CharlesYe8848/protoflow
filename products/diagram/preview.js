// products/diagram/preview.js — 绘图的本地阅读页。跟表格阅读页同一个做法：一个自包含页面带上全部版本，
// 版本、页的切换在页内完成（重渲染 + 用 history 改 ?v=&page=，不跳转）。外观也照表格：左上角标题兼版本
// 下拉，右上角分享，底部页面标签 + 缩放。
//
// 每一页怎么画由渲染器决定（engine/）：服务端 prepare() 的结果嵌进页面，浏览器端脚本
// PFDiagram.register(kind, { render, nodes }) 负责画和列出可选中的节点。这里只做所有写法共用的部分：
//   - 画面：平移（触控板双指、按住空格拖动、鼠标中键拖动）、缩放（⌘/Ctrl + 滚轮、捏合、底部按钮）、适应窗口
//   - 选择：点击选中节点，⇧/⌘ 点击加入或移出，在空白处拖动框选，Esc 或点空白处取消
//   - 标注：右键 →「标注」，面板和复制跟表格共用（core/ui.js 的 notePanelScript），只在本地预览启用
//   - 「图 / 源码」切换、渲染失败提示
//
// 页面状态只有地址里的 ?v=&page=（刷新后停在原来的版本和页）。缩放、折叠、选中都不保存，跟表格一致。
import { BRAND_CSS_VARS, DIAGRAM_PALETTE, FAVICON_LINK, FULLSCREEN_CSS, ICON_NOTE, ICON_SHARE, NOTE_PANEL_CSS, exportDownloadScript, exportMenuRowsHtml, fullscreenButtonHtml, fullscreenScript, notePanelScript } from "protoflow/sdk";
import { decompressLibsScript } from "protoflow/sdk/internal";
import { renderers, rendererByKind } from "./engine/index.js";
import { DIAGRAM_EXPORT_MENU } from "./exportMenu.js";

// 框架的通用图形配色 → Mermaid 的 themeVariables（配色本身只在 core/brand.js 定义一处）。
const MERMAID_THEME_VARS = {
  primaryColor: DIAGRAM_PALETTE.nodeFill,
  primaryTextColor: DIAGRAM_PALETTE.nodeText,
  primaryBorderColor: DIAGRAM_PALETTE.nodeBorder,
  lineColor: DIAGRAM_PALETTE.line,
  secondaryColor: DIAGRAM_PALETTE.secondaryFill,
  tertiaryColor: DIAGRAM_PALETTE.tertiaryFill,
  fontFamily: DIAGRAM_PALETTE.fontFamily,
};

const escapeScript = (s) => String(s).replace(/<\/script/gi, "<\\/script");
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (v) => escapeScript(JSON.stringify(v));

// 用到的写法按渲染器登记顺序排，库按渲染器里声明的顺序加载（d3 要在 markmap-view 之前）。
export function libNamesFor(kinds) {
  return renderers().filter((r) => kinds.includes(r.kind)).flatMap((r) => Object.keys(r.libs || {}));
}

// opts:
//   versions        [{ n, note, author, builtAt, pages:[{ id, name, file, kind, source }] }]
//   head            head 版本号
//   title           绘图标题
//   diagramId       本地预览中的目录名；导出页不传，因此不启用标注
//   standalone      导出时传 true：去掉「分享」按钮和标注
//   libRelPath      lib/ 相对路径（实时预览固定 "../../lib"）
//   compressedLibs  单 HTML 导出：{ 文件名: {format, base64} }，库压缩内嵌，不引用 lib/
export function renderDiagramPreviewHtml(opts = {}) {
  const { versions = [], head = 0, title = "绘图", diagramId = "", standalone = false, libRelPath = "../../lib", compressedLibs = null } = opts;
  const kinds = [...new Set(versions.flatMap((v) => v.pages.map((p) => p.kind)))];
  const used = renderers().filter((r) => kinds.includes(r.kind));
  const data = versions.map((v) => ({
    n: v.n, note: v.note || "", author: v.author || "", builtAt: v.builtAt || "",
    pages: v.pages.map((p) => {
      const r = rendererByKind(p.kind);
      return { id: p.id, name: p.name, file: p.file, kind: p.kind, source: p.source, data: r ? r.prepare(p.source) : {} };
    }),
  }));
  const kindsMeta = Object.fromEntries(used.map((r) => [r.kind, { label: r.label, icon: r.icon || "" }]));
  const libTags = compressedLibs ? "" : libNamesFor(kinds).map((n) => `<script src="${libRelPath}/${n}"><\/script>`).join("\n");
  const local = !standalone && !!diagramId;
  const shareBtn = `<div class="pf-hdr-r">${fullscreenButtonHtml()}${standalone ? "" : `<div class="pf-export-entry">
    <button class="pf-hdr-share" type="button" title="分享">${ICON_SHARE}<span class="pf-export-label">分享</span></button>
    <div class="pf-export-menu" hidden><div class="pf-export-menu__section">导出</div>${exportMenuRowsHtml(DIAGRAM_EXPORT_MENU)}</div>
  </div>`}</div>`;

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
${FAVICON_LINK}
<title>${escHtml(title + " · protoflow 绘图")}</title>
${libTags}
<style>
${BRAND_CSS_VARS}
*{box-sizing:border-box}
body{margin:0;background:#f6f7fb;color:#0f172a;font-family:"PingFang SC","Microsoft YaHei",-apple-system,sans-serif;line-height:1.5}
.pf-hdr{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:8px;height:40px;padding:0 12px 0 8px;background:#fff;border-bottom:1px solid #e9ebef;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.pf-hdr-l{display:flex;align-items:center;gap:4px;min-width:0}
.pf-hdr-r{display:flex;align-items:center;gap:4px;flex:none}
.pf-export-entry{position:relative}
.pf-hdr-share{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:12px;font-weight:400;color:rgba(15,23,42,.75);background:transparent;border:0;border-radius:6px;cursor:pointer}
.pf-hdr-share:hover{background:rgba(15,23,42,.06)}
.pf-hdr-share:disabled{opacity:.5;cursor:default}
.pf-export-menu{position:absolute;right:0;top:calc(100% + 8px);min-width:440px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:6px;z-index:60}
.pf-export-menu[hidden]{display:none}
.pf-export-menu__section{padding:8px 9px 4px;font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.02em}
.pf-export-menu__item{display:flex;align-items:center;gap:12px;width:100%;padding:8px 9px;border:none;background:none;border-radius:9px;cursor:pointer;font-family:inherit;text-align:left}
.pf-export-menu__item:hover{background:#f8fafc}
.pf-export-menu__item svg{flex:none;width:28px;height:28px;padding:6px;box-sizing:border-box;border-radius:7px;background:#f1f5f9;color:#475569}
.pf-export-menu__body{flex:1;min-width:0;display:flex;flex-direction:column}
.pf-export-menu__body b{font-size:13px;font-weight:600;color:#0f172a}
.pf-export-menu__body span{font-size:11.5px;color:#94a3b8;margin-top:2px}
.pf-export-menu__action{flex:none;font-size:11.5px;font-weight:500;color:#94a3b8}
.pf-vsel{position:relative;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:12px}
.pf-vsel *{box-sizing:border-box}
.pf-vsel-btn{display:inline-flex;align-items:center;gap:5px;max-width:60vw;height:26px;padding:0 5px 0 7px;font-family:inherit;font-size:12px;font-weight:400;line-height:1;color:rgba(15,23,42,.75);background:transparent;border:0;border-radius:6px;cursor:pointer;transition:background .1s ease}
.pf-vsel-btn:hover,.pf-vsel-btn[aria-expanded="true"]{background:rgba(15,23,42,.06)}
.pf-vsel-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:#0f172a}
.pf-vsel-badge{flex:none;border-radius:999px;background:rgba(15,23,42,.06);color:#8a919c;padding:1px 6px;font-size:10.5px;line-height:1.4}
.pf-vsel-chev{width:11px;height:11px;flex:none;opacity:.45}
.pf-vsel-menu{position:absolute;left:0;top:calc(100% + 4px);width:250px;background:#fff;border:1px solid #e9ebef;border-radius:10px;box-shadow:0 8px 26px rgba(15,23,42,.12);padding:4px;z-index:60;max-height:62vh;overflow:auto}
.pf-vsel-menu[hidden]{display:none}
.pf-vsel-item{display:block;padding:7px 9px;border-radius:6px;text-decoration:none;cursor:pointer}
.pf-vsel-item:hover{background:#f6f7f9}
.pf-vsel-item.active{background:#f1f3f5}
.pf-vsel-item .t{display:block;font-size:12px;font-weight:500;line-height:1.35;color:#1a1d21;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-vsel-item .s{display:block;font-size:11px;font-weight:400;line-height:1.3;color:#9aa1ab;margin-top:2px}
.pf-vsel-dot{display:inline-block;width:5px;height:5px;margin-left:5px;border-radius:50%;background:#0f172a;vertical-align:middle}
.pf-page{padding:16px;height:calc(100vh - 40px);display:flex;flex-direction:column}
.pf-dg-frame{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;background:#fff;border:1px solid #c9ccd1;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.06)}
.pf-dg-view{position:relative;flex:1;min-height:0;overflow:hidden;background:#fff;outline:none;user-select:none;-webkit-user-select:none;cursor:default}
.pf-dg-view.pf-panning{cursor:grab}
.pf-dg-view.pf-panning.pf-dragging{cursor:grabbing}
.pf-dg-stage{position:absolute;left:0;top:0;transform-origin:0 0;width:max-content}
.pf-dg-stage svg{display:block}
.pf-dg-view.pf-over-node{cursor:pointer}
.pf-dg-sel{position:absolute;inset:0;pointer-events:none}
.pf-dg-sel div{position:absolute;border:2px solid #3b73d1;background:rgba(59,115,209,.075);border-radius:6px}
.pf-dg-marquee{position:absolute;border:1px solid #3b73d1;background:rgba(59,115,209,.08);pointer-events:none}
.pf-dg-marquee[hidden]{display:none}
.pf-dg-source{position:absolute;inset:0;margin:0;padding:52px 0 24px;overflow:auto;background:#fbfcfd;font:13px/1.75 "SF Mono",Menlo,Consolas,monospace;color:#0f172a;user-select:text;-webkit-user-select:text;cursor:text}
.pf-dg-source[hidden]{display:none}
.pf-dg-source .l{display:flex}
.pf-dg-source .n{flex:none;width:56px;padding-right:16px;text-align:right;color:#94a3b8;user-select:none;-webkit-user-select:none}
.pf-dg-source .c{white-space:pre;padding-right:24px}
.pf-dg-source .f{padding:0 0 10px 56px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:12px;color:#64748b}
.pf-dg-error{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);max-width:560px;padding:16px 18px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.08);font-size:13px;color:#334155}
.pf-dg-error[hidden]{display:none}
.pf-dg-error b{display:block;margin-bottom:6px;color:#0f172a}
.pf-dg-error pre{margin:8px 0 0;max-height:160px;overflow:auto;white-space:pre-wrap;font:12px/1.5 "SF Mono",Menlo,monospace;color:#b42318}
.pf-dg-toolbar{position:absolute;top:10px;right:10px;z-index:5}
.pf-toggle-group{display:flex;gap:2px;background:#eef0f3;border-radius:8px;padding:3px}
.pf-toggle-btn{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;background:transparent;border-radius:6px;color:#8a919c;cursor:pointer}
.pf-toggle-btn svg{width:14px;height:14px}
.pf-toggle-btn:hover{color:#0f172a}
.pf-toggle-btn.active{background:#fff;color:#0f172a;box-shadow:0 1px 3px rgba(15,23,42,.12)}
.pf-dg-bottom{position:relative;z-index:8;flex:none;display:flex;align-items:center;height:32px;background:#f3f4f6;border-top:1px solid #dde0e5}
.pf-dg-tabs{flex:1;min-width:0;display:flex;align-items:center;gap:2px;height:100%;padding:0 8px;overflow:auto}
.pf-dg-tab{display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:12px;padding:5px 14px;border:1px solid transparent;border-radius:5px;background:transparent;color:#6b7280;cursor:pointer;white-space:nowrap}
.pf-dg-tab svg{width:13px;height:13px;flex:none}
.pf-dg-tab:hover{background:rgba(15,23,42,.05)}
.pf-dg-tab.active{background:#fff;border-color:#dde0e5;color:#0f172a;font-weight:600}
.pf-dg-zoom{position:relative;flex:none;display:flex;align-items:center;gap:1px;height:100%;padding:0 6px;border-left:1px solid #dde0e5;background:#f3f4f6}
.pf-dg-zoom__step{display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:none;background:transparent;border-radius:6px;font:18px/1 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#667085;cursor:pointer}
.pf-dg-zoom__step:hover{background:rgba(15,23,42,.06);color:#1f2937}
.pf-dg-zoom__label{min-width:48px;height:26px;padding:0 6px;border:none;background:none;border-radius:6px;font:12px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#475569;cursor:pointer}
.pf-dg-zoom__label:hover{background:#f1f5f9}
.pf-dg-zoom__menu{position:absolute;right:0;bottom:calc(100% + 8px);min-width:168px;display:flex;flex-direction:column;gap:1px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 4px 16px rgba(15,23,42,.12);padding:4px}
.pf-dg-zoom__menu[hidden]{display:none}
.pf-dg-zoom__menu button{text-align:left;padding:7px 10px;border:none;background:none;border-radius:6px;font:13px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#334155;cursor:pointer}
.pf-dg-zoom__menu button:hover{background:#f1f5f9}
${local ? NOTE_PANEL_CSS : ""}
${FULLSCREEN_CSS}html.pf-fs .pf-page{height:100vh}
</style></head><body>
<header class="pf-hdr" data-pf-chrome>
  <div class="pf-hdr-l"><span data-pf-nav-slot></span><div id="pfDocBar"></div></div>
  ${shareBtn}
</header>
<div class="pf-page">
  <div class="pf-dg-frame">
    <div class="pf-dg-view" id="pfView" tabindex="0">
      <div class="pf-dg-stage" id="pfStage"></div>
      <div class="pf-dg-sel" id="pfSel"></div>
      <div class="pf-dg-marquee" id="pfMarquee" hidden></div>
      <div class="pf-dg-source" id="pfSource" hidden></div>
      <div class="pf-dg-error" id="pfError" hidden></div>
      <div class="pf-dg-toolbar pf-toggle-group" data-pf-chrome>
        <button class="pf-toggle-btn active" type="button" data-view="diagram" title="查看图" aria-label="查看图"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg></button>
        <button class="pf-toggle-btn" type="button" data-view="source" title="查看源码" aria-label="查看源码"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></button>
      </div>
    </div>
    <div class="pf-dg-bottom">
      <nav class="pf-dg-tabs" id="pfTabs" aria-label="页"></nav>
      <div class="pf-dg-zoom" data-pf-chrome>
        <button class="pf-dg-zoom__out pf-dg-zoom__step" type="button" aria-label="缩小">−</button>
        <button class="pf-dg-zoom__label" type="button" aria-expanded="false">100%</button>
        <button class="pf-dg-zoom__in pf-dg-zoom__step" type="button" aria-label="放大">＋</button>
        <div class="pf-dg-zoom__menu" hidden>
          <button class="pf-dg-zoom__reset" type="button">缩放至 100%</button>
          <button class="pf-dg-zoom__fit" type="button">适应窗口</button>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
var __PF_VERSIONS__ = ${json(data)};
var __PF_HEAD__ = ${json(head)};
var __PF_TITLE__ = ${json(title)};
var __PF_DIAGRAM_ID__ = ${json(local ? diagramId : "")};
var __PF_KINDS__ = ${json(kindsMeta)};
var __PF_THEME__ = ${json(MERMAID_THEME_VARS)};
var __PF_LIB_ORDER__ = ${json(compressedLibs ? libNamesFor(kinds) : [])};
var __PF_LIBS__ = ${compressedLibs ? json(compressedLibs) : "null"};
window.PFDiagram = { renderers: {}, register: function(kind, r){ this.renderers[kind] = r; } };
<\/script>
${used.map((r) => `<script>\n${escapeScript(r.clientScript())}\n<\/script>`).join("\n")}
${local ? `<script>${notePanelScript()}<\/script>` : ""}
<script>
${compressedLibs ? decompressLibsScript() : ""}
${appScript()}
<\/script>
${standalone ? "" : `<script>${shareScript()}<\/script>`}
<script>${fullscreenScript()}<\/script>
</body></html>`;
}

function shareScript() {
  return `
(function(){
  ${exportDownloadScript()}
  var entry = document.querySelector(".pf-export-entry");
  if (!entry) return;
  var btn = entry.querySelector(".pf-hdr-share");
  var menu = entry.querySelector(".pf-export-menu");
  var m = /^\\/p\\/([^\\/]+)\\/diagrams\\/([^\\/]+)\\/preview\\.html$/.exec(location.pathname);
  if (!m) { btn.disabled = true; btn.title = "仅在 protoflow 预览服务中可导出"; return; }
  var key = m[1], diagramId = decodeURIComponent(m[2]);
  btn.addEventListener("click", function(e){ e.stopPropagation(); menu.hidden = !menu.hidden; });
  menu.querySelectorAll(".pf-export-menu__item").forEach(function(item){
    item.addEventListener("click", function(){
      menu.hidden = true;
      __pfDownloadExport("/p/" + key + "/__protoflow_export/diagram/" + encodeURIComponent(diagramId) + "/" + item.getAttribute("data-format"), btn);
    });
  });
  document.addEventListener("click", function(e){ if (!menu.hidden && !entry.contains(e.target)) menu.hidden = true; });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") menu.hidden = true; });
})();`;
}

// 页内 SPA：内嵌全部版本，切换版本/页 = 重渲染 + 用 history 改 ?v=&page=。
function appScript() {
  return `
(function(){
  var V = __PF_VERSIONS__, HEAD = __PF_HEAD__, TITLE = __PF_TITLE__, DIAGRAM_ID = __PF_DIAGRAM_ID__, KINDS = __PF_KINDS__;
  var byN = {}; V.forEach(function(v){ byN[v.n] = v; });
  var view = document.getElementById("pfView");
  var stage = document.getElementById("pfStage");
  var selLayer = document.getElementById("pfSel");
  var marquee = document.getElementById("pfMarquee");
  var sourceEl = document.getElementById("pfSource");
  var errorEl = document.getElementById("pfError");
  var tabsNav = document.getElementById("pfTabs");
  var bar = document.getElementById("pfDocBar");
  var CHEV = '<svg class="pf-vsel-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  var PAGE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/></svg>';
  var pub = window.__pfDiagram = { version: 0, page: "", zoom: 1, ready: false, error: "", selection: [] };

  function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function rel(iso){
    var t = Date.parse(iso); if (isNaN(t)) return "";
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "刚刚";
    if (s < 3600) return Math.floor(s / 60) + " 分钟前";
    if (s < 86400) return Math.floor(s / 3600) + " 小时前";
    if (s < 2592000) return Math.floor(s / 86400) + " 天前";
    if (s < 31536000) return Math.floor(s / 2592000) + " 个月前";
    return Math.floor(s / 31536000) + " 年前";
  }

  // ---- 状态：当前版本号 + 当前页，读写 ?v=&page= ----
  function parseState(){
    var sp = new URLSearchParams(location.search);
    var v = Number(sp.get("v"));
    if (!byN[v]) v = HEAD;
    return { v: v, page: sp.get("page") || "" };
  }
  function pushState(v, pageId){
    var sp = new URLSearchParams();
    if (v !== HEAD) sp.set("v", v);
    if (pageId) sp.set("page", pageId);
    var qs = sp.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }

  // ---- 画面：stage 按 translate + scale 摆放，渲染器只管画出固定尺寸的内容 ----
  var ZOOM_MIN = 0.1, ZOOM_MAX = 4, vp = { x: 0, y: 0, k: 1 };
  var zoomLabel = document.querySelector(".pf-dg-zoom__label");
  var zoomMenu = document.querySelector(".pf-dg-zoom__menu");
  function clampZoom(k){ return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, k)); }
  function applyView(){
    stage.style.transform = "translate(" + vp.x + "px," + vp.y + "px) scale(" + vp.k + ")";
    zoomLabel.textContent = Math.round(vp.k * 100) + "%";
    pub.zoom = vp.k;
    drawSelection();
  }
  function fit(){
    var cw = stage.offsetWidth, ch = stage.offsetHeight;
    var vw = view.clientWidth, vh = view.clientHeight;
    if (!cw || !ch || !vw || !vh) return;
    vp.k = clampZoom(Math.min((vw - 48) / cw, (vh - 48) / ch, 1));
    vp.x = Math.round((vw - cw * vp.k) / 2);
    vp.y = Math.round(Math.max(24, (vh - ch * vp.k) / 2));
    applyView();
  }
  function zoomAt(clientX, clientY, factor){
    var r = view.getBoundingClientRect();
    var px = clientX - r.left, py = clientY - r.top;
    var next = clampZoom(vp.k * factor);
    if (Math.abs(next - vp.k) < 0.0001) return;
    vp.x = px - (px - vp.x) * (next / vp.k);
    vp.y = py - (py - vp.y) * (next / vp.k);
    vp.k = next; applyView();
  }
  function zoomCenter(factor){ var r = view.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor); }
  view.addEventListener("wheel", function(e){
    if (!sourceEl.hidden) return; // 源码视图：普通滚动
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01)); return; }
    vp.x -= e.deltaX; vp.y -= e.deltaY; applyView();
  }, { passive: false });
  var gestureBase = 1;
  view.addEventListener("gesturestart", function(e){ e.preventDefault(); gestureBase = vp.k; });
  view.addEventListener("gesturechange", function(e){ e.preventDefault(); zoomAt(e.clientX, e.clientY, (gestureBase * e.scale) / vp.k); });
  view.addEventListener("gestureend", function(e){ e.preventDefault(); });
  document.querySelector(".pf-dg-zoom__in").addEventListener("click", function(){ zoomCenter(1.2); });
  document.querySelector(".pf-dg-zoom__out").addEventListener("click", function(){ zoomCenter(1 / 1.2); });
  document.querySelector(".pf-dg-zoom__reset").addEventListener("click", function(){ zoomMenu.hidden = true; zoomCenter(1 / vp.k); });
  document.querySelector(".pf-dg-zoom__fit").addEventListener("click", function(){ zoomMenu.hidden = true; fit(); });
  zoomLabel.addEventListener("click", function(e){ e.stopPropagation(); zoomMenu.hidden = !zoomMenu.hidden; zoomLabel.setAttribute("aria-expanded", zoomMenu.hidden ? "false" : "true"); });
  document.addEventListener("click", function(e){
    if (!zoomMenu.hidden && !zoomMenu.contains(e.target) && e.target !== zoomLabel) { zoomMenu.hidden = true; zoomLabel.setAttribute("aria-expanded", "false"); }
  });

  // ---- 选择 ----
  var nodes = [], selected = {}; // selected: key → true
  var curVersion = null, curPage = null, curBox = null;
  function refreshNodes(){
    nodes = [];
    var r = curPage && window.PFDiagram.renderers[curPage.kind];
    if (r && r.nodes && curBox && errorEl.hidden) {
      try { nodes = r.nodes(curBox, curPage) || []; } catch (e) { nodes = []; }
    }
    var keys = {}; nodes.forEach(function(n){ keys[n.key] = true; });
    Object.keys(selected).forEach(function(k){ if (!keys[k]) delete selected[k]; });
    drawSelection();
  }
  // 一个可选中的对象可能由几个元素组成（时序图的消息 = 文字 + 箭头），位置取它们合起来的范围。
  function elsOf(n){ return Array.isArray(n.el) ? n.el : [n.el]; }
  function rectOf(n){
    var box = null;
    elsOf(n).forEach(function(el){
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      box = box ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) }
        : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    return box || { left: 0, top: 0, right: 0, bottom: 0 };
  }
  // 指针下的对象：先看指针落在哪个对象的元素里；没有的话（细线、箭头只有 1px，很难正好点中）
  // 再看指针是不是离某个元素很近：线条用 isPointInStroke 在指针周围几个像素采样，其他元素用它自己
  // 的外框外扩几像素。不用"对象合起来的范围"：时序图一条消息的范围横跨两条生命线，会把空白也算进去，
  // 在图中间按下就开始不了框选。
  var NEAR = 4, NEAR_OFFSETS = [];
  for (var ox = -NEAR; ox <= NEAR; ox += 2) for (var oy = -NEAR; oy <= NEAR; oy += 2) NEAR_OFFSETS.push([ox, oy]);
  function nearEl(el, x, y){
    if (el.isPointInStroke && el.getScreenCTM && /^(path|line|polyline)$/.test(el.tagName)) {
      var m = el.getScreenCTM(); if (!m) return false;
      var inv = m.inverse(), svg = el.ownerSVGElement;
      for (var i = 0; i < NEAR_OFFSETS.length; i++) {
        var pt = svg.createSVGPoint(); pt.x = x + NEAR_OFFSETS[i][0]; pt.y = y + NEAR_OFFSETS[i][1];
        if (el.isPointInStroke(pt.matrixTransform(inv))) return true;
      }
      return false;
    }
    var r = el.getBoundingClientRect();
    return (r.width || r.height) && x >= r.left - NEAR && x <= r.right + NEAR && y >= r.top - NEAR && y <= r.bottom + NEAR;
  }
  function nodeAt(target, x, y){
    for (var el = target; el && el !== stage; el = el.parentNode) {
      for (var i = 0; i < nodes.length; i++) if (elsOf(nodes[i]).indexOf(el) >= 0) return nodes[i];
    }
    if (x == null || !(stage.contains(target) || target === view)) return null;
    var best = null, bestArea = Infinity;
    nodes.forEach(function(n){
      if (!elsOf(n).some(function(e){ return nearEl(e, x, y); })) return;
      var r = rectOf(n), area = (r.right - r.left + 1) * (r.bottom - r.top + 1);
      if (area < bestArea) { best = n; bestArea = area; }
    });
    return best;
  }
  function selectedInfos(){
    var seen = {}, out = [];
    nodes.forEach(function(n){ if (selected[n.key] && !seen[n.key]) { seen[n.key] = true; out.push(n.info); } });
    return out;
  }
  function drawSelection(){
    selLayer.innerHTML = "";
    var base = view.getBoundingClientRect();
    nodes.forEach(function(n){
      if (!selected[n.key]) return;
      var r = rectOf(n);
      var box = document.createElement("div");
      box.style.left = (r.left - base.left - 4) + "px"; box.style.top = (r.top - base.top - 4) + "px";
      box.style.width = (r.right - r.left + 8) + "px"; box.style.height = (r.bottom - r.top + 8) + "px";
      selLayer.appendChild(box);
    });
    pub.selection = selectedInfos();
  }
  function clearSelection(){ selected = {}; drawSelection(); }
  function selectOnly(key){ selected = {}; selected[key] = true; drawSelection(); }
  function toggle(key){ if (selected[key]) delete selected[key]; else selected[key] = true; drawSelection(); }

  // 按下：节点 → 选中；空白 → 框选；按住空格或鼠标中键 → 平移。
  var spaceHeld = false, drag = null;
  function typing(){ var ae = document.activeElement; return !!(ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")); }
  document.addEventListener("keydown", function(e){
    if (e.key === " " && !typing()) { e.preventDefault(); if (!spaceHeld) { spaceHeld = true; view.classList.add("pf-panning"); } return; }
    if (e.key === "Escape" && !(window.__pfNote && window.__pfNote.isOpen())) clearSelection();
    // ⌘/Ctrl+A：选中当前页的全部节点（等同于框选整张图）；在源码视图里只选源码文字。都不让浏览器
    // 把整页的界面文字（标题、页面标签、按钮）一起选上。正在输入框里打字时保留原生行为。
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "a" || e.key === "A") && !typing()) {
      e.preventDefault();
      var ns = window.getSelection();
      if (ns) ns.removeAllRanges();
      if (!sourceEl.hidden) { var range = document.createRange(); range.selectNodeContents(sourceEl); ns.addRange(range); return; }
      selected = {};
      nodes.forEach(function(n){ selected[n.key] = true; });
      drawSelection();
    }
  });
  document.addEventListener("keyup", function(e){ if (e.key === " ") { spaceHeld = false; view.classList.remove("pf-panning"); } });
  // 捕获阶段：有的渲染器会在节点上拦截 mousedown（markmap 的节点文字），冒泡阶段收不到。
  view.addEventListener("mousedown", function(e){
    if (!sourceEl.hidden || e.target.closest(".pf-dg-toolbar")) return;
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault();
      drag = { mode: "pan", x: e.clientX, y: e.clientY, vx: vp.x, vy: vp.y };
      view.classList.add("pf-panning", "pf-dragging");
      return;
    }
    if (e.button !== 0) return;
    view.focus({ preventScroll: true });
    var r = curPage && window.PFDiagram.renderers[curPage.kind];
    if (r && r.ignoreClick && r.ignoreClick(e.target)) return;
    var hit = nodeAt(e.target, e.clientX, e.clientY);
    var additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (hit) { if (additive) toggle(hit.key); else selectOnly(hit.key); return; }
    drag = { mode: "marquee", x: e.clientX, y: e.clientY, additive: additive, moved: false, base: additive ? Object.assign({}, selected) : {} };
  }, true);
  // 指针在节点上显示手型。不往渲染器生成的元素上加类名：渲染器重排时会重写它们的 class。
  view.addEventListener("mousemove", function(e){
    if (!drag) view.classList.toggle("pf-over-node", !!nodeAt(e.target, e.clientX, e.clientY));
  });
  document.addEventListener("mousemove", function(e){
    if (!drag) return;
    if (drag.mode === "pan") { vp.x = drag.vx + e.clientX - drag.x; vp.y = drag.vy + e.clientY - drag.y; applyView(); return; }
    if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 4) return;
    drag.moved = true;
    var base = view.getBoundingClientRect();
    var x1 = Math.min(drag.x, e.clientX), y1 = Math.min(drag.y, e.clientY), x2 = Math.max(drag.x, e.clientX), y2 = Math.max(drag.y, e.clientY);
    marquee.hidden = false;
    marquee.style.left = (x1 - base.left) + "px"; marquee.style.top = (y1 - base.top) + "px";
    marquee.style.width = (x2 - x1) + "px"; marquee.style.height = (y2 - y1) + "px";
    selected = Object.assign({}, drag.base);
    nodes.forEach(function(n){
      var r = rectOf(n);
      if (r.right >= x1 && r.left <= x2 && r.bottom >= y1 && r.top <= y2) selected[n.key] = true;
    });
    drawSelection();
  });
  document.addEventListener("mouseup", function(){
    if (!drag) return;
    if (drag.mode === "pan") { view.classList.remove("pf-dragging"); if (!spaceHeld) view.classList.remove("pf-panning"); }
    else if (!drag.moved && !drag.additive) clearSelection();
    marquee.hidden = true;
    drag = null;
  });
  window.addEventListener("resize", drawSelection);

  // ---- 标注（只在本地预览）：右键 → 标注 → 复制给 agent ----
  var KIND_OF_MATCH = { text: "（按文字匹配）" };
  function nodeLine(info){
    var parts = [];
    if (info.path && info.path.length) parts.push("path: " + info.path.join(" > "));
    else if (info.id) parts.push("id: " + info.id + "  label: " + info.label);
    else parts.push("label: " + info.label);
    if (info.lines) parts.push("lines: " + (info.lines[0] === info.lines[1] ? info.lines[0] : info.lines[0] + "-" + info.lines[1]));
    return "  - " + parts.join("   ") + (KIND_OF_MATCH[info.match] ? "   " + KIND_OF_MATCH[info.match] : "");
  }
  function annotationText(ctx, note){
    var lines = [];
    if (String(note || "").trim()) lines.push(String(note).trim(), "");
    var m = /^\\/p\\/([^/]+)\\//.exec(location.pathname);
    lines = lines.concat(window.__pfNote.header({
      projectId: m ? decodeURIComponent(m[1]) : "", kind: "diagram",
      source: "diagrams/" + DIAGRAM_ID + "/pages/" + ctx.page.file, version: ctx.version, head: HEAD,
    }));
    lines.push("diagram: " + TITLE + " (" + DIAGRAM_ID + ")");
    lines.push("page: " + ctx.page.name + " (" + ctx.page.id + ") · " + ((KINDS[ctx.page.kind] || {}).label || ctx.page.kind));
    if (ctx.infos.length) { lines.push("nodes:"); ctx.infos.forEach(function(i){ lines.push(nodeLine(i)); }); }
    else lines.push("nodes: （整页）");
    return lines.join("\\n");
  }
  function openNotePanel(){
    var ctx = { page: curPage, version: curVersion, infos: selectedInfos() };
    var main = ctx.infos.length === 1 ? (ctx.infos[0].path ? ctx.infos[0].path.join(" › ") : ctx.infos[0].label)
      : ctx.infos.length > 1 ? "已选 " + ctx.infos.length + " 个节点" : "整页：" + curPage.name;
    window.__pfNote.open({
      key: curVersion + "/" + curPage.id + "/" + ctx.infos.map(function(i){ return i.path ? i.path.join(">") : i.id || i.label; }).join("|"),
      title: "绘图标注", icon: (KINDS[curPage.kind] || {}).icon || PAGE_ICON,
      main: main, meta: curPage.name + " · v" + curVersion,
      placeholder: "写下希望本地 agent 怎么改这张图…",
      hint: "复制内容会包含源文件、页、版本、节点位置和源码行号。",
      compose: function(note){ return annotationText(ctx, note); },
    });
  }
  if (DIAGRAM_ID) view.addEventListener("contextmenu", function(e){
    if (!sourceEl.hidden || !curPage) return;
    e.preventDefault();
    var hit = nodeAt(e.target, e.clientX, e.clientY);
    if (hit && !selected[hit.key]) selectOnly(hit.key);
    window.__pfNote.menu(e.clientX, e.clientY, view, [{ id: "annotate", label: "标注", icon: ${JSON.stringify(ICON_NOTE)}, run: openNotePanel }]);
  });

  // ---- 图 / 源码 ----
  var toggleBtns = document.querySelectorAll(".pf-dg-toolbar .pf-toggle-btn");
  function showSource(on){
    sourceEl.hidden = !on;
    stage.style.visibility = on ? "hidden" : "";
    selLayer.style.visibility = on ? "hidden" : "";
    toggleBtns.forEach(function(b){ b.classList.toggle("active", (b.getAttribute("data-view") === "source") === on); });
  }
  toggleBtns.forEach(function(b){ b.addEventListener("click", function(){ showSource(b.getAttribute("data-view") === "source"); }); });
  function fillSource(page){
    var html = '<div class="f">pages/' + esc(page.file) + ' · ' + esc((KINDS[page.kind] || {}).label || page.kind) + '</div>';
    String(page.source).split(/\\r?\\n/).forEach(function(line, i){
      html += '<div class="l"><span class="n">' + (i + 1) + '</span><span class="c">' + (esc(line) || " ") + '</span></div>';
    });
    sourceEl.innerHTML = html;
  }

  // ---- 版本下拉：跟表格、文档阅读页同一套视觉和交互 ----
  function updateVsel(cur){
    bar.innerHTML = "";
    var w = document.createElement("div"); w.className = "pf-vsel";
    var btn = document.createElement("button"); btn.type = "button"; btn.className = "pf-vsel-btn"; btn.setAttribute("aria-expanded", "false");
    var badge = (cur !== HEAD) ? '<span class="pf-vsel-badge">v' + cur + '</span>' : '';
    btn.innerHTML = '<span class="pf-vsel-name">' + esc(TITLE) + '</span>' + badge + CHEV;
    var menu = document.createElement("div"); menu.className = "pf-vsel-menu"; menu.hidden = true;
    V.slice().sort(function(a,b){ return b.n - a.n; }).forEach(function(v){
      var a = document.createElement("a");
      a.className = "pf-vsel-item" + (v.n === cur ? " active" : "");
      a.href = v.n === HEAD ? location.pathname : location.pathname + "?v=" + v.n;
      var sub = "v" + v.n; var r = rel(v.builtAt); if (r) sub += " · " + r;
      if (v.n === cur) sub += '<span class="pf-vsel-dot" title="当前"></span>';
      if (v.note) a.title = v.note;
      a.innerHTML = '<span class="t">' + esc(v.note || TITLE) + '</span><span class="s">' + sub + '</span>';
      a.addEventListener("click", function(e){
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault(); e.stopPropagation();
        setOpen(false); render(v.n, curPage ? curPage.id : "");
      });
      menu.appendChild(a);
    });
    function setOpen(v){ menu.hidden = !v; btn.setAttribute("aria-expanded", v ? "true" : "false"); }
    btn.addEventListener("click", function(e){ e.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener("click", function(){ setOpen(false); });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape") setOpen(false); });
    w.appendChild(btn); w.appendChild(menu); bar.appendChild(w);
  }

  // ---- 渲染一页 ----
  var renderSeq = 0, curRenderer = null;
  function disposeCurrent(){
    if (curRenderer && curRenderer.dispose && curBox) { try { curRenderer.dispose(curBox); } catch (e) {} }
    curRenderer = null;
  }
  function showError(title, detail){
    errorEl.innerHTML = "<b>" + esc(title) + "</b>" + (detail ? "<pre>" + esc(detail) + "</pre>" : "");
    errorEl.hidden = false;
    pub.error = detail || title;
  }
  function render(v, pageId){
    var version = byN[v] || byN[HEAD];
    var pages = version.pages || [];
    var page = pages.find(function(p){ return p.id === pageId; }) || pages[0];
    curVersion = version.n; curPage = page || null;
    pub.version = version.n; pub.page = page ? page.id : ""; pub.ready = false; pub.error = "";
    tabsNav.innerHTML = "";
    pages.forEach(function(p){
      var tab = document.createElement("button");
      tab.type = "button"; tab.className = "pf-dg-tab" + (p === page ? " active" : "");
      tab.innerHTML = ((KINDS[p.kind] || {}).icon || PAGE_ICON) + "<span></span>";
      tab.querySelector("span").textContent = p.name;
      tab.addEventListener("click", function(){ render(version.n, p.id); });
      tabsNav.appendChild(tab);
    });
    updateVsel(version.n);
    pushState(version.n, page ? page.id : "");
    disposeCurrent();
    selected = {}; nodes = []; curBox = null; drawSelection();
    stage.innerHTML = ""; errorEl.hidden = true;
    if (!page) { showError("这个版本没有页"); return; }
    fillSource(page);
    var renderer = window.PFDiagram.renderers[page.kind];
    if (!renderer) { showError("不认识这一页的写法：" + page.kind); return; }
    curRenderer = renderer;
    var seq = ++renderSeq;
    var box = curBox = document.createElement("div");
    stage.appendChild(box);
    var ctx = { theme: __PF_THEME__, resized: function(){ if (seq === renderSeq) refreshNodes(); } };
    Promise.resolve().then(function(){ return renderer.render(box, page, ctx); }).then(function(){
      if (seq !== renderSeq) return;
      fit(); refreshNodes(); pub.ready = true;
    }, function(err){
      if (seq !== renderSeq) return;
      stage.innerHTML = "";
      showError("这一页渲染失败，源文件 pages/" + page.file, (err && err.message) || String(err));
      pub.ready = true;
    });
  }

  // 单 HTML 导出：库压缩内嵌，先解压、按顺序当脚本执行，再首次渲染。
  function loadLibs(){
    if (!__PF_LIBS__) return Promise.resolve();
    return __pfDecompressLibs(__PF_LIBS__).then(function(src){
      __PF_LIB_ORDER__.forEach(function(name){
        var s = document.createElement("script"); s.textContent = src[name]; document.head.appendChild(s);
      });
    });
  }
  var init = parseState();
  loadLibs().then(function(){ render(init.v, init.page); });
})();`;
}
