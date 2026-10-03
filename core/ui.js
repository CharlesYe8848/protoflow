// core/ui.js — 几个产品页面共用的界面零件（框架）：分享按钮图标、导出菜单行、导出下载脚本、
// Mermaid 配色、图片内联。以前放在画板预览 core/preview.js 里，文档、表格为了用它得引用画布的
// 文件；搬到框架后产品只依赖框架（依赖边界见 tests/boundaries.test.js）。
import fs from "node:fs";
import path from "node:path";

// 「导出」按钮的图标：画布 core/canvas.js 和文档阅读页 core/docPreview.js 共用同一个（下载箭头），
// 跟其它工具栏图标同一套画风（viewBox 24、stroke currentColor）。
// 顶层「分享」按钮的图标——之前用的是 Feather "download"（向下箭头扎进托盘），跟按钮已经改叫
// 「分享」名不副实；换成 Feather "share-2"（三个圆点用两条线连成一个小网络），是安卓系统那套
// ---- 全屏（各产品顶部菜单栏共用）----
// 真正的全屏：浏览器全屏 + 只留内容。框架在 <html> 上切 pf-fs 类，并隐藏所有标了 data-pf-chrome 的元素
// （各产品给自己的顶部菜单栏、工具栏、侧栏打这个标记）和框架自己的项目侧边栏；内容区怎么撑满由各产品
// 用 html.pf-fs 写自己的样式。Esc 退出（浏览器自带）。页面约定：
//   按钮 fullscreenButtonHtml() 放进顶部菜单栏右侧；样式 FULLSCREEN_CSS 放进 <style>；脚本 fullscreenScript() 放进 <script>。
//   脚本提供 window.__pfFullscreen.toggle()，产品可以绑自己的快捷键；进出全屏时派发 resize，缩放类的内容会重新适配。
export const ICON_FULLSCREEN = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;

export function fullscreenButtonHtml() {
  return `<button class="pf-hdr-fs" type="button" data-pf-fullscreen title="全屏（Esc 退出）" aria-label="全屏">${ICON_FULLSCREEN}<span class="pf-hdr-fs__label">全屏</span></button>`;
}

export const FULLSCREEN_CSS = `
.pf-hdr-fs{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:12px;color:rgba(15,23,42,.75);background:transparent;border:0;border-radius:6px;cursor:pointer}
.pf-hdr-fs:hover{background:rgba(15,23,42,.06)}
html.pf-fs [data-pf-chrome]{display:none!important}
`;

export function fullscreenScript() {
  return `
(function(){
  var root = document.documentElement;
  function sync(){
    root.classList.toggle("pf-fs", !!document.fullscreenElement);
    setTimeout(function(){ window.dispatchEvent(new Event("resize")); }, 0);
  }
  function toggle(){
    if (document.fullscreenElement) document.exitFullscreen();
    else if (root.requestFullscreen) root.requestFullscreen().catch(function(){});
  }
  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("click", function(e){
    var b = e.target && e.target.closest && e.target.closest("[data-pf-fullscreen]");
    if (b) { e.preventDefault(); toggle(); }
  });
  window.__pfFullscreen = { toggle: toggle, active: function(){ return !!document.fullscreenElement; } };
})();`;
}

// 「分享」的通用符号，不会被认成下载/导出。
export const ICON_SHARE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;

