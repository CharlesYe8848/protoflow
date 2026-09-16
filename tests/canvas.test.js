import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCanvasHtml } from "../core/canvas.js";

const twoPages = [
  { id: "pg_1", name: "登录流程", artboards: [{ id: "ab_1", name: "登录页", description: "d", hasSource: true, canvasWidth: 1440 }] },
  { id: "pg_2", name: "个人中心", artboards: [] },
];

test("buildCanvasHtml 是纯函数：相同输入产生逐字节相同输出，不含任何外部 URL", () => {
  const a = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  const b = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.equal(a, b);
  assert.ok(!/https?:\/\//.test(a), "不得包含外部 URL");
});

test("画板 iframe 不带 loading=\"lazy\"——回归测试：画布用 CSS transform:scale() 缩放/平移，浏览器判断懒加载看的是没缩放前的布局位置、不认 transform，画板一多会偶发「打开显示不全，刷新才正常」", () => {
  const html = buildCanvasHtml({ projectName: "P", pages: twoPages });
  assert.ok(html.includes('<iframe src="pages/pg_1/artboards/ab_1/preview.html"'));
  assert.ok(!/<iframe[^>]*loading=/.test(html), "画板 iframe 不应该带 loading 属性");
});

test("buildCanvasHtml exportBundle：画板还是 <iframe src=...>（不是 srcdoc）、砍掉取元素/模式工具栏/文档菜单/项目切换/分享按钮、取景内联、带 generator meta", () => {
  const html = buildCanvasHtml({
    projectName: "登录流程演示", pages: twoPages, docs: [],
    exportBundle: { canvasState: { activePage: "pg_1" } },
  });
  assert.ok(html.includes('<meta name="generator" content="protoflow-canvas-export"/>'));
  assert.ok(html.includes('<iframe src="pages/pg_1/artboards/ab_1/preview.html"'), "画板还是指向 preview.html 的 src iframe，不是 srcdoc");
  assert.ok(!/class="pf-frame__box"><iframe[^>]*\bsrcdoc=/.test(html), "画板 iframe 标签本身不带 srcdoc 属性（注释里提到这个词不算）");
  assert.ok(html.includes('<div class="pf-mode-toolbar">') && html.includes('class="pf-sidebar-toggle-btn"'), "顶部小工具栏还在，但只剩侧边栏收起/展开这一个按钮——导出包仍带 .pf-sidebar 页面列表，看的人也需要能收起它腾地方看画板，不是编辑态专属功能");
  assert.ok(!html.includes('class="pf-mode-interact') && !html.includes('class="pf-mode-select') && !html.includes('<div class="pf-doc-entry">'), "取元素模式切换/文档菜单仍然砍掉——那几个要活的预览服务撑腰，导出包里用不了（CSS 里的选择器仍在，元素不出）");
  assert.ok(!html.includes('class="pf-frame__open"'), "「新标签打开」没有目标，去掉（CSS 选择器仍在，元素不出）");
  assert.ok(html.includes(".pf-toolbar{"), "缩放工具栏的 CSS 仍在（保留缩放）");
  assert.ok(html.includes('<script src="lib/marked.min.js">'), "marked 还是引 lib/ 真实文件，不内联");
  assert.ok(html.includes('window.__PF_CANVAS_STATE__ = {"activePage":"pg_1"}'), "导出取景内联，不 fetch（导出目录没有 __protoflow_state 端点）");
  assert.ok(!html.includes('class="pf-canvas-export"'), "导出的 index.html 不渲染「导出」按钮");
  assert.ok(html.includes("var __PF_EXPORT__ = true;"));
});

test("buildCanvasHtml 非导出分支：右上角「导出」按钮点开菜单，两行（项目 HTML / 单页 HTML）各带 data-format，POST 到 __protoflow_export/canvas/<formatId>；没有 generator meta", () => {
  const html = buildCanvasHtml({ projectName: "P", pages: twoPages });
  assert.ok(html.includes('class="pf-canvas-export"') && html.includes("__protoflow_export/canvas/"));
  assert.ok(html.includes('class="pf-export-menu"'), "导出按钮旁边带菜单弹层");
  assert.ok(html.includes('data-format="zip"') && html.includes('data-format="html"'), "菜单两行分别对应 zip/html 两种格式");
  assert.ok(html.includes("项目 HTML") && html.includes("单页 HTML"), "菜单行标题");
  assert.ok(!html.includes("protoflow-canvas-export"));
  assert.ok(html.includes("var __PF_EXPORT__ = false;"));
});

test("buildCanvasHtml exportBundle.singleFile：画板 iframe 先留空（不静态拼 srcdoc），画板 HTML/压缩库各嵌一份 JSON，不引用 lib/ 真实文件、不内联任何库源码明文", () => {
  const artboardHtml = { ab_1: "<!DOCTYPE html><html><body>画板内容 & \"引号\"</body></html>" };
  const compressedLibs = { "marked.min.js": { format: "gzip", base64: "AAAA" }, "react.production.min.js": { format: "gzip", base64: "BBBB" } };
  const html = buildCanvasHtml({
    projectName: "登录流程演示", pages: twoPages, docs: [],
    exportBundle: { canvasState: { activePage: "pg_1" }, singleFile: true, artboardHtml, compressedLibs },
  });
  assert.ok(!html.includes('<iframe src="pages/'), "单 HTML 导出不再引用 pages/.../preview.html");
  assert.ok(!/class="pf-frame__box"><iframe[^>]*\bsrcdoc=/.test(html), "画板 iframe 标签本身不带 srcdoc 属性——运行时才由启动脚本填充");
  assert.match(html, /<div class="pf-frame__box"><iframe style="[^"]*"><\/iframe><\/div>/, "画板 iframe 先是空的");
  assert.ok(!html.includes('<script src="lib/marked.min.js">'), "单 HTML 导出不引用 lib/ 目录");
  assert.ok(html.includes('画板内容 & \\"引号\\"'), "画板 HTML 内容确实嵌进去了，走的是 JSON 转义（\\\" 反斜杠转义），不是旧版本那套手动 &quot;/&amp; 属性值转义");
  const artboardHtmlEl = html.match(/<script type="application\/json" id="pf-artboard-html">([\s\S]*?)<\/script>/);
  assert.ok(artboardHtmlEl, "画板 HTML 整体嵌成一份 JSON");
  assert.deepEqual(JSON.parse(artboardHtmlEl[1]), artboardHtml, "JSON 解出来的内容原样还原（JSON.stringify 自己处理转义，不用手动转义 & / 引号）");
  const libsEl = html.match(/<script type="application\/json" id="pf-compressed-libs">([\s\S]*?)<\/script>/);
  assert.ok(libsEl, "压缩库源码整体嵌成一份 JSON");
  assert.deepEqual(JSON.parse(libsEl[1]), compressedLibs);
  assert.ok(!html.includes("AAAA") || html.match(/AAAA/g).length === 1, "压缩后的库源码只出现一份（去重），不会跟着画板数量重复");
  assert.ok(html.includes("__pfDecompressLibs"), "启动脚本里带了解压函数");
  assert.ok(html.includes("__pfInjectArtboardLibs"), "启动脚本里带了把占位标签换成内联脚本的函数（不是建 Blob URL 共享——那条路径在托管平台的 CSP 下会被拦，见 core/libCodec.js 的注释）");
  assert.ok(!html.includes("blobUrls") && !html.includes('"text/javascript"'), "不再用 Blob URL 共享库源码这条路径（createObjectURL 本身在别处——导出按钮自己的下载逻辑——还有正常用途，不能拿它整体判定）");
  assert.ok(!html.includes('class="pf-canvas-export"'), "单 HTML 导出也不渲染「导出」按钮（跟 zip 导出一样）");
});

test("buildCanvasHtml exportBundle.singleFile：生成的每个 <script> 块本身都不含裸露的闭合脚本序列——回归测试：写在生成脚本模板里的中文注释字面提到过这几个字，会把外层 <script> 标签提前截断，画布启动脚本被切掉后半段，只在托管平台上表现为画板空白，本地测试很难注意到", () => {
  const html = buildCanvasHtml({
    projectName: "P", pages: twoPages, docs: [],
    exportBundle: { canvasState: {}, singleFile: true, artboardHtml: { ab_1: "<html></html>" }, compressedLibs: {} },
  });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0, "至少要有内联的 <script> 块可查");
  scripts.forEach((s, i) => {
    assert.equal(s.search(/<\/script/i), -1, `第 ${i} 个 <script> 块内容本身不该含裸露的 </script（哪怕是在注释里）`);
  });
});

test("浏览器标签页标题统一成「项目名 · protoflow 画布」", () => {
  const html = buildCanvasHtml({ projectName: "登录流程演示", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("<title>登录流程演示 · protoflow 画布</title>"));
  assert.ok(html.includes('<link rel="icon" href="data:image/svg+xml,'), "标签页图标：内联 SVG data URI");
});

test("品牌色（黑白灰）以 :root CSS 变量注入，画布内改用 var(--pf-brand)——一处定义、三张模板共用，改色不用满文件搜 hex", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes(":root{--pf-brand:#0f172a;"), "品牌变量声明要进 <style>");
  assert.ok(html.includes("background:var(--pf-brand);color:#fff}"), "取元素合成面板主按钮走变量");
  assert.ok(!/#0ea5a5|#14c4c4|#0ca3a3/i.test(html), "旧的青色主色不得再出现在画布 HTML 里");
});

