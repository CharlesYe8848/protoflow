// core/preview.js — buildPreviewHtml 为纯模板函数；copyPreviewLibs/readAssetsMap 是 FS 操作（与 store 同级的边界豁免）
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { FAVICON_LINK, BRAND } from "./brand.js";

const require_ = createRequire(import.meta.url);

// 「导出」按钮的图标：画布 core/canvas.js 和文档阅读页 core/docPreview.js 共用同一个（下载箭头），
// 跟其它工具栏图标同一套画风（viewBox 24、stroke currentColor）。
// 顶层「分享」按钮的图标——之前用的是 Feather "download"（向下箭头扎进托盘），跟按钮已经改叫
// 「分享」名不副实；换成 Feather "share-2"（三个圆点用两条线连成一个小网络），是安卓系统那套
// 「分享」的通用符号，不会被认成下载/导出。
export const ICON_SHARE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;

// 「导出」按钮的下载逻辑：画布 core/canvas.js 和文档阅读页 core/docPreview.js 各自的「导出」按钮
// 共用这一段（两边是不同的 HTML 文档，运行时不共享作用域，只能在生成时共用同一份源文本，跟
// MERMAID_THEME_VARS 那样）。导出端点回的是文件字节，不是 JSON——不落一个固定的 .export/ 路径。
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
export function exportDownloadScript() {
  return `
  function __pfDownloadExport(url, btn){
    var label = btn.querySelector(".pf-export-label");
    var old = label.textContent;
    // 只禁用按钮防重复点击（CSS :disabled 会把它压暗，够用），不改文案——"导出中…"这种过渡态
    // 文案是多余的交互，浏览器自己的下载动作很快，用户点完基本感觉不到这个中间状态。
    btn.disabled = true;
    fetch(url, { method: "POST" }).then(function(r){
      if (!r.ok) throw new Error("HTTP " + r.status);
      var cd = r.headers.get("Content-Disposition") || "";
      var filename = "export.zip";
      var m = /filename\\*=UTF-8''([^;]+)/.exec(cd);
      if (m) { try { filename = decodeURIComponent(m[1]); } catch (e) {} }
      else { var m2 = /filename="([^"]+)"/.exec(cd); if (m2) filename = m2[1]; }
      return r.blob().then(function(blob){ return { blob: blob, filename: filename }; });
    }).then(function(res){
      var a = document.createElement("a");
      a.href = URL.createObjectURL(res.blob); a.download = res.filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      // 成功了就直接解禁按钮，文案从头到尾没变过——不再显示"已导出 xxx"这种过渡文案，浏览器
      // 自己的下载栏/通知已经说明下载完成了，这里再加一遍是重复信息。
      btn.disabled = false;
    }).catch(function(e){
      // 把真实原因打进 console + 按钮 title（悬浮可见），不能只留一句"导出失败"——不然出问题时
      // 除了让用户重试没有别的排查手段（比如磁盘写满、项目没注册这类，光看"导出失败"猜不出来）。
      var msg = (e && e.message) || String(e);
      console.error("[protoflow] 导出失败：", e);
      label.textContent = "导出失败";
      btn.title = "导出失败：" + msg;
      setTimeout(function(){ label.textContent = old; btn.title = "分享"; btn.disabled = false; }, 5000);
    });
  }`;
}

// mermaid.min.js 压缩后 3.5MB，比 react+react-dom+babel 加起来还重好几倍——文件本身无条件拷进
// lib/ 目录（磁盘空间不值一提），但 buildPreviewHtml 只在画板源码真的用到 mermaid 时才生成
// <script> 标签引用它，没用到的画板不会多这一份网络/解析成本。
export const PREVIEW_LIB_FILES = ["react.production.min.js", "react-dom.production.min.js", "babel.min.js", "mermaid.min.js"];

// react 18 的 exports 字段不放行 ./umd/* 子路径，须经 package.json 定位包根目录再拼
const pkgRoot = (name) => path.dirname(require_.resolve(`${name}/package.json`));

