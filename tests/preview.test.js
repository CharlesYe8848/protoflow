import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildPreviewHtml, copyPreviewLibs, PREVIEW_LIB_FILES } from "../core/preview.js";

test("buildPreviewHtml 输出无外部 http 引用，lib 用相对路径，源码与资产内联", () => {
  const html = buildPreviewHtml({
    artboardId: "ab_1",
    source: `function Component(){ return <div id="x">你好</div>; }`,
    iconsSource: "const I = {};",
    assetsMap: { "a.png": "data:image/png;base64,AAA" },
    libRelPath: "../snapshot/lib",
  });
  assert.ok(!/https?:\/\//.test(html), "不得包含外部 URL");
  assert.ok(html.includes('<link rel="icon" href="data:image/svg+xml,'), "标签页图标：内联 SVG data URI，不外链");
  assert.ok(html.includes('src="../snapshot/lib/react.production.min.js"'));
  assert.ok(html.includes("function Component()"));
  assert.ok(html.includes("data:image/png;base64,AAA"));
  assert.ok(html.includes("你好</div>"), "普通 JSX 闭合标签不得被转义破坏");
});

test("mermaid.min.js 按需加载——回归测试：3.5MB，比 react+react-dom+babel 加起来还重好几倍，没用到 mermaid 的画板不该多付这份网络/解析成本；源码里出现 “mermaid” 字样才生成引用它的 <script> 标签，还要在渲染前 startOnLoad:false（默认会在 DOMContentLoaded 时自动扫描渲染，早于 React 把内容挂到 #root，会扑空）", () => {
  const withMermaid = buildPreviewHtml({
    artboardId: "ab_1",
    source: `function Component(){ React.useEffect(() => { window.mermaid.run(); }, []); return <pre className="mermaid">graph TD</pre>; }`,
    libRelPath: "lib",
  });
  assert.ok(withMermaid.includes('src="lib/mermaid.min.js"'), "源码用到 mermaid 时应该引用这个库文件");
  assert.ok(withMermaid.includes("startOnLoad: false") || withMermaid.includes("startOnLoad:false"), "要关掉自动扫描渲染，等画板自己在 useEffect 里显式调用 mermaid.run()");

  const withoutMermaid = buildPreviewHtml({
    artboardId: "ab_2",
    source: `function Component(){ return <div>普通画板</div>; }`,
    libRelPath: "lib",
  });
  assert.ok(!withoutMermaid.includes("mermaid.min.js"), "没用到 mermaid 的画板不应该多出这个 3.5MB 的 <script> 标签");
});

test("buildPreviewHtml 转义源码中的 </script>，防止提前闭合标签", () => {
  const source = `function Component(){ return <div id="s">{"</script>"}</div>; }`;
  const html = buildPreviewHtml({ artboardId: "ab_1", source, iconsSource: "", assetsMap: {}, libRelPath: "lib" });
  assert.ok(!html.includes(`{"</script>"}`), "源码内的 </script> 必须被转义");
  assert.ok(html.includes(`{"<\\/script>"}`));
});

test("buildPreviewHtml 传 annotationsMd 时注入标注覆盖层，无标注时不注入", () => {
  const md = "## 说明\n\n内容里引用 [某元素](#el/x)";
  const base = { artboardId: "ab_1", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib" };
  // 断言用 "window.__ANNOTATION_MD__ = "（赋值/注入）而不是裸子串 "__ANNOTATION_MD__"——
  // 取元素工具（elementPickScript）也会读这个全局变量，那个读引用在任何情况下都存在。
  const injected = "window.__ANNOTATION_MD__ = ";
  const withAnn = buildPreviewHtml({ ...base, annotationsMd: md });
  assert.ok(withAnn.includes(injected));
  const empty = buildPreviewHtml({ ...base, annotationsMd: "   \n  " });
  assert.ok(!empty.includes(injected));
  const none = buildPreviewHtml(base);
  assert.ok(!none.includes(injected));
});

test("标注覆盖层 v2：画板 iframe 里只留 定位闪一下 + 批量淡描边 + 交互重放，没有编号气泡、没有说明面板、没有独立打开时的显隐按钮——说明列表整体在画布左侧侧边栏（core/canvas.js）。全程走 postMessage，不挂 window.__pfXxx 给父文档同源调用（导出后画板可能跨源，直接调用会被拦）", () => {
  const html = buildPreviewHtml({ artboardId: "ab_1", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib", annotationsMd: "内容 [某元素](#el/x)" });
  assert.ok(!/window\.__pfFlashElement\s*=|window\.__pfHighlightElements\s*=|window\.__pfClearHighlights\s*=/.test(html), "不再挂 window.__pfXxx 给父文档直接调用");
  assert.ok(html.includes('d.type === "protoflow-annotation-flash"') && html.includes("locate(d.elId, d.path)"), "定位+闪一下走 postMessage");
  assert.ok(html.includes('d.type === "protoflow-annotation-highlight"') && html.includes('d.type === "protoflow-annotation-clear"'), "批量淡描边/清除走 postMessage");
  assert.ok(html.includes('d.type === "protoflow-annotation-check-ids"') && html.includes("protoflow-annotation-check-ids-reply"), "断链检测：父文档问、子文档自己查完发回执，不是父文档同步读子文档 DOM");
  assert.ok(!/__pfToggleAnnotations|__pfSetAnnotations|__pfLocateAnnotation/.test(html), "旧的开关/按标注 id 定位的函数都去掉了");
  assert.ok(!/编号|width:20px;height:20px;border-radius:50%/.test(html), "不再画编号气泡");
  assert.ok(!html.includes(".pf-ann-btn") && !html.includes("标注说明"), "iframe 里没有独立打开按钮、没有右侧说明面板");
});

test("buildPreviewHtml 是纯函数：相同输入产生逐字节相同输出，不含任何轮询/计时器代码", () => {
  const args = { artboardId: "ab_1", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib" };
  const a = buildPreviewHtml(args);
  const b = buildPreviewHtml(args);
  assert.equal(a, b);
  assert.ok(!a.includes("location.reload"), "不应包含任何自动刷新/轮询逻辑");
  assert.ok(!a.includes("setInterval"), "无标注时不应有任何计时器代码");
});

test("buildPreviewHtml 始终注入高度上报脚本（postMessage 给父窗口，携带 artboardId），供画布做真实尺寸展示", () => {
  const html = buildPreviewHtml({ artboardId: "ab_42", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib" });
  assert.ok(html.includes("protoflow-preview-size"));
  assert.ok(html.includes('"ab_42"'));
  assert.ok(html.includes("parent.postMessage"));
  assert.ok(html.includes("ResizeObserver"));
});

test("高度上报脚本要能识别并打断“画板用 100vh 之类视口相对单位 + 画布自动撑高 iframe”这套正反馈循环——回归测试：实测复现过（薪招寻聘项目的流程图画板，根节点 minHeight:'100vh'，且带 mermaid 图表）iframe 高度几秒内从 3067px 涨到近 2 万 px 且没有停下来的迹象；第一版用 MutationObserver 区分“真实内容变化”失败——mermaid 的 SVG 在容器宽度变化时会反过来改写自己的属性，本身就是一次真实 mutation（实测 2 秒内 714 次），导致判定条件永远凑不齐；改成看 ResizeObserver 触发的频率——1 秒滚动窗口内超过阈值就判定是回环并冻结上报", () => {
  const html = buildPreviewHtml({ artboardId: "ab_42", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib" });
  assert.ok(html.includes("recentResizes"), "需要记录最近一段时间内 ResizeObserver 的触发时间戳");
  assert.ok(html.includes("frozen = true"), "识别出回环后要能停止继续上报，不能无限循环下去");
  assert.ok(html.includes("new ResizeObserver(onResize)"), "resize 触发的上报要经过频率检查（onResize），跟 load/click 直接调用 report 区分开");
});

test("buildPreviewHtml 注入画布手势转发脚本——回归测试：画板 iframe 是独立浏览上下文，wheel/手势事件不会冒泡到父文档（画布 canvas.html），必须由画板自己拦截并转发，否则光标停在画板内容上捏合缩放时会触发浏览器原生整页缩放（连父文档的侧边栏一起放大）", () => {
  const html = buildPreviewHtml({ artboardId: "ab_42", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib" });
  assert.ok(html.includes("protoflow-canvas-gesture"));
  assert.ok(html.includes("window.parent === window"), "独立打开 preview.html（未被画布嵌入）时应保留浏览器原生缩放，不接管");
  assert.ok(html.includes("gesturestart") && html.includes("gesturechange") && html.includes("gestureend"));
  assert.ok(html.includes('"ab_42"'), "转发的消息需携带 artboardId，供父文档定位是哪块画板");
});

test("buildPreviewHtml 不再注入取元素工具的 hit-test 响应端——回归测试：canvas.html 和每块画板的 preview.html 永远同源（都走 core/localServer.js 的 /p/<projectId>/...），父文档可以直接 iframeEl.contentDocument.elementFromPoint(...) 同步读，不需要问画板、等它答；这层 postMessage 请求/响应是不必要的复杂度，hit-test 逻辑已经整个搬到 core/canvas.js 的 hitTest()/describe()/annotationFor()，画板侧不应该再重复一份", () => {
  const html = buildPreviewHtml({ artboardId: "ab_42", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib", annotationsMd: "见 [x](#el/x)" });
  assert.ok(!html.includes("protoflow-canvas-rpc"), "画板侧不应该再有 hit-test 请求/响应逻辑");
  assert.ok(!html.includes("elementFromPoint"), "elementFromPoint 应该只在父文档（canvas.html）里调用，画板侧不需要");
});

test("buildPreviewHtml 注入取元素工具的指针转发端——回归测试：光标停在画板内容（iframe）上时 mousemove 天生到不了父文档（iframe 是独立浏览上下文，跟手势不冒泡是同一个道理），画板必须自己把本地坐标转发出去，父文档才有机会驱动悬浮高亮；只靠父文档自己 elementFromPoint 永远测不出这个问题，因为那只对画板之间的空隙有效", () => {
  const html = buildPreviewHtml({ artboardId: "ab_42", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib" });
  assert.ok(html.includes("protoflow-canvas-pointer"), "需要一个单向广播消息类型，把本地鼠标坐标转发给父文档");
  assert.ok(html.includes('addEventListener("mousemove"') && html.includes('addEventListener("mouseleave"'), "既要转发悬停位置，也要在光标离开画板时通知父文档清除高亮");
  assert.ok(html.includes('"ab_42"'), "转发的坐标需携带 artboardId，供父文档定位是哪块画板");
  assert.ok(html.includes("protoflow-canvas-pointer-click"), "回归测试：点击锁定选中态同理——画板内容上的点击也到不了父文档，必须转发通知，不能只靠父文档自己的 click 监听器（那样只对画板之间的空隙点击有效，取元素工具点画板内容永远锁不上选中态）");
  assert.ok(html.includes("path: __pfInteractionHistory.slice()"), "点击转发要带上这一刻的交互历史快照，供父文档存进胶囊、之后定位不到时重放用");
});

test("选择模式下画板内的点按不驱动画板自身逻辑——回归测试：取元素工具的转发脚本一度对点击不 preventDefault，导致选择模式下点一下也会切 tab / 展开面板 / 跳转；改成父文档 setActive() 广播 protoflow-pick-mode、画板在选择模式下对 click/mousedown/mouseup/dblclick/contextmenu 做 preventDefault + stopImmediatePropagation", () => {
  const html = buildPreviewHtml({ artboardId: "ab_9", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib" });
  assert.ok(html.includes("protoflow-pick-mode-query"), "画板初始化时要主动问一次当前模式（懒加载 / 定位重放 reload 后本脚本重新跑，父文档可能早已在选择模式）");
  assert.ok(html.includes('e.data.type === "protoflow-pick-mode"') && html.includes("window.__pfPickMode = !!e.data.active"), "父文档广播 protoflow-pick-mode，画板据此更新模式位");
  assert.ok(html.includes("stopImmediatePropagation"), "选择模式下要 stopImmediatePropagation 掐断，React 的 onClick 挂在 #root 上、晚于 document 的 capture 监听器，因此收不到");
  assert.ok(/pfPickMode\) \{ e\.preventDefault\(\); e\.stopImmediatePropagation\(\); \}/.test(html), "拦截只在选择模式下生效，交互模式下画板照常响应点击");
  // 点击转发在拦截之前——选择模式下也要能插入引用胶囊
  const clickIdx = html.indexOf('protoflow-canvas-pointer-click');
  const suppressIdx = html.indexOf('if (window.__pfPickMode) { e.preventDefault(); e.stopImmediatePropagation(); }', clickIdx);
  assert.ok(clickIdx > 0 && suppressIdx > clickIdx, "click 监听器里先转发 pointer-click，再按模式决定要不要掐断");
  // 拦的是"点按"一族，悬浮不拦（取元素工具要靠它看清元素，且远没点击那么容易触发破坏性变化）
  assert.ok(html.includes('["mousedown", "mouseup", "dblclick", "contextmenu"].forEach'), "拦截列表是点按一族，不含 mouseover/mousemove");
});

test("选择模式下的点击不进交互重放历史——record() 读 window.__pfPickMode 短路；独立打开时该全局为 undefined，不受影响", () => {
  const html = buildPreviewHtml({ artboardId: "ab_10", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib" });
  assert.ok(/function record\(type, el\)\{[\s\S]*?if \(window\.__pfPickMode\) return;/.test(html), "record() 开头就要按 __pfPickMode 短路");
});

test("交互历史采集脚本无条件注入一次，不因为有没有标注/是否被嵌入而重复——回归测试：取元素工具的转发脚本一度也内联了一份同样的采集逻辑，导致被嵌入时点击/悬浮监听器被挂两遍、每次交互记两条重复历史；改成只在 buildPreviewHtml 里统一注入一次，取元素转发脚本不再重复注入", () => {
  const html = buildPreviewHtml({ artboardId: "ab_1", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib", annotationsMd: "见 [x](#el/x)" });
  const clickListenerCount = (html.match(/addEventListener\("click", function\(e\)\{ record\("click"/g) || []).length;
  assert.equal(clickListenerCount, 1, "点击历史记录监听器只应该挂一次，不能因为同时有标注和取元素工具就重复注入");
  const noAnnHtml = buildPreviewHtml({ artboardId: "ab_2", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib" });
  assert.ok(noAnnHtml.includes("window.__pfInteractionHistory"), "没有标注时也要注入——独立打开时标注定位用得到，取元素工具嵌入时也用得到，不应该只在有标注时才存在");
});

test("标注定位：能直接定位就 scrollIntoView + 闪一下；定位不到但 refs 里给了 interactionPath 时，重置画板到初始态、按路径重放，再重新判断——回归测试：用户要求自动重现交互而非要求人写清楚怎么到达，且要从初始状态出发重放才稳定", () => {
  const html = buildPreviewHtml({ artboardId: "ab_1", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib", annotationsMd: "见 [x](#el/x)" });
  assert.ok(html.includes("function locate(elId, path)"), "统一的定位入口：按元素 id + 可选重放路径");
  assert.ok(html.includes("function locatable(t)"), "判断能不能定位要同时看还在不在 DOM 里、有没有真实渲染尺寸");
  assert.ok(html.includes("sessionStorage.setItem(SS_KEY") && html.includes("location.reload()"), "定位不到且有路径时，把待重放信息存进 sessionStorage 再 reload，逼 React 从零挂载——唯一不需要画板配合就能确定回到初始态的通用手段");
  assert.ok(html.includes("function resumePendingLocate()") && html.includes("__pfReplaySteps(document, pending.path") && html.includes("byId(pending.elId)"), "reload 后从 sessionStorage 读回待重放路径 + 目标元素 id，接着完成被打断的定位");
  assert.ok(html.includes("SS_KEY = \"__pfPendingLocate_\" + ID"), "sessionStorage key 按 artboardId 加命名空间，画布同时嵌入多块画板时它们共享同一份 sessionStorage");
});

test("标注定位高亮不直接给目标元素加 CSS outline——回归测试：实测复现过真实画板（目标元素紧贴着某个 overflow:hidden 祖先容器的边缘，比如面板内 flex:1 撑满剩余空间的转写区）时，outline 画在元素边框外侧会被祖先的 overflow:hidden 从三边裁掉，画面上只剩顶边一条线；改成跟编号气泡同一种做法——用 getBoundingClientRect() 算好矩形，画进那个挂在 document.body 上、不受画板内部任何祖先 overflow 影响的图层里", () => {
  const html = buildPreviewHtml({ artboardId: "ab_1", source: `function Component(){ return <div id="x"/>; }`, libRelPath: "lib", annotationsMd: "见 [x](#el/x)" });
  assert.ok(!html.includes("t.style.outline") && !html.includes(".outlineOffset"), "不应该再直接操作目标元素自己的 outline 样式");
  assert.ok(html.includes("var flashTarget") && html.includes("flashUntil"), "高亮状态要能在 paint() 的每 800ms 刷新周期里存活、按最新的 getBoundingClientRect() 重新定位");
  assert.ok(html.includes('border:2px solid #e11d48'), "高亮矩形用 border（画在图层自己的盒子里，不受目标祖先 overflow 影响），不是 outline");
});

test("copyPreviewLibs 拷贝 PREVIEW_LIB_FILES 里的每个 UMD 文件（react/react-dom/babel + mermaid）", () => {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "pf-lib-"));
  copyPreviewLibs(dst);
  for (const f of PREVIEW_LIB_FILES) assert.ok(fs.existsSync(path.join(dst, f)), f);
});