test("侧边栏列出全部页面（只显示名称，不带画板数量）；第一个页面默认 active——回归测试：用户要求去掉页面列表项上的画板数量角标", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes('<button class="pf-page-item active" data-page="pg_1">登录流程</button>'));
  assert.ok(html.includes('<button class="pf-page-item" data-page="pg_2">个人中心</button>'));
  assert.ok(!html.includes("pf-page-item__count"), "不应该再有画板数量角标");
});

test("左上角项目切换器：brand 包在 .pf-proj 里、带一个 hidden 的 .pf-proj-menu；脚本 setupProjectSwitcher 拉 /__protoflow_projects，>1 个项目才启用，点行整页跳到那个项目的 canvas.html", () => {
  const html = buildCanvasHtml({ projectName: "结账流程", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes('<div class="pf-proj"><div class="pf-sidebar__brand"><span class="pf-sidebar__brand-text">结账流程</span></div><div class="pf-proj-menu" hidden></div></div>'), "brand 外面包 .pf-proj，里面多一个 hidden 的 popover 容器");
  assert.ok(html.includes("function setupProjectSwitcher()") && html.includes("setupProjectSwitcher();"), "脚本里有这个函数且被调用");
  assert.ok(html.includes('fetch("/__protoflow_projects")'), "数据来自本地服务的最近项目端点");
  assert.ok(html.includes('list.length > 1') && html.includes('brand.classList.add("pf-sidebar__brand--switch")'), "只有 >1 个项目才把 brand 变成切换器");
  assert.ok(html.includes('location.href = "/p/" + encodeURIComponent(p.id) + "/canvas.html"'), "点非当前行整页跳到那个项目的画布");
  assert.ok(html.includes(".pf-proj-menu[hidden]{display:none}"), "popover 用 [hidden] 开合，跟 .pf-doc-menu 一套");
});

test("没有任何文档时顶部工具栏的文档图标依然常驻显示，点开菜单显示默认态提示文案", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages, docs: [] });
  assert.ok(html.includes('<div class="pf-doc-entry">'), "图标本身应该始终渲染");
  assert.ok(html.includes('<div class="pf-doc-menu__empty">暂无文档</div>'));
  const htmlUndefined = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(htmlUndefined.includes('<div class="pf-doc-entry">'), "不传 docs 也不应该报错");
});

test("文档入口：每篇文档都列出来、按类型分组，组头是类型名，行 meta 只留版本+日期；渲染进每个页面的 .pf-mode-toolbar", () => {
  const html = buildCanvasHtml({
    projectName: "P", projectId: "proj_1", pages: twoPages,
    docs: [
      { id: "prd", kind: "prd", kindLabel: "PRD", title: "结账 PRD", head: 5, updatedAt: "2026-08-27T00:00:00.000Z" },
      { id: "release-note", kind: "release-note", kindLabel: "上线公告", title: "计费上线", head: 2, updatedAt: "2026-08-20T00:00:00.000Z" },
      { id: "release-note-q3", kind: "release-note", kindLabel: "上线公告", title: "灵听上线", head: 1, updatedAt: "2026-08-29T00:00:00.000Z" },
    ],
  });
  assert.equal((html.match(/<div class="pf-doc-entry">/g) || []).length, twoPages.length);
  const toolbarStart = html.indexOf('<div class="pf-mode-toolbar">');
  const toolbarEnd = html.indexOf("</div>", html.indexOf('<div class="pf-toolbar">'));
  assert.ok(html.slice(toolbarStart, toolbarEnd).includes('class="pf-doc-btn"'));
  // 每篇都有自己的入口（3 篇 → 3 个不同链接），不再是「每类型一行 + N 篇」
  const links = (html.match(/href="docs\/[^"]+\/preview\.html"/g) || []).filter((s, i, a) => a.indexOf(s) === i);
  assert.deepEqual(links.sort(), [
    'href="docs/prd/preview.html"', 'href="docs/release-note-q3/preview.html"', 'href="docs/release-note/preview.html"',
  ].sort());
  // 组头 = 类型显示名（两种类型 → 两个组头）
  assert.ok(html.includes('<div class="pf-doc-menu__hd">PRD</div>') && html.includes('<div class="pf-doc-menu__hd">上线公告</div>'));
  // 组间按「组内最新那篇」时间倒序：上线公告组(08-29) 整体在 PRD 组(08-27) 前
  assert.ok(html.indexOf('pf-doc-menu__hd">上线公告') < html.indexOf('pf-doc-menu__hd">PRD'));
  // 组内按更新时间倒序：release-note-q3(08-29) 在 release-note(08-20) 前
  assert.ok(html.indexOf("灵听上线") < html.indexOf("计费上线"));
  // 行首是文档名，meta 行只有 v + 日期，不带类型名、不带「N 篇」
  assert.ok(html.includes("<span>结账 PRD</span>"), "行首显示文档名");
  assert.ok(html.includes('class="pf-doc-menu__meta">v5 · 2026-08-27</span>'));
  assert.ok(!/\d+ 篇/.test(html), "不再有「· N 篇」折叠计数");
  assert.ok(!html.includes('pf-doc-menu__meta">PRD'), "类型名不再进 meta 行");
  assert.ok(!/https?:\/\//.test(html), "不得包含外部 URL");
});

test("文档入口：项目只有一种类型时不显示组头，就是一列文档，按更新时间倒序", () => {
  const html = buildCanvasHtml({
    projectName: "P", projectId: "proj_1", pages: twoPages,
    docs: [
      { id: "prd", kind: "prd", kindLabel: "PRD", title: "结账 PRD", head: 5, updatedAt: "2026-08-27T00:00:00.000Z" },
      { id: "prd-refund", kind: "prd", kindLabel: "PRD", title: "退款 PRD", head: 1, updatedAt: "2026-08-29T00:00:00.000Z" },
    ],
  });
  assert.ok(!html.includes('<div class="pf-doc-menu__hd">'), "单一类型不加组头");
  assert.ok(html.includes('href="docs/prd/preview.html"') && html.includes('href="docs/prd-refund/preview.html"'), "两篇都直接列出");
  assert.ok(html.indexOf("退款 PRD") < html.indexOf("结账 PRD"), "按更新时间倒序");
});

test("只有第一个页面的画布不带 hidden 属性，其它页面初始隐藏（同文档内切换，不是分开的文件）", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes('<div class="pf-page-canvas pf-loading" data-page="pg_1">'));
  assert.ok(html.includes('<div class="pf-page-canvas pf-loading" data-page="pg_2" hidden>'));
  assert.ok(!/href="[^"]*canvas\.html"/.test(html), "页面切换不应是跳转到另一个 canvas.html 的链接");
});

test("有源码的画板渲染为真实像素宽度的 iframe（复用自身 preview.html）；无源码画板显示占位卡片", () => {
  const html = buildCanvasHtml({
    projectName: "P", projectId: "proj_1",
    pages: [{ id: "pg_1", name: "p", artboards: [
      { id: "ab_1", name: "列表页", description: "", hasSource: true, canvasWidth: 375 },
      { id: "ab_2", name: "详情页", description: "", hasSource: false, canvasWidth: 1440 },
    ] }],
  });
  assert.ok(html.includes('src="pages/pg_1/artboards/ab_1/preview.html"'));
  assert.ok(html.includes("width:375px"), "应使用声明的 canvasWidth 而非固定尺寸");
  assert.ok(html.includes("尚无内容"));
  assert.ok(!html.includes('src="pages/pg_1/artboards/ab_2/preview.html"'));
});

test("有源码的画板悬浮显示新标签页打开按钮（指向自己的 preview.html，target=_blank）；无源码画板没有这个按钮——回归测试：用户要求画板级操作，悬浮才露出，点了不该被当成点了画板本身（父级监听器可能拿这个点击去做别的事，比如取元素工具），必须 stopPropagation", () => {
  const html = buildCanvasHtml({
    projectName: "P", projectId: "proj_1",
    pages: [{ id: "pg_1", name: "p", artboards: [
      { id: "ab_1", name: "列表页", description: "", hasSource: true, canvasWidth: 375 },
      { id: "ab_2", name: "详情页", description: "", hasSource: false, canvasWidth: 1440 },
    ] }],
  });
  assert.ok(html.includes('<a class="pf-frame__open" href="pages/pg_1/artboards/ab_1/preview.html" target="_blank" rel="noopener"'), "有内容的画板要有新标签页打开链接，直接指向它自己已经生成好的 preview.html");
  assert.ok(html.includes('onclick="event.stopPropagation()"'), "点这个按钮不应该被当成点了画板本身");
  assert.ok(!html.includes('href="pages/pg_1/artboards/ab_2/preview.html"'), "没内容的画板不该有这个按钮——那个 preview.html 压根没生成过");
  assert.ok(html.includes(".pf-frame:hover .pf-frame__open"), "按钮默认隐藏，悬浮画板才露出来，不常驻占地方");
});