// 每个库文件名 → 它在 node_modules 里的真实绝对路径。copyPreviewLibs/copyMarkedLib/copyMermaidLib
// （拷成真文件，给 zip 导出/实时预览用）和 readLibSources（读成字符串，给单 HTML 导出内联用）
// 是同一份路径表的两种消费方式，不要各自重复写一遍这几个 path.join。
const LIB_SOURCE_PATH = {
  "react.production.min.js": () => path.join(pkgRoot("react"), "umd", "react.production.min.js"),
  "react-dom.production.min.js": () => path.join(pkgRoot("react-dom"), "umd", "react-dom.production.min.js"),
  "babel.min.js": () => path.join(pkgRoot("@babel/standalone"), "babel.min.js"),
  "mermaid.min.js": () => path.join(pkgRoot("mermaid"), "dist", "mermaid.min.js"),
  "marked.min.js": () => path.join(pkgRoot("marked"), "lib", "marked.umd.js"),
};

export function copyPreviewLibs(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of ["react.production.min.js", "react-dom.production.min.js", "babel.min.js", "mermaid.min.js"]) {
    fs.copyFileSync(LIB_SOURCE_PATH[name](), path.join(destDir, name));
  }
}

// 文档预览（docs/<docId>/preview.html）用的库：marked 常拷，mermaid 只在正文真的用到 ```mermaid
// 时才拷（3.5MB，跟画板预览同一条原则）。落项目级 lib/，不再按版本 ×N（这是"版本目录太重"的
// 主要来源之一）。
export function copyMarkedLib(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(LIB_SOURCE_PATH["marked.min.js"](), path.join(destDir, "marked.min.js"));
}
export function copyMermaidLib(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(LIB_SOURCE_PATH["mermaid.min.js"](), path.join(destDir, "mermaid.min.js"));
}
export function usesMermaid(md) {
  return /```mermaid\b/.test(String(md));
}

// 单 HTML 导出用：把库文件读成字符串（不落盘），供内联进 <script> 标签。names 是
// LIB_SOURCE_PATH 里的文件名子集。
export function readLibSources(names) {
  const out = {};
  for (const name of names) {
    const resolve = LIB_SOURCE_PATH[name];
    if (!resolve) throw new Error(`未知的库文件：${name}`);
    out[name] = fs.readFileSync(resolve(), "utf8");
  }
  return out;
}

// 导出菜单的行 HTML：格式列表来自 core/exportMenu.js 的登记表（画布/文档两边生成页面时传进来），
// 新增格式只改那张表，这里自动多一行，不用跟着改模板。图标：zip 用文件夹（多文件打包），html
// 用单页文档（一个文件）。
const EXPORT_ROW_ICON = {
  zip: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`,
  html: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  markdown: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 15V9l3 3 3-3v6M15 9v6M13 13l2 2 2-2"/></svg>`,
};
export function exportMenuRowsHtml(formats) {
  return (formats || []).map((f) => {
    const icon = EXPORT_ROW_ICON[f.id] || EXPORT_ROW_ICON.html;
    return `<button class="pf-export-menu__item" type="button" data-format="${f.id}">${icon}<span class="pf-export-menu__body"><b>${f.label}</b><span>${f.hint}</span></span><span class="pf-export-menu__action">下载</span></button>`;
  }).join("");
}

// 画板 assets/ 目录 → { 文件名: dataURI }，供预览页内联
export function readAssetsMap(assetsDir) {
  const map = {};
  if (!fs.existsSync(assetsDir)) return map;
  for (const f of fs.readdirSync(assetsDir)) {
    const ext = path.extname(f).slice(1).toLowerCase();
    const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", gif: "image/gif" }[ext];
    if (mime) map[f] = `data:${mime};base64,${fs.readFileSync(path.join(assetsDir, f)).toString("base64")}`;
  }
  return map;
}

// 只转义 </script 序列（HTML 解析器提前闭合脚本块的唯一风险点）；
// 不能转义所有 </，否则 JSX 闭合标签（</div>）会被破坏。
const escapeScript = (s) => String(s).replace(/<\/script/gi, "<\\/script");

const THEME_CSS = `*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}
body{font-family:"PingFang SC","Microsoft YaHei",-apple-system,sans-serif;-webkit-font-smoothing:antialiased}`;

// 资产路径改写：拦截 <img src>，从 __ASSETS__ 里取 data URI（照搬 Axure0.3 的 patcher 思路，精简版）
const ASSET_PATCHER = `(function(){
  var A = window.__ASSETS__ || {};
  function resolve(v){ if(!v) return v; var f = String(v).split("/").pop(); return A[f] || v; }
  var d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    set: function(v){ d.set.call(this, resolve(v)); },
    get: function(){ return d.get.call(this); }, configurable: true
  });
})();`;

