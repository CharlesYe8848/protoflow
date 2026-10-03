// core/sheetPreview.js — 表格的本地阅读页。一个自包含 preview.html 承载全部版本（每版的内容对象
// 内嵌），版本/sheet 切换在页内完成：重渲染 #pfSheetWrap + 用 history 改 ?v=&sheet=，不跳转页面。
// 跟 core/docPreview.js 是同一个"内嵌全部版本、客户端 SPA 切换"的思路，但不需要 marked/mermaid/
// TOC/changelog 那一整套——表格没有正文 markdown，版本历史直接在版本下拉里看（说明 + 版本号 + 时间，跟文档/画布同一个写法）。
//
// 头部 chrome（版本切换下拉 .pf-vsel、导出菜单）照抄 core/docPreview.js 那一套的视觉和交互，两边
// 应该长得一样——目前是各自一份实现（sheet 没有 doc 的"同项目其它文档"分组这层，比 doc 简单），
// 还没抽成共享函数，改版本切换器的样式/交互记得两边一起改。
//
// 表格渲染用 DOM API（createElement + textContent + style.cssText），不拼 HTML 字符串塞
// innerHTML——单元格内容天然安全（textContent 不会被当标签解析），样式走 CSSOM 属性赋值（CSS
// 解析器不会执行脚本），不需要额外的 HTML 属性转义。
//
// 单元格样式级联解析（parseCssLevel/mergeCascade/resolveCellFlatStyle）是 core/sheetStyle.js 那
// 套算法的第二份实现——两边解析的是同一个第三方库（inline-style-parser）的输出，不是各自猜 CSS
// 语法，风险只在这几行简单的合并/危险值过滤逻辑上，改一处记得改另一处。
import { BRAND_CSS_VARS, FAVICON_LINK, FULLSCREEN_CSS, ICON_NOTE, ICON_SHARE, NOTE_PANEL_CSS, exportDownloadScript, exportMenuRowsHtml, fullscreenButtonHtml, fullscreenScript, notePanelScript } from "protoflow/sdk";
import { SHEET_EXPORT_MENU } from "./exportMenu.js";