test("标注入口在画板上（新标签页图标旁）：仅有 annotations.md 的画板才有 .pf-frame__annotate 按钮，点它左侧侧边栏换成这块画板的标注（pf-ann-open）；工具栏不再有标注按钮；md 里的 [名](#el/id) 渲染成可点 chip，定位/高亮走 postMessage", () => {
  const html = buildCanvasHtml({
    projectName: "P", projectId: "proj_1",
    pages: [{ id: "pg_1", name: "p", artboards: [
      { id: "ab_1", name: "有标注", description: "", hasSource: true, canvasWidth: 375,
        annotationsMd: "## 主流程\n\n### 提交\n\n点 [提交按钮](#el/btn) 会提交\n\n### 校验\n\n校验 [金额](#el/amt)",
        annotationRefs: { btn: { interactionPath: [{ type: "click", selector: "#btn" }] } } },
      { id: "ab_2", name: "没标注", description: "", hasSource: true, canvasWidth: 375, annotationsMd: "", annotationRefs: {} },
      { id: "ab_3", name: "没内容", description: "", hasSource: false, canvasWidth: 375, annotationsMd: "有字但没源码", annotationRefs: {} },
    ] }],
  });
  assert.ok(!html.includes('class="pf-mode-annotate"'), "工具栏不再有标注按钮");
  assert.ok(!/__pfToggleAnnotations|__pfSetAnnotations|__pfLocateAnnotation/.test(html), "旧的每画板开关 / 按标注 id 定位的函数都不用了");
  // 画板级入口：只有 ab_1（有 annotations.md）出现，ab_2 空、ab_3 无源码都不出
  const annBtns = html.match(/<button class="pf-frame__annotate" data-tip="标注" onclick="event\.stopPropagation\(\)">/g) || [];
  assert.equal(annBtns.length, 1, "只有有 annotations.md 的画板才有画板级标注按钮");
  const btnIdx = html.indexOf('<button class="pf-frame__annotate"');
  assert.ok(html.indexOf('data-artboard="ab_1"') < btnIdx && btnIdx < html.indexOf('data-artboard="ab_2"'), "标注按钮落在 ab_1 这块画板的 label 里");
  assert.ok(html.includes("function setupAnnotations()") && html.includes('classList.toggle("pf-ann-open"'), "点画板标注按钮切换左侧侧边栏的页面列表↔该画板标注");
  assert.ok(html.includes('<script src="lib/marked.min.js">'), "标注用 marked 渲染完整 markdown");
  assert.ok(html.includes("marked.parse(src)") && html.includes('a[href^="#el/"]') && html.includes("pf-ann-chip"), "annotations.md 用 marked 渲染，[名](#el/id) 换成可点 chip");
  assert.ok(html.includes("pf-anns__head") && html.includes("pf-anns__close"), "侧栏顶部有画板名 + 关闭按钮");
  assert.ok(!html.includes("pf-ann-item"), "不再一条一张卡片");
  assert.ok(html.includes(".pf-ann-md h2") && html.includes(".pf-ann-md ul"), "侧栏是一篇文章：md 自带 h2/h3，列表等紧凑样式");
  assert.ok(html.includes('postMessage({ type: "protoflow-annotation-flash"') && html.includes('postMessage({ type: "protoflow-annotation-highlight"') && html.includes('postMessage({ type: "protoflow-annotation-clear"'), "定位 / 悬停批量高亮走 postMessage，不直接调画板 iframe 的函数");
  assert.ok(!html.includes("function idoc("), "不再有同步读画板 contentDocument 的 idoc() 辅助函数（断链检测改成问画板自己）——取元素工具自己那份 contentDocument 读取跟标注无关，不受这次改动影响");
  assert.ok(html.includes('"protoflow-annotation-check-ids-reply"') && html.includes("pendingBrokenCheck"), "断链检测：postMessage 问画板、回执里按 elId 给对应 chip 补 --broken");
  const data = JSON.parse(html.match(/<script type="application\/json" id="pf-ann-data">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, "<"));
  assert.deepEqual(Object.keys(data), ["pg_1"]);
  assert.equal(data.pg_1.length, 1, "只有 ab_1 有标注（ab_2 空、ab_3 无源码）");
  assert.equal(data.pg_1[0].artboardId, "ab_1");
  assert.equal(data.pg_1[0].artboardName, "有标注");
  assert.match(data.pg_1[0].md, /点 \[提交按钮\]\(#el\/btn\) 会提交/);
  assert.deepEqual(data.pg_1[0].refs, { btn: { interactionPath: [{ type: "click", selector: "#btn" }] } });
});

test("未声明 canvasWidth 时默认 1440px", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: [{ id: "pg_1", name: "p", artboards: [{ id: "ab_1", name: "a", description: "", hasSource: true }] }] });
  assert.ok(html.includes("width:1440px"));
});

test("空项目 / 空页面显示占位提示，不留空白", () => {
  const emptyProject = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: [] });
  assert.ok(emptyProject.includes("这个项目还没有页面"));
  const emptyPage = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: [{ id: "pg_1", name: "p", artboards: [] }] });
  assert.ok(emptyPage.includes("这个页面还没有画板"));
});

test("画板名称做 HTML 转义，防止注入", () => {
  const html = buildCanvasHtml({
    projectName: "P", projectId: "proj_1",
    pages: [{ id: "pg_1", name: "p", artboards: [{ id: "ab_1", name: `<script>x</script>`, description: "a&b", hasSource: true }] }],
  });
  assert.ok(!html.includes("<script>x</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("画布只显示画板名称，不显示 description——回归测试：用户反馈画布上的描述文字太占地方，画板信息应该在标注/upsert_artboard 里维护，不用在画布标签上重复展示", () => {
  const html = buildCanvasHtml({
    projectName: "P", projectId: "proj_1",
    pages: [{ id: "pg_1", name: "p", artboards: [{ id: "ab_1", name: "登录页", description: "这是一段很长的描述文字", hasSource: true }] }],
  });
  assert.ok(html.includes("登录页"), "画板名称仍要显示");
  assert.ok(!html.includes("这是一段很长的描述文字"), "描述不应再渲染进画布标签");
});

test("包含缩放/平移与 postMessage 高度上报监听所需的标记，且消息类型与 preview.js 的上报类型一致", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("protoflow-preview-size"), "画布应监听画板上报的同一消息类型");
  assert.ok(html.includes("pf-zoom-in") && html.includes("pf-zoom-out") && html.includes("pf-zoom-fit"));
  assert.ok(html.includes("addEventListener(\"wheel\""));
});

test("父文档给 iframe 设置高度时有一个兜底上限——回归测试：打断回环主要靠 preview.js 自己识别（见 core/preview.js 的 sizeReportScript），这里只是最后一道保险，万一将来冒出这套识别覆盖不到的别的回环模式，也不至于把 iframe 撑到几万像素高拖垮标签页", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(/Math\.min\(d\.height,\s*20000\)/.test(html), "设置 iframe 高度时应该有一个合理的上限");
});

test("接管 Safari 触控板捏合手势（gesturestart/change/end）并全局兜底拦截浏览器原生整页缩放——回归测试：防止侧边栏跟着画布一起被放大", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("gesturestart") && html.includes("gesturechange") && html.includes("gestureend"), "必须接管 Safari 私有手势事件，否则触控板捏合会触发浏览器原生整页缩放");
  assert.ok(html.includes("isGesturing"), "wheel 处理需在手势进行中让位，避免和 gesturechange 重复缩放");
  assert.ok(/document\.addEventListener\(type/.test(html), "需要 document 级无条件兜底监听，覆盖光标停在侧边栏/工具栏（与画布是兄弟节点，事件不会冒泡经过画布）时的手势");
});

test("接收内嵌画板 iframe 转发来的手势（protoflow-canvas-gesture）并换算成父文档坐标——回归测试：光标停在画板内容（iframe）上时缩放/平移的驱动路径，Playwright 真实鼠标命中测试验证过（见诊断记录：cursor=arrow 落在 iframe 上，Ctrl+滚轮后画布 scale 从 0.157 变到 0.704，侧边栏矩形逐字节不变）", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("protoflow-canvas-gesture"), "需要监听画板转发的手势消息类型，与 preview.js 的转发脚本一致");
  assert.ok(html.includes("handleGestureMessage"));
  assert.ok(html.includes("__pfGesture"), "每个页面需要暴露手势处理接口供跨 iframe 消息调用，不能只依赖 DOM 事件冒泡（iframe 是独立浏览上下文，事件不会冒泡到父文档）");
  assert.ok(html.includes("getBoundingClientRect"), "需要把 iframe 内部坐标换算成父文档屏幕坐标，缩放锚点才准确");
});

test("缩放工具栏只常驻显示百分比，点击展开菜单（放大/缩小/100%/自适应）——回归测试：原来 -/100%/+/适应 四个控件挤一排容易换行溢出，改成常驻只显示百分比，点开才展开成菜单，菜单项是不限宽的整行文字按钮，不会有窄按钮换行的问题", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes('<button class="pf-zoom-label">100%</button>'), "工具栏常驻按钮只显示百分比");
  assert.ok(html.includes('<div class="pf-zoom-menu" hidden>'), "菜单默认收起");
  assert.ok(html.includes('<button class="pf-zoom-in">放大</button>') && html.includes('<button class="pf-zoom-out">缩小</button>') && html.includes('<button class="pf-zoom-reset">缩放至 100%</button>') && html.includes('<button class="pf-zoom-fit">自适应窗口</button>'), "菜单里要有完整四个操作");
  assert.ok(html.includes(".pf-zoom-menu{position:absolute") && html.includes("min-width:168px"), "菜单项不限宽（min-width 只是给菜单容器一个合理最小宽度），长文案不会挤到换行");
  assert.ok(html.includes("zoomMenu.hidden = !zoomMenu.hidden"), "点百分比应该是开关菜单，不是只能打开");
  assert.ok(html.includes("!zoomMenu.hidden && !zoomMenu.contains(e.target)"), "点菜单外面应该收起菜单");
  assert.ok(/if \(e\.key === "Escape" && !zoomMenu\.hidden\)/.test(html), "ESC 也应该能收起缩放菜单");
});