// 交互历史采集：记录画板里真实发生过的点击/悬浮，滚动窗口只留最近几条。取元素工具选中元素、
// 标注定位到元素，两边都可能遇到"这个元素只在某个交互之后才存在"——与其让用户手写"先点什么、
// 再点什么"，不如在真实交互发生的当下就如实记下来，定位不到时把画板重置回初始态、按记录的
// 顺序重放一遍，自动回到当时的状态。悬浮不是每次 mouseover 都记：先等停留一小段时间，再用
// MutationObserver 确认这次停留真的引起了 DOM 变化，才当作一次"有意义的交互"记下来——否则
// 鼠标划过路径上一大串元素全被当成交互，记录全是噪音。
// selector 优先用 id（唯一、最稳）；没有 id 就从这个元素一路往上找最近一个带 id 的祖先当锚点
// （el.closest("[id]")），只拼锚点到目标之间那一小段结构路径（同标签兄弟节点多于一个才带
// nth-of-type）——跟浏览器 DevTools "复制选择器" 是同一个思路，能用 id 的地方就不用位置。锚定
// 在最近的 id 上，页面别的地方增删多少兄弟节点都不影响这条路径，比"一路走到文档根"更短也更耐造；
// 真的一路往上都没有任何祖先带 id，才退回到从文档根开始的完整路径。
// 早期版本用"标签+全部 class"当选择器、另配一个"当时命中结果里排第几个"的 index 消歧义，但这
// 只在"命中列表的组成不会变"时可靠——只要页面存在会话/标签页切换这类会影响"当前一共命中几个
// 同款元素"的应用状态，index 就可能在状态漂移后错误地对上另一个长得一样、实际是别处内容的
// 元素，而且是安静地对错。结构路径要么精确命中当初那一个节点，要么（树形结构真的变了）查不到，
// 不存在"查到了但其实是别的东西"这种中间状态，天然不需要 index 消歧义。
const INTERACTION_HISTORY_SCRIPT = `
  window.__pfInteractionHistory = window.__pfInteractionHistory || [];
  (function(){
    function stableSelector(el){
      if (el.id) return "#" + CSS.escape(el.id);
      var anchor = el.parentElement && el.parentElement.closest("[id]");
      var root = anchor || document.documentElement;
      var path = [];
      var node = el;
      while (node && node.nodeType === 1 && node !== root) {
        var seg = node.tagName.toLowerCase();
        var parent = node.parentElement;
        if (parent) {
          var sameTag = Array.prototype.filter.call(parent.children, function(c){ return c.tagName === node.tagName; });
          if (sameTag.length > 1) seg += ":nth-of-type(" + (sameTag.indexOf(node) + 1) + ")";
        }
        path.unshift(seg);
        node = parent;
      }
      return (anchor ? "#" + CSS.escape(anchor.id) + " > " : "") + path.join(" > ");
    }
    function record(type, el){
      // 选择模式下（父文档工具栏切到"选择元素"，见 core/preview.js 的 elementPickScript）画板内的
      // 点击/悬浮只用来选元素、不驱动画板自身逻辑，也就不是"怎么到达某状态"的交互步骤，不进重放历史。
      // 独立打开时这个全局一直是 undefined，不受影响。
      if (window.__pfPickMode) return;
      if (!el || el === document.body || el === document.documentElement) return;
      var selector = stableSelector(el);
      var hist = window.__pfInteractionHistory;
      hist.push({ type: type, selector: selector, t: Date.now() });
      if (hist.length > 10) hist.shift();
    }
    document.addEventListener("click", function(e){ record("click", e.target); }, true);
    var hoverTimer = null;
    document.addEventListener("mouseover", function(e){
      clearTimeout(hoverTimer);
      var el = e.target;
      hoverTimer = setTimeout(function(){
        var mo = new MutationObserver(function(){ record("hover", el); mo.disconnect(); });
        mo.observe(document.body, { childList: true, subtree: true });
        setTimeout(function(){ mo.disconnect(); }, 500);
      }, 200);
    }, true);
    document.addEventListener("mouseout", function(){ clearTimeout(hoverTimer); }, true);
  })();
`;

