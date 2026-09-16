// core/canvasPicker.js — 取元素工具：悬浮预览 + 点击插入引用胶囊，供本地 agent 复制粘贴给
// Cursor/Codex 之类工具定位代码用。从 core/canvas.js 的 buildScript() 里搬出来独立成文件——
// 这块本来就设计成"整段可删"的独立模块（不碰 uiState/scheduleSave/setupPage 这些核心画布状态），
// 拆文件只是让这个边界从注释变成真实的文件边界，删除这个功能只需要删这一个文件 + canvas.js 里
// 对应的一行 import/插值，不用在一份 900+ 行的大文件里找注释标记的起止范围。
//
// 导出的是一段函数声明的源码文本（`function setupElementPicker(){...}`），不是可调用的 JS
// 函数——它要拼进 core/canvas.js 的 buildScript() 生成的那个大 IIFE 字符串里，最终作为浏览器端
// 脚本运行，不是在 Node 这边执行。跟 core/preview.js 里 elementPickScript/ANNOTATION_OVERLAY
// 这些脚本片段是同一种模式：本文件不 import 任何东西，纯字符串常量。
//
// 依赖（在生成的最终脚本里由 canvas.js 的 buildScript() 提供，本文件内直接按名字用，不用传参）：
// - toScreenRect(iframeEl, localRect)：iframe 局部坐标转父文档屏幕坐标，悬浮描边框/定位高亮要用。
// - window.__pfCanvas：本文件里赋值 window.__pfCanvas.selections，供外部自动化工具读取。
// - .pf-mode-interact / .pf-mode-select：顶部工具栏两个模式按钮，由 canvas.js 生成的 HTML 提供。
// - .pf-frame[data-artboard]：画板容器，取 iframe/画板名要用。
// - pageEl.__pfPanToScreenRect：定位选中元素时把画布平移过去，由 canvas.js 的 setupPage() 暴露。
export const ELEMENT_PICKER_SCRIPT = `function setupElementPicker(){
    var active = false;
    // 跟工具栏"元素选择模式"按钮同一个图标（core/canvas.js 的 ICON_SELECT）——两处各自存一份
    // SVG 字符串，不是共享同一个变量，改一处记得同步改另一处，保持视觉一致。
    var ICON_SELECT_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444.99a1 1 0 0 0-.686.686l-.99 3.443a.5.5 0 0 1-.943.033z"/><path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h2"/><path d="M14 3h1"/><path d="M3 9v1"/><path d="M21 9v2"/><path d="M3 14v1"/></svg>';
    var selections = []; // { chipEl, iframeEl, el, tag, id, className, text, annotation, pageId, artboardId, artboardName }
    var lastHover = null; // 最近一次悬浮命中的东西，点击时就是"要插入的这一个"
    var interactBtns = document.querySelectorAll(".pf-mode-interact");
    var selectBtns = document.querySelectorAll(".pf-mode-select");
    // 工具栏两个按钮（各自代表一种模式，点哪个就切到哪个，不是同一个按钮来回切）、合成面板自己的
    // 关闭按钮、ESC 键都要能"退出取元素模式"，共用同一个函数，不要几处各写一遍开关逻辑。
    function setActive(next){
      active = next;
      interactBtns.forEach(function(b){ b.classList.toggle("pf-mode-active", !active); });
      selectBtns.forEach(function(b){ b.classList.toggle("pf-mode-active", active); });
      document.querySelectorAll(".pf-viewport").forEach(function(v){ v.style.cursor = active ? "crosshair" : ""; });
      // 面板的显隐跟着 active 走，在这一个函数里统一收口——不管是点交互按钮、点合成面板自己的
      // 关闭按钮、按 ESC 还是按快捷键 A 切回交互模式，都是调用这同一个函数，右下角的"元素引用"
      // 弹窗都应该跟着消失，不能只有点关闭按钮这一条路径会隐藏它、其它几条路径切完了弹窗还留着。
      if (active) { ensureComposePanel(); composePanel.style.display = "flex"; }
      else { lastHover = null; renderHover(null); if (composePanel) composePanel.style.display = "none"; }
      broadcastPickMode();
    }

    // 把当前模式广播给每块画板 iframe——选择模式下画板内的点按只用来选元素，不驱动画板自身逻辑
    // （拦截逻辑在 core/preview.js 的 elementPickScript）。canvas.html 和 preview.html 同源，
    // 直接 postMessage 到 contentWindow 即可；此刻还没加载完的懒加载 iframe 收不到没关系，它自己
    // 初始化时会发 protoflow-pick-mode-query 来问，下面的 message 监听器回它当前值。
    function broadcastPickMode(){
      document.querySelectorAll('.pf-frame[data-artboard] iframe').forEach(function(f){
        try { f.contentWindow.postMessage({ type: "protoflow-pick-mode", active: active }, "*"); }
        catch (e) {}
      });
    }

    // ---- hit-test：canvas.html 和每块画板的 preview.html 永远同源，直接同步读 iframe 自己的
    // document，不用跨 frame 消息问画板、等它答。annotationFor/describe 是通用的"给个元素，
    // 答它是什么"查询，不是只服务插入胶囊这一个调用点。这里返回的 rect 是选中那一刻在画板
    // 自己本地坐标系里的位置快照（不随画布缩放/平移变化，用来在复制文本里区分"看起来一样"的
    // 多个元素，比如同一个状态图标在列表不同行里各出现一次），跟悬浮/定位高亮用的屏幕坐标是
    // 两回事——那两处（renderHover/locateSelection）永远自己用 el.getBoundingClientRect() +
    // toScreenRect() 现算当前屏幕位置，不会读这里缓存的快照，缩放/平移了也不会跟着错位。
    // 标注是一篇 markdown（__ANNOTATION_MD__）。这里只答一句「这个元素（或它的某个祖先）有没有
    // 被标注 content 里的 [名](#el/元素id) 引用过」，不解析出是哪一条——够合成胶囊标个「已被标注」了。
    function annotationFor(idoc, el){
      var md = (idoc.defaultView && idoc.defaultView.__ANNOTATION_MD__) || "";
      if (!md) return null;
      var node = el;
      while (node && node.nodeType === 1) {
        if (node.id && md.indexOf("(#el/" + node.id + ")") >= 0) return { referenced: true };
        node = node.parentElement;
      }
      return null;
    }
    // elementFromPoint 给的是像素命中的最深那个元素——经常是个没有 id/class、文字只有一两个字
    // 的行内标签（比如 <em>AI</em> 是"薪灵AI"里被斜体的那两个字母），单看它自己近乎没有可识别
    // 信息，作为定位依据太弱。这里只在命中元素确实"什么身份都没有"（没 id、没 class、文字短于
    // 4 个字）时才往上找最近一个有 id/有 class/文字够长的祖先当作真正引用的对象——不是无条件
    // 都往上爬：只要命中元素自己就有 id/class/够长的文字，说明它本身就是有意义的引用目标，原样
    // 用它，不要在用户明明点中一个具体小元素时，偷偷换成一个更大的、他没点中的容器。
    function nearestIdentifiable(el){
      var cur = el, depth = 0;
      while (cur && depth < 4) {
        var hasId = !!cur.id;
        var hasClass = typeof cur.className === "string" && cur.className.trim().length > 0;
        var text = (cur.textContent || "").trim();
        if (hasId || hasClass || text.length >= 4) return cur;
        cur = cur.parentElement;
        depth++;
      }
      return el;
    }
    // 只收"跟浏览器通用默认值不一样"的计算样式——不是无脑把 getComputedStyle() 全倒出来。
    // 大多数元素这里会是空对象，不引入噪音；只有真被自定义过颜色/字重/圆角这些的元素才会
    // 体现出来，这才是它对区分"看起来一样的元素"有用的地方（比如同一个图标用颜色区分
    // 成功/失败态，标签/文本完全相同，只有 color 不一样）。默认值表跟属性列表一样是个粗略
    // 估计，不是每种标签精确的初始值——够用，不追求完全精确。
    var STYLE_PROPS = ["color", "background-color", "border-color", "border-radius", "box-shadow", "font-size", "font-weight", "opacity", "text-align"];
    var STYLE_DEFAULTS = {
      "color": "rgb(0, 0, 0)", "background-color": "rgba(0, 0, 0, 0)", "border-color": "rgb(0, 0, 0)",
      "border-radius": "0px", "box-shadow": "none", "font-size": "16px", "font-weight": "400",
      "opacity": "1", "text-align": "start",
    };
    function notableStyle(idoc, el){
      var view = idoc.defaultView;
      if (!view) return {};
      var cs = view.getComputedStyle(el);
      var out = {};
      STYLE_PROPS.forEach(function(p){
        var v = cs.getPropertyValue(p);
        if (v && v !== STYLE_DEFAULTS[p]) out[p] = v;
      });
      return out;
    }
    // selector 是给"定位不到时重置画板到初始态、重放交互路径后，重新找回这同一个元素"用的——
    // 重放完文档已经整个换了一份，旧的 el 引用指向的是已经不存在的旧文档，不能继续用。
    // 早期版本用"标签+全部 class"当选择器、另配一个"当时命中结果里排第几个"的 index 去消歧义，
    // 但这只在"命中列表的组成不会变"时才可靠——一旦页面存在会话/标签页切换这类会影响"当前一共
    // 命中几个同款元素"的应用状态，index 就可能在状态漂移后错误地对上另一个长得一样、实际是别处
    // 内容的元素，而且是安静地对错，不会失败、不会报错。真正通用的做法是像浏览器 DevTools 的
    // "复制选择器"一样，从这个元素一路往上，每一层如果有同标签兄弟节点就带上 nth-of-type，拼成
    // 一条结构路径——这条路径要么精确命中当初选中的那一个节点，要么（真的因为应用状态不同、
    // 树形结构变了）查不到，不存在"查到了但其实是别的东西"这种中间状态，天然不需要 index 消歧义。
    //
    // 路径起点优先选"最近一个带 id 的祖先"（el.closest("[id]")），不是无条件一路走到文档根：
    // 应用里稍微复杂点的界面通常会给"这一条消息""这一次工具调用"这类有语义的容器挂 id（对比过
    // Cursor 浏览器工具抓到的同一个元素，它的 dom_path 也是这个思路——能用 id 的地方就不用位置）。
    // 锚定在最近的 id 上，路径只需要覆盖从这个 id 到目标元素的这一小段，既短得多也更耐造——页面
    // 别的地方增删多少兄弟节点都不影响这条路径，不像从文档根开始的路径那样"随便一个远房节点变了
    // 兄弟数量，整条路径就断"。真的一路往上都没有任何祖先带 id 时，才退回到从文档根开始的完整
    // 路径，这时候的行为跟锚定失败前完全一样，不是两套逻辑。
    function stableSelector(el){
      if (el.id) return "#" + CSS.escape(el.id);
      var doc = el.ownerDocument;
      var anchor = el.parentElement && el.parentElement.closest("[id]");
      var root = anchor || doc.documentElement;
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
    function describe(idoc, el){
      if (!el) return null;
      el = nearestIdentifiable(el);
      var r = el.getBoundingClientRect();
      var selector = stableSelector(el);
      return {
        el: el,
        tag: el.tagName.toLowerCase(),
        id: el.id || "",
        className: typeof el.className === "string" ? el.className : "",
        selector: selector,
        text: (el.textContent || "").trim().slice(0, 120),
        annotation: annotationFor(idoc, el),
        rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        style: notableStyle(idoc, el),
      };
    }
    function hitTest(iframeEl, localX, localY){
      var idoc = iframeEl.contentDocument;
      return idoc ? describe(idoc, idoc.elementFromPoint(localX, localY)) : null;
    }

    // ---- 悬浮预览：一个临时描边框，跟着鼠标走，不进 compose 面板 ----
    var hoverOutline = document.createElement("div");
    hoverOutline.className = "pf-pick-outline";
    document.body.appendChild(hoverOutline);
    function positionOutline(rect){
      hoverOutline.style.display = "block";
      hoverOutline.style.left = rect.left + "px";
      hoverOutline.style.top = rect.top + "px";
      hoverOutline.style.width = rect.width + "px";
      hoverOutline.style.height = rect.height + "px";
    }
    function renderHover(h){
      if (!h) { hoverOutline.classList.remove("pf-pick-outline--picked"); hoverOutline.style.display = "none"; return; }
      positionOutline(toScreenRect(h.iframeEl, h.el.getBoundingClientRect()));
    }

    // 光标停在画板内容（iframe）上时，mousemove 天生到不了父文档（iframe 是独立浏览上下文，
    // 见 preview.js 的 elementPickScript 注释），得靠画板自己转发本地坐标过来
    // （protoflow-canvas-pointer）；父文档收到后直接 hitTest，不再是异步问答，因此也不需要
    // 旧版那套"防止旧回复覆盖新结果"的序号保护——同步调用没有乱序问题。
    window.addEventListener("message", function(e){
      var d = e.data;
      if (!d) return;
      if (d.type === "protoflow-pick-mode-query") {
        // 画板刚初始化（含懒加载 / 定位重放 reload 后），来问当前是不是选择模式——回它当前值，
        // 免得 setActive() 那次广播时它还没加载完、错过了。
        try { e.source.postMessage({ type: "protoflow-pick-mode", active: active }, "*"); } catch (err) {}
        return;
      }
      if (d.type === "protoflow-canvas-pointer-click") {
        // 画板转发过来这一刻的交互历史快照（不含这一下点击本身）——insertFromHover 存进胶囊，
        // 定位不到时用来重放。见 locateSelection。
        if (lastHover) lastHover.interactionPath = d.path || [];
        insertFromHover();
        return;
      }
      if (d.type !== "protoflow-canvas-pointer") return;
      if (!active) return;
      if (d.x === null) { lastHover = null; renderHover(null); return; }
      var frame = document.querySelector('.pf-frame[data-artboard="' + d.artboardId + '"]');
      var iframeEl = frame && frame.querySelector("iframe");
      if (!iframeEl) return;
      var result = hitTest(iframeEl, d.x, d.y);
      if (!result) { lastHover = null; renderHover(null); return; }
      var pageEl = frame.closest(".pf-page-canvas");
      var labelEl = frame.querySelector(".pf-frame__label b");
      lastHover = Object.assign({
        iframeEl: iframeEl,
        pageId: pageEl ? pageEl.getAttribute("data-page") : "",
        artboardId: d.artboardId,
        artboardName: labelEl ? labelEl.textContent : "",
      }, result);
      renderHover(lastHover);
    });

    // 父文档自己的 mousemove/click 只负责非画板区域（画板之间的空隙）——这部分区域没有 iframe
    // 挡着，父文档能正常收到这些事件；光标/点击落在画板内容上的情形，由上面
    // protoflow-canvas-pointer(-click) 消息驱动，不靠这两个监听器。
    //
    // click 这里特意加了 e.target.closest(".pf-viewport") 这道范围检查，不能只判断
    // active && lastHover 就动手——lastHover 只会在光标真的划过某块画板之后才非空，正常真实
    // 鼠标移动路径上，挪去点合成面板自己的"复制/清空"按钮之前 mousemove 会先把它清空，看起来
    // 没问题；但这只是"恰好蹭到了 mousemove 的边"，不是真正的边界控制——程序化触发的点击
    // （没有对应的 mousemove，实测就是这么复现的）、或者触控板/触屏“点按不划动”的输入方式，
    // 都可能在 lastHover 还没被清空时点到画布之外的地方，误把"复制"按钮的点击当成又选中了
    // 一次画板元素。加上这道范围检查后，只有点击真的落在 .pf-viewport（画布可见区域）里才会
    // 触发插入，点合成面板/工具栏/侧边栏自己的按钮永远不会被误判。
    document.addEventListener("mousemove", function(e){
      if (!active) return;
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el.tagName !== "IFRAME") { lastHover = null; renderHover(null); }
    });
    document.addEventListener("click", function(e){
      if (!active || !lastHover) return;
      if (!e.target.closest(".pf-viewport")) return;
      e.preventDefault();
      insertFromHover();
    }, true);

    // ---- 合成面板：contenteditable 富文本框，点选元素在光标位置插入一个内联胶囊，跟打字
    // 混排，DOM 顺序天然就是先后顺序，不用另外维护一份顺序表；多选也不用单独的模式，连续点
    // 几个元素、每次都插在当前光标处就是有序多选。惰性创建，内容跨"取元素模式开/关"持续存在，
    // 关掉模式只是不能再点选插入新胶囊。----
    var composePanel = null, composeBox = null, copyBtn = null, savedRange = null;

    function saveCursor(){
      var sel = window.getSelection();
      var inBox = sel.rangeCount && composeBox.contains(sel.anchorNode);
      if (inBox) savedRange = sel.getRangeAt(0).cloneRange();
      syncChipSelectionHighlight(inBox ? sel.getRangeAt(0) : null);
    }
    // 胶囊有 user-select:none（避免鼠标拖选把它拆成半个字符那种不合法状态），副作用是浏览器
    // 原生选区高亮（::selection）根本不会画在它身上——全选时看起来"只有文字被选中、胶囊像没选"。
    // 用 selectionchange 自己跟踪当前选区，手动给落在选区范围内的胶囊加一个高亮 class，视觉上
    // 补回原生选择态本该有的反馈，不依赖浏览器对这个不可编辑孤岛的选区渲染（它本来就不画）。
    function syncChipSelectionHighlight(range){
      var active = !!(range && !range.collapsed);
      composeBox.querySelectorAll(".pf-pick-chip").forEach(function(chip){
        chip.classList.toggle("pf-pick-chip--native-selected", active && range.intersectsNode(chip));
      });
    }

    function ensureComposePanel(){
      if (composePanel) return;
      composePanel = document.createElement("div");
      composePanel.className = "pf-pick-compose";

      var header = document.createElement("div");
      header.className = "pf-pick-compose__header";
      var dot = document.createElement("span");
      dot.className = "pf-pick-compose__dot";
      var title = document.createElement("span");
      title.className = "pf-pick-compose__title";
      title.textContent = "元素引用";
      var closeBtn = document.createElement("button");
      closeBtn.type = "button"; closeBtn.className = "pf-pick-compose__close"; closeBtn.textContent = "×";
      closeBtn.title = "关闭并退出取元素模式";
      closeBtn.addEventListener("click", function(){ setActive(false); });
      header.appendChild(dot); header.appendChild(title); header.appendChild(closeBtn);

      var hint = document.createElement("div");
      hint.className = "pf-pick-compose__hint";
      hint.textContent = "点选画板上的元素，或直接在下面打字——两者按先后顺序混排";

      composeBox = document.createElement("div");
      composeBox.className = "pf-pick-compose__box";
      composeBox.contentEditable = "true";
      composeBox.setAttribute("data-placeholder", "点选元素或输入文字…");

      var toolbar = document.createElement("div");
      toolbar.className = "pf-pick-compose__toolbar";
      var clearBtn = document.createElement("button");
      clearBtn.type = "button"; clearBtn.textContent = "清空";
      clearBtn.addEventListener("click", doClear);
      copyBtn = document.createElement("button");
      copyBtn.type = "button"; copyBtn.className = "pf-pick-compose__primary"; copyBtn.textContent = "复制";
      copyBtn.addEventListener("click", doCopy);
      toolbar.appendChild(clearBtn);
      toolbar.appendChild(copyBtn);

      composePanel.appendChild(header);
      composePanel.appendChild(hint);
      composePanel.appendChild(composeBox);
      composePanel.appendChild(toolbar);
      document.body.appendChild(composePanel);

      composeBox.addEventListener("keyup", saveCursor);
      composeBox.addEventListener("mouseup", saveCursor);
      document.addEventListener("selectionchange", saveCursor);

      // 手动全选(Cmd/Ctrl+A)+复制(Cmd/Ctrl+C)：浏览器原生复制在拼纯文本剪贴板内容时，会跳过
      // contenteditable="false" 的胶囊节点的文字（哪怕它显示正常、也能被选中），回填出来的文本
      // 会丢胶囊、甚至选区里只有胶囊时整段复制出来是空字符串——粘贴到别处等于什么都没粘贴上。
      // 拦截原生 copy 事件，改用跟"复制"按钮同一份权威序列化逻辑写入剪贴板，两条路径结果一致。
      composeBox.addEventListener("copy", function(e){
        var text = serializeNodes(describeComposeNodes(composeBox));
        if (!text) return;
        e.clipboardData.setData("text/plain", text);
        e.preventDefault();
      });

      // 胶囊被用户退格删掉：MutationObserver 观察子节点变化，跟对应的持久高亮框一起清理，
      // 比在 keydown 里猜退格语义更可靠。
      new MutationObserver(function(mutList){
        mutList.forEach(function(m){
          m.removedNodes.forEach(function(node){
            if (node.nodeType === 1 && node.classList && node.classList.contains("pf-pick-chip")) removeSelectionByChip(node);
          });
        });
      }).observe(composeBox, { childList: true });
    }

    function insertChipAtCursor(chipEl){
      ensureComposePanel();
      composeBox.focus();
      var range = (savedRange && composeBox.contains(savedRange.startContainer)) ? savedRange : null;
      if (!range) { range = document.createRange(); range.selectNodeContents(composeBox); range.collapse(false); }
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      range.deleteContents();
      range.insertNode(chipEl);
      var space = document.createTextNode(" ");
      chipEl.parentNode.insertBefore(space, chipEl.nextSibling);
      var after = document.createRange();
      after.setStartAfter(space);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      savedRange = after.cloneRange();
    }

    function renumberBadges(){
      selections.forEach(function(s, i){
        var cb = s.chipEl.querySelector(".pf-pick-chip__badge");
        if (cb) cb.textContent = String(i + 1);
      });
    }

    function syncPublicSelections(){
      window.__pfCanvas.selections = selections.map(function(s){
        return { tag: s.tag, id: s.id, className: s.className, text: s.text, annotation: s.annotation, rect: s.rect, style: s.style, pageId: s.pageId, artboardId: s.artboardId, artboardName: s.artboardName };
      });
    }

    // 点画布上不再常驻描边+编号——太重了，选多了满画布都是框。改成点合成面板里的胶囊才"定位"
    // 一下：需要的话先切到胶囊所属的页面，把画布平移到让这个元素居中，然后闪一下（复用悬浮
    // 描边框，跟 ANNOTATION_OVERLAY 的 flash() 是同一个"闪一下就消失"的思路，不用额外常驻的
    // DOM），1.6s 后自动消失。
    var locateTimer = null;
    // 切到胶囊所属的页面——必须在判断"现在能不能定位"之前做，不能等确定要 flash 了才切：
    // 没切换的页面上 .pf-page-canvas[hidden] 是 display:none，这条链路上任何元素的
    // getBoundingClientRect() 都会是 0（隐藏祖先直接把整个子树的布局折叠掉了），如果先判断
    // 再切页面，跨页面的胶囊会被误判成"当前不可见"，从而走进不必要的重置+重放流程——真实
    // 复现过：切到别的页面后点一个属于第一个页面的胶囊，画面上会先经历一次没必要的重置，
    // 期间画板短暂空白、之后位置也是错的。
    function switchToPageIfHidden(pageEl, pageId){
      if (pageEl && pageEl.hasAttribute("hidden")) {
        var pageBtn = document.querySelector('.pf-page-item[data-page="' + pageId + '"]');
        if (pageBtn) pageBtn.click();
      }
    }
    function flashEl(iframeEl, targetEl, pageId){
      var pageEl = iframeEl.closest(".pf-page-canvas");
      switchToPageIfHidden(pageEl, pageId);
      if (pageEl && pageEl.__pfPanToScreenRect) pageEl.__pfPanToScreenRect(toScreenRect(iframeEl, targetEl.getBoundingClientRect()));
      hoverOutline.classList.add("pf-pick-outline--picked");
      positionOutline(toScreenRect(iframeEl, targetEl.getBoundingClientRect()));
      clearTimeout(locateTimer);
      locateTimer = setTimeout(function(){ hoverOutline.classList.remove("pf-pick-outline--picked"); hoverOutline.style.display = "none"; }, 1600);
    }
    // "现在能不能定位"要同时满足：还在这个 iframe 自己的文档里（没被卸载——注意不是父文档的
    // document.contains，元素属于画板自己的文档树）、有真实渲染尺寸（没被 CSS 隐藏/折叠）。
    function locatable(iframeEl, el){
      if (!el || !iframeEl.contentDocument || !iframeEl.contentDocument.contains(el)) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function resolveStep(doc, step){
      return doc.querySelector(step.selector);
    }
    function replaySteps(doc, path, i, done){
      if (i >= path.length) { done(); return; }
      var el = resolveStep(doc, path[i]);
      if (el) el.dispatchEvent(new MouseEvent(path[i].type === "hover" ? "mouseover" : "click", { bubbles: true }));
      setTimeout(function(){ replaySteps(doc, path, i + 1, done); }, 150);
    }
    // 定位不到（元素当时是靠某个交互才出现的，交互早就收起了）时：把这块画板的 iframe 整个
    // 重新加载一次，逼里面的 React 从零重新挂载——这是唯一不需要画板自己配合、就能确定"回到了
    // 初始态"的通用手段。加载完成后按选中那一刻记录的交互路径依次重放，重放完再用 selector
    // 重新找回目标元素（这时候 s.el 指向的是已经被扔掉的旧文档，不能再用）。没记录过路径（比如
    // 元素本来就不需要任何交互，只是这次巧合定位不到）就只重置不重放，重置后再判断一次；如果
    // 还是找不到，安静地放弃，不弹提示、不做进一步尝试。
    function resetAndReplay(s){
      var iframeEl = s.iframeEl;
      iframeEl.addEventListener("load", function onLoad(){
        iframeEl.removeEventListener("load", onLoad);
        var tries = 0;
        (function waitReady(){
          var idoc = iframeEl.contentDocument;
          var root = idoc && idoc.getElementById("root");
          if (!((root && root.children.length) || tries++ > 50)) { setTimeout(waitReady, 100); return; }
          replaySteps(idoc, s.interactionPath || [], 0, function(){
            var target = s.selector ? resolveStep(idoc, { selector: s.selector }) : null;
            switchToPageIfHidden(iframeEl.closest(".pf-page-canvas"), s.pageId);
            if (!locatable(iframeEl, target)) return;
            // 重放后这个 iframe 的文档已经整个换了一份，s.el 如果还指向重放前那个旧文档的节点，
            // 就永远是"已卸载"状态——下次点这个胶囊会永远判定"定位不到"，每次都要重新走一遍
            // 重置+重放，即使这次重放完目标其实已经在画面上了。把新找到的这个节点写回 s.el，
            // 下次同一个 selections 条目再被点击时，最上面那道"能不能直接定位"的快速判断才会
            // 真的生效，不需要每次都重来一遍。
            s.el = target;
            flashEl(iframeEl, target, s.pageId);
          });
        })();
      });
      iframeEl.contentWindow.location.reload();
    }
    // 缓存的 s.el 只是个优化，不是可信来源：这块画板的 iframe 只要被任何一个胶囊触发过
    // resetAndReplay（哪怕是别的胶囊），整份文档都会被扔掉重建，同一个 iframe 下其它所有
    // 胶囊缓存的 s.el 会一起变成"已卸载"的野指针，却没人会替它们更新。真正稳定的做法是每次
    // 定位都不信缓存的节点，先按选中时记好的 selector 去当前这份文档里现查一次——查得到就
    // 直接用，天然不受"文档是不是被别的胶囊换过一轮"影响；只有连现查都查不到，才需要走
    // 重置+重放。因为 stableSelector 现在产出的是从根一路带 nth-of-type 下来的结构路径（唯一
    // 定位，不是"标签+class 猜第几个同款"），现查要么精确命中当初那一个节点，要么（真的因为
    // 应用状态不同、树形结构变了）查不到——不存在"查到了但其实是别的会话/标签页里长得一样的
    // 东西"这种静默定位错的中间状态，因此这里不需要再额外记"上一次是不是刚确认过""这个胶囊
    // 依不依赖某个状态"之类的特殊分支去补救，跟 resolveStep/resetAndReplay 是同一套逻辑。
    function resolveLive(s){
      var idoc = s.iframeEl.contentDocument;
      if (s.selector && idoc) {
        var el = resolveStep(idoc, { selector: s.selector });
        if (el) return el;
      }
      return s.el;
    }
    function locateSelection(s){
      switchToPageIfHidden(s.iframeEl.closest(".pf-page-canvas"), s.pageId);
      var live = resolveLive(s);
      if (locatable(s.iframeEl, live)) { s.el = live; flashEl(s.iframeEl, live, s.pageId); return; }
      resetAndReplay(s);
    }

    function insertFromHover(){
      if (!active || !lastHover) return;
      var h = lastHover;
      var idx = selections.length + 1;

      var chipEl = document.createElement("span");
      chipEl.className = "pf-pick-chip";
      chipEl.contentEditable = "false";
      chipEl.title = "点击定位到画布上的这个元素";
      chipEl.dataset.tag = h.tag;
      chipEl.dataset.id = h.id;
      chipEl.dataset.className = h.className;
      chipEl.dataset.text = h.text;
      chipEl.dataset.selector = h.selector;
      chipEl.dataset.annotated = h.annotation ? "1" : "";
      chipEl.dataset.rect = JSON.stringify(h.rect);
      chipEl.dataset.style = JSON.stringify(h.style);
      chipEl.dataset.pageId = h.pageId;
      chipEl.dataset.artboardId = h.artboardId;
      chipEl.dataset.artboardName = h.artboardName;
      var chipBadge = document.createElement("span");
      chipBadge.className = "pf-pick-chip__badge";
      chipBadge.textContent = String(idx);
      chipEl.appendChild(chipBadge);
      // 图标跟工具栏"元素选择模式"按钮用同一个 SVG（core/canvas.js 的 ICON_SELECT），两处各自
      // 存一份、改一个记得改另一个——这样一眼就能认出"这是取元素工具插的引用"，不用先读文字。
      var chipIcon = document.createElement("span");
      chipIcon.className = "pf-pick-chip__icon";
      chipIcon.innerHTML = ICON_SELECT_SVG;
      chipEl.appendChild(chipIcon);
      // 标签展示统一成"标签·"文本""这一种形式，文本最多 8 个字（超出截断加省略号）——
      // 用户明确要求这个格式，方便一眼看懂胶囊指的是页面上哪个元素，不用靠猜标签名对应什么。
      var shortText = h.text ? h.text.slice(0, 8) : "";
      var label = h.tag + (shortText ? "·\\"" + shortText + (h.text.length > 8 ? "…" : "") + "\\"" : "");
      chipEl.appendChild(document.createTextNode(label));

      insertChipAtCursor(chipEl);

      var entry = {
        chipEl: chipEl, iframeEl: h.iframeEl, el: h.el,
        tag: h.tag, id: h.id, className: h.className, text: h.text, annotation: h.annotation,
        rect: h.rect, style: h.style,
        pageId: h.pageId, artboardId: h.artboardId, artboardName: h.artboardName,
        selector: h.selector, interactionPath: h.interactionPath || [],
      };
      chipEl.addEventListener("click", function(){ locateSelection(entry); });
      selections.push(entry);
      syncPublicSelections();
    }

    function removeSelectionByChip(chipNode){
      var idx = -1;
      for (var i = 0; i < selections.length; i++) if (selections[i].chipEl === chipNode) { idx = i; break; }
      if (idx === -1) return;
      selections.splice(idx, 1);
      renumberBadges();
      syncPublicSelections();
    }

    // ---- 复制：拆成"读 DOM"（describeComposeNodes）和"纯格式化"（serializeNodes）两半——
    // 后者不碰 DOM，输入一份纯数据数组、输出最终文本，可以从生成的脚本里单独抠出来跑单测。----
    function describeComposeNodes(box){
      var out = [];
      box.childNodes.forEach(function(node){
        if (node.nodeType === 3) { out.push({ type: "text", value: node.textContent }); return; }
        if (node.nodeType === 1 && node.classList && node.classList.contains("pf-pick-chip")) {
          out.push({
            type: "chip", tag: node.dataset.tag, id: node.dataset.id, className: node.dataset.className, text: node.dataset.text,
            selector: node.dataset.selector,
            annotation: node.dataset.annotated ? { referenced: true } : null,
            rect: node.dataset.rect ? JSON.parse(node.dataset.rect) : null,
            style: node.dataset.style ? JSON.parse(node.dataset.style) : null,
            pageId: node.dataset.pageId, artboardId: node.dataset.artboardId, artboardName: node.dataset.artboardName,
          });
        }
      });
      return out;
    }

    // 每个元素引用是一块自包含的信息（跟 Cursor 浏览器工具抓元素的呈现方式对齐：tag/class/
    // 文本/位置/样式这些字段都属于同一个元素，就该待在一起，不能拆到两个地方——不是"标签留在
    // 正文里、位置样式挪到文末列表"那种footnote式拆法）。字段名统一用英文（tag/id/class/text/
    // position/style/annotation/path），跟 Cursor 自己的输出习惯一致，方便粘贴过去后被同一套
    // 阅读习惯识别。board/source 这两行只在"跟上一个元素不是同一块画板"时才出现——同一次 compose
    // 大概率引用的是同一块画板，每条都重复这两行没必要；一旦跳到别的画板，这两行会重新出现，
    // 不会有任何一条引用的来源是含糊的。annotation 只在这个元素本来就关联了 ProtoFlow 标注时才
    // 出现——这是我们比 Cursor/Claude 的同类工具都多出来的信息。path 只在元素自己没有 id 时才
    // 出现（有 id 的话 id 字段已经能唯一定位，再列一遍 path 是重复信息）。
    function serializeNodes(nodes){
      var body = "", lastSourceKey = null;
      nodes.forEach(function(n){
        if (n.type === "text") { body += n.value; return; }
        var lines = [];
        var sourceKey = n.pageId + "/" + n.artboardId;
        if (sourceKey !== lastSourceKey) {
          lines.push("board: " + n.artboardName);
          lines.push("source: pages/" + n.pageId + "/artboards/" + n.artboardId + "/source.jsx");
          lastSourceKey = sourceKey;
        }
        lines.push("tag: " + n.tag);
        if (n.id) lines.push("id: " + n.id);
        if (n.className) lines.push("class: " + n.className);
        var text = (n.text || "").replace(/\\s+/g, " ").trim();
        if (text) lines.push("text: " + text);
        if (n.rect) lines.push("position: x=" + n.rect.x + " y=" + n.rect.y + ", " + n.rect.width + "×" + n.rect.height);
        if (n.style) {
          var styleKeys = Object.keys(n.style);
          if (styleKeys.length) lines.push("style: " + styleKeys.map(function(k){ return k + ": " + n.style[k]; }).join("; "));
        }
        if (n.annotation) lines.push("（该元素已被标注引用）");
        if (!n.id && n.selector) lines.push("path: " + n.selector);
        // 每个元素块前面留一个空行跟前面的内容分开（block 之间的视觉分隔）；块结束只留一个
        // 换行，紧跟着的文字直接续在下一行，不额外空一行——空行只用来分隔"两个不同的元素引用"，
        // 不用来分隔"元素和它前后的说明文字"。连续点选多个元素时，插入胶囊之间自动补的那个空格
        // 只是方便继续打字用的占位符，不是真的有意义的文字——先把这种纯空白的结尾去掉，再统一
        // 补一个空行，不然会在两个元素块之间留下一行只有一个空格的怪行。
        body = body.replace(/\\s+$/, "");
        if (body) body += "\\n\\n";
        body += lines.join("\\n") + "\\n";
      });
      return body.replace(/\\n+$/, "");
    }

    function doCopy(){
      if (!composeBox) return;
      var text = serializeNodes(describeComposeNodes(composeBox));
      navigator.clipboard.writeText(text).then(function(){
        if (!copyBtn) return;
        var original = copyBtn.textContent;
        copyBtn.textContent = "已复制";
        setTimeout(function(){ copyBtn.textContent = original; }, 1200);
      }).catch(function(){});
    }
    function doClear(){
      if (!composeBox) return;
      composeBox.innerHTML = "";
      selections = [];
      savedRange = null;
      syncPublicSelections();
    }

    interactBtns.forEach(function(btn){
      btn.addEventListener("click", function(){ setActive(false); });
    });
    selectBtns.forEach(function(btn){
      btn.addEventListener("click", function(){ setActive(true); });
    });
    // ESC 退出元素选择模式回到交互模式——跟点交互按钮是同一件事，不额外判断合成面板里是否正在
    // 编辑文字（contenteditable 本身不吞 Escape，浏览器原生行为就是留给页面处理）。
    // 快捷键 A 在交互模式/选择模式之间快速切换——跟点两个工具栏按钮是同一件事，直接调
    // setActive(!active)。必须先排除正在往合成面板（contenteditable）或任何输入框里打字的
    // 情况：那种时候用户按下的 "a" 是想打这个字母，不是想切模式，不能拦截；ESC 不用这层判断
    // （合成面板本来就不吞 Escape，浏览器原生行为已经是交给页面处理，也没有"想打 Esc 这个字符"
    // 这种真实场景）。同时排除带修饰键的组合（Cmd/Ctrl+A 是原生全选，不能被这个快捷键吞掉）。
    document.addEventListener("keydown", function(e){
      if (e.key === "Escape" && active) { setActive(false); return; }
      if (e.key !== "a" && e.key !== "A") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var ae = document.activeElement;
      if (ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      setActive(!active);
    });

    window.__pfCanvas = { selections: [] };
  }`;