test("侧边栏收起/展开状态持久化到项目内 .protoflow/canvas.json（不是 localStorage），routeKey 从当前页面自己的 URL 反推而不是生成时写死 projectId", () => {
  const html = buildCanvasHtml({ projectName: "P", pages: twoPages });
  assert.ok(!html.includes("localStorage.getItem") && !html.includes("localStorage.setItem"), "不应该再用 localStorage 存这类状态——按浏览器 origin 隔离，换设备/换浏览器/file:// 与 http:// 之间都跟不过去，不是真正的项目自包含");
  assert.ok(html.includes(".protoflow/canvas.json"), "读取初始状态应该 fetch 项目内的 .protoflow/canvas.json");
  assert.ok(html.includes("__protoflow_state/canvas"), "保存状态应该 POST 到通用的按 key 存取路由（core/localServer.js 的 __protoflow_state），key 是 canvas");
  assert.ok(html.includes("location.pathname"), "routeKey 应该从当前页面自己的 URL 反推——生成时不知道最终会不会因为撞同名项目被服务器加 -2 后缀，写死不准");
  assert.ok(html.includes('class="pf-sidebar-toggle-btn"'), "需要一个可点击的收起/展开按钮——回归测试：这个按钮从侧边栏头部搬进了顶部小工具栏（.pf-mode-toolbar），跟切换取元素模式的按钮放一起");
});

test("标注打开时收起侧边栏、刷新后仍保持收起——回归测试：恢复上次打开的标注不能触发「侧栏收着就替用户展开」那条逻辑，否则把用户特意保存的收起状态冲掉", () => {
  const html = buildCanvasHtml({ projectName: "P", pages: twoPages });
  // setOpen 带一个「是否恢复态」参数；只有用户主动点标注按钮（restoring 假）才替他展开收起的侧栏
  assert.ok(html.includes("function setOpen(abId, restoring)"), "setOpen 要能区分「用户点击」和「刷新后恢复」");
  assert.ok(html.includes('if (!restoring && document.documentElement.classList.contains("pf-sb-c"))'), "恢复态不得强行展开侧栏、不得改 uiState.sidebarCollapsed");
  // 恢复上次打开的标注时传 restoring=true
  assert.ok(/setOpen\(want, true\)/.test(html), "boot 里恢复上次标注要走恢复态分支");
});

test("当前选中的页面也要持久化到 .protoflow/canvas.json，刷新页面后应该停留在之前切到的那个页面——回归测试：用户反馈明明切到了第二个页面，刷新后又弹回第一个页面，因为 uiState 之前只存了 sidebarCollapsed 和各页视角，漏了 activePage 这一项", () => {
  const html = buildCanvasHtml({ projectName: "P", pages: twoPages });
  assert.ok(html.includes("activePage"), "uiState 需要一个字段记录当前选中的页面 id");
  assert.ok(html.includes("uiState.activePage = id") && html.includes("scheduleSave()"), "点击切页面时应该把选中的页面 id 存进 uiState 并触发保存，不能只切 UI 不存状态");
  assert.ok(/if \(uiState\.activePage && document\.querySelector\(/.test(html), "boot() 里应该用读到的 uiState.activePage 恢复选中态，而不是永远停在生成时写死的第一个页面");
});

test("侧边栏收起时完全归零宽度，不留图标条——回归测试：用户参考截图收起状态下工具栏紧贴左边缘，不是旧版留一条 44px 宽的图标带；收起按钮搬进顶部小工具栏后侧边栏自己不再需要在收起态下放任何东西", () => {
  const html = buildCanvasHtml({ projectName: "P", pages: twoPages });
  assert.ok(html.includes("html.pf-sb-c .pf-sidebar{width:0;flex:0 0 0"), "收起态应归零宽度，不是旧版的 44px 图标带");
  assert.ok(!html.includes("pf-sidebar__toggle"), "旧的侧边栏内嵌收起按钮 class 不应再出现，已整体搬进顶部小工具栏");
});

test("顶部小工具栏（.pf-mode-toolbar）：侧边栏收起图标 + 分隔线 + 取元素模式图标，位置在视口左上角；每个页面各有一份但状态全局同步——回归测试：用户提供参考截图要求把侧边栏收起图标和交互/元素选择模式切换放进同一个简洁图标工具栏，位置贴视口左上角（跟画布随侧边栏宽度自然联动，不用额外 JS 算偏移）", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes(".pf-mode-toolbar{position:absolute;left:16px;top:16px"), "应定位在视口左上角，跟随 .pf-viewport 的实际左边界（侧边栏宽度变化时天然跟着变，不用 JS 算）");
  assert.ok(html.includes('<div class="pf-mode-toolbar">'), "每个页面自己的画布容器里都要有一份（跟 .pf-toolbar 一样按页面复制，同一时刻只有一份可见）");
  assert.ok(html.includes("querySelectorAll(\".pf-sidebar-toggle-btn\")"), "侧边栏状态是全局的，多份按钮要一起同步标题/状态，不能只挂当前可见那份");
});

test("交互模式、元素选择模式各自一个图标按钮，点击后各自进入选中态——回归测试：改成两个独立按钮而不是一个来回切换图标的按钮，点哪个就切到哪个模式，各自用 pf-mode-active 表达当前选中态", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes('<button class="pf-mode-interact pf-mode-active" data-tip="交互模式">'), "默认（交互模式）应该已经是选中态");
  assert.ok(html.includes('<button class="pf-mode-select" data-tip="选择模式">'), "选择模式按钮默认不带选中态");
  assert.ok(html.includes(".pf-mode-toolbar button.pf-mode-active{background:var(--pf-brand-tint);color:var(--pf-brand)}"), "选中态样式选择器要跟 .pf-mode-toolbar button 同等或更高特异性——回归测试：写成裸的 .pf-mode-active{...} 特异性只有 1 个 class，会被更具体的 .pf-mode-toolbar button{color:...background:...} 覆盖掉，选中态样式实际从未生效过（用户反馈默认看不出来当前处于什么模式），必须带上 .pf-mode-toolbar button 前缀才赢得过");
  assert.ok(html.includes('querySelectorAll(".pf-mode-interact")') && html.includes('querySelectorAll(".pf-mode-select")'), "两个按钮各自的点击目标应该是切到各自代表的模式，不是互相 toggle 同一个状态");
});

test("元素选择模式下按 ESC 退出回交互模式——回归测试：用户要求跟点交互按钮等价的快捷键退出方式", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(/addEventListener\("keydown",\s*function\(e\)\{\s*if \(e\.key === "Escape" && active\) \{ setActive\(false\); return; \}/.test(html), "应该监听 Escape 键，在取元素模式激活时调用同一个 setActive(false)");
});

test("快捷键 A 在交互模式/选择模式之间快速切换——用户明确要求；必须排除正在合成面板（contenteditable）或任何输入框里打字的情况（不能拦截用户想打字母 a），也要排除带修饰键的组合（Cmd/Ctrl+A 是原生全选，不能被吞掉）", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  const anchorIdx = html.indexOf('selectBtns.forEach(function(btn){');
  assert.ok(anchorIdx !== -1, "选择模式按钮的点击监听器应该存在");
  const kdIdx = html.indexOf('document.addEventListener("keydown", function(e){', anchorIdx);
  assert.ok(kdIdx !== -1, "应该有一个统一的 keydown 监听器（在选择模式按钮监听器之后，不是画布缩放菜单那个 Escape 监听器）");
  const kdBody = html.slice(kdIdx, kdIdx + 700);
  assert.ok(kdBody.includes('if (e.key !== "a" && e.key !== "A") return;'), "要同时接受大小写 a/A（用户可能开着大写锁定或按了 Shift）");
  assert.ok(kdBody.includes("if (e.metaKey || e.ctrlKey || e.altKey) return;"), "带修饰键时不应该触发——Cmd/Ctrl+A 是原生全选，不能被这个快捷键吞掉");
  assert.ok(kdBody.includes("ae.isContentEditable || ae.tagName === \"INPUT\" || ae.tagName === \"TEXTAREA\""), "正在合成面板或任意输入框里打字时，按 a 应该是在打字母，不应该触发模式切换");
  assert.ok(kdBody.includes("setActive(!active);"), "触发时应该在两个模式之间切换，不是只能单向进入某个模式");
});

test("切到交互模式时（不管是点交互按钮、点合成面板关闭按钮、按 ESC 还是按快捷键 A）右下角的元素引用弹窗都要跟着消失——回归测试：用户反馈切到交互模式后弹窗还留在右下角；根因是隐藏弹窗只写在关闭按钮自己的点击处理里，其它几条退出路径（点交互按钮、ESC）都只调了 setActive(false) 没有额外隐藏弹窗。收口到 setActive 这一个函数里统一处理，不管从哪条路径切到交互模式，弹窗都会隐藏", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  const fnStart = html.indexOf("function setActive(next){");
  const fnBody = html.slice(fnStart, fnStart + 750);
  assert.ok(fnBody.includes('if (composePanel) composePanel.style.display = "none";'), "setActive(false) 分支本身就应该隐藏合成面板，不能只指望关闭按钮自己的点击处理去做这件事");
  assert.ok(!html.includes('closeBtn.addEventListener("click", function(){ setActive(false); composePanel.style.display = "none"; });'), "关闭按钮不应该再重复写一遍隐藏面板的逻辑，跟切到交互模式的其它路径共用 setActive 这一份收口逻辑");
});