// 按记录的交互路径重放：先把画板重置回初始态（整个文档 reload，逼 React 从零重新挂载——这是
// 唯一不需要画板自己配合、就能保证"确定回到了初始态"的通用手段，不依赖画板暴露任何自定义重置
// 接口），再按顺序对每一步 dispatchEvent 真实的 click/mouseover，两步之间留出时间等 React
// 重新渲染。机器采集的 selector（INTERACTION_HISTORY_SCRIPT）本身已经是唯一的结构路径，不带
// index 也能精确命中；index 只是留给人/模型手写 interactionPath 时的可选逃生舱——写一个粗粒度
// selector（比如 tag+class）省事，命中多个时靠 index 挑第几个，兼容 guides/annotation.md 里
// 文档过的写法。reload 后文档整个换掉，所以这段重放逻辑必须写成"reload 之后从零开始跑"，不能
// 是重置前那个上下文里的普通函数调用。
const REPLAY_SCRIPT = `
  function __pfResolveStep(doc, step){
    var matches = doc.querySelectorAll(step.selector);
    return matches[step.index] || matches[0] || null;
  }
  function __pfReplaySteps(doc, path, i, done){
    if (i >= path.length) { done(); return; }
    var el = __pfResolveStep(doc, path[i]);
    if (el) el.dispatchEvent(new MouseEvent(path[i].type === "hover" ? "mouseover" : "click", { bubbles: true }));
    setTimeout(function(){ __pfReplaySteps(doc, path, i + 1, done); }, 150);
  }
`;

// 标注覆盖层（v2）：不再画编号气泡。标注说明在画布左侧侧边栏（core/canvas.js 的 setupAnnotations），
// 说明正文里的元素引用 [名](#el/元素id) 点击后画布发 protoflow-annotation-flash 定位+闪一下；
// 悬停整条发 protoflow-annotation-highlight 给这条引用到的元素批量淡描边。元素要交互才可见时的
// 重放逻辑保留。
// 全程走 postMessage，不直接挂 window.__pfXxx 给父文档同源调用——画布导出后可能被放进跨源的
// file:// 环境（画板 iframe 用的是 src=，不是 srcdoc），同源假设不成立时直接调用会被
// SecurityError 拦下；postMessage 发送这一步不受跨源限制，两种场景（今天的同源 dev server /
// 导出后的跨源 file://）走同一份代码，不用分场景判断。
//
// 高亮框故意不用给目标元素加 CSS outline——真实项目里目标常紧贴某个 overflow:hidden 祖先边缘，
// outline 会被裁成一条线（实测过）。改成画进挂在 document.body 上、不受画板内部 overflow 影响的
// 图层，用 getBoundingClientRect() 算矩形定位。
const ANNOTATION_OVERLAY = (artboardId) => `(function(){
  var ID = ${JSON.stringify(artboardId)};
  // 用 artboardId 给 sessionStorage key 加命名空间——画布同时嵌入多块画板时，同一标签页里
  // 各 iframe 共享 sessionStorage，不加命名空间会互相覆盖。
  var SS_KEY = "__pfPendingLocate_" + ID;
  ${REPLAY_SCRIPT}
  function el(tag, css){ var e = document.createElement(tag); e.style.cssText = css; return e; }
  function byId(id){ return id ? document.getElementById(id) : null; }
  function locatable(t){
    if (!t || !document.contains(t)) return false;
    var r = t.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  var layer;
  var flashTarget = null, flashUntil = 0;
  var highlights = [];   // 当前批量淡描边的元素（悬停整条标注时）
  function boxOn(node, style){
    var r = node.getBoundingClientRect();
    var b = el("div", "position:absolute;pointer-events:none;box-sizing:border-box;border-radius:4px;" + style);
    b.style.left = (r.left + window.scrollX - 2) + "px";
    b.style.top = (r.top + window.scrollY - 2) + "px";
    b.style.width = (r.width + 4) + "px";
    b.style.height = (r.height + 4) + "px";
    layer.appendChild(b);
  }
  function paint(){
    if (!layer) return;
    layer.innerHTML = "";
    highlights.forEach(function(h){ if (locatable(h)) boxOn(h, "border:2px solid rgba(225,29,72,.55);background:rgba(225,29,72,.06);"); });
    if (flashTarget && document.contains(flashTarget) && Date.now() < flashUntil) boxOn(flashTarget, "border:2px solid #e11d48;");
  }
  function flash(t){
    flashTarget = t;
    flashUntil = Date.now() + 1600;
    paint();
    setTimeout(function(){ if (Date.now() >= flashUntil) { flashTarget = null; paint(); } }, 1600);
  }
  // 定位一个元素：能直接定位就 scrollIntoView + 闪；定位不到但给了 interactionPath（元素要交互
  // 才出现），就把画板重置回初始态、按路径重放（reload 后 resumePendingLocate 接力收尾）；都不行
  // 就静默返回（侧边栏那条 chip 会自己标灰）。
  function locate(elId, path){
    var t = byId(elId);
    if (locatable(t)) { t.scrollIntoView({ block: "center" }); flash(t); setTimeout(paint, 300); return; }
    if (!path || !path.length) return;
    try { sessionStorage.setItem(SS_KEY, JSON.stringify({ elId: elId, path: path })); } catch (e) { return; }
    location.reload();
  }
  function resumePendingLocate(){
    var raw;
    try { raw = sessionStorage.getItem(SS_KEY); } catch (e) { return; }
    if (!raw) return;
    try { sessionStorage.removeItem(SS_KEY); } catch (e) {}
    var pending;
    try { pending = JSON.parse(raw); } catch (e) { return; }
    __pfReplaySteps(document, pending.path, 0, function(){
      var t = byId(pending.elId);
      if (locatable(t)) { t.scrollIntoView({ block: "center" }); flash(t); }
    });
  }
  function build(){
    layer = el("div", "position:absolute;left:0;top:0;width:100%;height:0;pointer-events:none;z-index:99995;");
    document.body.appendChild(layer);
    window.addEventListener("resize", paint);
    setInterval(paint, 800);   // 交互后描边跟着元素挪
  }
  // 画布父文档发消息过来（不直接调用，见文件头注释）。build() 是异步的（等 #root 有内容），
  // 消息到得早时图层可能还没建好——paint() 里有 !layer 守卫，setInterval 起来后会补画。
  window.addEventListener("message", function(e){
    var d = e.data;
    if (!d) return;
    if (d.type === "protoflow-annotation-flash") { locate(d.elId, d.path); return; }
    if (d.type === "protoflow-annotation-highlight") { highlights = (d.ids || []).map(byId).filter(Boolean); paint(); return; }
    if (d.type === "protoflow-annotation-clear") { highlights = []; paint(); return; }
    if (d.type === "protoflow-annotation-check-ids") {
      // 画布侧栏渲染标注列表时问"这些元素 id 还在不在"，用来给断链的 chip 加样式——这一步需要
      // 读子文档 DOM，只能在子文档自己这边查、把结果送回去，不能指望父文档跨源直接查。
      var missing = (d.ids || []).filter(function(elId){ return !byId(elId); });
      try { parent.postMessage({ type: "protoflow-annotation-check-ids-reply", artboardId: ID, missingIds: missing }, "*"); } catch (err) {}
      return;
    }
  });
  var tries = 0;
  var wait = setInterval(function(){
    tries++;
    var root = document.getElementById("root");
    if ((root && root.children.length) || tries > 50) { clearInterval(wait); build(); resumePendingLocate(); }
  }, 100);
})();`;