// 「导出」按钮的下载逻辑：画布 core/canvas.js 和文档阅读页 core/docPreview.js 各自的「导出」按钮
// 共用这一段（两边是不同的 HTML 文档，运行时不共享作用域，只能在生成时共用同一份源文本）。导出端点回的是文件字节，不是 JSON——不落一个固定的 .export/ 路径。
// 走浏览器原生的 <a download>，不用 File System Access API 的另存为对话框：后者是 Chromium 独有、
// 要求真实用户手势 + 顶层安全上下文，条件不满足时会弹一个原生模态对话框卡住整个标签页；而且它
// 走的不是浏览器下载管线，不会出现在下载记录里。<a download> 哪个浏览器都认、不阻塞页面、
// 一定进下载记录——要不要弹"选择保存位置"的对话框交给用户自己 Chrome 的下载设置决定，跟本地/
// 线上部署在哪台机器无关：这一步全程只在发起请求的浏览器里发生，服务端只是把文件字节流回去，
// 从不在自己磁盘上留一份（core/exportCanvas.js 等几个 build* 用完临时目录就删）。
// btn 现在是图标 + 文字（<span class="pf-export-label">），不能整个 textContent 覆盖掉——
// 会连图标一起清空——文案只改那个 label span。
//
// 回归测试的教训（曾经短暂改成隐藏 iframe 导航，已经撤回）：一度怀疑 fetch+blob 在大文件（单
// HTML 导出画板一多能到几十 MB）上会因为页面本来就跑着一堆画板 iframe、内存紧张而被判死，换成
// iframe.src 导航"边下边落盘、不占页面内存"。结果这条路径在自动化测试环境里直接触发了原生
// "另存为"对话框，把整个标签页卡死——跟本文件最上面这段注释里明确拒绝掉的 File System Access
// API 是同一类问题（浏览器的下载位置设置一旦是"下载前询问"，任何触发下载的方式都可能弹这个原生
// 模态框，不是 fetch+blob 独有的）。真正让"导出失败"复现的另有其人：本机磁盘几乎写满
// （只剩两百多 MB 可用），不管走 fetch+blob 还是 iframe 导航，任何要落盘的操作在那种环境下都
// 会不稳定——不是这段下载逻辑的问题，磁盘空间恢复后 fetch+blob 照常好用。原生弹窗这一类"整个
// 标签页被非脚本能控制的模态框卡住"的风险明显更大也更难自动恢复，所以退回 fetch+blob，只保留
// 更明确的报错信息（打进 console + 按钮 title），不再假设"大文件一定要走 iframe"。
// 导出进度弹窗（所有产品共用）：导出超过 1 秒还没好（比如录 MP4 要几分钟）才弹出，快的导出不打扰。
// 左边是预览：产品报了"现在渲染到的画面"（导出的 ctx.progress 第三个参数 preview）就实时显示，没有就是格式图标；
// 右边是作品名称、格式、时长（产品报了 meta.durationMs 才有）、当前步骤、已用时；底下进度条和「取消」——
// 取消会中断导出请求，服务端据此停掉渲染（ctx.signal），不只是关弹窗。
const EXPORT_DIALOG_CSS = `
.pf-xd-mask{position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.38);display:flex;align-items:center;justify-content:center;font:13px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a}
.pf-xd{width:min(760px,calc(100vw - 32px));background:#fff;border-radius:14px;box-shadow:0 24px 64px rgba(15,23,42,.28);overflow:hidden}
.pf-xd__hd{padding:14px 20px;font-weight:600;font-size:14px;border-bottom:1px solid #e2e8f0}
.pf-xd__bd{display:flex;gap:20px;padding:20px}
.pf-xd__pv{flex:0 0 55%;aspect-ratio:16/9;border-radius:10px;background:#0f172a;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
.pf-xd__pv img{width:100%;height:100%;object-fit:contain;display:block}
.pf-xd__icon{display:flex;flex-direction:column;align-items:center;gap:8px;color:#94a3b8}
.pf-xd__icon b{font-size:12px;letter-spacing:.06em;color:#e2e8f0;background:rgba(255,255,255,.12);padding:2px 10px;border-radius:999px}
.pf-xd__info{flex:1;min-width:0;background:#f8fafc;border-radius:10px;padding:16px 18px}
.pf-xd__info h3{margin:0 0 12px;font-size:17px}
.pf-xd__row{display:flex;gap:12px;margin:6px 0}
.pf-xd__row span{flex:none;width:64px;color:#64748b}
.pf-xd__row b{font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-xd__err{margin-top:10px;color:#b91c1c;font-size:12px;word-break:break-all}
.pf-xd__row[hidden],.pf-xd__err[hidden]{display:none}
.pf-xd__ft{display:flex;align-items:center;gap:14px;padding:14px 20px;border-top:1px solid #e2e8f0}
.pf-xd__pct{width:48px;font-variant-numeric:tabular-nums;color:#475569}
.pf-xd__bar{flex:1;height:6px;border-radius:999px;background:#e2e8f0;overflow:hidden}
.pf-xd__bar i{display:block;height:100%;width:0;background:var(--pf-brand,#0f172a);border-radius:999px;transition:width .4s ease}
.pf-xd__btn{flex:none;border:0;border-radius:8px;padding:7px 18px;font:inherit;font-weight:600;cursor:pointer;background:#f1f5f9;color:#0f172a}
.pf-xd__btn:hover{background:#e2e8f0}
.pf-xd__btn--danger{background:#b91c1c;color:#fff}
.pf-xd__btn--danger:hover{background:#991b1b}
.pf-xd__ask{flex:1;color:#0f172a}
.pf-xd__ask small{display:block;color:#64748b;font-size:12px}
.pf-xd__ft [hidden]{display:none}
@media (max-width:640px){.pf-xd__bd{flex-direction:column}.pf-xd__pv{flex:none;width:100%}}
`;