test("顶部小工具栏三个按钮用自定义 tooltip（data-tip + hover 事件委托），不用原生 title——回归测试：图标按钮没有文字标签，用户要求 hover 要有提示；原生 title 弹出延迟长、样式没法控，改成自己实现的悬浮提示，共享一个 tooltip 元素、事件委托到 document，不用每个按钮各挂一份监听器", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(!html.includes('title="收起侧边栏"') && !html.includes('title="展开侧边栏"'), "侧边栏按钮不应该再用原生 title，避免和自定义 tooltip 同时弹出两个提示");
  assert.ok(html.includes("pf-mode-tooltip") && html.includes('createElement("div")'), "需要一个共享的 tooltip 元素");
  assert.ok(html.includes('".pf-mode-toolbar button, .pf-frame__label a, .pf-frame__label button"') && html.includes('addEventListener("mouseover"') && html.includes('addEventListener("mouseout"'), "hover 提示委托到 document 一处监听（同一份 tooltip 逻辑也覆盖画板标签里的新标签页打开 + 标注按钮），不是给每个按钮各挂一份");
  assert.ok(html.includes(".pf-mode-tooltip:before{"), "回归测试：参考截图里 tooltip 带一个指向触发按钮的小箭头（尖角），不是光秃秃一个圆角矩形");
});

test("侧边栏收起/展开不带 CSS 过渡动画——回归测试：曾经给 .pf-sidebar 加过 width/flex-basis 的 transition，结果收起状态下刷新页面即使 class 在渲染前就已经应用好、且已经加了 transition:none 覆盖，用户实测仍然反馈会先展开一帧再收起（可能是过渡动画本身在 visibility:hidden 揭示的瞬间才追上目标值这类更细的时序问题，排查成本远高于价值）；改成宽度直接瞬间切换，从根上让这一类问题不可能发生", () => {
  const html = buildCanvasHtml({ projectName: "P", pages: twoPages });
  assert.ok(!/\.pf-sidebar\{[^}]*transition/.test(html), ".pf-sidebar 不应该再有任何 transition 声明");
});

test("<html> 默认带 pf-loading class（纯静态属性，零延迟）；侧边栏在这个 class 下 visibility:hidden，直到状态 fetch 回来才摘掉——避免先展开一帧、状态到了才发现该收起的闪烁", () => {
  const html = buildCanvasHtml({ projectName: "P", pages: twoPages });
  assert.ok(html.startsWith('<!DOCTYPE html><html lang="zh-CN" class="pf-loading">'), "html 标签默认带 pf-loading，是纯 HTML 属性不靠脚本，保证在任何 JS 跑之前就已经是隐藏状态");
  assert.ok(html.includes("html.pf-loading .pf-sidebar{visibility:hidden}"));
  assert.ok(html.includes('document.documentElement.classList.remove("pf-loading")'), "状态 fetch 回来、boot() 跑完之后要摘掉这个 class 才露出侧边栏");
});

test("首次露出前整个页面（视口+工具栏）带 pf-loading（visibility:hidden），fit() 由画板真实高度上报驱动而非猜时间——回归测试：修之前先按占位高度以 100% 画一帧（连工具栏的缩放百分比文字都先显示 100%）、几百毫秒后才跳到正确缩放，肉眼可见闪烁", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes('<div class="pf-page-canvas pf-loading" data-page="pg_1">'), "初始应该整页（含工具栏）都是 pf-loading，只隐藏画布本身盖不住工具栏上写死的初始 100% 文字");
  assert.ok(/\.pf-page-canvas\.pf-loading \.pf-viewport,\.pf-page-canvas\.pf-loading \.pf-toolbar,\.pf-page-canvas\.pf-loading \.pf-mode-toolbar\{visibility:hidden\}/.test(html), "视口、缩放工具栏、顶部小工具栏都要在 pf-loading 时隐藏");
  assert.ok(html.includes("pendingIds") && html.includes("__pfOnSize"), "fit()+露出应该等每块画板真实上报高度后触发，不是猜一个延时");
  assert.ok(!html.includes("__pfFitted"), "切页面不再需要单独猜时间补 fit，统一走 pf-loading/__pfOnSize 这一套");
  assert.ok(html.includes("setTimeout(revealOnce, 1000)"), "只应该有一处兜底延时（极端情况下画板没能上报，最多等 1s 也要露出来），不是靠猜时间驱动首次 fit()");
});

test("画板外面的空白画布区域默认是普通光标，不是常驻的抓手（grab）——回归测试：用户反馈交互模式下鼠标停在画板外面就变成拖动手型，看起来像已经进入拖动状态，实际根本没在拖；.pf-grab 曾经在 setupPage 里无条件常驻挂在 .pf-viewport 上，导致光标永远是 grab，只有真正按住拖动（mousedown+moved）时才应该出现抓手，改成只在拖动中挂 pf-grabbing，不再有 hover 就是抓手这个中间态", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(!html.includes("pf-viewport.pf-grab{cursor:grab}"), "不应该再有 hover 态的 grab 光标样式");
  assert.ok(!html.includes('classList.add("pf-grab")'), "不应该再无条件给 viewport 常驻挂 pf-grab class");
  assert.ok(html.includes(".pf-viewport.pf-grabbing{cursor:grabbing}") && html.includes('classList.add("pf-grabbing")'), "真正开始拖动（moved 为 true）才应该切成抓手光标");
});

test("画布容器使用 translate3d，视口关闭浏览器自身的触摸缩放/回弹手势", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("translate3d("));
  assert.ok(html.includes("touch-action:none"));
  assert.ok(html.includes("overscroll-behavior:none"));
});

test("will-change:transform 只在交互中动态挂，不是写死的静态样式——回归测试：永久挂着这个提示会让浏览器把画布内容（尤其画板还是 iframe）提升成一个 GPU 合成层，缩放时直接拉伸已经画好的贴图，停下来之后不会自愈，会一直模糊；改成每次 apply() 挂上 pf-interacting，闲置一段时间自动摘掉，逼浏览器空闲时按当前缩放比例重新画一遍", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(!/\.pf-canvas\{[^}]*will-change/.test(html), ".pf-canvas 本身不应该写死 will-change，那样就是永久生效，跟只在交互中生效矛盾");
  assert.ok(html.includes(".pf-canvas.pf-interacting{will-change:transform}"), "will-change 应该挂在一个交互态的 class 上，只在这个 class 存在时生效");
  assert.ok(html.includes('classList.add("pf-interacting")'), "apply() 应该在每次变换时先挂上这个 class");
  assert.ok(html.includes('classList.remove("pf-interacting")') && html.includes("setTimeout"), "闲置一段时间后要用 setTimeout 自动摘掉，不能一直挂着");
});

test("取元素工具：工具栏有选择按钮；hit-test 直接同源读 iframe.contentDocument，不再用 postMessage 问答——回归测试：canvas.html 和每块画板的 preview.html 永远同源，不需要跨 frame 请求/响应这层复杂度；坐标换算复用共享函数，不跟 handleGestureMessage 各写各的", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes('<button class="pf-mode-select" data-tip="选择模式"><svg'), "顶部小工具栏需要一个图标按钮切换到取元素模式——回归测试：改成简洁图标而不是文字按钮");
  assert.ok(!html.includes("protoflow-canvas-rpc"), "回归测试：hit-test 不应该再走 postMessage 请求/响应——同源可以直接 iframeEl.contentDocument.elementFromPoint(...) 同步读，问答一整层机制是不必要的复杂度，应该已经删掉");
  assert.ok(html.includes("function hitTest(") && html.includes(".contentDocument"), "hit-test 应该是父文档一个同步函数，直接读 iframe 的 contentDocument");
  assert.ok(html.includes("window.__pfCanvas"), "选中结果要暴露成顶层 window 变量，供不穿透 iframe 的自动化工具直接读取");
  assert.ok(html.includes("function toScreenRect") && html.includes("function toParentPoint"), "坐标换算应该是独立的共享函数，取元素工具和手势转发都调用它们，不各写各的");
  assert.ok(html.includes("toParentPoint(iframeEl"), "handleGestureMessage 应该改调共享换算函数，不再内联 sx/sy 公式");
  assert.ok(html.includes("protoflow-canvas-pointer"), "回归测试：光标停在画板内容（iframe）上时 mousemove 到不了父文档，必须由画板转发本地坐标——不能只靠父文档自己 elementFromPoint（那样只对画板之间的空隙有效，永远测不出悬停在画板内容上不亮的问题）");
});

test("取元素工具：切模式时把选择态广播给每块画板 iframe，并回应画板的 protoflow-pick-mode-query——选择模式下画板内点按只选元素、不驱动画板自身逻辑（拦截在 core/preview.js），父文档只负责把模式位递过去", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("function broadcastPickMode()") && html.includes("broadcastPickMode();"), "setActive() 里要广播当前模式给画板");
  assert.ok(html.includes('postMessage({ type: "protoflow-pick-mode", active: active }'), "广播消息带当前 active 值");
  assert.ok(html.includes('d.type === "protoflow-pick-mode-query"') && html.includes('e.source.postMessage({ type: "protoflow-pick-mode", active: active }'), "画板懒加载后来问当前模式，父文档要回它——否则错过 setActive() 那次广播");
  assert.ok(html.includes(".pf-frame[data-artboard] iframe"), "广播对象是每块画板的 iframe");
});

test("取元素工具：独立的 message 监听器 + 独立的 setupElementPicker 函数，不往 boot() 里现有的分发逻辑加分支——回归测试：保证以后要整个移除这个功能时，改动范围不涉及尺寸上报/手势转发这些核心逻辑", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("function setupElementPicker()"), "取元素工具应该是一个独立、可整体删除的函数");
  assert.ok(html.includes("setupElementPicker();"), "boot() 只应该多一行调用，不是把逻辑摊进 boot() 本体");
  const bootBody = html.slice(html.indexOf("function boot(loaded){"), html.indexOf("function setupElementPicker()"));
  assert.ok(!bootBody.includes("protoflow-canvas-pointer"), "boot() 里现有的 message 监听器不应该认识取元素工具的消息类型，取元素工具应该自己另开一个监听器");
});