const escapeScript = (s) => String(s).replace(/<\/script/gi, "<\\/script");
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// opts:
//   versions   [{ n, content, note, author, builtAt }] 全部版本，content 是那一版 sheet.json 解析后的对象
//   head       head 版本号
//   title      表格标题
//   sheetId    本地预览中的表格目录名；导出页不传，因此不显示给本地 agent 用的标注菜单
//   standalone 导出时传 true：去掉「导出」按钮——导出产物里没有服务可 POST
//   libRelPath lib/ 相对路径（实时预览固定 "../../lib"，导出目录树里传 "lib"）
export function renderSheetPreviewHtml(opts = {}) {
  const { versions = [], head = 0, title = "表格", sheetId = "", standalone = false, libRelPath = "../../lib" } = opts;
  const tabTitle = title + " · protoflow 表格";
  const shareBtn = `<div class="pf-hdr-r">${fullscreenButtonHtml()}${standalone ? "" : `<div class="pf-export-entry">
    <button class="pf-hdr-share" type="button" title="分享">${ICON_SHARE}<span class="pf-export-label">分享</span></button>
    <div class="pf-export-menu" hidden><div class="pf-export-menu__section">导出</div>${exportMenuRowsHtml(SHEET_EXPORT_MENU)}</div>
  </div>`}</div>`;

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
${FAVICON_LINK}
<title>${escHtml(tabTitle)}</title>
<script src="${libRelPath}/inline-style-parser.min.js"><\/script>
<style>
${BRAND_CSS_VARS}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
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
.pf-sheet-frame{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;background:#fff;border:1px solid #c9ccd1;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.06)}
.pf-sheet-scroll{flex:1;min-height:0;overflow:auto;background:#fff}
.pf-sheet-bottom{position:relative;z-index:8;flex:none;display:flex;align-items:center;height:32px;background:#f3f4f6;border-top:1px solid #dde0e5}
.pf-sheet-zoom{position:relative;flex:none;display:flex;align-items:center;gap:1px;height:100%;padding:0 6px;border-left:1px solid #dde0e5;background:#f3f4f6}
.pf-sheet-zoom__step{display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:none;background:transparent;border-radius:6px;font:18px/1 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#667085;cursor:pointer}
.pf-sheet-zoom__step:hover{background:rgba(15,23,42,.06);color:#1f2937}
.pf-sheet-zoom__label{min-width:48px;height:26px;padding:0 6px;border:none;background:none;border-radius:6px;font:12px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#475569;cursor:pointer}
.pf-sheet-zoom__label:hover{background:#f1f5f9}
.pf-sheet-zoom__menu{position:absolute;right:0;bottom:calc(100% + 8px);min-width:168px;display:flex;flex-direction:column;gap:1px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 4px 16px rgba(15,23,42,.12);padding:4px}
.pf-sheet-zoom__menu[hidden]{display:none}
.pf-sheet-zoom__menu button{text-align:left;padding:7px 10px;border:none;background:none;border-radius:6px;font:13px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#334155;cursor:pointer}
.pf-sheet-zoom__menu button:hover{background:#f1f5f9}
.pf-sheet-zoom__sep{height:1px;background:#e2e8f0;margin:3px 4px}
.pf-grid{border-collapse:separate;border-spacing:0;font-size:12.5px;font-variant-numeric:tabular-nums}
.pf-grid th,.pf-grid td{border-right:1px solid #e1e3e8;border-bottom:1px solid #e1e3e8;padding:5px 10px;white-space:pre-wrap;line-height:1.5;text-align:left}
.pf-grid thead th{position:sticky;top:0;z-index:2;background:#f3f4f6;color:#5f6570;font-weight:600;font-size:11.5px;text-align:center;height:26px;padding:4px 8px;cursor:pointer;user-select:none}
.pf-grid .pf-gutter{position:sticky;left:0;z-index:1;background:#f3f4f6;color:#8a919c;text-align:center;font-weight:400;min-width:40px;user-select:none;cursor:pointer}
.pf-grid thead th.pf-gutter{z-index:3}
.pf-grid tbody td:not(.pf-gutter){cursor:cell}
.pf-grid td,.pf-grid th{position:relative}
.pf-grid .pf-sel::after{content:"";position:absolute;inset:0 -1px -1px 0;box-sizing:border-box;pointer-events:none;border:0 solid #3b73d1}
.pf-grid .pf-sel-fill::after{background:rgba(59,115,209,.075)}
.pf-grid .pf-sel-top::after{border-top-width:2px}
.pf-grid .pf-sel-bottom::after{border-bottom-width:2px}
.pf-grid .pf-sel-left::after{border-left-width:2px}
.pf-grid .pf-sel-right::after{border-right-width:2px}
.pf-grid thead th:hover,.pf-grid .pf-gutter:hover{background:#e9ebee}
.pf-grid thead th.pf-sel-header,.pf-grid .pf-gutter.pf-sel-header{background:#e8effc;color:#3268be}
.pf-grid thead th.pf-sel-header-strong,.pf-grid .pf-gutter.pf-sel-header-strong{background:#dbe7fb;color:#235caf;font-weight:600}
.pf-empty{padding:48px 10px;text-align:center;color:#94a3b8;font-size:13.5px}
.pf-grid td.pf-image-cell{overflow:hidden;vertical-align:middle}
.pf-cell-img{display:block;max-width:200px;max-height:150px;margin:auto;object-fit:contain;border-radius:3px;cursor:zoom-in}
.pf-grid--columns-locked .pf-cell-img{max-width:100%}
.pf-lightbox{position:fixed;inset:0;z-index:100;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center;cursor:zoom-out}
.pf-lightbox img{max-width:90vw;max-height:90vh;border-radius:6px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
.pf-sheet-tabs{flex:1;min-width:0;display:flex;align-items:center;gap:2px;height:100%;padding:0 8px;overflow:auto}
.pf-sheet-tab{font-family:inherit;font-size:12px;padding:5px 14px;border:1px solid transparent;border-radius:5px;background:transparent;color:#6b7280;cursor:pointer}
.pf-sheet-tab:hover{background:rgba(15,23,42,.05)}
.pf-sheet-tab.active{background:#fff;border-color:#dde0e5;color:#0f172a;font-weight:600}
${NOTE_PANEL_CSS}
${FULLSCREEN_CSS}html.pf-fs .pf-page{height:100vh}
</style></head><body>
<header class="pf-hdr" data-pf-chrome>
  <div class="pf-hdr-l"><span data-pf-nav-slot></span><div id="pfDocBar"></div></div>
  ${shareBtn}
</header>
<div class="pf-page">
  <div class="pf-sheet-frame">
    <div class="pf-sheet-scroll" id="pfSheetWrap"></div>
    <div class="pf-sheet-bottom">
      <nav class="pf-sheet-tabs" id="pfTabs"></nav>
      <div class="pf-sheet-zoom" data-pf-chrome>
        <button class="pf-sheet-zoom__out pf-sheet-zoom__step" type="button" aria-label="缩小">−</button>
        <button class="pf-sheet-zoom__label" type="button" aria-expanded="false">100%</button>
        <button class="pf-sheet-zoom__in pf-sheet-zoom__step" type="button" aria-label="放大">＋</button>
        <div class="pf-sheet-zoom__menu" hidden>
          <button class="pf-sheet-zoom__reset" type="button">缩放至 100%</button>
          <button class="pf-sheet-zoom__fit" type="button">自适应窗口</button>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
var __PF_VERSIONS__ = ${escapeScript(JSON.stringify(versions))};
var __PF_HEAD__ = ${JSON.stringify(head)};
var __PF_TITLE__ = ${escapeScript(JSON.stringify(title))};
var __PF_SHEET_ID__ = ${escapeScript(JSON.stringify(standalone ? "" : sheetId))};
${appScript()}
<\/script>
${standalone ? "" : `<script>${notePanelScript()}<\/script><script>${shareScript()}<\/script>`}
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
  var m = /^\\/p\\/([^\\/]+)\\/sheets\\/([^\\/]+)\\/preview\\.html$/.exec(location.pathname);
  if (!m) { btn.disabled = true; btn.title = "仅在 protoflow 预览服务中可导出"; return; }
  var key = m[1], sheetId = decodeURIComponent(m[2]);
  btn.addEventListener("click", function(e){ e.stopPropagation(); menu.hidden = !menu.hidden; });
  menu.querySelectorAll(".pf-export-menu__item").forEach(function(item){
    item.addEventListener("click", function(){
      menu.hidden = true;
      __pfDownloadExport("/p/" + key + "/__protoflow_export/sheet/" + encodeURIComponent(sheetId) + "/" + item.getAttribute("data-format"), btn);
    });
  });
  document.addEventListener("click", function(e){ if (!menu.hidden && !entry.contains(e.target)) menu.hidden = true; });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") menu.hidden = true; });
})();`;
}

// 页内 SPA：内嵌全部版本，切换版本/sheet = 重渲染 #pfSheetWrap + 用 history 改 ?v=&sheet=。
function appScript() {
  return `
(function(){
  var V = __PF_VERSIONS__, HEAD = __PF_HEAD__, TITLE = __PF_TITLE__, SHEET_ID = __PF_SHEET_ID__;
  var byN = {}; V.forEach(function(v){ byN[v.n] = v; });
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

  // ---- 单元格样式级联解析：跟 core/sheetStyle.js 是同一套算法，解析同一个第三方库
  // （window.InlineStyleParser）的输出，改一处记得改另一处。 ----
  var DANGEROUS_VALUE_RE = /url\\s*\\(|@import/i;
  var MAX_DECL_LEN = 300;
  function parseCssLevel(cssText){
    if (!cssText) return {};
    var out = {};
    var decls;
    try { decls = window.InlineStyleParser(String(cssText)); } catch (e) { return {}; }
    decls.forEach(function(d){
      if (d.type !== "declaration" || !d.property || d.value == null) return;
      var value = String(d.value).trim();
      if (!value || value.length > MAX_DECL_LEN || DANGEROUS_VALUE_RE.test(value)) return;
      out[d.property.trim().toLowerCase()] = value;
    });
    return out;
  }
  function mergeCascade(){
    var out = {};
    for (var i = 0; i < arguments.length; i++) Object.assign(out, parseCssLevel(arguments[i]));
    return out;
  }
  function resolveCellFlatStyle(sheet, r, c){
    var styles = sheet.styles || {};
    return mergeCascade(styles.table, (styles.rows||{})[String(r)], (styles.columns||{})[String(c)], (styles.cells||{})[r+":"+c]);
  }
  function flatToCssText(flat){
    return Object.keys(flat).map(function(k){ return k + ":" + flat[k]; }).join(";");
  }

  // ---- 合并单元格：算出"被覆盖坐标 → true"和"左上角坐标 → {rowSpan,colSpan}"两张表 ----
  function mergeInfo(sheet){
    var covered = {}, topLeft = {};
    (sheet.merges || []).forEach(function(m){
      for (var r = m.startRow; r <= m.endRow; r++){
        for (var c = m.startCol; c <= m.endCol; c++){
          if (r === m.startRow && c === m.startCol) topLeft[r+":"+c] = { rowSpan: m.endRow-m.startRow+1, colSpan: m.endCol-m.startCol+1 };
          else covered[r+":"+c] = true;
        }
      }
    });
    return { covered: covered, topLeft: topLeft };
  }

  // 单元格值整体是 ![说明](assets/<file>) 时渲染成图片——跟 core/sheet.js 的 matchImageCell
  // 是同一条正则的第二份拷贝（Node 端做引用校验/导出用，这边渲染预览用），改一处记得改另一处。
  var IMAGE_CELL_RE = /^!\\[([^\\]]*)\\]\\(assets\\/([^)\\s]+)\\)$/;
  function matchImageCell(val){
    if (typeof val !== "string") return null;
    var m = IMAGE_CELL_RE.exec(val.trim());
    return m ? { alt: m[1], file: decodeURIComponent(m[2]) } : null;
  }

  // 0-based 列号 → Excel 风格字母（0→A, 25→Z, 26→AA），纯粹是给人看的表头装饰，跟 sheet.json
  // 里 0-based 的 styles/merges 坐标不是一回事，互不影响。
  function colLetter(n){
    var s = "", x = n + 1;
    while (x > 0) { var rem = (x - 1) % 26; s = String.fromCharCode(65 + rem) + s; x = Math.floor((x - 1) / 26); }
    return s;
  }

  // ---- 表格渲染：DOM API 建表，不拼 HTML 字符串（textContent 天然安全，style.cssText 走 CSSOM）。
  // 外观照实体表格软件那一套：左侧行号列、顶部字母列头（都是 sticky 的纯装饰，不是数据），
  // 数据格四周都有细网格线，风格上就是"打开了一张表"，不是"网页里的一段内容"。
  //
  // 顺带建一份 coordMap：每个数据坐标 "r:c"（包括被合并覆盖的坐标）→ 代表它的那个 DOM 元素——
  // 合并单元格只有左上角是真实 <td>，coordMap 让选区逻辑不用关心这一层，按坐标查永远拿到"应该
  // 高亮哪个元素"，不用重复判断是不是被合并覆盖。 ----
  function renderTable(sheet, versionN){
    if (!sheet || !(sheet.rows || []).length) {
      var empty = document.createElement("div"); empty.className = "pf-empty"; empty.textContent = "这个 sheet 还没有数据";
      return { el: empty, nRows: 0, nCols: 0, coordMap: {}, colHeaderEls: {}, rowHeaderEls: {} };
    }
    var info = mergeInfo(sheet);
    var nRows = sheet.rows.length, nCols = sheet.rows[0].length;
    var table = document.createElement("table");
    table.className = "pf-grid";
    var coordMap = {}, colHeaderEls = {}, rowHeaderEls = {};

    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    var corner = document.createElement("th"); corner.className = "pf-gutter"; corner.setAttribute("data-select-all", "1");
    headRow.appendChild(corner);
    for (var c = 0; c < nCols; c++) {
      var th = document.createElement("th"); th.textContent = colLetter(c); th.setAttribute("data-col-select", String(c));
      colHeaderEls[c] = th; headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    if (sheet.styles && sheet.styles.table) tbody.style.cssText = sheet.styles.table;
    sheet.rows.forEach(function(row, r){
      var tr = document.createElement("tr");
      var rownum = document.createElement("td"); rownum.className = "pf-gutter"; rownum.textContent = String(r + 1);
      rownum.setAttribute("data-row-select", String(r));
      rowHeaderEls[r] = rownum;
      tr.appendChild(rownum);
      row.forEach(function(val, c){
        var key = r + ":" + c;
        if (info.covered[key]) return; // 这个坐标的 coordMap 在处理它所属合并区域的左上角时已经写好
        var td = document.createElement("td");
        td.setAttribute("data-r", String(r)); td.setAttribute("data-c", String(c));
        var span = info.topLeft[key];
        if (span) {
          if (span.rowSpan > 1) td.rowSpan = span.rowSpan;
          if (span.colSpan > 1) td.colSpan = span.colSpan;
          for (var sr = r; sr < r + span.rowSpan; sr++) for (var sc = c; sc < c + span.colSpan; sc++) coordMap[sr+":"+sc] = td;
        } else {
          coordMap[key] = td;
        }
        var img = matchImageCell(val);
        if (img) {
          td.classList.add("pf-image-cell");
          var imgEl = document.createElement("img");
          imgEl.className = "pf-cell-img";
          imgEl.src = "versions/" + versionN + "/assets/" + encodeURIComponent(img.file);
          imgEl.alt = img.alt || img.file;
          imgEl.draggable = false;
          td.appendChild(imgEl);
        } else {
          td.textContent = val == null ? "" : String(val);
        }
        var css = flatToCssText(resolveCellFlatStyle(sheet, r, c));
        if (css) td.style.cssText = css;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return { el: table, nRows: nRows, nCols: nCols, coordMap: coordMap, colHeaderEls: colHeaderEls, rowHeaderEls: rowHeaderEls };
  }

  // ---- 状态：当前版本号 + 当前 sheet 名，读写 ?v=&sheet= ----
  function parseState(){
    var sp = new URLSearchParams(location.search);
    var v = Number(sp.get("v"));
    if (!byN[v]) v = HEAD;
    return { v: v, sheet: sp.get("sheet") || "" };
  }
  function pushState(v, sheetName){
    var sp = new URLSearchParams();
    if (v !== HEAD) sp.set("v", v);
    sp.set("sheet", sheetName);
    var qs = sp.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }

  // 图片格缩略图默认只有 200×150，截图类内容常常需要放大看——点缩略图弹一个居中大图，点遮罩
  // 或大图本身关掉。用事件委托挂在 document 上，跟切版本/切 sheet 无关，不用每次渲染重挂。
  document.addEventListener("click", function(e){
    var img = e.target.closest(".pf-cell-img");
    if (img) {
      var box = document.createElement("div"); box.className = "pf-lightbox";
      var big = document.createElement("img"); big.src = img.src; big.alt = img.alt;
      box.appendChild(big);
      box.addEventListener("click", function(){ box.remove(); });
      document.body.appendChild(box);
    }
  });

  // ---- 选区：点单元格选一格，拖动选一片矩形，点列头/行头选整列/整行，点左上角选全部，
  // shift+点 从锚点扩展——跟实体表格软件的选择方式对齐，统一建模成一个矩形（minR/maxR/minC/
  // maxC），行/列/全选只是"跨满该方向"的矩形，不用分几套逻辑。选中后 Ctrl/Cmd+C 复制成
  // Tab 分隔文本，可以直接粘贴进 Excel/表格工具。 ----
  var selection = null, anchorRect = null, dragging = false, selectionMode = "cell";
  var curTableInfo = null, curSheet = null, curVersion = HEAD;
  window.__pfSheet = { selection: null, zoom: 1 };

  function unionRect(a, b){
    return { minR: Math.min(a.minR, b.minR), maxR: Math.max(a.maxR, b.maxR),
      minC: Math.min(a.minC, b.minC), maxC: Math.max(a.maxC, b.maxC) };
  }
  function rectForTarget(el, info){
    if (el.hasAttribute("data-select-all")) return { minR: 0, maxR: info.nRows - 1, minC: 0, maxC: info.nCols - 1 };
    if (el.hasAttribute("data-col-select")) { var c = Number(el.getAttribute("data-col-select")); return { minR: 0, maxR: info.nRows - 1, minC: c, maxC: c }; }
    if (el.hasAttribute("data-row-select")) { var r = Number(el.getAttribute("data-row-select")); return { minR: r, maxR: r, minC: 0, maxC: info.nCols - 1 }; }
    if (el.hasAttribute("data-r")) { var r2 = Number(el.getAttribute("data-r")), c2 = Number(el.getAttribute("data-c")); return { minR: r2, maxR: r2 + (el.rowSpan || 1) - 1, minC: c2, maxC: c2 + (el.colSpan || 1) - 1 }; }
    return null;
  }
  // 选区包含整个合并单元格，保证外围仍是完整矩形；复制范围也与视觉一致。
  function expandMergedSelection(rect, info){
    var changed = true;
    while (changed) {
      changed = false;
      var cells = new Set();
      for (var r = rect.minR; r <= rect.maxR; r++) for (var c = rect.minC; c <= rect.maxC; c++) {
        var cell = info.coordMap[r + ":" + c];
        if (!cell || cells.has(cell)) continue;
        cells.add(cell);
        var next = unionRect(rect, rectForTarget(cell, info));
        if (next.minR !== rect.minR || next.maxR !== rect.maxR || next.minC !== rect.minC || next.maxC !== rect.maxC) {
          rect = next; changed = true;
        }
      }
    }
    return rect;
  }
  function selectionA1(rect){
    if (!rect) return "";
    var a = colLetter(rect.minC) + String(rect.minR + 1);
    var b = colLetter(rect.maxC) + String(rect.maxR + 1);
    return a === b ? a : a + ":" + b;
  }
  function selectedValues(){
    if (!selection || !curSheet) return [];
    var out = [];
    for (var r = selection.minR; r <= selection.maxR; r++) {
      var row = [];
      for (var c = selection.minC; c <= selection.maxC; c++) row.push((curSheet.rows[r] || [])[c] ?? null);
      out.push(row);
    }
    return out;
  }
  function intersects(a, b){
    return a.startRow <= b.maxR && a.endRow >= b.minR && a.startCol <= b.maxC && a.endCol >= b.minC;
  }
  // 给本地 agent 的上下文保留两套坐标：人看的 A1 和 sheet.json 真正使用的 0-based 下标。
  // 样式只带与选区相交的条目；具体修改仍落在 source 指向的工作草稿里，不改冻结版本。
  function selectionPayload(){
    if (!selection || !curSheet) return null;
    var pathMatch = /^\\/p\\/([^/]+)\\//.exec(location.pathname);
    var styles = curSheet.styles || {}, related = {};
    if (styles.table) related.table = styles.table;
    var rows = {}, columns = {}, cells = {};
    for (var r = selection.minR; r <= selection.maxR; r++) if ((styles.rows || {})[String(r)]) rows[String(r)] = styles.rows[String(r)];
    for (var c = selection.minC; c <= selection.maxC; c++) if ((styles.columns || {})[String(c)]) columns[String(c)] = styles.columns[String(c)];
    for (var rr = selection.minR; rr <= selection.maxR; rr++) for (var cc = selection.minC; cc <= selection.maxC; cc++) {
      var key = rr + ":" + cc;
      if ((styles.cells || {})[key]) cells[key] = styles.cells[key];
    }
    if (Object.keys(rows).length) related.rows = rows;
    if (Object.keys(columns).length) related.columns = columns;
    if (Object.keys(cells).length) related.cells = cells;
    return {
      projectId: pathMatch ? decodeURIComponent(pathMatch[1]) : "",
      sheetId: SHEET_ID,
      title: TITLE,
      source: "sheets/" + SHEET_ID + "/sheet.json",
      previewVersion: curVersion,
      headVersion: HEAD,
      worksheet: curSheet.name || "",
      mode: selectionMode === "cell" && (selection.minR !== selection.maxR || selection.minC !== selection.maxC) ? "range" : selectionMode,
      range: selectionA1(selection),
      coordinates: { minRow: selection.minR, maxRow: selection.maxR, minColumn: selection.minC, maxColumn: selection.maxC },
      values: selectedValues(),
      styles: related,
      merges: (curSheet.merges || []).filter(function(m){ return intersects(m, selection); }),
    };
  }
  function syncPublicSelection(){ window.__pfSheet.selection = selectionPayload(); }
  function applySelectionHighlight(info){
    var classes = ["pf-sel", "pf-sel-fill", "pf-sel-top", "pf-sel-bottom", "pf-sel-left", "pf-sel-right", "pf-sel-header", "pf-sel-header-strong"];
    info.el.querySelectorAll(".pf-sel,.pf-sel-header").forEach(function(el){
      classes.forEach(function(cls){ el.classList.remove(cls); });
    });
    if (!selection) { syncPublicSelection(); return; }
    if (selectionMode !== "row") for (var c = selection.minC; c <= selection.maxC; c++) {
      var th = info.colHeaderEls[c];
      if (th) { th.classList.add("pf-sel-header"); if (selectionMode === "column" || selectionMode === "all") th.classList.add("pf-sel-header-strong"); }
    }
    if (selectionMode !== "column") for (var r = selection.minR; r <= selection.maxR; r++) {
      var rh = info.rowHeaderEls[r];
      if (rh) { rh.classList.add("pf-sel-header"); if (selectionMode === "row" || selectionMode === "all") rh.classList.add("pf-sel-header-strong"); }
    }
    var anchorCell = selectionMode === "cell" && anchorRect ? info.coordMap[anchorRect.minR + ":" + anchorRect.minC] : null;
    var seen = new Set();
    for (var rr = selection.minR; rr <= selection.maxR; rr++) for (var cc = selection.minC; cc <= selection.maxC; cc++) {
      var cell = info.coordMap[rr + ":" + cc];
      if (!cell || seen.has(cell)) continue;
      seen.add(cell);
      var rect = rectForTarget(cell, info);
      cell.classList.add("pf-sel");
      if (cell !== anchorCell) cell.classList.add("pf-sel-fill");
      if (rect.minR === selection.minR) cell.classList.add("pf-sel-top");
      if (rect.maxR === selection.maxR) cell.classList.add("pf-sel-bottom");
      if (rect.minC === selection.minC) cell.classList.add("pf-sel-left");
      if (rect.maxC === selection.maxC) cell.classList.add("pf-sel-right");
    }
    syncPublicSelection();
  }
  function setupSelection(info, sheet){
    curTableInfo = info; curSheet = sheet; selection = null; anchorRect = null; dragging = false; selectionMode = "cell";
    syncPublicSelection(); closeContextMenu();
    if (!info.nRows) return;
    info.el.addEventListener("mousedown", function(e){
      if (e.button !== 0) return;
      var target = e.target.closest("[data-r],[data-col-select],[data-row-select],[data-select-all]");
      if (!target) return;
      e.preventDefault();
      var rect = rectForTarget(target, info);
      if (!rect) return;
      if (!e.shiftKey || !anchorRect) {
        anchorRect = rect;
        selectionMode = target.hasAttribute("data-select-all") ? "all" : target.hasAttribute("data-col-select") ? "column" : target.hasAttribute("data-row-select") ? "row" : "cell";
      }
      selection = expandMergedSelection(unionRect(anchorRect, rect), info);
      dragging = true;
      applySelectionHighlight(info);
    });
    info.el.addEventListener("mouseover", function(e){
      if (!dragging) return;
      var target = e.target.closest("[data-r],[data-col-select],[data-row-select],[data-select-all]");
      if (!target) return;
      var rect = rectForTarget(target, info);
      if (!rect || !anchorRect) return;
      selection = expandMergedSelection(unionRect(anchorRect, rect), info);
      applySelectionHighlight(info);
    });
  }
  document.addEventListener("mouseup", function(){ dragging = false; });

  // ---- 选区右键菜单 + 表格标注：菜单用 actions 数组生成，之后添加新项只需追加一项。
  // 「标注」沿用画布取元素工具的契约：把人写的修改要求和机器可定位的选区上下文合成一段文本，
  // 复制给本地 Codex/Cursor 等 agent。它不是写入冻结版本的持久标注。导出页没有 SHEET_ID，不启用。 ----
  // 菜单、面板、复制、Esc 关闭是表格和绘图共用的一套（core/ui.js 的 notePanelScript），这里只管选中了
  // 什么、复制出去的正文怎么写。
  var NOTE_ICON = ${JSON.stringify(ICON_NOTE)};
  var TABLE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M3 14.5h18M9 9v11"/></svg>';
  function closeContextMenu(){ if (window.__pfNote) window.__pfNote.closeMenu(); }
  function rectInsideSelection(rect){
    return !!selection && rect.minR >= selection.minR && rect.maxR <= selection.maxR && rect.minC >= selection.minC && rect.maxC <= selection.maxC;
  }
  function inferMode(target){
    return target.hasAttribute("data-select-all") ? "all" : target.hasAttribute("data-col-select") ? "column" : target.hasAttribute("data-row-select") ? "row" : "cell";
  }
  function openNotePanel(){
    var payload = selectionPayload(); if (!payload) return;
    window.__pfNote.open({
      key: payload.previewVersion + "/" + payload.worksheet + "/" + payload.range,
      title: "表格标注", icon: TABLE_ICON,
      main: payload.worksheet || TITLE, meta: payload.range + " · v" + payload.previewVersion,
      placeholder: "补充希望本地 agent 如何调整这片数据…",
      hint: "复制内容会包含源文件、工作表、版本、选区坐标、值和相关样式。",
      compose: function(note){ return annotationText(payload, note); },
    });
  }
  function annotationText(payload, note){
    var lines = [];
    if (String(note || "").trim()) lines.push(String(note).trim(), "");
    lines = lines.concat(window.__pfNote.header({ projectId: payload.projectId, kind: "sheet", source: payload.source, version: payload.previewVersion, head: payload.headVersion }));
    lines.push("sheet: " + payload.title + " (" + payload.sheetId + ")");
    lines.push("worksheet: " + payload.worksheet);
    lines.push("selection: " + payload.range + " (" + payload.mode + ")");
    lines.push("coordinates0Based: " + JSON.stringify(payload.coordinates));
    lines.push("values: " + JSON.stringify(payload.values, null, 2));
    if (Object.keys(payload.styles || {}).length) lines.push("relatedStyles: " + JSON.stringify(payload.styles, null, 2));
    if ((payload.merges || []).length) lines.push("intersectingMerges: " + JSON.stringify(payload.merges, null, 2));
    return lines.join("\\n");
  }
  if (SHEET_ID) document.addEventListener("contextmenu", function(e){
    if (!curTableInfo || !curTableInfo.el.contains(e.target)) return;
    var target = e.target.closest("[data-r],[data-col-select],[data-row-select],[data-select-all]");
    if (!target) return;
    e.preventDefault();
    var rect = rectForTarget(target, curTableInfo); if (!rect) return;
    if (!rectInsideSelection(rect)) {
      anchorRect = rect; selectionMode = inferMode(target); selection = expandMergedSelection(rect, curTableInfo); applySelectionHighlight(curTableInfo);
    }
    window.__pfNote.menu(e.clientX, e.clientY, target, [{ id: "annotate", label: "标注", icon: NOTE_ICON, run: openNotePanel }]);
  });
  document.addEventListener("keydown", function(e){
    var ae = document.activeElement;
    if (ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
    if (!curSheet || !curTableInfo) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    // ⌘/Ctrl+A：不管有没有选区都选中整张工作表，不让浏览器把整页的界面文字一起选上。
    if (e.key.toLowerCase() === "a" && curTableInfo.nRows) {
      e.preventDefault(); closeContextMenu(false);
      selectionMode = "all";
      anchorRect = { minR: 0, maxR: curTableInfo.nRows - 1, minC: 0, maxC: curTableInfo.nCols - 1 };
      selection = anchorRect;
      var nativeSelection = window.getSelection(); if (nativeSelection) nativeSelection.removeAllRanges();
      applySelectionHighlight(curTableInfo);
      return;
    }
    if (e.key.toLowerCase() !== "c" || !selection) return;
    var lines = [];
    for (var r = selection.minR; r <= selection.maxR; r++){
      var cells = [];
      for (var c = selection.minC; c <= selection.maxC; c++){
        var v = (curSheet.rows[r] || [])[c];
        cells.push(v == null ? "" : String(v));
      }
      lines.push(cells.join("\\t"));
    }
    try { navigator.clipboard.writeText(lines.join("\\n")); } catch (err) {}
  });

  var wrap = document.getElementById("pfSheetWrap");
  var tabsNav = document.getElementById("pfTabs");
  var bar = document.getElementById("pfDocBar");
  var CHEV = '<svg class="pf-vsel-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  // ---- 表格缩放：沿用画布的百分比菜单与“指针位置不动”锚点体验。普通滚轮仍负责滚动表格；
  // 只接管触控板捏合产生的 Ctrl/Cmd+wheel，以及 Safari 的 gesture 事件。 ----
  var ZOOM_MIN = 0.25, ZOOM_MAX = 4, zoomScale = 1, zoomEl = null;
  var zoomLabel = document.querySelector(".pf-sheet-zoom__label");
  var zoomMenu = document.querySelector(".pf-sheet-zoom__menu");
  function clampZoom(v){ return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v)); }
  // auto-layout 表格在 CSS zoom 改变可用布局宽度时可能重新分配各列，表现为有的列突然变宽、
  // 有的列重新换行。首次渲染完成后把浏览器已经算好的列宽固化到 colgroup，之后只做整体等比缩放。
  function lockGridColumns(table){
    if (!table || table.tagName !== "TABLE" || table.classList.contains("pf-grid--columns-locked")) return;
    var headers = table.querySelectorAll("thead tr:first-child > th");
    if (!headers.length) return;
    var widths = Array.prototype.map.call(headers, function(th){ return th.getBoundingClientRect().width / zoomScale; });
    var group = document.createElement("colgroup");
    widths.forEach(function(width){ var col = document.createElement("col"); col.style.width = width + "px"; group.appendChild(col); });
    table.insertBefore(group, table.firstChild);
    table.style.tableLayout = "fixed";
    table.style.width = widths.reduce(function(sum, width){ return sum + width; }, 0) + "px";
    table.classList.add("pf-grid--columns-locked");
  }
  function lockGridColumnsWhenImagesReady(table){
    var pending = Array.prototype.filter.call(table.querySelectorAll(".pf-cell-img"), function(img){ return !img.complete; });
    if (!pending.length) { lockGridColumns(table); return; }
    var left = pending.length;
    function settled(){
      left -= 1;
      if (!left && table.isConnected && zoomEl === table) lockGridColumns(table);
    }
    pending.forEach(function(img){ img.addEventListener("load", settled, { once: true }); img.addEventListener("error", settled, { once: true }); });
  }
  function applyZoom(){
    if (zoomEl) zoomEl.style.zoom = String(zoomScale);
    zoomLabel.textContent = Math.round(zoomScale * 100) + "%";
    window.__pfSheet.zoom = zoomScale;
  }
  function zoomAt(clientX, clientY, factor){
    var rect = wrap.getBoundingClientRect();
    var px = clientX - rect.left, py = clientY - rect.top;
    var next = clampZoom(zoomScale * factor);
    if (Math.abs(next - zoomScale) < 0.0001) return;
    var ratio = next / zoomScale;
    var left = wrap.scrollLeft, top = wrap.scrollTop;
    zoomScale = next; applyZoom();
    wrap.scrollLeft = (left + px) * ratio - px;
    wrap.scrollTop = (top + py) * ratio - py;
  }
  // 表格按钮缩放固定当前视口左上角：从 A1 开始查看时连续点“＋”，A/1 仍留在原位。
  // 画布式的中心锚点会把滚动位置自动推向中间，连续放大后看起来像行列标题消失了。
  function zoomFromTopLeft(factor){
    var r = wrap.getBoundingClientRect(); zoomAt(r.left, r.top, factor);
  }
  function fitZoom(){
    if (!zoomEl) return;
    var r = zoomEl.getBoundingClientRect();
    var baseW = r.width / zoomScale, baseH = r.height / zoomScale;
    if (!baseW || !baseH) return;
    var next = clampZoom(Math.min(wrap.clientWidth / baseW, wrap.clientHeight / baseH, 1) * 0.96);
    zoomFromTopLeft(next / zoomScale);
  }
  wrap.addEventListener("wheel", function(e){
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
  }, { passive: false });
  var gestureBase = 1;
  wrap.addEventListener("gesturestart", function(e){ e.preventDefault(); gestureBase = zoomScale; });
  wrap.addEventListener("gesturechange", function(e){ e.preventDefault(); zoomAt(e.clientX, e.clientY, (gestureBase * e.scale) / zoomScale); });
  wrap.addEventListener("gestureend", function(e){ e.preventDefault(); });
  document.querySelector(".pf-sheet-zoom__in").addEventListener("click", function(){ zoomFromTopLeft(1.2); });
  document.querySelector(".pf-sheet-zoom__out").addEventListener("click", function(){ zoomFromTopLeft(1 / 1.2); });
  document.querySelector(".pf-sheet-zoom__reset").addEventListener("click", function(){ zoomFromTopLeft(1 / zoomScale); });
  document.querySelector(".pf-sheet-zoom__fit").addEventListener("click", fitZoom);
  zoomLabel.addEventListener("click", function(e){ e.stopPropagation(); zoomMenu.hidden = !zoomMenu.hidden; zoomLabel.setAttribute("aria-expanded", zoomMenu.hidden ? "false" : "true"); });
  document.addEventListener("click", function(e){
    if (!zoomMenu.hidden && !zoomMenu.contains(e.target) && e.target !== zoomLabel) { zoomMenu.hidden = true; zoomLabel.setAttribute("aria-expanded", "false"); }
  });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") { zoomMenu.hidden = true; zoomLabel.setAttribute("aria-expanded", "false"); } });

  // 版本切换下拉：跟 core/docPreview.js 的 .pf-vsel 同一套视觉/交互，sheet 没有 doc 那种"同项目
  // 其它文档"分组，直接铺平版本列表。
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
      // 跟文档阅读页同一个写法：第一行版本说明，第二行版本号 + 时间
      if (v.note) a.title = v.note;
      a.innerHTML = '<span class="t">' + esc(v.note || TITLE) + '</span><span class="s">' + sub + '</span>';
      a.addEventListener("click", function(e){
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault(); e.stopPropagation();
        setOpen(false); render(v.n, "");
      });
      menu.appendChild(a);
    });
    function setOpen(v){ menu.hidden = !v; btn.setAttribute("aria-expanded", v ? "true" : "false"); }
    btn.addEventListener("click", function(e){ e.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener("click", function(){ setOpen(false); });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape") setOpen(false); });
    w.appendChild(btn); w.appendChild(menu); bar.appendChild(w);
  }

  function render(v, sheetName){
    var version = byN[v] || byN[HEAD];
    var sheets = (version.content && version.content.sheets) || [];
    var active = sheets.find(function(s){ return s.name === sheetName; }) || sheets[0];
    curVersion = version.n;
    tabsNav.innerHTML = "";
    sheets.forEach(function(s){
      var tab = document.createElement("button");
      tab.type = "button"; tab.className = "pf-sheet-tab" + (s === active ? " active" : "");
      tab.textContent = s.name;
      tab.addEventListener("click", function(){ pushState(version.n, s.name); render(version.n, s.name); });
      tabsNav.appendChild(tab);
    });
    wrap.innerHTML = "";
    var info = renderTable(active, version.n);
    wrap.appendChild(info.el);
    zoomEl = info.el; applyZoom();
    lockGridColumnsWhenImagesReady(info.el);
    setupSelection(info, active);
    updateVsel(version.n);
    pushState(version.n, active ? active.name : "");
  }

  var init = parseState();
  render(init.v, init.sheet);
})();`;
}
