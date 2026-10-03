// core/preview.js — 画板预览页 buildPreviewHtml（画布产品）。纯模板函数；分享按钮、导出菜单、
// Mermaid 配色等几个产品共用的界面零件在 core/ui.js，依赖库的拷贝在 core/libs.js。
import { DIAGRAM_PALETTE, FAVICON_LINK } from "protoflow/sdk";

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
// selector（比如 tag+class）省事，命中多个时靠 index 挑第几个，兼容 guides/annotation.md（本产品目录下）里
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
  // ⌘/Ctrl+A：焦点在画板里时按键到不了父文档，转发给画布做"全选当前页"（canvasPicker.js 的
  // selectAllOnPage），不让浏览器只把这块画板的文字选上。画板里的输入框正在打字时保留原生全选。
  document.addEventListener("keydown", function(e){
    if (!(e.metaKey || e.ctrlKey) || e.altKey || (e.key !== "a" && e.key !== "A")) return;
    var ae = document.activeElement;
    if (ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT")) return;
    e.preventDefault();
    try { parent.postMessage({ type: "protoflow-canvas-select-all", artboardId: ID }, "*"); } catch (err) {}
  }, true);
})();`;

// 【只为兼容老画板】画板只做界面原型，新的图用专门的画图工具画，指南里不再介绍在画板里画 Mermaid；
// 画布健康检查对仍在用的画板给一条 advice（canvasProduct.js 的 artboard_diagram）。删除条件：这条
// advice 在已知项目里连续一个发布版本都没出现过，就删掉这段、exportCanvasHtml.js 的 needsMermaid、
// libs.js 里的 mermaid.min.js 和对应测试（preview.test.js、exportCanvas*.test.js、canvasMermaid.test.js）。
//
// 只在画板源码真的用到 mermaid 时才生成引用这个库的 <script> 标签——见 libs.js 的 PREVIEW_LIB_FILES
// 注释，文件本身无条件拷进 lib/，但网络/解析这 3.5MB 的成本只应该由真用到的画板来付。检测
// 手法就是看源码文本里有没有出现"mermaid"这个词，不做更复杂的静态分析，够用。
// startOnLoad:false 是因为 mermaid 默认会在 DOMContentLoaded 时自动扫描页面找 .mermaid 元素
// 渲染——这个时机早于 React 把内容挂载到 #root，会扑空；改成画板自己的 JSX 在 useEffect 里
// 显式调用 mermaid.run()，等真正挂载完再渲染。
// theme/themeVariables 配的是 ProtoFlow 自己这套画布 UI 的黑白灰配色（节点浅灰底 + ink 文字、
// slate 结构线、PingFang SC 字体，跟取元素工具的合成面板同一套）——mermaid 自带的 default
const MERMAID_INIT = `(function(){
  if (!window.mermaid) return;
  window.mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: ${JSON.stringify(MERMAID_THEME_VARS)} });
})();`;

// canvasWidth：画板在画布里的像素宽度。写进 <meta name="protoflow-artboard">，是对外的约定——流程 skill 的
// 截图脚本按它设视口宽度，不去读画布的内部文件（docs/product-architecture.md §4.5）。
export function buildPreviewHtml({ artboardId, source, iconsSource = "", assetsMap = null, libRelPath = "lib", annotationsMd = "", canvasWidth = null, canvasHeight = null }) {
  const artboardMeta = JSON.stringify({ id: artboardId, canvasWidth: canvasWidth || 1440, canvasHeight: canvasHeight || null })
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const parts = [
    '<!DOCTYPE html>',
    `<html lang="zh-CN" data-artboard="${artboardId}"><head><meta charset="UTF-8"/>`,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>',
    `<meta name="protoflow-artboard" content="${artboardMeta}"/>`,
    FAVICON_LINK,
    `<style>${THEME_CSS}</style>`,
    `<script src="${libRelPath}/react.production.min.js"><\/script>`,
    `<script src="${libRelPath}/react-dom.production.min.js"><\/script>`,
    `<script src="${libRelPath}/babel.min.js"><\/script>`,
  ];
  if (assetsMap) {
    const assetsJson = JSON.stringify(assetsMap).replace(/</g, "\\u003c");
    parts.push(
      `<script>window.__ASSETS__ = ${assetsJson};<\/script>`,
      `<script>${ASSET_PATCHER}<\/script>`,
    );
  }
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