test("取元素工具：点击插入内联引用胶囊到常驻合成面板，多选靠连续插入而不是单独的多选模式；胶囊被删（MutationObserver）要同步清掉 window.__pfCanvas.selections 里对应的一项", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes('class="pf-pick-compose"') || html.includes("pf-pick-compose"), "需要一个常驻的合成面板容器");
  assert.ok(html.includes('contentEditable = "true"'), "合成面板要用 contenteditable 承载文字+内联胶囊混排");
  assert.ok(html.includes("function insertFromHover") && html.includes("function insertChipAtCursor"), "点击应该插入胶囊到当前光标位置，不是锁定单个选中态");
  assert.ok(html.includes("pf-pick-chip"), "胶囊需要一个可识别的 CSS class（复制时也靠它识别节点类型）");
  assert.ok(html.includes('contentEditable = "false"'), "胶囊自身要是不可编辑的原子块，退格能整体删掉");
  assert.ok(html.includes("MutationObserver") && html.includes("removeSelectionByChip"), "胶囊被退格删掉要能检测到并联动清理");
  assert.ok(html.includes("window.__pfCanvas = { selections: [] }") || html.includes("__pfCanvas.selections"), "多选状态应该是数组（selections），不是单个 selection");
  assert.ok(!html.includes("outlineEl"), "回归测试：画布上不应该再有常驻的每选中一个就常驻一个描边框——太重了，选多了满画布都是框，已经改成点胶囊才临时定位一下");
});

test("取元素工具：胶囊展示统一成「图标 + 标签·“文本”」这一种格式，文本最多 8 个字——用户明确要求这个格式，方便一眼看懂胶囊指的是页面上哪个元素；图标要跟工具栏「元素选择模式」按钮同一个 SVG，一眼就能认出这是取元素工具插的引用，不用先读文字", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  const iconIdx = html.indexOf("var ICON_SELECT_SVG = '");
  assert.ok(iconIdx !== -1, "胶囊图标应该是一个独立的 SVG 字符串常量");
  const toolbarIconStart = html.indexOf("const ICON_SELECT = `");
  assert.ok(toolbarIconStart === -1, "canvas.js 打包进最终 HTML 后不会保留 const 声明本身，这里只是确认取元素工具用的是同一份路径数据");
  const pathSample = "M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444.99a1 1 0 0 0-.686.686l-.99 3.443a.5.5 0 0 1-.943.033z";
  assert.ok(html.includes(pathSample), "工具栏「元素选择模式」按钮应该用这个新图标（虚线框+鼠标指针，devtools/设计工具通用的取元素图标）");
  const chipIconIdx = html.indexOf(pathSample, iconIdx);
  assert.ok(chipIconIdx > iconIdx && chipIconIdx < iconIdx + 700, "胶囊图标（ICON_SELECT_SVG）应该内嵌同一条 path 数据，两处视觉保持一致，不是另画了一个新图标");

  assert.ok(html.includes('chipIcon.innerHTML = ICON_SELECT_SVG;'), "胶囊里应该真的把图标塞进一个 span，不是只声明了常量没用上");
  const labelIdx = html.indexOf('var shortText = h.text ? h.text.slice(0, 8) : "";');
  assert.ok(labelIdx !== -1, "文本部分应该截到最多 8 个字");
  const labelBody = html.slice(labelIdx, labelIdx + 300);
  assert.ok(labelBody.includes('h.tag + (shortText ? "·\\"" + shortText'), '标签展示格式应该是「标签·\\"文本\\"」，标签在前、文本用直引号包住');
  assert.ok(labelBody.includes('h.text.length > 8 ? "…"'), "文本被截断时应该带上省略号，提示这不是元素的完整文本");
});

test("取元素工具：合成面板要有标题栏（标题+关闭按钮）和提示语，不是只有一个光秃秃的输入框；关闭按钮要能退出取元素模式并隐藏面板，跟工具栏切换按钮共用同一个 setActive，不是两处各写一遍开关逻辑", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("pf-pick-compose__header") && html.includes("pf-pick-compose__title"), "需要一个标题栏");
  assert.ok(html.includes("pf-pick-compose__close"), "标题栏需要一个关闭按钮");
  assert.ok(html.includes("pf-pick-compose__hint"), "需要一行提示语说明怎么用，不能全靠输入框的 placeholder 撑");
  assert.ok(html.includes("pf-pick-compose__primary"), "复制是主操作，视觉上要跟清空区分开，不是两个按钮一个样式");
  assert.ok(html.includes("function setActive(") && html.includes("setActive(true)") && html.includes("setActive(false)"), "工具栏两个模式按钮和面板自己的关闭按钮都应该调用同一个 setActive，不是各写一遍开关状态的逻辑");
});

test("取元素工具：不常驻标高亮，改成点合成面板里的胶囊临时定位——需要时先切到胶囊所属的页面、把画布平移到让元素居中，再闪一下就消失；平移复用 setupPage() 对外暴露的 __pfPanToScreenRect 钩子（跟 __pfFit/__pfGesture/__pfOnSize 同一类型），不是直接伸手进 setupPage 内部改", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("function locateSelection"), "点击胶囊应该触发一个独立的定位函数");
  assert.ok(html.includes("pageEl.__pfPanToScreenRect"), "定位要靠平移视口把元素带入可视区域，不是只闪一下（元素本来就可能在当前视角之外）");
  assert.ok(html.includes("chipEl.addEventListener(\"click\""), "胶囊本身要能点击触发定位");
  assert.ok(html.includes("locateTimer") && html.includes("1600"), "闪一下应该是临时的（这里选了 1.6s，跟 ANNOTATION_OVERLAY 的 flash() 时长一致），不是永久常驻");
});

test("取元素工具：定位不到时不是直接放弃，而是重置画板到初始态、按选中时记录的交互路径自动重放——回归测试：用户明确要求自动重现交互（不是让人写清楚怎么到达），且要从初始状态出发才稳定；先试一次实时能不能定位（元素本来就常驻的情况最常见、最便宜），定位不到才重置+重放，不是每次点定位都无条件重置", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("function locatable(iframeEl, el)"), "要有一个统一的“现在能不能定位”判断，看还在不在这个 iframe 自己的文档里、有没有真实渲染尺寸");
  assert.ok(html.includes("if (locatable(s.iframeEl, live)) { s.el = live; flashEl(s.iframeEl, live, s.pageId); return; }"), "先试一次实时定位，能定位就直接闪一下，不需要每次都重置画板");
  assert.ok(html.includes("function resetAndReplay(s)") && html.includes("iframeEl.contentWindow.location.reload()"), "定位不到时应该重置这块画板的 iframe（reload），逼里面的 React 从零重新挂载");
  assert.ok(html.includes("function replaySteps(doc, path, i, done)"), "重放函数要能按顺序执行记录的交互步骤");
  assert.ok(html.includes("interactionPath: h.interactionPath || []"), "选中记录要带上画板转发过来的交互历史，用于之后的重放");
  // 回归测试：用户反馈重放定位成功一次之后，同一个胶囊再点一次还是会整个重置+重放一遍（画板
  // 空白一闪），即使目标这时候明明已经在画面上——根因是 s.el 重放后还指向重放前那个旧文档的
  // 节点（reload 换了一份全新文档，旧节点已卸载），下次快速判断 locatable(s.iframeEl, s.el)
  // 永远判定失败。重放成功后要把新找到的节点写回 s.el，下次才能走快速定位、不必每次都重置。
  assert.ok(html.includes("s.el = target;\n            flashEl(iframeEl, target, s.pageId);"), "重放成功后应该把新找到的元素写回 s.el，供下次快速定位判断使用，不能让它一直指向重放前的旧节点");
});

test("取元素工具：快速定位不能只信缓存的 s.el——回归测试：用户反馈依次点胶囊 A、点胶囊 B（B 需要重置画板）、再点回 A，A 明明就在画面上却还是会空白一闪重置一遍；根因是同一块画板的 iframe 只要被任何一个胶囊触发过 resetAndReplay，整份文档都会被换掉，其它胶囊缓存的 s.el 会一起变成已卸载的野指针却没人更新。修法是每次定位都先按 selector 去当前文档里现查一次，查得到就直接用，不依赖缓存节点是否还挂在文档里", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  const fnStart = html.indexOf("function resolveLive(s){");
  assert.ok(fnStart !== -1, "应该有一个独立函数负责'不信缓存、现查一次'这件事");
  const fnBody = html.slice(fnStart, fnStart + 300);
  assert.ok(fnBody.includes("resolveStep(idoc, { selector: s.selector })"), "现查要用记录下来的 selector，跟重放后重新找回目标用的是同一套逻辑，不能另起一套");
  const locateSelectionStart = html.indexOf("function locateSelection(s){");
  const locateSelectionBody = html.slice(locateSelectionStart, locateSelectionStart + 300);
  assert.ok(locateSelectionBody.includes("var live = resolveLive(s);"), "locateSelection 的快速判断必须先调 resolveLive 现查一次，不能直接拿 s.el 去判断 locatable（那样才会被别的胶囊触发的 reload 带歪）");
});