export function exportDownloadScript() {
  return `
  function __pfDownloadExport(url, btn){
    var label = btn.querySelector(".pf-export-label");
    var old = label.textContent;
    btn.disabled = true;
    var job = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    var fmt = (url.split("?")[0].split("/").pop() || "").toLowerCase();
    var fmtItem = document.querySelector('.pf-export-menu__item[data-format="' + fmt + '"] b');
    var fmtLabel = fmtItem ? fmtItem.textContent : fmt.toUpperCase();
    var ctrl = window.AbortController ? new AbortController() : null;
    var began = Date.now(), dlg = null, polling = false, shownPreview = 0, finished = false;
    // 各产品页的标题是「名称 · protoflow 产品」，弹窗里只要名称
    var workName = document.title.replace(/\\s·\\s[Pp]rotoflow.*$/, "");
    function esc(s){ return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function fmtDur(ms){ var s = Math.round(ms / 1000), m = Math.floor(s / 60); return m ? m + " 分 " + (s % 60) + " 秒" : s + " 秒"; }
    function openDialog(){
      if (!document.getElementById("pf-xd-css")) { var st = document.createElement("style"); st.id = "pf-xd-css"; st.textContent = ${JSON.stringify(EXPORT_DIALOG_CSS)}; document.head.appendChild(st); }
      var m = document.createElement("div");
      m.className = "pf-xd-mask";
      m.innerHTML = '<div class="pf-xd" role="dialog" aria-modal="true" aria-label="导出">'
        + '<div class="pf-xd__hd">导出</div>'
        + '<div class="pf-xd__bd"><div class="pf-xd__pv"><div class="pf-xd__icon"><svg width="40" height="48" viewBox="0 0 40 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h22l10 10v30H4z"/><path d="M26 4v10h10"/></svg><b>.' + esc(fmt.toUpperCase()) + '</b></div></div>'
        + '<div class="pf-xd__info"><h3>正在导出</h3>'
        + '<div class="pf-xd__row"><span>作品名称</span><b>' + esc(workName) + '</b></div>'
        + '<div class="pf-xd__row"><span>格式</span><b>' + esc(fmtLabel) + '</b></div>'
        + '<div class="pf-xd__row" data-k="dur" hidden><span>时长</span><b></b></div>'
        + '<div class="pf-xd__row"><span>当前步骤</span><b data-k="stage">准备中</b></div>'
        + '<div class="pf-xd__row"><span>已用时</span><b data-k="elapsed">0 秒</b></div>'
        + '<div class="pf-xd__err" hidden></div></div></div>'
        + '<div class="pf-xd__ft">'
        + '<span class="pf-xd__pct">0%</span><div class="pf-xd__bar"><i></i></div><button class="pf-xd__btn" type="button" data-k="cancel">取消</button>'
        // 取消要二次确认：取消后已经渲染的部分全部作废，误点代价大（录视频动辄几分钟）。在弹窗里确认，不用浏览器原生 confirm
        + '<div class="pf-xd__ask" hidden>确定取消导出吗？<small>已完成的进度不会保留，下次要从头开始</small></div>'
        + '<button class="pf-xd__btn" type="button" data-k="keep" hidden>继续导出</button>'
        + '<button class="pf-xd__btn pf-xd__btn--danger" type="button" data-k="confirm" hidden>确定取消</button>'
        + '</div></div>';
      document.body.appendChild(m);
      function asking(on){
        [".pf-xd__pct", ".pf-xd__bar", '[data-k="cancel"]'].forEach(function(s){ m.querySelector(s).hidden = on; });
        [".pf-xd__ask", '[data-k="keep"]', '[data-k="confirm"]'].forEach(function(s){ m.querySelector(s).hidden = !on; });
        if (on) m.querySelector('[data-k="keep"]').focus();
      }
      m.querySelector('[data-k="cancel"]').addEventListener("click", function(){
        if (finished) { closeDialog(); return; } // 已经失败了，这个按钮是「关闭」
        asking(true);
      });
      m.querySelector('[data-k="keep"]').addEventListener("click", function(){ asking(false); });
      m.querySelector('[data-k="confirm"]').addEventListener("click", function(){
        if (finished) { closeDialog(); return; }
        finished = true; // 取消：中断请求，服务端连接一断就停
        if (ctrl) ctrl.abort();
        restore(); closeDialog();
      });
      m.__asking = asking;
      return m;
    }
    function closeDialog(){ if (dlg) { dlg.remove(); dlg = null; } }
    function q(sel){ return dlg && dlg.querySelector(sel); }
    function update(p){
      if (!dlg) return;
      var s = Math.round((Date.now() - began) / 1000);
      q('[data-k="elapsed"]').textContent = fmtDur(s * 1000);
      if (!p) return;
      var f = typeof p.fraction === "number" ? p.fraction : 0;
      q(".pf-xd__pct").textContent = Math.floor(f * 100) + "%";
      q(".pf-xd__bar i").style.width = (f * 100).toFixed(1) + "%";
      if (p.stage) q('[data-k="stage"]').textContent = p.stage;
      if (p.meta && p.meta.durationMs) { var r = q('[data-k="dur"]'); r.hidden = false; r.querySelector("b").textContent = fmtDur(p.meta.durationMs); }
      if (p.preview && p.preview !== shownPreview) {
        shownPreview = p.preview;
        // 先在后台加载好再换上，避免闪一下空白
        var img = new Image();
        img.onload = function(){ var pv = q(".pf-xd__pv"); if (!pv) return; pv.innerHTML = ""; pv.appendChild(img); };
        img.alt = "当前渲染画面";
        img.src = "/__protoflow_export_preview?job=" + job + "&v=" + p.preview;
      }
    }
    var ticker = setInterval(function(){
      if (finished) return;
      if (!dlg && Date.now() - began >= 1000) dlg = openDialog();
      update(null);
      if (polling || !dlg) return;
      polling = true;
      fetch("/__protoflow_export_progress?job=" + job).then(function(r){ return r.json(); }).then(function(p){ if (!finished) update(p); })
        .catch(function(){}).then(function(){ polling = false; });
    }, 1000);
    function restore(){ clearInterval(ticker); label.textContent = old; btn.disabled = false; }
    fetch(url + (url.indexOf("?") < 0 ? "?" : "&") + "job=" + job, ctrl ? { method: "POST", signal: ctrl.signal } : { method: "POST" }).then(function(r){
      // 服务端回的正文是原因（比如导出 MP4 缺 ffmpeg），显示在弹窗和按钮的悬浮提示里
      if (!r.ok) return r.text().then(function(t){ throw new Error(t || ("HTTP " + r.status)); });
      var cd = r.headers.get("Content-Disposition") || "";
      var filename = "export.zip";
      var m = /filename\\*=UTF-8''([^;]+)/.exec(cd);
      if (m) { try { filename = decodeURIComponent(m[1]); } catch (e) {} }
      else { var m2 = /filename="([^"]+)"/.exec(cd); if (m2) filename = m2[1]; }
      return r.blob().then(function(blob){ return { blob: blob, filename: filename }; });
    }).then(function(res){
      if (finished) return;
      finished = true;
      var a = document.createElement("a");
      a.href = URL.createObjectURL(res.blob); a.download = res.filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      // 成功就关弹窗、恢复按钮——浏览器自己的下载栏/通知已经说明下载完成了
      restore(); closeDialog();
    }).catch(function(e){
      if (e && e.name === "AbortError") return; // 自己点的取消
      if (finished) return;
      finished = true;
      // 把真实原因打进 console + 弹窗 + 按钮 title，不能只留一句"导出失败"——不然出问题时除了重试没有别的排查手段
      var msg = (e && e.message) || String(e);
      console.error("[protoflow] 导出失败：", e);
      restore();
      if (dlg) {
        q(".pf-xd__info h3").textContent = "导出失败";
        var er = q(".pf-xd__err"); er.hidden = false; er.textContent = msg;
        dlg.__asking(false); // 正在问要不要取消的时候失败了：收起确认，只留「关闭」
        q('[data-k="cancel"]').textContent = "关闭";
      } else {
        var oldTitle = btn.title;
        label.textContent = "导出失败"; btn.title = "导出失败：" + msg;
        setTimeout(function(){ label.textContent = old; btn.title = oldTitle; }, 5000);
      }
    });
  }`;
}