// 真实高度上报：向父窗口（若存在，如画布把本页装进 iframe）postMessage 自己的文档高度。
// 独立打开时 parent === window，postMessage 发给自己是无害空操作。这是画布"画板按真实尺寸
// 展示"的数据来源——画板不需要知道自己被谁嵌入，只管如实上报内容高度。
//
// 回归测试的教训：画板根节点如果用了 minHeight:'100vh' 这类视口相对单位（很常见的写法，不算
// 画板作者的错），会跟这套"画布把 iframe 撑高到贴合内容"的机制打起正反馈循环——iframe 被撑高
// → 画板自己的视口跟着变高 → 100vh 重新算出更大的值 → scrollHeight 变得更大 → 上报给父文档
// → iframe 被撑得更高……不会自己停，实测跑几秒钟能把 iframe 撑到近万像素高。
//
// 第一版用 MutationObserver 区分"真实内容变化"跟"单纯外部撑高引起的重排"，实测在真实项目
// （带 mermaid 图表的画板）上没能打断循环——mermaid 的 SVG（useMaxWidth:true）在容器宽度变化
// 时会反过来改写自己的属性，这本身就是一次真实的 DOM mutation，导致"这次 resize 有没有伴随
// 内容变化"这道检查永远判定"有"，freeze 条件永远凑不齐（实测 2 秒内量到 714 次 mutation）。
// 换成更直接的信号：不管 resize 背后有没有 DOM 变化，只看 ResizeObserver 触发的**频率**——
// 真实内容变化（消息追加、图片加载、面板展开）引起的重排是人类可感知节奏，1 秒内正常撑死几次；
// 而这套回环是"resize → 内容对外部尺寸变化做反应 → 又触发 resize"的链式反应，只受浏览器排版/
// 绘制流水线速度限制，实测能到每秒五六十次。1 秒滚动窗口内 ResizeObserver 触发次数一旦超过
// 一个正常内容变化不可能达到的阈值，就判定是回环，冻结上报——画板本身照常渲染，父文档不再跟着
// 继续撑高 iframe（外部尺寸不再变化，回环自然也就没有再触发的理由）。
const sizeReportScript = (artboardId) => `(function(){
  var ID = ${JSON.stringify(artboardId)};
  var frozen = false, recentResizes = [];
  function report(){
    if (frozen) return;
    try {
      // 用 #root / body 的内容高度，不要用 documentElement.scrollHeight：
      // 后者至少等于当前 iframe 视口高，占位先按 width×0.72 撑开后就再也缩不回真实内容高度，
      // 画板底下会留下一截白边。发布截图同理（publishPack 也量的是 #root）。
      var root = document.getElementById("root");
      // React 尚未挂载时，视口占位高度不代表内容就绪。
      if (!root || !root.hasChildNodes() || root.scrollHeight <= 0) return;
      var h = Math.ceil((root && root.scrollHeight) || document.body.scrollHeight || document.documentElement.scrollHeight);
      parent.postMessage({ type: "protoflow-preview-size", artboardId: ID, height: h }, "*");
    } catch (e) {}
  }
  function onResize(){
    if (frozen) return;
    var now = Date.now();
    recentResizes.push(now);
    while (recentResizes.length && now - recentResizes[0] > 1000) recentResizes.shift();
    if (recentResizes.length > 30) { frozen = true; return; }
    report();
  }
  window.addEventListener("load", function(){ setTimeout(report, 50); setTimeout(report, 300); setTimeout(report, 900); });
  if (window.ResizeObserver) {
    var observer = new ResizeObserver(onResize);
    observer.observe(document.documentElement);
    var contentRoot = document.getElementById("root");
    if (contentRoot) observer.observe(contentRoot);
  }
  document.addEventListener("click", function(){ setTimeout(report, 60); });
  // 画布那边：自己所在的页面切页时是"祖先 display:none"，本画板这几次定时上报如果恰好在那时候
  // 触发，量出来的都是没排版的假高度（父文档不知道，会拿假高度定死缩放）。父文档把页面切成可见
  // 后会主动问一次要求马上重新量报——这时候是真的可见了，量出来的才是准的。
  window.addEventListener("message", function(e){
    if (e.data && e.data.type === "protoflow-request-size") report();
  });
})();`;