test("取元素工具：selector 必须是唯一结构路径，不能是'标签+class 猜第几个同款'——回归测试：用户反馈选中一个依赖应用内某个状态（比如切到某个会话/标签页）才会出现的元素，过一会儿再点定位，结果定位到了别处一个 tag/class 都相同的元素；根因是旧版 stableSelector 只产出'标签+全部 class'，另配一个'当时命中结果里排第几个'的 index 消歧义——这只在'命中列表组成不会变'时可靠，应用状态一变就可能对错行，而且是安静地对错，不报错不闪烁，比明显失败更危险。通用解法是像浏览器 DevTools 的“复制选择器”一样，从元素一路带 nth-of-type 走到根，产出一条结构上唯一的路径：查得到就一定是当初那一个，查不到就是真的需要重置+重放，不存在“查到了但是别的东西”这种中间态，因此也不需要再额外记 index、或者引入“上一次是不是刚确认过”这类特殊分支去补救", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  const fnStart = html.indexOf("function stableSelector(el){");
  assert.ok(fnStart !== -1, "应该有一个独立函数产出唯一选择器");
  const fnBody = html.slice(fnStart, fnStart + 900);
  assert.ok(fnBody.includes('return "#" + CSS.escape(el.id)'), "有 id 时优先直接用 id，最简单也最稳");
  assert.ok(fnBody.includes("nth-of-type") && fnBody.includes("node !== root"), "没有 id 时要从元素一路带 nth-of-type 走到锚点（或文档根），产出结构上唯一的路径，不是拼 class 猜第几个同款");
  assert.ok(!html.includes("lastConfirmed") && !html.includes("stateDependent"), "selector 本身唯一之后，locateSelection 不应该再需要任何'这个胶囊是不是刚确认过''要不要强制重放'之类的特殊分支去补救——现查要么精确命中、要么查不到，没有第三种情况");
  const resolveStepStart = html.indexOf("function resolveStep(doc, step){");
  const resolveStepBody = html.slice(resolveStepStart, resolveStepStart + 100);
  assert.ok(resolveStepBody.includes("doc.querySelector(step.selector)") && !resolveStepBody.includes("step.index"), "resolveStep 应该直接用 querySelector 取唯一匹配，不需要再有 index/matches[0] 兜底那一套");
});

test("取元素工具：selector 优先锚定在最近一个带 id 的祖先上，不是无条件一路走到文档根——参考对比 Cursor 浏览器工具抓同一个元素的 dom_path（div#root > ... > div#tool-call-file-create > div.event.ok > div.eventBody > div.code），它明显是能用 id 的地方就不用位置。锚定在最近的 id 上路径更短，也不受页面别的地方增删兄弟节点影响；真的一路往上都没有任何祖先带 id，才退回到从文档根开始的完整路径", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  const fnStart = html.indexOf("function stableSelector(el){");
  const fnBody = html.slice(fnStart, fnStart + 900);
  assert.ok(fnBody.includes('el.parentElement && el.parentElement.closest("[id]")'), "要用 closest(\"[id]\") 找最近一个带 id 的祖先当锚点，不是无条件从文档根开始数");
  assert.ok(fnBody.includes("var root = anchor || doc.documentElement;"), "找到锚点就以锚点为路径起点；找不到（一路上都没有 id）才退回文档根，这是同一套逻辑的两个分支，不是两套实现");
  assert.ok(fnBody.includes('return (anchor ? "#" + CSS.escape(anchor.id) + " > " : "") + path.join(" > ");'), "最终 selector 要以 #锚点id 开头拼上剩下那一小段路径，不能只返回相对路径丢了锚点");
});

test("取元素工具：跨页面定位——回归测试：用户反馈点一个属于非当前页的胶囊时，画板先切了页面但样式显示不全、也没定位到，根因是 locatable() 在切页面之前就被判断了——非当前页的 .pf-page-canvas[hidden] 是 display:none，隐藏祖先下任何元素的 getBoundingClientRect() 都是 0，导致哪怕元素其实还在也被误判成“定位不到”而走进不必要的重置+重放；必须先切到胶囊所属的页面，再判断 locatable，resetAndReplay 重放完之后的判断同理也要先切页面", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("function switchToPageIfHidden(pageEl, pageId)"), "切页面逻辑要抽成一个独立函数，不能只塞在 flashEl 里面（flashEl 触发得太晚，判断 locatable 之前必须已经切换完）");
  const locateSelectionStart = html.indexOf("function locateSelection(s){");
  assert.ok(locateSelectionStart !== -1, "locateSelection 函数应该存在");
  const locateSelectionBody = html.slice(locateSelectionStart, locateSelectionStart + 500);
  const switchIdx = locateSelectionBody.indexOf("switchToPageIfHidden(");
  const locatableIdx = locateSelectionBody.indexOf("locatable(s.iframeEl, live)");
  assert.ok(switchIdx !== -1 && locatableIdx !== -1 && switchIdx < locatableIdx, "locateSelection 里必须先切页面、再判断 locatable，顺序反了的话跨页面胶囊永远会被误判成定位不到");
  const resetAndReplayStart = html.indexOf("function resetAndReplay(s){");
  const resetAndReplayBody = html.slice(resetAndReplayStart, resetAndReplayStart + 900);
  const replaySwitchIdx = resetAndReplayBody.indexOf("switchToPageIfHidden(");
  const replayLocatableIdx = resetAndReplayBody.indexOf("if (!locatable(iframeEl, target))");
  assert.ok(replaySwitchIdx !== -1 && replayLocatableIdx !== -1 && replaySwitchIdx < replayLocatableIdx, "resetAndReplay 重放完之后的 locatable 判断，前面也必须先切页面，否则跨页面元素重放完还是会被误判定位失败");
});

test("取元素工具：父文档自己的 click 监听器要求点击落在 .pf-viewport 里才触发插入——回归测试：实测复现过点合成面板自己的“复制”按钮会被误判成又选中了一次画板元素（active && lastHover 恰好还没被 mousemove 清空时，任何点击、包括点工具自己的 UI，都会插入一次），加上范围检查后点合成面板/工具栏/侧边栏永远不会误触发", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  const clickListenerStart = html.indexOf('document.addEventListener("click", function(e){\n      if (!active || !lastHover) return;');
  assert.ok(clickListenerStart !== -1, "父文档的 click 监听器应该存在");
  const nearby = html.slice(clickListenerStart, clickListenerStart + 300);
  assert.ok(nearby.includes('e.target.closest(".pf-viewport")'), "点击处理必须先检查落点是不是在画布视口里，不能只靠 active/lastHover 两个状态位判断");
});

test("取元素工具：命中元素自己没有任何可识别信息（没 id、没 class、文字短于 4 个字，比如“薪灵AI”里被 <em> 包住的“AI”两个字）时，往上找最近一个有 id/class/够长文字的祖先当作真正引用对象——回归测试：点太深的行内标签复制出来的引用几乎没有定位价值；但命中元素自己已经有 id/class/够长文字时不应该被换成更大的祖先，那不是用户点的东西", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("function nearestIdentifiable"), "hit-test 应该有一步专门处理'命中的元素本身没有任何可识别信息'这种情况");
  assert.ok(html.includes("el = nearestIdentifiable(el)"), "describe() 应该用爬取到的祖先，不是原样使用 elementFromPoint 命中的那个最深元素");
});

test("取元素工具：复制成功后按钮要有可见反馈（“已复制”闪一下），不能点了跟没点一样", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("已复制"), "复制成功要有肉眼可见的反馈文案");
  const doCopyStart = html.indexOf("function doCopy(){");
  assert.ok(doCopyStart !== -1);
  const doCopyBody = html.slice(doCopyStart, doCopyStart + 400);
  assert.ok(doCopyBody.includes(".then(function(){") && doCopyBody.includes("已复制"), "反馈应该挂在 writeText 成功的回调里，不是无条件立刻显示（写剪贴板失败时不该假装成功）");
});

test("取元素工具：手动全选(Cmd/Ctrl+A)+复制(Cmd/Ctrl+C)也要能粘贴出正确内容——回归测试：用户反馈原生复制粘贴不出东西；根因是浏览器给纯文本剪贴板取内容时会跳过 contenteditable=\"false\" 的胶囊节点文字，选区里只有胶囊时原生复制出来是空字符串。必须拦截 composeBox 的原生 copy 事件，改用跟“复制”按钮同一份 serializeNodes(describeComposeNodes(...)) 权威序列化逻辑写入剪贴板，两条路径不能有两份不同的格式化逻辑", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  const listenerIdx = html.indexOf('composeBox.addEventListener("copy"');
  assert.ok(listenerIdx !== -1, "应该在 composeBox 上拦截原生 copy 事件，不能指望浏览器原生行为");
  const body = html.slice(listenerIdx, listenerIdx + 400);
  assert.ok(body.includes("serializeNodes(describeComposeNodes(composeBox))"), "拦截后应该复用跟复制按钮同一份序列化逻辑，不是另起一套简化版");
  assert.ok(body.includes("e.clipboardData.setData(") && body.includes("e.preventDefault()"), "必须真的把浏览器默认的（有缺陷的）复制行为替换掉，只是算出文本但不写入/不阻止默认行为等于没修");
});