// 导出菜单的行 HTML：格式列表来自各产品自己的导出格式登记（生成页面时传进来），
// 新增格式只改那张表，这里自动多一行，不用跟着改模板。图标：zip 用文件夹（多文件打包），html
// 用单页文档（一个文件）。
const EXPORT_ROW_ICON = {
  pdf: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h2a1.5 1.5 0 0 1 0 3H8v-5M14 11v5M14 11h1.5a2.5 2.5 0 0 1 0 5H14"/></svg>`,
  zip: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`,
  html: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  mp4: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3"/></svg>`,
  markdown: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 15V9l3 3 3-3v6M15 9v6M13 13l2 2 2-2"/></svg>`,
};
export function exportMenuRowsHtml(formats) {
  return (formats || []).map((f) => {
    const icon = EXPORT_ROW_ICON[f.id] || EXPORT_ROW_ICON.html;
    return `<button class="pf-export-menu__item" type="button" data-format="${f.id}">${icon}<span class="pf-export-menu__body"><b>${f.label}</b><span>${f.hint}</span></span><span class="pf-export-menu__action">下载</span></button>`;
  }).join("");
}

// 画板 assets/ 目录 → { 文件名: dataURI }，只给需要单文件/脱离原目录的产物内联。
// 实时预览和 ZIP 导出保留 assets/ 真实文件，避免 base64 膨胀与每次生成 HTML 重复拷贝。
const IMAGE_MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml",
  gif: "image/gif", webp: "image/webp", avif: "image/avif",
};
// files: [{ name, filePath }] → { 文件名: data URI }，不是图片的跳过。来源不限（目录、版本清单）。
export function assetsDataMap(files) {
  const map = {};
  for (const f of files) {
    const mime = IMAGE_MIME[path.extname(f.name).slice(1).toLowerCase()];
    if (mime) map[f.name] = `data:${mime};base64,${fs.readFileSync(f.filePath).toString("base64")}`;
  }
  return map;
}