// 画布手势转发：iframe 是独立的浏览上下文，光标停在画板内容上产生的 wheel/捏合手势不会冒泡到
// 父文档（整站画布 canvas.html），若不在这里单独拦截，浏览器会对这份画板自己的文档执行原生缩放
// ——因为 Chrome 的页面缩放是整个标签页级别的属性，结果是连父文档里的侧边栏也一起被放大。
// 只在真被嵌入时（window.parent !== window）接管；独立打开 preview.html 时保留浏览器原生缩放。
const canvasGestureForwardScript = (artboardId) => `(function(){
  if (window.parent === window) return;
  var ID = ${JSON.stringify(artboardId)};
  function send(kind, e, extra){
    try {
      parent.postMessage(Object.assign({ type: "protoflow-canvas-gesture", kind: kind, artboardId: ID,
        clientX: e.clientX, clientY: e.clientY }, extra || {}), "*");
    } catch (err) {}
  }
  document.addEventListener("wheel", function(e){
    e.preventDefault();
    send("wheel", e, { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey || e.metaKey });
  }, { passive: false });
  document.addEventListener("gesturestart", function(e){ e.preventDefault(); send("gesturestart", e, { scale: e.scale }); });
  document.addEventListener("gesturechange", function(e){ e.preventDefault(); send("gesturechange", e, { scale: e.scale }); });
  document.addEventListener("gestureend", function(e){ e.preventDefault(); send("gestureend", e, {}); });
})();`;