test("取元素工具：全选时胶囊也要有选中态的视觉反馈——回归测试：用户反馈全选时只有文字有选择样式、胶囊看起来像没被选中；根因是 .pf-pick-chip 有 user-select:none，浏览器原生选区高亮（::selection）根本不会画在它身上。用 selectionchange 手动跟踪选区、给落在选区里的胶囊加一个高亮 class 补回视觉反馈，不依赖浏览器对这个不可编辑孤岛的原生选区渲染", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  assert.ok(html.includes("pf-pick-chip--native-selected"), "需要一个专门的 class 手动表示胶囊当前落在选区里");
  assert.ok(html.includes(".pf-pick-chip.pf-pick-chip--native-selected{"), "这个 class 要有实际的高亮样式，不能只是加了个空 class");
  const fnStart = html.indexOf("function syncChipSelectionHighlight(range){");
  assert.ok(fnStart !== -1, "应该有一个独立函数负责同步胶囊的选中态");
  const fnBody = html.slice(fnStart, fnStart + 400);
  assert.ok(fnBody.includes("range.intersectsNode(chip)"), "应该用 Range.intersectsNode 判断胶囊是否真的落在当前选区内，不能瞎猜");
  const saveCursorStart = html.indexOf("function saveCursor(){");
  assert.ok(saveCursorStart !== -1 && html.slice(saveCursorStart, saveCursorStart + 300).includes("syncChipSelectionHighlight("), "saveCursor 已经在监听 keyup/mouseup/selectionchange 三处更新光标位置，胶囊高亮应该复用同一组监听点，不需要另起一套监听器");
});

test("取元素工具：复制格式改成 Cursor 风格的英文字段名（tag/class/text/position/style/...），每个元素的信息整块待在一起——回归测试：用户明确反对把一个元素的信息拆成'正文里留个记号、位置样式挪到文末列表'这种 footnote 式格式，要求跟元素相关的信息留在一起，字段名统一用英文，跟粘贴过去的目标（Cursor/Codex）自己的输出习惯对齐。board/source 只在换了一个不同的画板时才重新出现，同一块画板连续引用多次不用每条都重复这两行", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  const m = html.match(/function serializeNodes\(nodes\)\{[\s\S]*?\n    \}/);
  assert.ok(m, "serializeNodes 应该是一个边界清楚、能被整段抠出来的具名函数");
  const serializeNodes = new Function("return " + m[0])();

  const oneSource = serializeNodes([
    { type: "text", value: "把" },
    { type: "chip", tag: "button", id: "", className: "search", text: "搜索任务/文档", annotation: null, pageId: "pg_1", artboardId: "ab_1", artboardName: "登录页" },
    { type: "text", value: "改成红色" },
  ]);
  assert.equal(
    oneSource,
    "把\n\nboard: 登录页\nsource: pages/pg_1/artboards/ab_1/source.jsx\ntag: button\nclass: search\ntext: 搜索任务/文档\n改成红色",
    "元素的字段（tag/class/text）要整块待在一起，不能拆开；块前面空一行跟前面的文字分开，块结束后紧跟着的文字直接续在下一行，不额外空行"
  );

  const twoChipsSameBoard = serializeNodes([
    { type: "chip", tag: "button", id: "", className: "a", text: "按钮A", annotation: null, pageId: "pg_1", artboardId: "ab_1", artboardName: "画板A" },
    { type: "text", value: " " },
    { type: "chip", tag: "button", id: "", className: "b", text: "按钮B", annotation: null, pageId: "pg_1", artboardId: "ab_1", artboardName: "画板A" },
  ]);
  assert.equal((twoChipsSameBoard.match(/^board: /gm) || []).length, 1, "同一块画板连续引用多次，board/source 只应该在第一次出现，不用每条引用都重复这两行");
  assert.ok(!/\n \n/.test(twoChipsSameBoard) && !twoChipsSameBoard.includes("\n \n\n"), "两个胶囊之间只隔着一个自动补的空格（不是有意义的文字）时，不应该在两个元素块之间留下一行只有一个空格的怪行");

  const twoSources = serializeNodes([
    { type: "text", value: "改" },
    { type: "chip", tag: "button", id: "", className: "a", text: "按钮A", annotation: null, pageId: "pg_1", artboardId: "ab_1", artboardName: "画板A" },
    { type: "text", value: "和" },
    { type: "chip", tag: "div", id: "", className: "b", text: "块B", annotation: null, pageId: "pg_2", artboardId: "ab_2", artboardName: "画板B" },
  ]);
  assert.equal(
    twoSources,
    "改\n\nboard: 画板A\nsource: pages/pg_1/artboards/ab_1/source.jsx\ntag: button\nclass: a\ntext: 按钮A\n和\n\nboard: 画板B\nsource: pages/pg_2/artboards/ab_2/source.jsx\ntag: div\nclass: b\ntext: 块B",
    "引用了两个不同画板时，第二个画板的 board/source 应该重新出现一次（不是去重成只在文首列一遍），这样每一条元素引用自己就能看出属于哪块画板，不用回头翻文首的来源列表"
  );

  const textOnly = serializeNodes([{ type: "text", value: "只是随便写点什么" }]);
  assert.equal(textOnly, "只是随便写点什么", "没有引用任何元素时不应该凭空生成 board/source");
});

test("取元素工具：id/位置/样式/标注都跟着每条引用一起带出来——回归测试：同一个状态图标在列表不同行各出现一次时，标签/class/文本完全相同，模型没法区分是哪一行，position 永远带上；style 已经按“跟默认值不同才收录”过滤过，没有自定义样式的元素不应该凭空多出 style 这一行；annotation 只在这个元素本来就关联了 ProtoFlow 标注时才出现，这是我们比 Cursor/Claude 同类工具都多出来的信息；有 id 的元素不应该再多余地列一遍 path（id 已经能唯一定位），没有 id 才需要 path", () => {
  const html = buildCanvasHtml({ projectName: "P", projectId: "proj_1", pages: twoPages });
  const m = html.match(/function serializeNodes\(nodes\)\{[\s\S]*?\n    \}/);
  const serializeNodes = new Function("return " + m[0])();

  const identicalIcons = serializeNodes([
    { type: "chip", tag: "span", id: "", className: "state ok", text: "", annotation: null, rect: { x: 1063, y: 271, width: 12, height: 12 }, style: {}, pageId: "pg_1", artboardId: "ab_1", artboardName: "画板" },
    { type: "text", value: " " },
    { type: "chip", tag: "span", id: "", className: "state ok", text: "", annotation: null, rect: { x: 1063, y: 307, width: 12, height: 12 }, style: {}, pageId: "pg_1", artboardId: "ab_1", artboardName: "画板" },
  ]);
  assert.equal(
    identicalIcons,
    "board: 画板\nsource: pages/pg_1/artboards/ab_1/source.jsx\ntag: span\nclass: state ok\nposition: x=1063 y=271, 12×12\n\ntag: span\nclass: state ok\nposition: x=1063 y=307, 12×12",
    "标签/class/文本完全相同的两个元素，position 不同应该在复制文本里体现出来，不能是两段一模一样、分不出谁是谁的引用；文本为空时不应该凭空多出一行空的 text:"
  );

  const noCustomStyle = serializeNodes([{ type: "chip", tag: "div", id: "", className: "row", text: "普通行", annotation: null, rect: { x: 0, y: 0, width: 10, height: 10 }, style: {}, pageId: "pg_1", artboardId: "ab_1", artboardName: "画板" }]);
  assert.ok(!noCustomStyle.includes("style:"), "没有自定义样式（style 是空对象）时不应该凭空多出 style: 这一行");

  const withStyle = serializeNodes([{ type: "chip", tag: "span", id: "", className: "state fail", text: "", annotation: null, rect: { x: 1, y: 2, width: 3, height: 4 }, style: { color: "rgb(220, 38, 38)" }, pageId: "pg_1", artboardId: "ab_1", artboardName: "画板" }]);
  assert.ok(withStyle.includes("style: color: rgb(220, 38, 38)"), "有自定义样式时应该单独一行 style:，这是跟“同标签同 class 但靠颜色区分状态”的元素区分开的另一个信号");

  const withAnnotation = serializeNodes([{ type: "chip", tag: "div", id: "", className: "code", text: "{...}", annotation: { referenced: true }, rect: { x: 0, y: 0, width: 1, height: 1 }, style: {}, pageId: "pg_1", artboardId: "ab_1", artboardName: "画板" }]);
  assert.ok(withAnnotation.includes("（该元素已被标注引用）"), "被 annotations.md 里 [名](#el/元素id) 引用过的元素应该带上这一行——这是我们独有、Cursor/Claude 同类工具都没有的信息");
  const withoutAnnotation = serializeNodes([{ type: "chip", tag: "div", id: "", className: "code", text: "x", annotation: null, rect: { x: 0, y: 0, width: 1, height: 1 }, style: {}, pageId: "pg_1", artboardId: "ab_1", artboardName: "画板" }]);
  assert.ok(!withoutAnnotation.includes("该元素已被标注引用"), "没有被标注引用时不应该凭空多出这一行");

  const withId = serializeNodes([{ type: "chip", tag: "div", id: "tool-call-file-create", className: "code", text: "x", annotation: null, selector: "#tool-call-file-create", rect: { x: 0, y: 0, width: 1, height: 1 }, style: {}, pageId: "pg_1", artboardId: "ab_1", artboardName: "画板" }]);
  assert.ok(withId.includes("id: tool-call-file-create"), "有 id 的元素应该带上 id 这一行");
  assert.ok(!withId.includes("path:"), "有 id 时 id 本身已经能唯一定位，不应该再多余地列一遍 path");

  const withoutId = serializeNodes([{ type: "chip", tag: "div", id: "", className: "code", text: "x", annotation: null, selector: "#tool-call-file-create > div.code", rect: { x: 0, y: 0, width: 1, height: 1 }, style: {}, pageId: "pg_1", artboardId: "ab_1", artboardName: "画板" }]);
  assert.ok(withoutId.includes("path: #tool-call-file-create > div.code"), "没有 id 时应该带上 path（结构选择器），给 agent 一点定位上下文，不是完全没有位置信息");
});