export function readAssetsMap(assetsDir) {
  if (!fs.existsSync(assetsDir)) return {};
  return assetsDataMap(fs.readdirSync(assetsDir).map((f) => ({ name: f, filePath: path.join(assetsDir, f) })));
}

// ---- 标注：右键菜单 + 标注面板（表格、绘图共用）----
// 人在产品页上选中一片内容、写下修改意见，页面把意见和能定位的上下文拼成一段文本，复制给本地 agent。
// 不保存、不写回任何文件。只在本地预览页启用，导出的页面不带。
//
// 各产品只管"选中了什么"和"复制出去的正文怎么写"；菜单、面板、复制、Esc 关闭都在这里。复制的文本
// 统一以一个固定头部开头（annotationHeader），agent 只需要认一种格式：
//
//   <人写的意见>
//
//   [Protoflow 标注]
//   project: <项目>
//   kind: <产品类型>
//   source: <要改的源文件，相对项目根>
//   version: v<n> (head|historical)
//   <产品自己的正文……>
//
// 浏览器端用法（先把 NOTE_PANEL_CSS 放进 <style>、notePanelScript() 放进 <script>）：
//   __pfNote.menu(clientX, clientY, triggerEl, [{ id, label, icon, run }])   打开右键菜单
//   __pfNote.open({ key, title, icon, main, meta, placeholder, hint, compose, shot })   打开标注面板；compose(意见) → 要复制的全文；
//                                               key 标识标注对象，换了对象清空上次的意见；
//                                               shot 可选：{ selector, boxes }，本地服务截下 selector 那块、按顺序给 boxes 编号框出
//                                               （core/pageShot.js），面板里显示缩略图，复制的全文末尾带上图片路径
//   __pfNote.boxesIn(areaEl, els)              els 在 areaEl 里的位置（比例），给 shot.boxes 用
//   __pfNote.warmShot()                        提前让本地服务把截图用的浏览器启动起来（右键菜单弹出时调）
//   __pfNote.header({ projectId, kind, source, version, head })              统一头部的几行（数组）
//   __pfNote.closeMenu() / __pfNote.close()   只关菜单 / 菜单和面板都关
export const NOTE_PANEL_CSS = `
.pf-context{position:fixed;z-index:90;min-width:156px;padding:5px;background:#fff;border:1px solid #e2e8f0;border-radius:9px;box-shadow:0 10px 28px rgba(15,23,42,.16);font:13px/1.4 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.pf-context[hidden]{display:none}
.pf-context__item{display:flex;align-items:center;gap:9px;width:100%;height:32px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:#263244;font:inherit;text-align:left;cursor:pointer}
.pf-context__item:hover,.pf-context__item:focus-visible{background:#f1f5f9;outline:none}
.pf-context__item svg{width:16px;height:16px;flex:none;color:#64748b}
.pf-note{position:fixed;right:16px;bottom:16px;z-index:89;width:390px;background:#fff;border:1px solid #dfe4eb;border-radius:14px;box-shadow:0 14px 38px rgba(15,23,42,.2);overflow:hidden;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.pf-note[hidden]{display:none}
.pf-note__head{display:flex;align-items:center;gap:8px;padding:14px 12px 10px 16px}
.pf-note__dot{width:8px;height:8px;border-radius:50%;background:var(--pf-brand);flex:none}
.pf-note__title{flex:1;font-size:14px;font-weight:700;color:#0f172a}
.pf-note__close{display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:7px;background:transparent;color:#94a3b8;font-size:18px;cursor:pointer}
.pf-note__close:hover{background:#f1f5f9;color:#334155}
.pf-note__ref{display:flex;align-items:center;gap:8px;margin:0 16px 10px;padding:9px 11px;border:1px solid #e5e9f0;border-radius:9px;background:#f8fafc;color:#334155;font-size:12px}
.pf-note__ref svg{width:16px;height:16px;flex:none;color:#64748b}
.pf-note__ref-main{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.pf-note__ref-meta{flex:none;color:#8a94a3;font-variant-numeric:tabular-nums}
.pf-note__input{display:block;width:calc(100% - 32px);min-height:92px;margin:0 16px;padding:10px 12px;resize:vertical;border:1px solid #e5e9f0;border-radius:9px;outline:none;background:#fff;color:#172033;font:13px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.pf-note__input:focus{border-color:#94a3b8;box-shadow:0 0 0 2px rgba(15,23,42,.05)}
.pf-note__input::placeholder{color:#a0a7b2}
.pf-note__shot{display:flex;align-items:center;justify-content:center;min-height:54px;margin:0 16px 10px;border:1px solid #e5e9f0;border-radius:9px;background:#f8fafc;overflow:hidden;color:#8a94a3;font-size:11px}
.pf-note__shot[hidden]{display:none}
.pf-note__shot img{display:block;width:100%;height:auto}
.pf-note__hint{padding:8px 16px 0;color:#8a94a3;font-size:11px;line-height:1.45}
.pf-note__actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px 16px}
.pf-note__actions button{height:32px;padding:0 12px;border:1px solid #dfe4eb;border-radius:6px;background:#fff;color:#334155;font:12px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;cursor:pointer}
.pf-note__actions button:hover{background:#f1f5f9}
.pf-note__actions .pf-note__copy{border-color:var(--pf-brand);background:var(--pf-brand);color:#fff}
.pf-note__actions .pf-note__copy:hover{background:var(--pf-brand-hover);border-color:var(--pf-brand-hover)}
`;

