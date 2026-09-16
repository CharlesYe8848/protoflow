// core/docPreview.js — doc 的本地阅读页。一个自包含 preview.html 承载**全部版本**（每版的原始
// markdown 内嵌），版本切换在页内完成：重渲染 #doc + 用 history 改 ?v=<n>，不跳转页面（参考
// Artifacts）。渲染仍在浏览器端（marked + 可选 mermaid）；Node 端只负责把每版 markdown 收集好、
// 把图片引用改写成版本作用域路径（versions/<n>/assets/）。
//
//   docs/<docId>/preview.html   唯一的阅读页，默认展示 head 版本，?v=<n> 展示历史版本
import { MERMAID_THEME_VARS, exportDownloadScript, exportMenuRowsHtml, ICON_SHARE } from "./preview.js";
import { EXPORT_MENU } from "./exportMenu.js";
import { decompressLibsScript } from "./libCodec.js";
import { FAVICON_LINK, BRAND_CSS_VARS } from "./brand.js";

const escapeScript = (s) => String(s).replace(/<\/script/gi, "<\\/script");
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function usesMermaidDoc(md) {
  return /```mermaid\b/.test(String(md));
}

// <!-- protoflow:changelog --> 标记的展开算法——跟下面 appScript() 里浏览器端的
// changelogTable()/injectChangelog() 是同一套算法的两份实现：一份跑在浏览器里生成阅读页 HTML，
// 一份跑在 Node 里给 markdown 导出用（core/exportDocMarkdown.js）。两边输出的表必须逐字节一致，
// 改一处记得改另一处；两边都只认正文里有没有这个标记字符串，不看文档类型。
export const CHANGELOG_MARKER = "<!-- protoflow:changelog -->";

function ymdNode(iso) { return String(iso || "").slice(0, 10); }
function cellTxtNode(s) { return String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim(); }

export function changelogTableMarkdown(versions, upto) {
  const rows = versions.filter((v) => v.n <= upto).slice().sort((a, b) => b.n - a.n);
  if (!rows.length) return "";
  const h = "| 版本 | 修改日期 | 修改人 | 修改内容 |\n| :--- | :--- | :--- | :--- |";
  const b = rows.map((v) => `| v${v.n} | ${ymdNode(v.builtAt)} | ${cellTxtNode(v.author)} | ${cellTxtNode(v.note)} |`).join("\n");
  return h + "\n" + b;
}

export function injectChangelogMarkdown(md, versions, upto) {
  if (md.indexOf(CHANGELOG_MARKER) === -1) return md;
  return md.replace(CHANGELOG_MARKER, changelogTableMarkdown(versions, upto) || "");
}

// opts:
//   versions   [{ n, md, note, author, builtAt }]，全部版本，md 已改写好图片引用（versions/<n>/assets/）
//   head       head 版本号
//   title      文档标题（doc.json.title，= 一级标题）；浏览器标签页 <title> = 「<title> · protoflow 文档」，
//              不带项目名——项目上下文由画布那侧承担，文档页只标自己
//   kind       当前文档类型（分组 key）
//   kindLabel  当前文档类型显示名（左上角菜单里当前文档所在分组的组头）
//   siblings   同项目其它文档（跨类型）[{ id, kind, kindLabel, title, href }]，href 相对
//              docs/<docId>/preview.html；只有名字 + 入口，版本在各文档自己那页看
//   anyMermaid 是否有任一版本用到 mermaid（决定要不要引 mermaid.min.js）
//   libRelPath lib/ 相对路径（唯一阅读页固定 "../../lib"；导出目录树里 preview.html 跟 lib/ 同级，
//              传 "lib"）
//   standalone 导出时传 true：去掉「返回画布」「导出」按钮和「同项目其它文档」——这些跳转目标
//              在导出产物里要么不存在、要么没有服务可 POST。
//   compressedLibs 单 HTML 导出专用（core/exportDocHtml.js 传，core/libCodec.js 产出）：
//              { "marked.min.js": {format,base64}, "mermaid.min.js"?: {...} }——marked/mermaid
//              从 <script src> 换成压缩内嵌，运行时解压后当脚本执行（导出产物没有 lib/ 目录，
//              压缩是因为这俩文件本身不小，marked 几十 KB、mermaid 3.5MB，湊在一起也值得压）。
//              不传就是目录树导出/实时预览那套 <script src="${libRelPath}/...."> 引真实文件，
//              行为不变。
export function renderDocPreviewHtml(opts = {}) {
  let {
    versions = [], head = 0, title = "文档", kind = "", kindLabel = "",
    siblings = [], anyMermaid = false, libRelPath = "../../lib", standalone = false,
    compressedLibs = null,
  } = opts;
  if (standalone) siblings = [];

  const tabTitle = title + " · protoflow 文档";
  // 压缩模式下 marked/mermaid 不在这里静态拼 <script> 标签——解压、当脚本执行这一步挪到
  // appScript() 的启动逻辑里（得先解压完、window.marked 真的存在，首次渲染才能调 marked.parse()）。
  const markedTag = compressedLibs ? "" : `<script src="${libRelPath}/marked.min.js"><\/script>`;
  const mermaidTag = !anyMermaid || compressedLibs ? "" : `<script src="${libRelPath}/mermaid.min.js"><\/script>`;
  const compressedLibsScript = compressedLibs
    ? `<script type="application/json" id="pf-compressed-libs">${escapeScript(JSON.stringify(compressedLibs))}<\/script>`
    : "";
  const homeLink = standalone ? "" : `<a class="pf-hdr-home" href="../../canvas.html" title="返回画布"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5"/><path d="M5 10v10h14V10"/></svg></a>`;
  // 「导出」按钮只在 dev server 实时预览里出现——导出产物（standalone）不需要、也没有服务可
  // POST。点某一行菜单 POST /p/<key>/__protoflow_export/doc/<docId>/<formatId>，回一份可下载的
  // 文件。菜单行从 core/exportMenu.js 的登记表生成，加新格式改那张表，这里不用动。
  const shareBtn = standalone ? "" : `<div class="pf-hdr-r"><div class="pf-export-entry">
    <button class="pf-hdr-share" type="button" title="分享">${ICON_SHARE}<span class="pf-export-label">分享</span></button>
    <div class="pf-export-menu" hidden><div class="pf-export-menu__section">导出</div>${exportMenuRowsHtml(EXPORT_MENU.doc)}</div>
  </div></div>`;

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
${FAVICON_LINK}
<title>${escHtml(tabTitle)}</title>
<style>
${BRAND_CSS_VARS}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:#f6f7fb;color:#0f172a;font-family:"PingFang SC","Microsoft YaHei",-apple-system,sans-serif;line-height:1.75}
.pf-hdr{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:8px;height:40px;padding:0 12px 0 8px;background:#fff;border-bottom:1px solid #e9ebef;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.pf-hdr-l{display:flex;align-items:center;gap:4px;min-width:0}
.pf-hdr-r{display:flex;align-items:center;gap:4px;flex:none}
.pf-export-entry{position:relative}
.pf-hdr-share{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:12px;font-weight:400;color:rgba(15,23,42,.75);background:transparent;border:0;border-radius:6px;cursor:pointer}
.pf-hdr-share:hover{background:rgba(15,23,42,.06)}
.pf-hdr-share:disabled{opacity:.5;cursor:default}
.pf-hdr-share svg{flex:none}
/* 导出菜单：参考 Claude/Luma 那套 Export 弹层，跟 core/canvas.js 的 .pf-export-menu 同一套
   样式/交互（[hidden] 开合），格式列表来自 core/exportMenu.js。 */
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
.pf-hdr-home{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border-radius:7px;color:rgba(15,23,42,.55);text-decoration:none}
.pf-hdr-home:hover{background:rgba(15,23,42,.06);color:#0f172a}
.pf-hdr-home svg{width:15px;height:15px}
.pf-doc-bar{display:flex;min-width:0}
.pf-vsel{position:relative;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:12px}
.pf-vsel *{box-sizing:border-box}
.pf-vsel-btn{display:inline-flex;align-items:center;gap:5px;max-width:60vw;height:26px;padding:0 5px 0 7px;font-family:inherit;font-size:12px;font-weight:400;line-height:1;color:rgba(15,23,42,.75);background:transparent;border:0;border-radius:6px;cursor:pointer;transition:background .1s ease}
.pf-vsel-btn:hover,.pf-vsel-btn[aria-expanded="true"]{background:rgba(15,23,42,.06)}
.pf-vsel-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-vsel-badge{flex:none;border-radius:999px;background:rgba(15,23,42,.06);color:#8a919c;padding:1px 6px;font-size:10.5px;line-height:1.4}
.pf-vsel-chev{width:11px;height:11px;flex:none;opacity:.45}
.pf-vsel-menu{position:absolute;left:0;top:calc(100% + 4px);width:250px;background:#fff;border:1px solid #e9ebef;border-radius:10px;box-shadow:0 8px 26px rgba(15,23,42,.12);padding:4px;z-index:60;max-height:62vh;overflow:auto}
.pf-vsel-menu[hidden]{display:none}
.pf-vsel-item{display:block;padding:7px 9px;border-radius:6px;text-decoration:none;cursor:pointer}
.pf-vsel-item:hover{background:#f6f7f9}
.pf-vsel-item.active{background:#f1f3f5}
.pf-vsel-item .t{display:block;font-size:12px;font-weight:500;line-height:1.35;color:#1a1d21;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-vsel-item .s{display:block;font-size:11px;font-weight:400;line-height:1.3;color:#9aa1ab;margin-top:2px}
.pf-vsel-sep{height:1px;background:#eef0f3;margin:4px 6px}
.pf-vsel-hd{padding:5px 9px 2px;font-size:10px;font-weight:600;line-height:1.3;color:#a0a6b0;letter-spacing:.03em}
.pf-vsel-doc{padding:7px 9px 3px;font-size:12px;font-weight:600;line-height:1.35;color:#1a1d21;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-vsel-item.pf-vsel-ver{padding-left:22px}
.pf-vsel-dot{display:inline-block;width:5px;height:5px;margin-left:5px;border-radius:50%;background:#0f172a;vertical-align:middle}
.page{max-width:1160px;margin:0 auto;padding:28px 24px 80px;display:flex;align-items:flex-start;gap:32px}
.toc{width:220px;flex:none;position:sticky;top:64px;max-height:calc(100vh - 104px);overflow:auto;font-size:13px}
.toc-title{font-weight:600;color:#0f172a;margin-bottom:8px}
.toc nav{display:flex;flex-direction:column}
.toc nav a{display:block;padding:5px 0 5px 10px;color:#64748b;text-decoration:none;border-left:2px solid transparent;line-height:1.4}
.toc nav a:hover{color:#0f172a}
.toc nav a.active{color:var(--pf-brand);border-left-color:var(--pf-brand);font-weight:600}
.toc nav a.lvl-h2{padding-left:22px}
.toc nav a.lvl-h3{padding-left:34px}
@media (max-width:900px){.toc{display:none}}
.wrap{flex:1;min-width:0;max-width:860px}
.doc{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:40px 48px}
.doc h1,.doc h2,.doc h3,.doc h4{line-height:1.4;scroll-margin-top:56px}
.doc h1{font-size:28px;border-bottom:1px solid #eef0f5;padding-bottom:12px}
.doc h2{font-size:21px;margin-top:36px}
.doc h3{font-size:17px;margin-top:28px}
.doc img{max-width:100%;border:1px solid #e2e8f0;border-radius:8px;display:block;margin:12px 0}
.doc table{border-collapse:collapse;width:100%;margin:16px 0}
.doc th,.doc td{border:1px solid #e2e8f0;padding:8px 12px;text-align:left}
.doc th{background:#f8fafc;font-weight:600}
.doc code{background:#f1f5f9;border-radius:4px;padding:1px 6px;font-size:.9em}
.doc pre{background:#0f172a;color:#e2e8f0;border-radius:8px;padding:16px;overflow:auto}
.doc pre code{background:none;padding:0;color:inherit}
.doc pre.mermaid{background:#fff;padding:8px;text-align:center}
.doc blockquote{margin:0;padding:4px 16px;border-left:3px solid #cbd5e1;color:#475569}
.pf-mermaid-wrap{position:relative;margin:12px 0}
.pf-toggle-group{display:flex;gap:2px;background:#eef0f3;border-radius:8px;padding:3px}
.pf-toggle-btn{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;background:transparent;border-radius:6px;color:#8a919c;cursor:pointer}
.pf-toggle-btn svg{width:14px;height:14px}
.pf-toggle-btn:hover{color:#0f172a}
.pf-toggle-btn.active{background:#fff;color:#0f172a;box-shadow:0 1px 3px rgba(15,23,42,.12)}
.pf-mermaid-toolbar{position:absolute;top:6px;right:6px;z-index:1}
</style></head><body>
<header class="pf-hdr">
  <div class="pf-hdr-l">
    ${homeLink}
    <div class="pf-doc-bar" id="pfDocBar"></div>
  </div>
  ${shareBtn}
</header>
<div class="page">
<aside class="toc" id="tocAside"><div class="toc-title">目录</div><nav id="tocNav"></nav></aside>
<div class="wrap"><article class="doc" id="doc"></article></div>
</div>
${markedTag}
${mermaidTag}
${compressedLibsScript}
<script>
var __PF_VERSIONS__ = ${escapeScript(JSON.stringify(versions))};
var __PF_HEAD__ = ${JSON.stringify(head)};
var __PF_TITLE__ = ${escapeScript(JSON.stringify(title))};
var __PF_KIND__ = ${escapeScript(JSON.stringify(kind))};
var __PF_KIND_LABEL__ = ${escapeScript(JSON.stringify(kindLabel))};
var __PF_SIBLINGS__ = ${escapeScript(JSON.stringify(siblings))};
var __PF_ANY_MERMAID__ = ${JSON.stringify(!!anyMermaid)};
${compressedLibs ? decompressLibsScript() : ""}
${appScript({ compressedLibs: !!compressedLibs })}
<\/script>
${standalone ? "" : `<script>${shareScript()}<\/script>`}
</body></html>`;
}

// 「导出」按钮：只在 dev server 实时预览里挂。点按钮弹出格式菜单（跟 .pf-doc-menu 同一套
// [hidden] 开合），选一行才从 location.pathname（/p/<key>/docs/<docId>/preview.html）反推 key 和
// docId，POST 到对应格式的导出端点，拿回一个可下载的文件，用隐藏 <a download> 触发下载。
function shareScript() {
  return `
(function(){
  ${exportDownloadScript()}
  var entry = document.querySelector(".pf-export-entry");
  if (!entry) return;
  var btn = entry.querySelector(".pf-hdr-share");
  var menu = entry.querySelector(".pf-export-menu");
  var m = /^\\/p\\/([^\\/]+)\\/docs\\/([^\\/]+)\\/preview\\.html$/.exec(location.pathname);
  if (!m) { btn.disabled = true; btn.title = "仅在 protoflow 预览服务中可导出"; return; }
  var key = m[1], docId = decodeURIComponent(m[2]);
  btn.addEventListener("click", function(e){ e.stopPropagation(); menu.hidden = !menu.hidden; });
  menu.querySelectorAll(".pf-export-menu__item").forEach(function(item){
    item.addEventListener("click", function(){
      menu.hidden = true;
      __pfDownloadExport("/p/" + key + "/__protoflow_export/doc/" + encodeURIComponent(docId) + "/" + item.getAttribute("data-format"), btn);
    });
  });
  document.addEventListener("click", function(e){ if (!menu.hidden && !entry.contains(e.target)) menu.hidden = true; });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") menu.hidden = true; });
})();`;
}

// 页内 SPA：内嵌全部版本，切换版本 = 重渲染 #doc + history 改 ?v=<n>，不跳转。
// compressedLibs：单 HTML 导出时传 true——marked/mermaid 压缩内嵌，首次渲染前得先解压、当脚本
// 执行（window.marked 得真的存在，render() 里的 marked.parse() 才能调），所以最后触发首次渲染
// 那一步要等解压完的 Promise，不能像目录树导出/实时预览那样直接同步调。
function appScript({ compressedLibs = false } = {}) {
  return `
(function(){
  var V = __PF_VERSIONS__, HEAD = __PF_HEAD__, TITLE = __PF_TITLE__, SIB = __PF_SIBLINGS__;
  var KIND = __PF_KIND__, KIND_LABEL = __PF_KIND_LABEL__;
  var byN = {}; V.forEach(function(v){ byN[v.n] = v; });
  var docEl = document.getElementById("doc");
  var bar = document.getElementById("pfDocBar");
  var tocAside = document.getElementById("tocAside");
  var tocNav = document.getElementById("tocNav");
  var tocObserver = null;
  var tocScroll = null; // 当前版本目录的 scroll 处理器，重建目录时先摘掉旧的

  function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function ymd(iso){ return String(iso || "").slice(0, 10); }
  function cellTxt(s){ return String(s == null ? "" : s).replace(/\\|/g,"\\\\|").replace(/\\r?\\n/g," ").trim(); }
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

  // 修改记录表是不是要出现，完全由正文里有没有这个标记决定——没有别的开关。想要这张表的文档
  // 类型，模板/writing 规范会指导 agent 把标记写进 doc.md（比如 PRD）；不想要的类型，写作规范
  // 干脆不提这个标记（比如上线公告），agent 自然不会写，这里也就没什么可替换的。框架本身不
  // 认识"这是哪种文档类型"，只认正文内容里这一个标记字符串——不猜、不兜底插到标题下方：
  // 没有标记就是没有标记，说明这份文档不需要这张表。
  var MARKER = "<!-- protoflow:changelog -->";
  function changelogTable(upto){
    var rows = V.filter(function(v){ return v.n <= upto; }).slice().sort(function(a,b){ return b.n - a.n; });
    if (!rows.length) return "";
    var h = "| 版本 | 修改日期 | 修改人 | 修改内容 |\\n| :--- | :--- | :--- | :--- |";
    var b = rows.map(function(v){ return "| v" + v.n + " | " + ymd(v.builtAt) + " | " + cellTxt(v.author) + " | " + cellTxt(v.note) + " |"; }).join("\\n");
    return h + "\\n" + b;
  }
  function injectChangelog(md, upto){
    if (md.indexOf(MARKER) === -1) return md;
    return md.replace(MARKER, changelogTable(upto) || "");
  }

  ${MERMAID_THEME_VARS_JS()}
  var mermaidInited = false;
  function renderMermaid(){
    if (!window.mermaid) return;
    if (!mermaidInited){ window.mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: __PF_MERMAID_VARS__ }); mermaidInited = true; }
    docEl.querySelectorAll("pre code.language-mermaid").forEach(function(codeEl){
      var raw = codeEl.textContent;
      var pre = codeEl.parentElement;
      var wrap = document.createElement("div"); wrap.className = "pf-mermaid-wrap";
      var toolbar = document.createElement("div"); toolbar.className = "pf-mermaid-toolbar pf-toggle-group";
      var eyeBtn = document.createElement("button"); eyeBtn.type = "button"; eyeBtn.className = "pf-toggle-btn active"; eyeBtn.title = "查看图";
      eyeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>';
      var codeBtn = document.createElement("button"); codeBtn.type = "button"; codeBtn.className = "pf-toggle-btn"; codeBtn.title = "查看代码";
      codeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
      toolbar.appendChild(eyeBtn); toolbar.appendChild(codeBtn);
      var diagram = document.createElement("pre"); diagram.className = "mermaid"; diagram.textContent = raw;
      var codeBlock = document.createElement("pre"); codeBlock.className = "pf-mermaid-code"; codeBlock.style.display = "none";
      var codeInner = document.createElement("code"); codeInner.textContent = raw; codeBlock.appendChild(codeInner);
      wrap.appendChild(toolbar); wrap.appendChild(diagram); wrap.appendChild(codeBlock);
      pre.replaceWith(wrap);
      function show(showCode){ diagram.style.display = showCode ? "none" : ""; codeBlock.style.display = showCode ? "" : "none"; eyeBtn.classList.toggle("active", !showCode); codeBtn.classList.toggle("active", showCode); }
      eyeBtn.onclick = function(){ show(false); }; codeBtn.onclick = function(){ show(true); };
    });
    window.mermaid.run();
  }

  // 目录：扫 #doc 里的标题，跳过第一个（文档自己的标题）。每次重渲染都重建，先断掉上一轮的
  // IntersectionObserver。没有其它标题时隐藏目录。
  function buildToc(){
    if (tocObserver){ tocObserver.disconnect(); tocObserver = null; }
    if (tocScroll){ window.removeEventListener("scroll", tocScroll); tocScroll = null; }
    tocNav.innerHTML = "";
    tocAside.style.display = "";
    var heads = Array.prototype.slice.call(docEl.querySelectorAll("h1, h2, h3")).slice(1);
    if (!heads.length){ tocAside.style.display = "none"; return; }
    var links = heads.map(function(hd, i){
      hd.id = "pf-h-" + i;
      var a = document.createElement("a");
      a.href = "#" + hd.id; a.textContent = hd.textContent; a.className = "lvl-" + hd.tagName.toLowerCase();
      tocNav.appendChild(a);
      return { el: hd, a: a };
    });
    // 高亮当前小节：当前标题 = 顶边已经滚过“阅读线”（吸顶头下方一点）的**最后**一个标题。
    // 回归测试：早先是"回调里对每个 isIntersecting 的 entry 依次 add active"，一级标题（「一、
    // xxx」）后面总紧跟二级标题（「1.1、xxx」），点一级标题时两个一起进激活区，排在后面的二级
    // 标题 entry 把一级标题的高亮顶掉，导致一级标题几乎永远高亮不上。按位置取"滚过阅读线的最后
    // 一个"没有 entry 顺序的歧义，一级/二级都能稳定命中。配合 heading 的 scroll-margin-top，
    // 点击跳转后标题正好落在阅读线下方，对应目录项立即高亮。
    // scroll 监听（rAF 合并）是高亮的主力，IntersectionObserver 只作补充触发（首屏/图片撑高
    // 导致的位移）——只靠 IO 做滚动高亮众所周知不稳，边界命中和回调时机都不可控。
    var READ_LINE = 80; // 视口顶起算，略低于 .pf-hdr(40px)
    var raf = 0;
    function syncActive(){
      raf = 0;
      var cur = null;
      for (var i = 0; i < links.length; i++){
        if (links[i].el.getBoundingClientRect().top - 1 <= READ_LINE) cur = links[i]; else break;
      }
      if (!cur) cur = links[0];
      links.forEach(function(l){ l.a.classList.toggle("active", l === cur); });
    }
    function scheduleSync(){ if (!raf) raf = requestAnimationFrame(syncActive); }
    tocScroll = scheduleSync;
    window.addEventListener("scroll", tocScroll, { passive: true });
    tocObserver = new IntersectionObserver(scheduleSync, { rootMargin: "-56px 0px -66% 0px" });
    links.forEach(function(l){ tocObserver.observe(l.el); });
    syncActive();
  }

  var CHEV = '<svg class="pf-vsel-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  function baseUrl(){ return location.pathname; }
  function urlForV(n){ return n === HEAD ? baseUrl() : baseUrl() + "?v=" + n; }

  function updateBar(cur){
    bar.innerHTML = "";
    var wrap = document.createElement("div"); wrap.className = "pf-vsel";
    var btn = document.createElement("button"); btn.type = "button"; btn.className = "pf-vsel-btn"; btn.setAttribute("aria-expanded", "false");
    var badge = (cur !== HEAD) ? '<span class="pf-vsel-badge">v' + cur + '</span>' : '';
    btn.innerHTML = '<span class="pf-vsel-name">' + esc(TITLE) + '</span>' + badge + CHEV;
    var menu = document.createElement("div"); menu.className = "pf-vsel-menu"; menu.hidden = true;

    // 按类型分组：当前文档所在类型排最前，其余按 siblings 里的出现顺序。组内当前文档在最前，
    // 标题下平铺它自己的全部版本；其它文档只占一行，点了跳去它自己的阅读页看版本。
    // 没有其它文档时（structured=false）退化成纯版本列表，跟分组前一样。
    var structured = SIB.length > 0;
    var groups = [], gmap = {};
    function grp(k, label){
      if (!gmap[k]){ gmap[k] = { label: label, items: [] }; groups.push(gmap[k]); }
      return gmap[k];
    }
    grp(KIND, KIND_LABEL).items.push({ current: true });
    SIB.forEach(function(s){ grp(s.kind, s.kindLabel).items.push({ current: false, title: s.title, href: s.href }); });

    function addVersionRows(){
      V.slice().sort(function(a,b){ return b.n - a.n; }).forEach(function(v){
        var a = document.createElement("a");
        a.className = "pf-vsel-item" + (structured ? " pf-vsel-ver" : "") + (v.n === cur ? " active" : "");
        a.href = urlForV(v.n); // 中键/新标签打开仍是有效地址（?v=N 载入后 SPA 自己解析）
        var sub = "v" + v.n; var r = rel(v.builtAt); if (r) sub += " · " + r;
        if (v.n === cur) sub += '<span class="pf-vsel-dot" title="当前"></span>'; // 当前版本用黑色小圆点标记，不再写「当前」二字
        a.innerHTML = (structured ? "" : '<span class="t">' + esc(TITLE) + '</span>') + '<span class="s">' + sub + '</span>';
        a.addEventListener("click", function(e){
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // 让浏览器正常新标签打开
          e.preventDefault(); e.stopPropagation();
          setOpen(false); go(v.n, true);
        });
        menu.appendChild(a);
      });
    }

    groups.forEach(function(g, gi){
      if (structured){
        if (gi > 0){ var sep = document.createElement("div"); sep.className = "pf-vsel-sep"; menu.appendChild(sep); }
        var hd = document.createElement("div"); hd.className = "pf-vsel-hd"; hd.textContent = g.label; menu.appendChild(hd);
      }
      g.items.forEach(function(it){
        if (it.current){
          if (structured){
            var dt = document.createElement("div"); dt.className = "pf-vsel-doc";
            dt.textContent = TITLE; // 「当前」只标在下面那版，标题行不重复
            menu.appendChild(dt);
          }
          addVersionRows();
        } else {
          var a = document.createElement("a"); a.className = "pf-vsel-item"; a.href = it.href;
          a.innerHTML = '<span class="t">' + esc(it.title) + '</span>';
          menu.appendChild(a);
        }
      });
    });
    function setOpen(v){ menu.hidden = !v; btn.setAttribute("aria-expanded", v ? "true" : "false"); }
    btn.addEventListener("click", function(e){ e.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener("click", function(){ setOpen(false); });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape") setOpen(false); });
    wrap.appendChild(btn); wrap.appendChild(menu); bar.appendChild(wrap);
  }

  function render(n){
    var v = byN[n] || byN[HEAD]; n = v.n;
    docEl.innerHTML = marked.parse(injectChangelog(v.md, n));
    buildToc();
    if (__PF_ANY_MERMAID__) renderMermaid();
    updateBar(n);
    return n;
  }
  function go(n, push){
    n = render(n);
    var url = urlForV(n);
    if (push) history.pushState({ v: n }, "", url); else history.replaceState({ v: n }, "", url);
    window.scrollTo(0, 0);
  }
  function fromUrl(){
    var m = /[?&]v=(\\d+)/.exec(location.search);
    var n = m ? parseInt(m[1], 10) : HEAD;
    return byN[n] ? n : HEAD;
  }
  window.addEventListener("popstate", function(){ render(fromUrl()); window.scrollTo(0, 0); });
  ${compressedLibs ? `
  var __pfCompressedLibs = {};
  try { __pfCompressedLibs = JSON.parse(document.getElementById("pf-compressed-libs").textContent) || {}; } catch (e) {}
  __pfDecompressLibs(__pfCompressedLibs).then(function(sources){
    Object.keys(sources).forEach(function(name){
      var s = document.createElement("script");
      s.text = sources[name];
      document.head.appendChild(s);
    });
    go(fromUrl(), false);
  });` : `go(fromUrl(), false);`}
})();
`;
}

function MERMAID_THEME_VARS_JS() {
  return `var __PF_MERMAID_VARS__ = ${JSON.stringify(MERMAID_THEME_VARS)};`;
}