// 取元素工具的画板侧：只负责转发，不负责回答"这是什么元素"——canvas.html 和每块画板的
// preview.html 永远同源（都走 core/localServer.js 的 /p/<projectId>/...），父文档可以直接
// iframeEl.contentDocument.elementFromPoint(...) 同步读，不需要问画板、等画板答；hit-test
// 逻辑因此整个搬去了 core/canvas.js 的 describe()/annotationFor()/hitTest()，这里不再重复一份。
// 真正省不掉的只有这三个转发：光标停在画板内容上产生的 mousemove/mouseleave/click 天生到不了
// 父文档（iframe 是独立浏览上下文，这跟 canvasGestureForwardScript 转发 wheel/手势是同一个
// 道理——是浏览器对"谁接收输入事件"的路由规则，跟同不同源无关），画板必须主动把"这里发生了
// 什么、在哪"广播出去，父文档才有机会去问自己（不是问画板）"这个点是什么"。
// 只在真被嵌入时（window.parent !== window）注册。
const elementPickScript = (artboardId) => `(function(){
  if (window.parent === window) return;
  var ID = ${JSON.stringify(artboardId)};

  // 选择模式位：这是画板侧唯一持有的一点状态。父文档工具栏切到"选择元素"时会 setActive() 广播
  // protoflow-pick-mode；本脚本初始化时也主动问一次（protoflow-pick-mode-query）——懒加载的画板、
  // 或标注定位重放时被 reload 过的画板，本脚本重新跑时父文档可能早已在选择模式。放 window 上是
  // 因为 INTERACTION_HISTORY_SCRIPT 的 record() 也要读它（选择模式下的点击不算交互步骤）。
  window.__pfPickMode = false;
  window.addEventListener("message", function(e){
    if (e.data && e.data.type === "protoflow-pick-mode") window.__pfPickMode = !!e.data.active;
  });
  try { parent.postMessage({ type: "protoflow-pick-mode-query" }, "*"); } catch (err) {}

  // 选择模式下拦掉"点按"一族：capture 阶段 preventDefault + stopImmediatePropagation。React 的
  // 合成事件挂在 #root 上、晚于 document 的 capture 监听器，因此收不到——点击只用来选元素，不会
  // 切 tab / 展开面板 / 跳转。要真正操作原型请切回交互模式。悬浮（mouseover / :hover）不拦：取
  // 元素工具要靠它看清元素，且远没有点击那么容易触发破坏性的状态变化。
  ["mousedown", "mouseup", "dblclick", "contextmenu"].forEach(function(type){
    document.addEventListener(type, function(e){
      if (window.__pfPickMode) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  });

  // 光标停在画板内容上产生的 mousemove 不会传到父文档——跟 canvasGestureForwardScript 顶部
  // 注释是同一个道理，iframe 是独立浏览上下文，父文档拿不到"鼠标现在在这块画板的哪个位置"，
  // 悬浮高亮就无从驱动。这里只管如实转发本地坐标。交互历史采集（__pfInteractionHistory）在
  // buildPreviewHtml 里作为独立脚本无条件注入过一次（标注定位在独立打开时也要用），这里不重复。
  var moveTicking = false, lastX = 0, lastY = 0;
  document.addEventListener("mousemove", function(e){
    lastX = e.clientX; lastY = e.clientY;
    if (moveTicking) return;
    moveTicking = true;
    setTimeout(function(){
      moveTicking = false;
      try { parent.postMessage({ type: "protoflow-canvas-pointer", artboardId: ID, x: lastX, y: lastY }, "*"); }
      catch (err) {}
    }, 30);
  });
  document.addEventListener("mouseleave", function(){
    try { parent.postMessage({ type: "protoflow-canvas-pointer", artboardId: ID, x: null, y: null }, "*"); }
    catch (err) {}
  });
  // 点击：画板内容上发生的点击到不了父文档，取元素工具"点击插入引用胶囊"那一步等的就是这个
  // 通知——所以**先无条件转发**（带上 __pfInteractionHistory 这一刻的快照，供之后"定位不到就
  // 从初始态重放"用）。转发之后：选择模式下 preventDefault + stopImmediatePropagation 掐断，
  // 画板自身的 onClick 收不到；交互模式下不拦，画板照常响应（展开折叠面板等）。
  document.addEventListener("click", function(e){
    try { parent.postMessage({ type: "protoflow-canvas-pointer-click", artboardId: ID, path: __pfInteractionHistory.slice() }, "*"); }
    catch (err) {}
    if (window.__pfPickMode) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
})();`;