export const ICON_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/></svg>';

export function notePanelScript() {
  return `
(function(){
  if (window.__pfNote) return;
  var menuEl = null, menuTrigger = null, panel = null, input = null, refEl = null, shotEl = null, hintEl = null, titleEl = null, copyBtn = null, compose = null, lastKey = null;
  var shotJob = null; // 当前这次标注的截图：Promise<{ path } | null>
  function closeMenu(restoreFocus){
    if (menuEl) menuEl.hidden = true;
    if (restoreFocus && menuTrigger && menuTrigger.isConnected && menuTrigger.focus) menuTrigger.focus({ preventScroll: true });
    menuTrigger = null;
  }
  function menu(x, y, trigger, actions){
    if (!menuEl) {
      menuEl = document.createElement("div");
      menuEl.className = "pf-context"; menuEl.hidden = true; menuEl.setAttribute("role", "menu");
      document.body.appendChild(menuEl);
    }
    menuEl.innerHTML = "";
    actions.forEach(function(action){
      var item = document.createElement("button");
      item.type = "button"; item.className = "pf-context__item"; item.setAttribute("role", "menuitem"); item.dataset.action = action.id;
      var icon = document.createElement("span"); icon.innerHTML = action.icon || "";
      var label = document.createElement("span"); label.textContent = action.label;
      item.appendChild(icon); item.appendChild(label);
      item.addEventListener("click", function(e){ e.stopPropagation(); closeMenu(false); action.run(); });
      menuEl.appendChild(item);
    });
    menuEl.hidden = false;
    menuTrigger = trigger || null;
    if (menuTrigger && menuTrigger.setAttribute && !menuTrigger.hasAttribute("tabindex")) menuTrigger.setAttribute("tabindex", "-1");
    menuEl.style.left = "0px"; menuEl.style.top = "0px";
    var box = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(8, Math.min(x, innerWidth - box.width - 8)) + "px";
    menuEl.style.top = Math.max(8, Math.min(y, innerHeight - box.height - 8)) + "px";
    var first = menuEl.querySelector("button"); if (first) first.focus();
  }
  function ensurePanel(){
    if (panel) return;
    // 用 div 不用 section：有的页面内容会给 section 整体上样式（幻灯片的设计系统），面板不能被带进去
    panel = document.createElement("div"); panel.className = "pf-note"; panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "标注");
    var head = document.createElement("div"); head.className = "pf-note__head";
    var dot = document.createElement("span"); dot.className = "pf-note__dot";
    titleEl = document.createElement("span"); titleEl.className = "pf-note__title";
    var close = document.createElement("button"); close.type = "button"; close.className = "pf-note__close"; close.title = "关闭"; close.setAttribute("aria-label", "关闭标注"); close.textContent = "×";
    close.addEventListener("click", function(){ panel.hidden = true; });
    head.appendChild(dot); head.appendChild(titleEl); head.appendChild(close);
    refEl = document.createElement("div"); refEl.className = "pf-note__ref";
    input = document.createElement("textarea"); input.className = "pf-note__input";
    shotEl = document.createElement("div"); shotEl.className = "pf-note__shot"; shotEl.hidden = true;
    hintEl = document.createElement("div"); hintEl.className = "pf-note__hint";
    var actions = document.createElement("div"); actions.className = "pf-note__actions";
    var clear = document.createElement("button"); clear.type = "button"; clear.textContent = "清空"; clear.addEventListener("click", function(){ input.value = ""; input.focus(); });
    copyBtn = document.createElement("button"); copyBtn.type = "button"; copyBtn.className = "pf-note__copy"; copyBtn.textContent = "复制给 agent"; copyBtn.addEventListener("click", copy);
    actions.appendChild(clear); actions.appendChild(copyBtn);
    panel.appendChild(head); panel.appendChild(refEl); panel.appendChild(shotEl); panel.appendChild(input); panel.appendChild(hintEl); panel.appendChild(actions);
    document.body.appendChild(panel);
  }
  function open(o){
    ensurePanel();
    titleEl.textContent = o.title || "标注";
    refEl.innerHTML = (o.icon || "") + '<span class="pf-note__ref-main"></span><span class="pf-note__ref-meta"></span>';
    refEl.querySelector(".pf-note__ref-main").textContent = o.main || "";
    refEl.querySelector(".pf-note__ref-meta").textContent = o.meta || "";
    input.placeholder = o.placeholder || "写下希望本地 agent 怎么改…";
    hintEl.textContent = o.hint || "";
    compose = o.compose;
    startShot(o.shot);
    // 换了标注对象就清空上次写的意见；同一个对象再打开，保留没复制出去的文字。
    if (o.key != null && o.key !== lastKey) input.value = "";
    lastKey = o.key != null ? o.key : lastKey;
    panel.hidden = false; input.focus();
  }
  function writeClipboard(text){
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
    var ok = document.execCommand("copy"); ta.remove(); return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
  }
  // 截图：请求本地服务（/p/<项目>/__protoflow_shot），地址是当前页（带 ?查询 和 #锚点）。截不了（导出的单文件、
  // 本地服务没有浏览器）就不带图，标注照样能复制。
  function startShot(spec){
    shotJob = null;
    if (!shotEl) return;
    var m = /^\\/p\\/([^/]+)\\/(.+)$/.exec(location.pathname);
    if (!spec || !m) { shotEl.hidden = true; return; }
    shotEl.hidden = false; shotEl.textContent = "正在截图…";
    var area = document.querySelector(spec.selector);
    var job = shotJob = fetch("/p/" + m[1] + "/__protoflow_shot", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: m[2] + location.search + location.hash, selector: spec.selector, boxes: spec.boxes || [], viewport: { width: innerWidth, height: innerHeight }, areaWidth: area ? area.getBoundingClientRect().width : 0 }),
    }).then(function(r){ return r.ok ? r.json() : null; }).then(function(r){
      if (job !== shotJob) return null;
      if (!r || !r.path) { shotEl.textContent = "截图没成功，复制的内容不带图"; return null; }
      shotEl.innerHTML = ""; var img = document.createElement("img"); img.src = r.dataUrl; img.alt = "标注截图"; shotEl.appendChild(img);
      return { path: r.path };
    }, function(){ if (job === shotJob) shotEl.textContent = "截图没成功，复制的内容不带图"; return null; });
  }
  // 按排版位置量（offsetTop 那条链），不按屏幕上的位置：页面的入场动画、缩放（transform）都不影响——截图时
  // 无头浏览器关了动画，量的是最终位置，两边才对得上。SVG 里的元素没有 offset*，退回按屏幕位置量。
  function warmShot(){
    var m = /^\\/p\\/([^/]+)\\//.exec(location.pathname);
    if (m) fetch("/p/" + m[1] + "/__protoflow_shot", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"warm":true}' }).catch(function(){});
  }
  function boxesIn(area, els){
    var aw = area.offsetWidth, ah = area.offsetHeight, a = area.getBoundingClientRect();
    if (!aw || !ah) return [];
    return els.map(function(el){
      var x = 0, y = 0, n = el;
      while (n && n !== area && n.offsetParent !== undefined) {
        x += n.offsetLeft; y += n.offsetTop;
        n = n.offsetParent;
        if (n && n !== area) { x += n.clientLeft; y += n.clientTop; }
      }
      if (n === area) return { x: x / aw, y: y / ah, w: el.offsetWidth / aw, h: el.offsetHeight / ah };
      var r = el.getBoundingClientRect();
      return { x: (r.left - a.left) / a.width, y: (r.top - a.top) / a.height, w: r.width / a.width, h: r.height / a.height };
    });
  }
  function copy(){
    if (!compose) return;
    var text = compose(input.value);
    var job = shotJob;
    if (job) { copyBtn.disabled = true; copyBtn.textContent = "等截图…"; }
    Promise.resolve(job).then(function(shot){
      copyBtn.disabled = false; copyBtn.textContent = "复制给 agent";
      return writeClipboard(text + (shot ? "\\nscreenshot: " + shot.path + "  （选中的按编号框出，编号对应上面的顺序）" : ""));
    }).then(function(){
      var old = copyBtn.textContent; copyBtn.textContent = "已复制"; setTimeout(function(){ copyBtn.textContent = old; }, 1200);
    }).catch(function(){ copyBtn.disabled = false; });
  }
  function header(o){
    var lines = ["[Protoflow 标注]"];
    if (o.projectId) lines.push("project: " + o.projectId);
    lines.push("kind: " + o.kind);
    lines.push("source: " + o.source);
    lines.push("version: v" + o.version + (o.version === o.head ? " (head)" : " (historical)"));
    return lines;
  }
  document.addEventListener("pointerdown", function(e){ if (menuEl && !menuEl.hidden && !menuEl.contains(e.target)) closeMenu(false); });
  document.addEventListener("scroll", function(){ closeMenu(false); }, true);
  window.addEventListener("resize", function(){ closeMenu(false); });
  document.addEventListener("keydown", function(e){
    if (e.key !== "Escape") return;
    if (menuEl && !menuEl.hidden) { closeMenu(true); return; }
    if (panel && !panel.hidden) panel.hidden = true;
  });
  window.__pfNote = {
    menu: menu, open: open, header: header, boxesIn: boxesIn, warmShot: warmShot,
    closeMenu: function(){ closeMenu(false); },
    close: function(){ closeMenu(false); if (panel) panel.hidden = true; },
    isOpen: function(){ return !!((menuEl && !menuEl.hidden) || (panel && !panel.hidden)); },
  };
})();`;
}