// 只在画板源码真的用到 mermaid 时才生成引用这个库的 <script> 标签——见 copyPreviewLibs 顶部
// 注释，文件本身无条件拷进 lib/，但网络/解析这 3.5MB 的成本只应该由真用到的画板来付。检测
// 手法就是看源码文本里有没有出现"mermaid"这个词，不做更复杂的静态分析，够用。
// startOnLoad:false 是因为 mermaid 默认会在 DOMContentLoaded 时自动扫描页面找 .mermaid 元素
// 渲染——这个时机早于 React 把内容挂载到 #root，会扑空；改成画板自己的 JSX 在 useEffect 里
// 显式调用 mermaid.run()，等真正挂载完再渲染。
// theme/themeVariables 配的是 ProtoFlow 自己这套画布 UI 的黑白灰配色（节点浅灰底 + ink 文字、
// slate 结构线、PingFang SC 字体，跟取元素工具的合成面板同一套）——mermaid 自带的 default
// 主题是偏淡的紫色+通用无衬线字体，跟其它产物摆在一起会显得像是外来的、没设计过的小组件；
// 换成这套配色至少视觉上跟平台其它部分一致，不是真正意义上的"好看"，画板作者仍然可以在自己的
// JSX 里传别的 theme 覆盖掉（mermaid.run 之前自己再调一次 mermaid.initialize 即可）。
// 导出给 core/docPreview.js 复用——这是纯配色数据，不是环境相关的脚本片段（不像本文件其它
// 脚本常量那样"运行在浏览器端、要不要重复取决于执行环境"），两边共用同一份，改配色不用两处改。
// primaryColor（节点底）比 --pf-brand-tint 再浅一点，多节点图里不至于一片灰；边框用 slate-700
// 而非 ink，节点多时全黑描边太重。
export const MERMAID_THEME_VARS = {
  primaryColor: "#f1f5f9",
  primaryTextColor: BRAND.brand,
  primaryBorderColor: "#334155",
  lineColor: "#64748b",
  secondaryColor: "#f6f7fb",
  tertiaryColor: "#fff",
  fontFamily: '"PingFang SC","Microsoft YaHei",-apple-system,sans-serif',
};
const MERMAID_INIT = `(function(){
  if (!window.mermaid) return;
  window.mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: ${JSON.stringify(MERMAID_THEME_VARS)} });
})();`;

export function buildPreviewHtml({ artboardId, source, iconsSource = "", assetsMap = {}, libRelPath = "lib", annotationsMd = "" }) {
  const assetsJson = JSON.stringify(assetsMap).replace(/</g, "\\u003c");
  const parts = [
    '<!DOCTYPE html>',
    `<html lang="zh-CN" data-artboard="${artboardId}"><head><meta charset="UTF-8"/>`,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>',
    FAVICON_LINK,
    `<style>${THEME_CSS}</style>`,
    `<script>window.__ASSETS__ = ${assetsJson};<\/script>`,
    `<script>${ASSET_PATCHER}<\/script>`,
    `<script src="${libRelPath}/react.production.min.js"><\/script>`,
    `<script src="${libRelPath}/react-dom.production.min.js"><\/script>`,
    `<script src="${libRelPath}/babel.min.js"><\/script>`,
  ];
  if (source.includes("mermaid")) {
    parts.push(
      `<script src="${libRelPath}/mermaid.min.js"><\/script>`,
      `<script>${MERMAID_INIT}<\/script>`,
    );
  }
  parts.push(
    '</head><body><div id="root"></div>',
    '<script type="text/babel" data-presets="env,react">',
    escapeScript(iconsSource),
    'window.I = Object.assign({}, window.I || {}, typeof I !== "undefined" ? I : {});',
    '<\/script>',
    '<script type="text/babel" data-presets="env,react">',
    escapeScript(source),
    'ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(Component));',
    '<\/script>',
  );
  parts.push(`<script>${INTERACTION_HISTORY_SCRIPT}<\/script>`);
  if (String(annotationsMd).trim()) {
    // 取元素工具（elementPickScript）读这个：点选到一个已经被标注引用（content 里有 #el/该元素id）
    // 的元素时，在合成胶囊里标一句「已被标注引用」。定位/高亮的重放路径由画布父文档传进来
    // （__pfFlashElement(elId, path)），overlay 自己不需要 refs 数据。
    parts.push(
      `<script>window.__ANNOTATION_MD__ = ${JSON.stringify(String(annotationsMd)).replace(/</g, "\\u003c")};<\/script>`,
      `<script>${ANNOTATION_OVERLAY(artboardId)}<\/script>`,
    );
  }
  parts.push(
    `<script>${sizeReportScript(artboardId)}<\/script>`,
    `<script>${canvasGestureForwardScript(artboardId)}<\/script>`,
    `<script>${elementPickScript(artboardId)}<\/script>`,
    '</body></html>',
  );
  return parts.join('\n');
}
