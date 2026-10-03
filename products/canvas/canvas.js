// products/canvas/canvas.js — 纯模板函数：整站画布。一份文件，顶栏的页面切换下拉列出全部页面，切换页面是文档内
// 显示/隐藏（零网络请求、零页面跳转，因此和 FigJam 切页面一样瞬时）。每个页面拥有独立的
// 可缩放可平移画布；画板按声明的 canvasWidth 以真实像素宽度显示。高度默认自适应内容——画板自己
// 的 preview.html 加载后通过 postMessage 上报真实高度（见 core/preview.js 的 sizeReportScript），
// 这里只负责监听并应用，两边共用消息类型字符串 "protoflow-preview-size"；每次量到的真实高度会
// 节流写回 .protoflow/canvas.json，下次这块画板初次渲染就直接拿这个真值当高度，不用从占位猜测
// 起步（见 buildFrame 的 opts.heightCache）。少数场景 agent 会在 meta.json 显式声明 canvasHeight，
// 表示这块画板要做成固定尺寸的设备屏——这种画板不接受自动撑高，内容超出声明高度交给 iframe 默认
// 的内部滚动条（见 buildFrame 的 data-pf-fixed-h 和这里 postMessage 处理器里对它的判断）。
import { ELEMENT_PICKER_SCRIPT } from "./canvasPicker.js";
import { BRAND_CSS_VARS, FAVICON_LINK, FULLSCREEN_CSS, ICON_SHARE, exportDownloadScript, exportMenuRowsHtml, fullscreenButtonHtml, fullscreenScript } from "protoflow/sdk";
import { decompressLibsScript, injectArtboardLibsScript } from "protoflow/sdk/internal";
import { CANVAS_EXPORT_MENU } from "./exportMenu.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 顶部小工具栏（.pf-mode-toolbar）的三个图标，lucide 风格（viewBox 0 0 24 24，stroke=currentColor）。
// 定义成常量而不是各自内联写两遍：既要拼进 buildPageCanvas 生成的初始 HTML（默认交互模式），
// 也要作为字符串常量塞进 buildScript() 里，供切换模式时替换按钮的 innerHTML。
const ICON_INTERACT = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/></svg>`;
// "虚线框 + 鼠标指针"——设计/浏览器 devtools 里表示"取元素"最通用的图标（Figma Dev Mode、
// 各类元素选择器扩展都用这个），比之前那个纯四角括号（跟"裁剪"图标撞得很像）更让人一眼认出
// 这是"点选页面上的元素"。取元素工具胶囊上的小图标（core/canvasPicker.js）要跟这里保持视觉
// 一致，改这里也要同步改那边——两处各自持有一份 SVG 字符串，不是同一个变量（canvasPicker.js
// 设计成不依赖 canvas.js 任何内部状态、可以整个文件独立删除，见该文件顶部注释）。
const ICON_SELECT = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444.99a1 1 0 0 0-.686.686l-.99 3.443a.5.5 0 0 1-.943.033z"/><path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h2"/><path d="M14 3h1"/><path d="M3 9v1"/><path d="M21 9v2"/><path d="M3 14v1"/></svg>`;
const ICON_EXPAND = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;
// 顶栏页面切换按钮的图标：两张叠着的页，前面那张里写页数（参考 FigJam）。
const pagesIcon = (n) => `<svg class="pf-pgsel-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M6.5 3.5h8a2 2 0 0 1 2 2v8"/><rect x="3.5" y="6.5" width="10" height="10.5" rx="2"/><text x="8.5" y="14.4" text-anchor="middle" font-size="${n > 9 ? 6 : 7.5}" font-weight="600" font-family="-apple-system,sans-serif" fill="currentColor" stroke="none">${n}</text></svg>`;
const ICON_ANNOTATION = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

const CSS = `
${BRAND_CSS_VARS}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:#f6f7fb;color:#0f172a;font-family:"PingFang SC","Microsoft YaHei",-apple-system,sans-serif}
body{display:flex;flex-direction:column}
/* 顶栏：跟文档/表格/绘图同一条 .pf-hdr（高 40、白底、下边线；左 = 项目栏入口 + 标题兼版本下拉，右 = 分享）。
   画布多一个页面切换（.pf-pgsel，样子参考 FigJam：叠页图标里写页数 + 当前页名，点开是页面列表）。 */
.pf-hdr{flex:none;position:relative;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:8px;height:40px;padding:0 12px 0 8px;background:#fff;border-bottom:1px solid #e9ebef;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.pf-hdr-l{display:flex;align-items:center;gap:4px;min-width:0}
.pf-hdr-r{display:flex;align-items:center;gap:4px;flex:none}
.pf-hdr-title{padding:0 7px;font-size:12px;font-weight:600;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40vw}
.pf-hdr-sep{flex:none;width:1px;height:16px;margin:0 4px;background:#e2e8f0}
.pf-app{flex:1;min-height:0;display:flex}
html.pf-loading .pf-pgsel{visibility:hidden}
.pf-pgsel{position:relative;min-width:0;font-size:12px}
.pf-pgsel-btn{display:inline-flex;align-items:center;gap:6px;max-width:40vw;height:28px;padding:0 6px 0 5px;font-family:inherit;font-size:12px;font-weight:500;line-height:1;color:#0f172a;background:transparent;border:0;border-radius:6px;cursor:pointer;transition:background .1s ease}
.pf-pgsel-btn:hover,.pf-pgsel-btn[aria-expanded="true"]{background:rgba(15,23,42,.06)}
.pf-pgsel-icon{flex:none;width:18px;height:18px;color:#475569}
.pf-pgsel-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-pgsel-menu{position:absolute;left:0;top:calc(100% + 6px);width:240px;background:#fff;border:1px solid #e9ebef;border-radius:12px;box-shadow:0 8px 26px rgba(15,23,42,.12);padding:4px;z-index:60;max-height:62vh;overflow:auto}
.pf-pgsel-menu[hidden]{display:none}
.pf-pgsel-head{padding:8px 10px 6px;font-size:12px;font-weight:600;color:#0f172a}
/* 版本下拉：视觉和交互照抄 core/docPreview.js 的 .pf-vsel（按钮 = 标题 + 非最新版时的 vN 小标）。
   菜单用 position:fixed 按按钮位置摆（见 setupVersions）。 */
.pf-vsel{min-width:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:12px}
.pf-vsel *{box-sizing:border-box}
.pf-vsel-btn{display:inline-flex;align-items:center;gap:5px;max-width:40vw;height:26px;padding:0 5px 0 7px;font-family:inherit;font-size:12px;font-weight:600;line-height:1;color:#0f172a;background:transparent;border:0;border-radius:6px;cursor:pointer;transition:background .1s ease}
.pf-vsel-btn:hover,.pf-vsel-btn[aria-expanded="true"]{background:rgba(15,23,42,.06)}
.pf-vsel-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-vsel-badge{flex:none;border-radius:999px;background:rgba(15,23,42,.06);color:#8a919c;padding:1px 6px;font-size:10.5px;font-weight:400;line-height:1.4}
.pf-vsel-chev{width:11px;height:11px;flex:none;opacity:.45}
.pf-vsel-menu{position:fixed;width:250px;background:#fff;border:1px solid #e9ebef;border-radius:10px;box-shadow:0 8px 26px rgba(15,23,42,.12);padding:4px;z-index:60;max-height:62vh;overflow:auto}
.pf-vsel-menu[hidden]{display:none}
.pf-vsel-item{display:block;padding:7px 9px;border-radius:6px;text-decoration:none;cursor:pointer}
.pf-vsel-item:hover{background:#f6f7f9}
.pf-vsel-item.active{background:#f1f3f5}
.pf-vsel-item .t{display:block;font-size:12px;font-weight:500;line-height:1.35;color:#1a1d21;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-vsel-item .s{display:block;font-size:11px;font-weight:400;line-height:1.3;color:#9aa1ab;margin-top:2px}
.pf-vsel-dot{display:inline-block;width:5px;height:5px;margin-left:5px;border-radius:50%;background:#0f172a;vertical-align:middle}
.pf-page-item{display:block;width:100%;padding:8px 10px;border:none;background:none;border-radius:7px;font-size:12px;line-height:16px;color:#334155;text-align:left;cursor:pointer;font-family:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-page-item:hover{background:#f1f5f9}
.pf-page-item.active{background:#eef2f6;color:#0f172a;font-weight:600}
/* 标注面板：每块画板悬浮出来的「标注」按钮（新标签页图标旁）打开，画布右侧展开这块画板的标注，平时不占地方（脚本 setupAnnotations，随注释块可删） */
.pf-anns{display:none;width:300px;flex:0 0 300px;background:#fff;border-left:1px solid #e2e8f0;overflow-y:auto;overflow-x:hidden}
html.pf-ann-open .pf-anns{display:block}
.pf-anns__head{display:flex;align-items:center;gap:6px;padding:10px 8px 8px 12px;border-bottom:1px solid #eef0f5;font-size:11px;font-weight:600;color:#0f172a}
.pf-anns__head span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-anns__close{flex:0 0 auto;width:20px;height:20px;border:none;background:none;padding:0;color:#94a3b8;cursor:pointer;border-radius:5px;font-size:15px;line-height:1;display:flex;align-items:center;justify-content:center}
.pf-anns__close:hover{background:#f1f5f9;color:#0f172a}
.pf-ann-chip{display:inline;padding:0 5px;margin:0 1px;border-radius:4px;background:var(--pf-brand-tint);color:var(--pf-brand);font-weight:500;cursor:pointer}
.pf-ann-chip:hover{background:#c8f3f3}
.pf-ann-chip--broken{background:#f1f5f9;color:#94a3b8;text-decoration:line-through;cursor:default}
/* 整页标注 = 一篇 markdown 文章（不是一条一张卡片），marked 渲染后套这套紧凑样式 */
.pf-ann-md{padding:6px 12px 16px;font-size:11px;line-height:1.65;color:#475569;word-break:break-word}
.pf-ann-md>*:first-child{margin-top:0}
.pf-ann-md p{margin:5px 0}
.pf-ann-md h1{font-size:12px;font-weight:800;color:#0f172a;margin:20px 0 6px;padding-top:14px;border-top:2px solid #e2e8f0}
.pf-ann-md>h1:first-child{margin-top:0;padding-top:0;border-top:none}
.pf-ann-md h2{font-size:11px;font-weight:700;color:#0f172a;margin:16px 0 4px;padding-top:12px;border-top:1px solid #eef0f5}
.pf-ann-md>h2:first-child{margin-top:0;padding-top:0;border-top:none}
.pf-ann-md h1+h2{padding-top:0;border-top:none;margin-top:6px}
.pf-ann-md h3{font-size:10px;font-weight:700;color:#64748b;letter-spacing:.02em;margin:10px 0 3px}
.pf-ann-md h4,.pf-ann-md h5,.pf-ann-md h6{font-size:11px;font-weight:700;color:#0f172a;margin:9px 0 2px}
.pf-ann-md ul,.pf-ann-md ol{margin:4px 0;padding-left:16px}
.pf-ann-md li{margin:2px 0}
.pf-ann-md li>ul,.pf-ann-md li>ol{margin:2px 0}
.pf-ann-md strong{color:#0f172a}
.pf-ann-md code{background:#eef0f5;border-radius:3px;padding:0 3px;font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.pf-ann-md pre{background:#f8fafc;border:1px solid #eef0f5;border-radius:6px;padding:6px 8px;overflow-x:auto;margin:4px 0}
.pf-ann-md pre code{background:none;padding:0}
.pf-ann-md blockquote{margin:4px 0;padding-left:8px;border-left:2px solid #e2e8f0;color:#64748b}
.pf-ann-md a{color:var(--pf-brand);text-decoration:underline}
.pf-ann-md table{border-collapse:collapse;font-size:10px;margin:4px 0;display:block;overflow-x:auto}
.pf-ann-md th,.pf-ann-md td{border:1px solid #e2e8f0;padding:2px 5px;text-align:left}
.pf-ann-md hr{border:none;border-top:1px solid #e2e8f0;margin:6px 0}
.pf-ann-md img{max-width:100%}
.pf-anns__empty{padding:12px 10px;font-size:11px;color:#94a3b8;line-height:1.6}
.pf-main{flex:1;position:relative;overflow:hidden}
.pf-page-canvas{position:absolute;inset:0;display:flex;flex-direction:column}
/* 隐藏页面保留布局：iframe 内的 SVG、图表组件仍需测量尺寸（比如 Mermaid 时序图会报 svg element not in render tree）。 */
.pf-page-canvas[hidden]{display:flex;visibility:hidden;pointer-events:none}
.pf-toolbar{position:absolute;left:16px;bottom:16px;z-index:5;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 4px 16px rgba(15,23,42,.08);padding:4px}
.pf-zoom-label{min-width:44px;height:28px;padding:0 8px;border:none;background:none;border-radius:6px;font-size:12px;color:#334155;cursor:pointer;font-family:inherit}
.pf-zoom-label:hover{background:#f1f5f9}
.pf-zoom-menu{position:absolute;left:0;bottom:calc(100% + 8px);min-width:168px;display:flex;flex-direction:column;gap:1px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 4px 16px rgba(15,23,42,.08);padding:4px}
.pf-zoom-menu[hidden]{display:none}
.pf-zoom-menu button{text-align:left;padding:7px 10px;border:none;background:none;border-radius:6px;font-size:13px;color:#334155;cursor:pointer;font-family:inherit}
.pf-zoom-menu button:hover{background:#f1f5f9}
.pf-zoom-menu__sep{height:1px;background:#e2e8f0;margin:3px 4px}
.pf-mode-toolbar{position:absolute;left:16px;top:16px;z-index:5;display:flex;flex-direction:column;align-items:center;gap:2px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 4px 16px rgba(15,23,42,.08);padding:4px}
.pf-mode-toolbar button{width:32px;height:32px;border:none;background:none;border-radius:8px;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center}
.pf-mode-toolbar button:hover{background:#f1f5f9}
.pf-mode-toolbar__sep{width:20px;height:1px;background:#e2e8f0;margin:2px 0}
.pf-export-entry{position:relative}
.pf-hdr-share{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:12px;font-weight:400;color:rgba(15,23,42,.75);background:transparent;border:0;border-radius:6px;cursor:pointer}
.pf-hdr-share:hover{background:rgba(15,23,42,.06)}
.pf-hdr-share:disabled{opacity:.5;cursor:default}
.pf-hdr-share svg{flex:none}
/* 导出菜单：参考 Claude/Luma 那套 Export 弹层——图标 + 标题 + 小字说明 + 右侧动作字一行，
   [hidden] 开合，格式列表来自 ./exportMenu.js（见 core/ui.js 的 exportMenuRowsHtml），
   加新格式不用改这份 CSS/JS。 */
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
.pf-mode-tooltip{position:fixed;z-index:20;transform:translateY(-50%);padding:8px 14px;border-radius:10px;background:#0f172a;color:#fff;font-size:13px;line-height:1.4;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .1s ease}
.pf-mode-tooltip:before{content:"";position:absolute;left:-6px;top:50%;transform:translateY(-50%);border-width:6px 6px 6px 0;border-style:solid;border-color:transparent #0f172a transparent transparent}
.pf-mode-tooltip--show{opacity:1}
.pf-viewport{flex:1;position:relative;overflow:hidden;touch-action:none;overscroll-behavior:none;background-image:radial-gradient(#e2e8f0 1px, transparent 1px);background-size:24px 24px}
.pf-page-canvas.pf-loading .pf-viewport,.pf-page-canvas.pf-loading .pf-toolbar,.pf-page-canvas.pf-loading .pf-mode-toolbar{visibility:hidden}
.pf-viewport.pf-grabbing{cursor:grabbing}
.pf-canvas{position:absolute;left:0;top:0;transform-origin:0 0;display:flex;flex-direction:row;align-items:flex-start;gap:64px;padding:64px}
.pf-canvas.pf-interacting{will-change:transform}
.pf-canvas.pf-panning iframe{pointer-events:none}
.pf-frame{display:flex;flex-direction:column;gap:8px}
.pf-frame__label{font-size:12px;color:#475569;overflow-wrap:break-word;display:flex;align-items:center;justify-content:space-between;gap:8px}
.pf-frame__label b{font-weight:600;color:#0f172a}
.pf-frame__actions{flex:0 0 auto;display:flex;align-items:center;gap:2px}
.pf-frame__open,.pf-frame__annotate{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border:none;background:none;padding:0;font:inherit;color:#64748b;text-decoration:none;cursor:pointer;border-radius:6px;opacity:0;transition:opacity .1s ease}
.pf-frame:hover .pf-frame__open,.pf-frame:hover .pf-frame__annotate{opacity:1}
.pf-frame__open:hover,.pf-frame__annotate:hover{background:#fff;color:#0f172a}
.pf-frame__annotate.is-active{opacity:1;color:var(--pf-brand);background:var(--pf-brand-tint)}
.pf-frame__box{background:#fff;border:1px solid #e2e8f0;border-radius:4px;box-shadow:0 1px 3px rgba(15,23,42,.06);overflow:hidden}
.pf-frame__box iframe{display:block;border:0}
.pf-frame[data-pf-loading] .pf-frame__box{position:relative;background:#fff;border-color:transparent;box-shadow:none}
.pf-frame[data-pf-loading] iframe{visibility:hidden}
.pf-frame[data-pf-loading] .pf-frame__box:before,.pf-frame[data-pf-loading] .pf-frame__box:after{content:"";position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(circle,#94a3b8 1px,transparent 1.2px);background-size:7px 7px}
.pf-frame[data-pf-loading] .pf-frame__box:before{opacity:.2;mask-image:radial-gradient(ellipse at center,#000 15%,transparent 75%)}
.pf-frame[data-pf-loading] .pf-frame__box:after{opacity:.55;mask-image:radial-gradient(ellipse 38% 32% at center,#000,transparent);animation:pf-placeholder-breathe 2.4s ease-in-out infinite}
@keyframes pf-placeholder-breathe{0%,100%{opacity:.25;transform:translateX(-3%)}50%{opacity:.65;transform:translateX(3%)}}
@media(prefers-reduced-motion:reduce){.pf-frame[data-pf-loading] .pf-frame__box:after{animation:none}}
.pf-frame__empty{display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:13px}
.pf-empty{padding:80px 24px;text-align:center;color:#94a3b8}
/* ---- 取元素工具（脚本主体见 core/canvasPicker.js，整段随它一起可删） ---- */
.pf-mode-toolbar button.pf-mode-active{background:var(--pf-brand-tint);color:var(--pf-brand)}
.pf-mode-toolbar button.pf-mode-active:hover{background:#e2e6ec}
.pf-pick-outline{position:fixed;pointer-events:none;z-index:99993;border:2px solid var(--pf-brand);background:var(--pf-brand-wash);border-radius:2px;display:none}
.pf-pick-outline--picked{border-color:#e11d48;background:rgba(225,29,72,.05)}
.pf-pick-compose{position:fixed;right:16px;bottom:16px;z-index:99994;width:380px;max-height:400px;display:flex;flex-direction:column;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 12px 32px rgba(15,23,42,.18);overflow:hidden;font-family:-apple-system,"PingFang SC",sans-serif}
.pf-pick-compose__header{display:flex;align-items:center;gap:8px;padding:14px 10px 10px 16px;flex:0 0 auto}
.pf-pick-compose__dot{width:8px;height:8px;border-radius:50%;background:var(--pf-brand);flex:0 0 auto}
.pf-pick-compose__title{flex:1;font-size:14px;font-weight:700;color:#0f172a}
.pf-pick-compose__close{width:26px;height:26px;border:none;background:none;border-radius:8px;color:#94a3b8;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center}
.pf-pick-compose__close:hover{background:#f1f5f9;color:#334155}
.pf-pick-compose__hint{padding:0 16px 12px;font-size:12px;line-height:1.5;color:#64748b}
.pf-pick-compose__box{flex:1;overflow:auto;margin:0 16px;padding:12px 14px;font-size:13px;line-height:1.7;color:#0f172a;outline:none;min-height:120px;word-break:break-word;background:#f8fafc;border:1px solid #eef0f5;border-radius:10px}
.pf-pick-compose__box:empty:before{content:attr(data-placeholder);color:#94a3b8}
.pf-pick-compose__toolbar{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:14px 16px 16px;flex:0 0 auto}
.pf-pick-compose__toolbar button{display:flex;align-items:center;justify-content:center;height:32px;padding:0 12px;border:1px solid #e2e8f0;border-radius:5px;background:#fff;font-size:12px;font-weight:500;line-height:16px;letter-spacing:.01em;white-space:nowrap;color:#334155;cursor:pointer;transition:background .1s ease,border-color .1s ease}
.pf-pick-compose__toolbar button:hover{background:#f1f5f9}
.pf-pick-compose__toolbar button.pf-pick-compose__primary{border-color:var(--pf-brand);background:var(--pf-brand);color:#fff}
.pf-pick-compose__toolbar button.pf-pick-compose__primary:hover{background:var(--pf-brand-hover);border-color:var(--pf-brand-hover)}
.pf-pick-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px 1px 4px;margin:0 2px;border-radius:999px;background:var(--pf-brand-tint);color:var(--pf-brand);font:600 12px -apple-system,sans-serif;white-space:nowrap;user-select:none;cursor:pointer}
.pf-pick-chip.pf-pick-chip--native-selected{background:#b4d5fe;color:#0f172a}
.pf-pick-chip__badge{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--pf-brand);color:#fff;font-size:10px;flex:0 0 auto}
.pf-pick-chip__icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;line-height:0}
/* ---- /取元素工具 ---- */
`;

// 每个 .pf-page-canvas 独立拥有自己的平移/缩放状态与工具栏；切换页面仅切换 hidden 属性。
// 缩放/平移交互与锚点公式移植自 ~/Axure0.3 App.jsx 已验证的画布实现（isMouseWheel 判别、
// zoomAt 锚点公式、Safari gesturestart/change/end 接管、translate3d+will-change）。
// 拖拽平移时给 .pf-canvas 加 pf-panning 临时关闭 iframe 的 pointer-events，避免拖拽被画板内容截获。
//
// 视角（每页 scale/x/y）、当前页面和标注面板状态持久化到项目内 .protoflow/canvas.json（见
// core/localServer.js 的 __protoflow_state 路由，一个按 key 存取派生 UI 状态的通用机制，
// 不是焊死给画布一个用的）。不用 localStorage——那是按浏览器 origin 隔离的，换设备/换浏览器/
// file:// 与 http://127.0.0.1 之间都跟不过去，不是真正的"项目自包含"。routeKey 从当前页面
// 自己的 URL（location.pathname 里的 /p/<key>/ 段）反推，不在生成时写死——生成时不知道最终
// 会不会因为撞同名项目被服务器加 -2 后缀，用运行时自己的 URL 反推永远准；如果整份文件是被
// file:// 直接打开、没走这条路由，routeKey 为 null，优雅降级成"这次不存不取"，不报错不卡住。
function buildScript({ exportMode = false, singleFile = false, canvasId = "" } = {}) {
  return `(function(){
  var __PF_EXPORT__ = ${exportMode ? "true" : "false"};
  var ZOOM_MIN = 0.1, ZOOM_MAX = 4;
  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
  function isMouseWheel(e){ return e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 100); }

  // 通用坐标换算：iframe 局部坐标 -> 父文档屏幕坐标。iframe.getBoundingClientRect() 拿到的永远是
  // 当前实际渲染尺寸（已经把 .pf-canvas 上的 scale(...) 算在内了），iframe.clientWidth/Height 是
  // 画板自己声明的固定逻辑尺寸（不随缩放变），两者之比就是当前缩放系数——不管画布缩放到多少都准。
  // 手势转发（handleGestureMessage）和取元素工具（setupElementPicker）共用这两个函数，不用各写各的。
  // 只需要局部转屏幕这一个方向：屏幕转局部（点选请求方向）不需要了——画板自己知道自己的本地坐标，
  // 直接报给父文档，父文档不用反过来猜（见 setupElementPicker 里 protoflow-canvas-pointer 的注释）。
  function iframeScale(iframeEl){
    var rect = iframeEl.getBoundingClientRect();
    return { rect: rect, sx: rect.width / iframeEl.clientWidth || 1, sy: rect.height / iframeEl.clientHeight || 1 };
  }
  function toParentPoint(iframeEl, localX, localY){
    var s = iframeScale(iframeEl);
    return { x: s.rect.left + localX * s.sx, y: s.rect.top + localY * s.sy };
  }
  function toScreenRect(iframeEl, localRect){
    var s = iframeScale(iframeEl);
    return { left: s.rect.left + localRect.left * s.sx, top: s.rect.top + localRect.top * s.sy, width: localRect.width * s.sx, height: localRect.height * s.sy };
  }

  // 画板内容是跨文档的 <iframe>（见 buildFrame），点在里面的 click 只在那个子文档内部冒泡，
  // 过不了 iframe 边界——分享菜单/缩放菜单这类"点外面关闭"的 [hidden] 菜单，
  // 各自那份 document.addEventListener("click", ...) 收不到画板内部的点击，菜单就关不掉。画板
  // 那侧的 sizeReportScript（core/preview.js）已经会把点击转发成 protoflow-canvas-pointer-click
  // 消息（原本给取色器 canvasPicker.js 用），这里补一份公共注册表：谁开了这类菜单，就把它的
  // close 函数登记进来，收到这条消息统一关一遍——不用每个菜单各写一份 message 监听器。
  var menusToCloseOnFrameClick = [];
  function closeOnFrameClick(closeFn){ menusToCloseOnFrameClick.push(closeFn); }
  // 独立开一个 message 监听器，不往 boot() 里现有的尺寸上报/手势转发那个分发逻辑加分支——
  // 跟取元素工具（setupElementPicker）同一个理由：以后要整个移除"点画板关菜单"这个行为，
  // 改动范围不该牵扯到 boot() 本体。
  window.addEventListener("message", function(e){
    if (e.data && e.data.type === "protoflow-canvas-pointer-click") menusToCloseOnFrameClick.forEach(function(fn){ fn(); });
  });

  var routeMatch = new RegExp("^/p/([^/]+)/").exec(location.pathname);
  var routeKey = routeMatch ? routeMatch[1] : null;
  // 导出模式不认服务端那套状态路由——取景已经内联成 __PF_CANVAS_STATE__，也没有地方可存；
  // 连字符串都不提，免得单文件里留着一段指向 protoflow 预览服务的死路径。
  ${exportMode ? "var STATE_FILE_URL = null, STATE_SAVE_URL = null;" : `var STATE_FILE_URL = routeKey ? "/p/" + routeKey + "/.protoflow/canvas.json" : null;
  var STATE_SAVE_URL = routeKey ? "/p/" + routeKey + "/__protoflow_state/canvas" : null;`}

  var uiState = { annotationArtboard: null, activePage: null, pages: {}, artboardHeights: {} };
  var saveTimer = null;
  function scheduleSave(){
    if (!STATE_SAVE_URL) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){
      fetch(STATE_SAVE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(uiState) }).catch(function(){});
    }, 500);
  }

  function setupPage(pageEl, savedViewport){
    var viewport = pageEl.querySelector(".pf-viewport");
    var canvas = pageEl.querySelector(".pf-canvas");
    var zoomLabel = pageEl.querySelector(".pf-zoom-label");
    var pageId = pageEl.getAttribute("data-page");
    var state = { x: 0, y: 0, scale: 1 };
    var interactTimer = null;

    // will-change:transform 只在真的缩放/拖拽的过程中才挂——之前是写死在 CSS 里的静态样式，
    // 永久挂着的话，浏览器会把这块内容提升成一个 GPU 合成层，缩放时直接拉伸这个层已经画好的
    // 贴图（省算力，但糊），停下来之后也不一定会自己重新按真实缩放比例画一遍；画板还是 iframe，
    // 内容更容易被当成一张不透明贴图对待，糊了会一直糊着，不会自愈。这里改成每次 apply() 就
    // 先挂上这个 class，闲置 250ms（连续滚轮/捏合时会不断被重置，只有真正停手后才会触发）后
    // 自动摘掉，逼浏览器在空闲时把内容按当前缩放比例重新画一遍。
    function apply(){
      canvas.style.transform = "translate3d(" + state.x + "px," + state.y + "px,0) scale(" + state.scale + ")";
      zoomLabel.textContent = Math.round(state.scale * 100) + "%";
      canvas.classList.add("pf-interacting");
      clearTimeout(interactTimer);
      interactTimer = setTimeout(function(){ canvas.classList.remove("pf-interacting"); }, 250);
    }

    function persistViewport(){
      uiState.pages[pageId] = { scale: state.scale, x: state.x, y: state.y };
      scheduleSave();
    }

    // 以 (clientX,clientY) 为锚点，按 factor 缩放当前画布——锚点在视觉上保持不动。
    function zoomAt(clientX, clientY, factor){
      var rect = viewport.getBoundingClientRect();
      var px = clientX - rect.left, py = clientY - rect.top;
      var next = clamp(state.scale * factor, ZOOM_MIN, ZOOM_MAX);
      var k = next / state.scale;
      state.x = px - (px - state.x) * k;
      state.y = py - (py - state.y) * k;
      state.scale = next;
      apply();
      persistViewport();
    }

    function fit(){
      var cw = canvas.scrollWidth, ch = canvas.scrollHeight;
      if (!cw || !ch) return;
      var vw = viewport.clientWidth, vh = viewport.clientHeight;
      state.scale = clamp(Math.min(vw / cw, vh / ch) * 0.92, 0.05, 1);
      state.x = (vw - cw * state.scale) / 2;
      state.y = (vh - ch * state.scale) / 2;
      apply();
    }

    var isGesturing = false, gestureBase = 1;

    // 抽成独立函数：既服务于本页 viewport 上直接发生的 wheel 事件，也服务于从内嵌画板 iframe
    // 转发过来的 wheel 手势（见 handleGestureMessage）——两条路径共享同一套判定逻辑，行为一致。
    function handleWheelLike(deltaX, deltaY, deltaMode, ctrlKey, clientX, clientY){
      if (isGesturing) return;
      if (ctrlKey) zoomAt(clientX, clientY, Math.exp(-deltaY * 0.01));
      else if (isMouseWheel({ deltaMode: deltaMode, deltaX: deltaX, deltaY: deltaY })) zoomAt(clientX, clientY, Math.exp(-Math.sign(deltaY) * 0.18));
      else { state.x -= deltaX; state.y -= deltaY; apply(); persistViewport(); }
    }

    viewport.addEventListener("wheel", function(e){
      e.preventDefault();
      handleWheelLike(e.deltaX, e.deltaY, e.deltaMode, e.ctrlKey || e.metaKey, e.clientX, e.clientY);
    }, { passive: false });

    // Safari 触控板捏合不产生 wheel 事件，走这三个私有手势事件；必须显式接管 + preventDefault，
    // 否则浏览器会执行原生整页缩放（连顶栏一起放大——这正是要修的问题）。
    viewport.addEventListener("gesturestart", function(e){ e.preventDefault(); isGesturing = true; gestureBase = state.scale; });
    viewport.addEventListener("gesturechange", function(e){ e.preventDefault(); zoomAt(e.clientX, e.clientY, (gestureBase * e.scale) / state.scale); });
    viewport.addEventListener("gestureend", function(e){ e.preventDefault(); isGesturing = false; });

    // 供内嵌画板 iframe 转发手势时调用（见 handleGestureMessage）——iframe 是独立浏览上下文，
    // 它自己的 wheel/gesture 事件不会冒泡到这个文档，必须靠 postMessage 桥接，再复用上面同一套
    // handleWheelLike / zoomAt，让"光标停在画板内容上"和"停在画布空白处"的缩放平移体验一致。
    pageEl.__pfGesture = {
      wheel: function(p){ handleWheelLike(p.deltaX, p.deltaY, p.deltaMode, p.ctrlKey, p.clientX, p.clientY); },
      gestureStart: function(p){ isGesturing = true; gestureBase = state.scale; },
      gestureChange: function(p){ zoomAt(p.clientX, p.clientY, (gestureBase * p.scale) / state.scale); },
      gestureEnd: function(){ isGesturing = false; },
    };

    var dragging = false, moved = false, startX, startY, startPX, startPY;
    viewport.addEventListener("mousedown", function(e){
      if (e.button !== 0) return;
      dragging = true; moved = false; startX = e.clientX; startY = e.clientY; startPX = state.x; startPY = state.y;
    });
    window.addEventListener("mousemove", function(e){
      if (!dragging) return;
      if (!moved) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 3) return;
        moved = true; viewport.classList.add("pf-grabbing"); canvas.classList.add("pf-panning");
      }
      state.x = startPX + (e.clientX - startX); state.y = startPY + (e.clientY - startY); apply();
    });
    window.addEventListener("mouseup", function(){
      if (dragging && moved) persistViewport();
      dragging = false; viewport.classList.remove("pf-grabbing"); canvas.classList.remove("pf-panning");
    });

    var center = function(){ var r = viewport.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    pageEl.querySelector(".pf-zoom-out").onclick = function(){ var c = center(); zoomAt(c[0], c[1], 1 / 1.2); };
    pageEl.querySelector(".pf-zoom-in").onclick = function(){ var c = center(); zoomAt(c[0], c[1], 1.2); };
    pageEl.querySelector(".pf-zoom-reset").onclick = function(){ var c = center(); zoomAt(c[0], c[1], 1 / state.scale); };
    pageEl.querySelector(".pf-zoom-fit").onclick = function(){ fit(); persistViewport(); };

    // 工具栏只常驻显示当前缩放百分比，点它才展开菜单（放大/缩小/100%/自适应）——点外面或按 ESC
    // 收起；菜单里的按钮点了不自动收起（放大/缩小经常要连点好几下，每点一次就收起反而麻烦）。
    var zoomMenu = pageEl.querySelector(".pf-zoom-menu");
    zoomLabel.addEventListener("click", function(e){
      e.stopPropagation();
      zoomMenu.hidden = !zoomMenu.hidden;
    });
    document.addEventListener("click", function(e){
      if (!zoomMenu.hidden && !zoomMenu.contains(e.target) && e.target !== zoomLabel) zoomMenu.hidden = true;
    });
    document.addEventListener("keydown", function(e){
      if (e.key === "Escape" && !zoomMenu.hidden) zoomMenu.hidden = true;
    });
    closeOnFrameClick(function(){ zoomMenu.hidden = true; });

    apply();
    pageEl.__pfFit = fit;
    // 供取元素工具"定位"用（见 setupElementPicker 的 locateSelection）：把一个已知的屏幕坐标矩形
    // 平移到视口正中央，只平移不缩放。screenRect 是调用方已经算好的屏幕坐标（比如 toScreenRect
    // 的返回值），这里只管布局数学，不关心是谁在用——是"平移视口"这个通用能力，不是取元素工具的
    // 私有逻辑，跟 __pfFit/__pfGesture/__pfOnSize 是同一类对外暴露的钩子。
    pageEl.__pfPanToScreenRect = function(screenRect){
      var vRect = viewport.getBoundingClientRect();
      var cx = screenRect.left + screenRect.width / 2 - vRect.left;
      var cy = screenRect.top + screenRect.height / 2 - vRect.top;
      state.x += viewport.clientWidth / 2 - cx;
      state.y += viewport.clientHeight / 2 - cy;
      apply();
      persistViewport();
    };

    if (savedViewport) {
      // 有存量视角（上次关闭前存的）：直接套用，不用等真实高度、不用 fit()，立刻露出。
      state.scale = savedViewport.scale; state.x = savedViewport.x; state.y = savedViewport.y;
      apply();
      pageEl.classList.remove("pf-loading");
      return;
    }

    // 没有存量视角（第一次打开这个页面）：等每块有真实预览的画板都上报过一次真实高度（见
    // core/preview.js 的 sizeReportScript）再 fit()+显示，避免"先按占位高度画一帧，稍后又跳到
    // 正确缩放"的闪烁；算出来之后顺手存一份，下次打开就有存量视角了，不用再等这一趟。
    //
    // 首次 fit 仍在选中页面时启动，避免把画板尚未渲染完成的占位高度持久化。
    // hidden 页面用 visibility:hidden 保留布局，供 Mermaid/SVG 在后台测量；切出时再通过
    // __pfEnsureFit 请求最新尺寸，不依赖后台已经结束的定时上报，也不重载画板。
    var pendingIds = null, pendingCount = 0, revealed = false, waiting = false;
    function revealOnce(){
      if (revealed) return;
      revealed = true;
      fit();
      pageEl.classList.remove("pf-loading");
      persistViewport();
    }
    function startWaiting(){
      if (revealed || waiting) return;
      waiting = true;
      var iframes = pageEl.querySelectorAll(".pf-frame__box iframe");
      pendingIds = {};
      iframes.forEach(function(f){
        var fr = f.closest(".pf-frame");
        if (fr) pendingIds[fr.getAttribute("data-artboard")] = true;
      });
      pendingCount = Object.keys(pendingIds).length;
      if (pendingCount === 0) { revealOnce(); return; }
      iframes.forEach(function(f){
        try { f.contentWindow.postMessage({ type: "protoflow-request-size" }, "*"); } catch (e) {}
      });
      pageEl.__pfOnSize = function(artboardId){
        if (!pendingIds[artboardId]) return;
        delete pendingIds[artboardId];
        pendingCount--;
        if (pendingCount <= 0) revealOnce();
      };
      setTimeout(revealOnce, 1000); // 兜底：极端情况下某块画板没能上报，最多等 1s 也要露出来
    }
    pageEl.__pfEnsureFit = startWaiting;
    if (!pageEl.hidden) startWaiting();
  }

  function boot(loaded){
    uiState = Object.assign({ annotationArtboard: null, activePage: null, pages: {}, artboardHeights: {} }, loaded || {});
    if (!uiState.pages) uiState.pages = {};
    if (!uiState.artboardHeights) uiState.artboardHeights = {};

    // 按画板等待首次有效高度，独立于页面的保存视角与首次 fit。
    // 加载失败时仍露出原始错误/空白页，避免永久遮住画板。
    document.querySelectorAll('.pf-frame[data-pf-loading]').forEach(function(frame){
      frame.__pfLoadingTimer = setTimeout(function(){ frame.removeAttribute('data-pf-loading'); }, 10000);
    });

    document.querySelectorAll(".pf-page-canvas").forEach(function(pageEl){
      setupPage(pageEl, uiState.pages[pageEl.getAttribute("data-page")]);
    });

    // 全局兜底：无条件拦截缩放手势的浏览器默认行为，不管事件落在画布、工具栏（在 DOM 上是画布
    // 的兄弟节点，视觉上会与画布重叠，但事件不会经过画布节点冒泡）还是顶栏——否则那些区域的
    // 捏合/Ctrl+滚轮会缩放整个标签页，连顶栏一起放大。真正驱动某个画布缩放的逻辑仍由上面各自
    // 的 viewport 监听器负责（该监听器在事件冒泡链上更靠近目标，会先于这里执行）；这里的监听器
    // 只是兜底，重复 preventDefault 无副作用。
    document.addEventListener("wheel", function(e){ if (e.ctrlKey || e.metaKey) e.preventDefault(); }, { passive: false });
    ["gesturestart", "gesturechange", "gestureend"].forEach(function(type){
      document.addEventListener(type, function(e){ e.preventDefault(); });
    });

    window.addEventListener("message", function(e){
      var d = e.data;
      if (!d) return;
      if (d.type === "protoflow-preview-size") {
        var frame = document.querySelector('.pf-frame[data-artboard="' + d.artboardId + '"]');
        var iframe = frame && frame.querySelector("iframe");
        var pageEl2 = frame && frame.closest(".pf-page-canvas");
        if (!iframe || e.source !== iframe.contentWindow || !Number.isFinite(d.height) || d.height <= 0) return;
        // 声明了固定高度的画板（data-pf-fixed-h，见 buildFrame）不接受自动撑高——内容比声明值高就
        // 交给 iframe 默认的内部滚动条，矮就留白，都不去改 iframe.style.height。只清 loading 状态，
        // 不 return：下面的缓存回写对固定高度画板没有意义（它的高度来源是 agent 声明，不是测量），
        // 也一起跳过。
        if (frame.hasAttribute("data-pf-fixed-h")) {
          if (!(pageEl2 && pageEl2.hidden)) { clearTimeout(frame.__pfLoadingTimer); frame.removeAttribute('data-pf-loading'); }
          if (pageEl2 && pageEl2.__pfOnSize) pageEl2.__pfOnSize(d.artboardId);
          annOnFrameSettled(d.artboardId);
          return;
        }
        // 页面还 hidden 时收到的高度不能拿来改 iframe.style.height——画板如果用 100vh 这类
        // 视口相对单位布局（很常见的整页 App 截图），它的"真实高度"本来就是照着 iframe 当前
        // 的高度算出来的：这时候把 iframe 压到一个几十像素的假高度，画板会真的按这个假高度重排，
        // 之后哪怕页面可见了再问一遍，量出来的还是这个（现在真实存在的）小高度——不是脏数据没
        // 刷新，是量出来的答案本身已经被污染了，越问越坐实，request-size 这一步救不回来。索性
        // 干脆不让 hidden 状态下的上报碰 iframe 尺寸，保持建页面时给的占位高度（够大，见 buildFrame
        // 的 width*0.72）不动，等页面真的可见、量出来的数据才可信时再写进去。
        if (iframe && !(pageEl2 && pageEl2.hidden)) {
          // 上限只是兜底（真正打断回环靠 preview.js 的 sizeReportScript 自己识别），万一将来
          // 冒出这套识别逻辑没覆盖到的别的回环模式，也不至于把 iframe 撑到几万像素高把标签页拖垮。
          var appliedHeight = Math.max(80, Math.min(d.height, 20000));
          iframe.style.height = appliedHeight + "px";
          clearTimeout(frame.__pfLoadingTimer);
          frame.removeAttribute('data-pf-loading');
          // 自愈式缓存：把这次量到的真实高度记下来，下次这块画板加载时直接当初始高度用（见
          // buildFrame 的 opts.heightCache），不用再从 width*0.72 的占位猜起——跟 scheduleSave
          // 共用同一份节流（500ms），不单独开一条写盘路径。只在测量值真的变了才标记保存，避免
          // 每次挂载都无意义地触发一次 fetch。
          if (uiState.artboardHeights[d.artboardId] !== appliedHeight) {
            uiState.artboardHeights[d.artboardId] = appliedHeight;
            scheduleSave();
          }
        }
        if (pageEl2 && pageEl2.__pfOnSize) pageEl2.__pfOnSize(d.artboardId);
        annOnFrameSettled(d.artboardId);
        return;
      }
      if (d.type === "protoflow-canvas-gesture") handleGestureMessage(d);
    });

    // 把内嵌画板 iframe 转发来的手势坐标（相对该 iframe 自身视口）换算成父文档的屏幕坐标，
    // 再转交给那个画板所在页面的 __pfGesture 处理——since iframe 本身随父画布一起被
    // transform:scale() 视觉缩放，用 getBoundingClientRect() 拿到的是当前实际渲染的屏幕位置，
    // 按渲染尺寸与 iframe 自身逻辑尺寸的比例换算即可得到正确的父文档坐标（用于 zoomAt 锚点）。
    function handleGestureMessage(d){
      var frame = document.querySelector('.pf-frame[data-artboard="' + d.artboardId + '"]');
      var iframeEl = frame && frame.querySelector("iframe");
      var pageEl = frame && frame.closest(".pf-page-canvas");
      if (!iframeEl || !pageEl || !pageEl.__pfGesture) return;
      // clientX/clientY 是像素坐标，需要按当前视觉缩放比例换算成父文档坐标（见 toParentPoint）；
      // deltaX/deltaY 反映的是触控板/滚轮的物理输入速度，与页面缩放无关，原样透传即可——两者是
      // 不同性质的量，不能同一套系数。
      var p = toParentPoint(iframeEl, d.clientX, d.clientY);
      var g = pageEl.__pfGesture;
      if (d.kind === "wheel") g.wheel({ deltaX: d.deltaX, deltaY: d.deltaY, deltaMode: d.deltaMode, ctrlKey: d.ctrlKey, clientX: p.x, clientY: p.y });
      else if (d.kind === "gesturestart") g.gestureStart();
      else if (d.kind === "gesturechange") g.gestureChange({ scale: d.scale, clientX: p.x, clientY: p.y });
      else if (d.kind === "gestureend") g.gestureEnd();
    }

    // 切页面只是切 hidden；每个页面自己的首次露出/fit() 由 setupPage() 里那套等真实高度上报的
    // 逻辑负责。画板 iframe 不带 loading="lazy" 了（见 buildFrame 的注释——它跟画布的 CSS
    // transform:scale() 打架，会导致偶发的"打开显示不全"），所以现在**所有页面**的画板都在
    // 首屏一起开始加载，不只是当前可见那页——如果项目页面/画板特别多、首屏因此变重，值得再加一层
    // "只给当前页面的画板设 src，切页面时才补上"的按页面懒加载，跟这里的 loading="lazy" 是两回事，
    // 不受 transform 影响；这次先只解决"看不全"这个正确性问题，没做这层优化。
    var buttons = document.querySelectorAll(".pf-page-item");
    var pages = document.querySelectorAll(".pf-page-canvas");
    var annReflect = function(){}; // 由下面 setupAnnotations 覆盖：标注视图打开时，切页要跟着换列表
    var annOnFrameSettled = function(){}; // 由 setupAnnotations 覆盖：某画板首帧尺寸上报后重渲染列表
    var pgselName = document.querySelector(".pf-pgsel-name");
    function switchToPage(id){
      buttons.forEach(function(b){
        var on = b.getAttribute("data-page") === id;
        b.classList.toggle("active", on);
        if (on && pgselName) pgselName.textContent = b.textContent;
      });
      pages.forEach(function(p){
        var show = p.getAttribute("data-page") === id;
        p.hidden = !show;
        // 页面从 hidden 切到可见：如果它还没走完首次 fit()（见 setupPage 里 __pfEnsureFit 的
        // 注释），请求画板最新尺寸，启动那套「等真实高度再 fit()」的流程。已经 fit
        // 过的页面这里是空操作（__pfEnsureFit 内部会自己判断），不会打断用户已经手动调整过的视角。
        if (show && p.__pfEnsureFit) p.__pfEnsureFit();
        // 高度同步独立于首次 fit：已有保存视角/已经 fit 的页面也可能错过隐藏期间的尺寸上报。
        // 只重新测量，不重载 iframe、不重置用户缩放或交互状态。
        if (show) p.querySelectorAll(".pf-frame__box iframe").forEach(function(f){
          try { f.contentWindow.postMessage({ type: "protoflow-request-size" }, "*"); } catch (e) {}
        });
      });
      annReflect(id);
    }
    buttons.forEach(function(btn){
      btn.addEventListener("click", function(){
        var id = btn.getAttribute("data-page");
        switchToPage(id);
        uiState.activePage = id;
        scheduleSave();
      });
    });
    // 当前选中哪个页面也要持久化，跟每页视角是同一份 .protoflow/canvas.json——
    // 回归测试的教训：漏了这块状态，用户刷新页面后总是弹回第一个页面，即便之前明明切到了别的页面。
    // uiState.activePage 指向的页面 id 可能已经被删掉，先确认它还在当前页面列表里再切，不盲目信。
    if (uiState.activePage && document.querySelector('.pf-page-item[data-page="' + uiState.activePage + '"]')) {
      switchToPage(uiState.activePage);
    }

    // 顶栏页面切换：按钮开合页面列表，点列表里的页（上面 buttons 的 click）切过去后收起。
    // 画板是跨文档的 iframe，点画板收不到 document 的 click，走 closeOnFrameClick 一起关。
    var pgsel = document.querySelector(".pf-pgsel");
    if (pgsel) {
      var pgselBtn = pgsel.querySelector(".pf-pgsel-btn");
      var pgselMenu = pgsel.querySelector(".pf-pgsel-menu");
      var setPgselOpen = function(open){
        pgselMenu.hidden = !open;
        pgselBtn.setAttribute("aria-expanded", open ? "true" : "false");
      };
      pgselBtn.addEventListener("click", function(e){ e.stopPropagation(); setPgselOpen(pgselMenu.hidden); });
      buttons.forEach(function(b){ b.addEventListener("click", function(){ setPgselOpen(false); }); });
      document.addEventListener("click", function(e){ if (!pgselMenu.hidden && !pgsel.contains(e.target)) setPgselOpen(false); });
      document.addEventListener("keydown", function(e){ if (e.key === "Escape") setPgselOpen(false); });
      closeOnFrameClick(function(){ setPgselOpen(false); });
    }

    // 所有图标按钮统一走自定义 tooltip（不用原生 title——原生 title 弹出延迟长、样式没法控，图标
    // 按钮没有文字标签更需要一个反应快、看得清的提示）：顶部小工具栏的三个按钮 + 每块画板悬浮出来
    // 的"新标签页打开"/"查看标注"按钮，共用同一个 tooltip 元素，事件委托到 document 上，不用给
    // 每个按钮各挂一份监听器，以后再加新的图标按钮也只用给它加个 data-tip 属性，不用碰这段逻辑。
    var TIP_SELECTOR = ".pf-mode-toolbar button, .pf-frame__label a, .pf-frame__label button";
    var tipEl = document.createElement("div");
    tipEl.className = "pf-mode-tooltip";
    document.body.appendChild(tipEl);
    document.addEventListener("mouseover", function(e){
      var btn = e.target.closest(TIP_SELECTOR);
      if (!btn) return;
      var text = btn.getAttribute("data-tip");
      if (!text) return;
      var r = btn.getBoundingClientRect();
      tipEl.textContent = text;
      tipEl.style.left = (r.right + 8) + "px";
      tipEl.style.top = (r.top + r.height / 2) + "px";
      tipEl.classList.add("pf-mode-tooltip--show");
    });
    document.addEventListener("mouseout", function(e){
      if (e.target.closest(TIP_SELECTOR)) tipEl.classList.remove("pf-mode-tooltip--show");
    });

    setupAnnotations();

    document.documentElement.classList.remove("pf-loading");
    // 导出模式：取元素工具不装（工具栏 HTML 也没生成，看的人用不上）；「导出」按钮同理只在实时
    // 预览里挂。项目切换和同项目其它产物的入口在框架层的项目侧边栏里（core/projectNav.js，由本地
    // 服务注入），不归画布管。
    if (!__PF_EXPORT__) {
      setupElementPicker();
      setupExport();
      setupVersions();
    }

    // ---- 标注视图（整段随 .pf-anns 样式一起可删）：每块画板悬浮出来的「标注」按钮（新标签页图标
    // 旁）点一下，画布右侧展开标注面板，渲染**这块画板**的 annotations.md。列表数据
    // pf-ann-data 在父文档渲染成文本 + 元素引用 chip；点 chip 定位、悬停整条批量淡描边，都由画板
    // iframe 的 ANNOTATION_OVERLAY 负责（core/preview.js 的 sizeReportScript 同一批脚本）。
    // 父文档跟画板 iframe 的交互全走 postMessage（见下面 locate/highlight/clearHighlights），
    // 不直接摸 contentWindow/contentDocument——画板可能是同源的 <iframe src=...>，也可能是单
    // HTML 导出里的 <iframe srcdoc=...>，两种情况用同一份代码，不分场景判断。----
    function setupAnnotations(){
      var DATA = {};
      var dataEl = document.getElementById("pf-ann-data");
      try { DATA = JSON.parse(dataEl.textContent) || {}; } catch (e) {}
      var annNav = document.querySelector(".pf-anns");
      var annBtns = document.querySelectorAll(".pf-frame__annotate");
      if (!annNav) return;

      // 拍平成 { 画板id: { pageId, name, md, refs } }
      var byAb = {};
      Object.keys(DATA).forEach(function(pid){
        (DATA[pid] || []).forEach(function(ab){
          byAb[ab.artboardId] = { pageId: pid, name: ab.artboardName, md: ab.md, refs: ab.refs || {} };
        });
      });

      function activePageId(){
        var el = document.querySelector(".pf-page-canvas:not([hidden])");
        return el ? el.getAttribute("data-page") : null;
      }
      function pageEl(id){ return document.querySelector('.pf-page-canvas[data-page="' + id + '"]'); }
      function frameIframe(pgEl, artboardId){
        var sel = '.pf-frame[data-artboard="' + (window.CSS && CSS.escape ? CSS.escape(artboardId) : artboardId) + '"]';
        var fr = pgEl && pgEl.querySelector(sel);
        return fr ? fr.querySelector("iframe") : null;
      }
      // 跟画板 iframe 的全部交互走 postMessage，不直接读/调 contentWindow、contentDocument——
      // 画板用的是 <iframe src=...>（不是 srcdoc），导出后可能被放进跨源的 file:// 环境，直接
      // 摸子文档会被 SecurityError 拦下；发消息这一步不受跨源限制，今天的同源 dev server 和
      // 导出后的跨源 file:// 走同一份代码，不用分场景判断。
      function iwin(ifr){ try { return ifr && ifr.contentWindow; } catch (e) { return null; } }

      // 断链检测：这块画板文档里还有没有这些元素 id，只能问它自己（postMessage 一来一回），不能
      // 同步跨源读。按 abId 记住这一轮渲染出的 chip，回执到了才补 --broken 类；这期间又切换/
      // 重渲染了（pendingBrokenCheck[abId] 已经指向新的一份或被删掉），旧回执直接丢弃。
      var pendingBrokenCheck = {};
      window.addEventListener("message", function(e){
        var d = e.data;
        if (!d || d.type !== "protoflow-annotation-check-ids-reply") return;
        var pending = pendingBrokenCheck[d.artboardId];
        if (!pending) return;
        delete pendingBrokenCheck[d.artboardId];
        (d.missingIds || []).forEach(function(elId){
          (pending[elId] || []).forEach(function(chip){ chip.classList.add("pf-ann-chip--broken"); });
        });
      });
      function checkBrokenChips(abId, pg, chipsByElId){
        var ids = Object.keys(chipsByElId);
        if (!ids.length) return;
        var w = iwin(frameIframe(pg, abId));
        if (!w) return;
        pendingBrokenCheck[abId] = chipsByElId;
        try { w.postMessage({ type: "protoflow-annotation-check-ids", ids: ids }, "*"); } catch (e) {}
      }

      // 渲染某一块画板的 annotations.md（本身就是一篇 markdown，## 分区、### 一条说明）。
      // md 里的 [显示名](#el/元素id) 改写成 [显示名](#el/画板id/元素id) 供定位，refs 收进一张查找表。
      function renderList(abId){
        annNav.innerHTML = "";
        var entry = byAb[abId];
        if (!entry) {
          var empty = document.createElement("div");
          empty.className = "pf-anns__empty";
          empty.textContent = "这块画板还没有标注。";
          annNav.appendChild(empty);
          return;
        }
        var pid = entry.pageId, pg = pageEl(pid);

        var head = document.createElement("div");
        head.className = "pf-anns__head";
        var name = document.createElement("span");
        name.textContent = entry.name;
        var closeBtn = document.createElement("button");
        closeBtn.className = "pf-anns__close";
        closeBtn.setAttribute("aria-label", "关闭标注");
        closeBtn.textContent = "\\u00d7";
        closeBtn.addEventListener("click", function(){ setOpen(null); });
        head.appendChild(name);
        head.appendChild(closeBtn);
        annNav.appendChild(head);

        var refPath = {};   // "画板id\\x00元素id" -> interactionPath
        var chipsByElId = {}; // 这次渲染出的 chip，按元素 id 分组——断链回执异步回来时按 id 找回它们
        var src = String(entry.md || "").replace(/(\\]\\(#el\\/)([^)\\s]+)(\\))/g, function(_, p1, elId, p3){
          if (entry.refs[elId] && entry.refs[elId].interactionPath) refPath[abId + "\\x00" + elId] = entry.refs[elId].interactionPath;
          return p1 + abId + "/" + elId + p3;
        });
        var box = document.createElement("div");
        box.className = "pf-ann-md";
        try { box.innerHTML = window.marked ? marked.parse(src) : src.replace(/[<>&]/g, function(c){ return { "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]; }); }
        catch (e) { box.textContent = src; }
        box.querySelectorAll('a[href^="#el/"]').forEach(function(a){
          var rest = a.getAttribute("href").slice(4);
          var slash = rest.indexOf("/");
          var elId; try { elId = decodeURIComponent(rest.slice(slash + 1)); } catch (e) { elId = rest.slice(slash + 1); }
          var chip = document.createElement("span");
          // 断链状态要问子文档才知道（见 checkBrokenChips），先按"正常"渲染，核实完再补 --broken。
          chip.className = "pf-ann-chip";
          chip.textContent = a.textContent || ("#" + elId);
          chip.addEventListener("click", function(e){ e.stopPropagation(); locate(pid, abId, elId, refPath[abId + "\\x00" + elId]); });
          chip.addEventListener("mouseenter", function(){ highlight(pid, abId, [elId]); });
          chip.addEventListener("mouseleave", function(){ clearHighlights(); });
          a.replaceWith(chip);
          (chipsByElId[elId] = chipsByElId[elId] || []).push(chip);
        });
        // 普通链接（marked 自动识别的裸 URL 等）新标签页打开，别在面板里导航走
        box.querySelectorAll("a").forEach(function(a){ a.target = "_blank"; a.rel = "noopener"; });
        annNav.appendChild(box);
        checkBrokenChips(abId, pg, chipsByElId);
      }

      // 点 chip：把画布平移到那个元素所在画板的整块框（跨源读不到元素本身在子文档里的坐标，退而
      // 求其次带入整块画板；画板收到 flash 消息后会在它自己文档内部 scrollIntoView 到具体元素、
      // 就地闪一下，见 core/preview.js 的 ANNOTATION_OVERLAY）。
      function locate(pageId, artboardId, elId, path){
        var pg = pageEl(pageId);
        var ifr = frameIframe(pg, artboardId);
        if (!ifr) return;
        var w = iwin(ifr);
        if (pg && pg.__pfPanToScreenRect) pg.__pfPanToScreenRect(toScreenRect(ifr, { left: 0, top: 0, width: ifr.clientWidth, height: ifr.clientHeight }));
        if (w) { try { w.postMessage({ type: "protoflow-annotation-flash", elId: elId, path: path }, "*"); } catch (e) {} }
      }
      function highlight(pageId, artboardId, ids){
        var w = iwin(frameIframe(pageEl(pageId), artboardId));
        if (w) { try { w.postMessage({ type: "protoflow-annotation-highlight", ids: ids }, "*"); } catch (e) {} }
      }
      function clearHighlights(){
        document.querySelectorAll(".pf-frame__box iframe").forEach(function(ifr){
          var w = iwin(ifr);
          if (w) { try { w.postMessage({ type: "protoflow-annotation-clear" }, "*"); } catch (e) {} }
        });
      }

      var currentAb = null;   // 当前在面板里展开标注的画板 id；null = 关闭
      function syncBtns(){
        annBtns.forEach(function(b){
          var fr = b.closest(".pf-frame");
          b.classList.toggle("is-active", !!currentAb && fr && fr.getAttribute("data-artboard") === currentAb);
        });
      }
      function setOpen(abId){
        currentAb = abId || null;
        document.documentElement.classList.toggle("pf-ann-open", !!currentAb);
        syncBtns();
        if (currentAb) {
          renderList(currentAb);
        } else {
          annNav.innerHTML = "";
          clearHighlights();
        }
        uiState.annotationArtboard = currentAb;
        scheduleSave();
      }
      annBtns.forEach(function(b){
        b.addEventListener("click", function(e){
          e.stopPropagation();
          var fr = b.closest(".pf-frame");
          var abId = fr && fr.getAttribute("data-artboard");
          if (!abId) return;
          setOpen(currentAb === abId ? null : abId);
        });
      });

      // 画板 iframe 懒加载，加载晚于 setOpen 时：加载完重渲染（chip 的断链/定位判断要读 iframe 文档）。
      // iframe 的 load 只等到 HTML 到位，里面还要浏览器内 Babel 编译 + React 挂载 #root 才有真实元素，
      // 所以 load 之后再补一次延迟重渲染，避免首屏 chip 全部误判成断链。
      document.querySelectorAll(".pf-frame__box iframe").forEach(function(ifr){
        var fr = ifr.closest(".pf-frame");
        var abId = fr && fr.getAttribute("data-artboard");
        ifr.addEventListener("load", function(){
          if (currentAb && currentAb === abId) {
            renderList(currentAb);
            setTimeout(function(){ if (currentAb === abId) renderList(currentAb); }, 900);
          }
        });
      });
      // 画板首次上报真实高度 = 它的 React 树已挂载，此刻 chip 断链判断才可靠。每块画板只补渲染一次。
      var settled = {};
      annOnFrameSettled = function(artboardId){
        if (!currentAb || currentAb !== artboardId || settled[artboardId]) return;
        settled[artboardId] = true;
        renderList(currentAb);
      };

      // switchToPage 里调：切页后当前展开的画板已不在可见页面里，直接收起标注视图。
      annReflect = function(){ if (currentAb) setOpen(null); };

      // 恢复上次：只有目标画板还在、且就在当前可见页面时才重开
      var want = uiState.annotationArtboard;
      if (want && byAb[want] && byAb[want].pageId === activePageId()) setOpen(want);
    }
  }

  ${exportDownloadScript()}

  // 「导出」：点按钮弹出格式菜单（[hidden] 开合），选一行才真正
  // POST /p/<key>/__protoflow_export/canvas/<canvasId>/<formatId>，回一份文件（zip 目录树或单 HTML）——
  // 用户自己在另存为对话框里选存哪，不是我们定一个固定路径。routeKey 复用上面 boot() 那份。
  // 版本下拉：跟文档阅读页（core/docPreview.js 的 updateBar）同一套——最新版不带参数，历史版本
  // ?v=<n>，新的在上，当前版本后面一个黑点。画布的各版本由服务端渲染，所以切换是整页跳转，
  // 不像文档那样页内重渲染。数据在 #pf-versions（没定过版就没有这个控件）。
  function setupVersions(){
    var box = document.querySelector(".pf-vsel");
    var dataEl = document.getElementById("pf-versions");
    if (!box || !dataEl) return;
    var D = {};
    try { D = JSON.parse(dataEl.textContent) || {}; } catch (e) { return; }
    var btn = box.querySelector(".pf-vsel-btn");
    var menu = box.querySelector(".pf-vsel-menu");
    function esc(x){ return String(x == null ? "" : x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
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
    (D.versions || []).slice().sort(function(a, b){ return b.n - a.n; }).forEach(function(v){
      var a = document.createElement("a");
      a.className = "pf-vsel-item" + (v.n === D.current ? " active" : "");
      a.href = v.n === D.head ? location.pathname : location.pathname + "?v=" + v.n;
      var sub = "v" + v.n; var r = rel(v.builtAt); if (r) sub += " · " + r;
      if (v.n === D.current) sub += '<span class="pf-vsel-dot" title="当前"></span>';
      // 跟文档阅读页同一个写法：第一行版本说明，第二行版本号 + 时间
      if (v.note) a.title = v.note;
      a.innerHTML = '<span class="t">' + esc(v.note || D.title) + '</span><span class="s">' + sub + '</span>';
      menu.appendChild(a);
    });
    function setOpen(open){
      if (open) {
        var r = btn.getBoundingClientRect();
        menu.style.left = r.left + "px";
        menu.style.top = (r.bottom + 4) + "px";
      }
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    btn.addEventListener("click", function(e){ e.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener("click", function(e){ if (!menu.hidden && !box.contains(e.target)) setOpen(false); });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape") setOpen(false); });
    closeOnFrameClick(function(){ setOpen(false); });
  }

  function setupExport(){
    var entry = document.querySelector(".pf-export-entry");
    if (!entry) return;
    var btn = entry.querySelector(".pf-hdr-share");
    var menu = entry.querySelector(".pf-export-menu");
    if (!routeKey) { btn.disabled = true; btn.title = "仅在 protoflow 预览服务中可导出"; return; }
    btn.addEventListener("click", function(e){ e.stopPropagation(); menu.hidden = !menu.hidden; });
    menu.querySelectorAll(".pf-export-menu__item").forEach(function(item){
      item.addEventListener("click", function(){
        menu.hidden = true;
        __pfDownloadExport("/p/" + routeKey + "/__protoflow_export/canvas/" + encodeURIComponent(${JSON.stringify(canvasId)}) + "/" + item.getAttribute("data-format"), btn);
      });
    });
    document.addEventListener("click", function(e){ if (!menu.hidden && !entry.contains(e.target)) menu.hidden = true; });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape") menu.hidden = true; });
    closeOnFrameClick(function(){ menu.hidden = true; });
  }

  // 取元素工具：见 core/canvasPicker.js（悬浮预览 + 点击插入引用胶囊，独立成文件、整段可删）。
  // 导出模式不带（看的人用不上，也少一处同源依赖）。
  ${exportMode ? "" : ELEMENT_PICKER_SCRIPT}

  ${singleFile ? decompressLibsScript() + injectArtboardLibsScript() : ""}

  if (STATE_FILE_URL) {
    fetch(STATE_FILE_URL).then(function(r){ return r.ok ? r.json() : {}; }).catch(function(){ return {}; }).then(boot);
  } else {
    ${singleFile ? `
    // 单 HTML 导出：库源码（react/react-dom/babel/mermaid/marked）只在文件里压缩存了一份
    // JSON——画板 HTML 里对应位置留的是 __PF_LIB__/xxx 占位路径（见 core/exportCanvasHtml.js），
    // 这里解压出源码，__pfInjectArtboardLibs（core/libCodec.js）把占位标签整段换成内联脚本标签
    // 才赋给 iframe.srcdoc；顺序不能反——boot() 里 setupPage 那套"等画板上报真实高度再 fit()"
    // 要等 srcdoc 真的挂上内容、画板自己的 sizeReportScript 才会跑起来。marked.min.js 是给这份
    // 顶层文档自己用的（标注面板渲染），直接当脚本执行，不用经过 __pfInjectArtboardLibs 那套
    // （那套是给画板 iframe 的 srcdoc 用的）。
    var __pfCompressedLibs = {}, __pfArtboardHtml = {};
    try { __pfCompressedLibs = JSON.parse(document.getElementById("pf-compressed-libs").textContent) || {}; } catch (e) {}
    try { __pfArtboardHtml = JSON.parse(document.getElementById("pf-artboard-html").textContent) || {}; } catch (e) {}
    __pfDecompressLibs(__pfCompressedLibs).then(function(sources){
      document.querySelectorAll(".pf-frame[data-artboard]").forEach(function(frame){
        var abId = frame.getAttribute("data-artboard");
        var raw = __pfArtboardHtml[abId];
        var iframe = frame.querySelector(".pf-frame__box iframe");
        if (raw == null || !iframe) return;
        iframe.srcdoc = __pfInjectArtboardLibs(raw, sources);
      });
      if (sources["marked.min.js"]) {
        var s = document.createElement("script");
        s.text = sources["marked.min.js"];
        document.head.appendChild(s);
      }
      boot((typeof window.__PF_CANVAS_STATE__ === "object" && window.__PF_CANVAS_STATE__) || {});
    });` : `
    // 导出的目录树把取景内联成 window.__PF_CANVAS_STATE__（不 fetch，file:// 也能用）。
    boot((typeof window.__PF_CANVAS_STATE__ === "object" && window.__PF_CANVAS_STATE__) || {});`}
  }
})();`;
}

function buildFrame(pageId, ab, opts = {}) {
  const width = ab.canvasWidth || 1440;
  // 悬浮画板才露出这两个按钮，不常驻占地方；点击 stopPropagation，避免被当成"点了这块画板"
  // 触发取元素工具之类的父级点击逻辑。
  //  - 「新标签页打开」：在新标签打开这块画板的 preview.html。导出模式没必要，去掉。
  //  - 「标注」：仅当这块画板有 annotations.md 时出现，点击在右侧标注面板展开**这块画板**的标注
  //    （见 setupAnnotations）；画板 iframe 只负责定位高亮。
  const openLink = ab.hasSource && !opts.exportMode
    ? `<a class="pf-frame__open" href="${esc(opts.framePrefix || "")}pages/${esc(pageId)}/artboards/${esc(ab.id)}/preview.html" target="_blank" rel="noopener" data-tip="新标签页打开" onclick="event.stopPropagation()">${ICON_EXPAND}</a>`
    : "";
  const annBtn = ab.hasSource && String(ab.annotationsMd || "").trim()
    ? `<button class="pf-frame__annotate" data-tip="标注" onclick="event.stopPropagation()">${ICON_ANNOTATION}</button>`
    : "";
  const label = `<div class="pf-frame__label" style="width:${width}px"><b>${esc(ab.name)}</b><span class="pf-frame__actions">${annBtn}${openLink}</span></div>`;
  if (!ab.hasSource) {
    return `<div class="pf-frame" data-artboard="${esc(ab.id)}">${label}<div class="pf-frame__box pf-frame__empty" style="width:${width}px;height:300px">尚无内容</div></div>`;
  }
  // 初始高度三级兜底：① meta.json 里 agent 显式声明的 canvasHeight（画板要做成固定设备屏时才会
  // 有，超出内容交给下面的 overflow 内部滚动，不再自动撑高）；② opts.heightCache 里这块画板上一次
  // 真实渲染后测量到的高度（见 core/localServer.js 的 __protoflow_state 路由持久化，画布 boot()
  // 时从 .protoflow/canvas.json 读出、测量到新值后节流回写，自愈式缓存，不需要 agent 维护）；
  // ③ 两者都没有（画板从没被渲染测量过）才退回 width*0.72 的纯猜测占位。①②都不是猜测，是真值，
  // 用作初始高度不会引入这次改动本身造成的跳变；跳变只可能来自"内容确实比缓存/声明的值变了"，
  // 那是内容变化本身该反映的正确行为，不是这里要消除的对象。
  const cachedHeight = opts.heightCache && Number.isFinite(opts.heightCache[ab.id]) ? opts.heightCache[ab.id] : null;
  const declaredHeight = Number.isFinite(ab.canvasHeight) ? ab.canvasHeight : null;
  const placeholderHeight = declaredHeight || cachedHeight || Math.round(width * 0.72);
  // 只有 agent 显式声明了 canvasHeight，才把这块画板当"固定尺寸设备屏"：内容超出声明高度时内部
  // 滚动，不再靠 postMessage 上报的真实高度把 iframe 撑高（见下面 setupPage 里对 data-pf-fixed-h
  // 的判断）。cachedHeight 只是"上次测量的真值"当初始占位用，不改变自适应撑高这个默认行为。
  const fixedHeightAttr = declaredHeight ? ` data-pf-fixed-h="${declaredHeight}"` : "";
  // 跟画板 iframe 的全部交互都走 postMessage（见 core/preview.js 的 sizeReportScript /
  // ANNOTATION_OVERLAY 和这个文件的 setupAnnotations），不直接摸 contentWindow/contentDocument——
  // 不管画板是 <iframe src=...>（目录树导出/实时预览）还是 <iframe srcdoc=...>（单 HTML 导出，
  // 见下面 opts.singleFile 分支），跨不跨源都是同一份代码，不用分场景判断。srcdoc 其实天然同源
  // （继承父文档 origin），但没必要为它单独留一条"可以直连"的近路——两条路径分叉越少越好维护。
  //
  // 不带 loading="lazy"：画布靠 CSS transform:scale() 做缩放/平移（见 setupPage 的
  // canvas.style.transform），但浏览器判断"要不要开始加载"看的是元素**没缩放前**的布局位置，
  // 不认 transform——画板一多，靠后的画板在原始布局里可能在视口外几千像素，缩放只是视觉上把它们
  // 挪回可视区域，浏览器的懒加载判定不知道这回事，会认为"离得远"就一直不触发加载，导致偶发的
  // "打开只显示部分内容，刷新才正常"（回归测试：用户反馈过这个现象）。画板资源本来就轻（本地
  // 开发服务或本地文件），不值得为了懒加载那点收益冒这个正确性风险，直接去掉。
  //
  // opts.singleFile（单 HTML 导出专用，core/exportCanvasHtml.js 传）：画板这块 iframe 先留空，
  // 不在这里静态拼 srcdoc——画板 HTML 本身（含 __PF_LIB__/xxx 占位路径，指向 react/react-dom/
  // babel 这些库）连同压缩过的库源码一起，由 buildCanvasHtml 整体嵌成一份 JSON（不用像以前那样
  // 手动转义 "&"/双引号塞进属性值，JSON.stringify 天然处理好这些）。父文档启动脚本解压出库源码、
  // 建好 Blob URL，把画板 HTML 里的占位路径换成真实 blob: URL，这时候才赋给 iframe.srcdoc（见
  // buildScript）——库源码全文件只留一份，不再跟着每块画板重复一份 react/babel。
  if (opts.singleFile) {
    return `<div class="pf-frame" data-artboard="${esc(ab.id)}" data-pf-loading${fixedHeightAttr}>${label}<div class="pf-frame__box"><iframe style="width:${width}px;height:${placeholderHeight}px"></iframe></div></div>`;
  }
  return `<div class="pf-frame" data-artboard="${esc(ab.id)}" data-pf-loading${fixedHeightAttr}>${label}<div class="pf-frame__box"><iframe src="${esc(opts.framePrefix || "")}pages/${esc(pageId)}/artboards/${esc(ab.id)}/preview.html" style="width:${width}px;height:${placeholderHeight}px"></iframe></div></div>`;
}

function buildPageCanvas(page, index, opts = {}) {
  const frames = (page.artboards || []).length
    ? page.artboards.map((ab) => buildFrame(page.id, ab, opts)).join("")
    : `<div class="pf-empty">这个页面还没有画板</div>`;
  // 导出模式：取元素/模式切换不出（看的人用不上，都要活的预览服务撑腰），整条小工具栏都不要；
  // 缩放工具栏保留。
  const modeToolbar = opts.exportMode
    ? ""
    : `
    <div class="pf-mode-toolbar" data-pf-chrome>
      <button class="pf-mode-interact pf-mode-active" data-tip="交互模式">${ICON_INTERACT}</button>
      <button class="pf-mode-select" data-tip="选择模式">${ICON_SELECT}</button>
    </div>`;
  return `<div class="pf-page-canvas pf-loading" data-page="${esc(page.id)}"${index === 0 ? "" : " hidden"}>
    <div class="pf-viewport"><div class="pf-canvas">${frames}</div></div>${modeToolbar}
    <div class="pf-toolbar" data-pf-chrome>
      <button class="pf-zoom-label">100%</button>
      <div class="pf-zoom-menu" hidden>
        <button class="pf-zoom-in">放大</button>
        <button class="pf-zoom-out">缩小</button>
        <div class="pf-zoom-menu__sep"></div>
        <button class="pf-zoom-reset">缩放至 100%</button>
        <button class="pf-zoom-fit">自适应窗口</button>
      </div>
    </div>
  </div>`;
}

// pages: [{ id, name, artboards: [{ id, name, description, hasSource, canvasWidth,
//            annotationsMd, annotationRefs }] }]
//
// exportBundle：渲一次写盘/拼一个字符串而不是实时 serve，跟实时预览是**同一份模板**，只是砍掉
// 取元素/模式工具栏/「导出」这几个纯创作期 UI，以及把取景内联成
// window.__PF_CANVAS_STATE__（导出产物没有 __protoflow_state 端点可 fetch）。两种导出格式：
//   canvasState    导出时的取景 { pages:{id:{scale,x,y}}, activePage }
//   singleFile     core/exportCanvasHtml.js 传 true：单 HTML 导出——画板从 <iframe src=...> 换成
//                  运行时才填内容的 <iframe>（见 buildFrame/buildScript），react/react-dom/
//                  babel(/mermaid)/marked 全项目只压缩内联一份（不是每块画板一份），画板 HTML
//                  里对应位置留的是占位路径，启动脚本解压出源码、建 Blob URL 后再替换进去。
//   artboardHtml   { 画板id: 画板 HTML（含 __PF_LIB__/xxx 占位路径）}，singleFile 时必传
//   compressedLibs { 库文件名: {format, base64} }（core/libCodec.js 产出），singleFile 时必传
// 不带 singleFile（core/exportCanvas.js 传）就是目录树导出：画板仍是 <iframe src=...>、lib/ 仍是
// 真实文件用 <script src> 引，逐字节跟实时预览一样。
const VSEL_CHEV = `<svg class="pf-vsel-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

// versioning = { head, current, versions:[{ n, note, builtAt }] }：画布定过版才有，按钮 = 项目名 + 非最新版时
// 的 vN 小标，菜单由 setupVersions 在浏览器里按相对时间生成（跟文档一样）。
// framePrefix：画板 iframe 地址前缀（看第 n 版时指向那一版的画板，见 core/store.js 的 canvasHtml）。
// canvasId：这个画布的 id（导出按钮按它请求）；libRelPath：lib/ 的相对位置（本地服务 "../../lib"，导出 "lib"）。
export function buildCanvasHtml({ projectName, canvasId = "", pages, exportBundle = null, heightCache = null, framePrefix = "", libRelPath = "lib", versioning = null }) {
  // 页面列表在顶栏的页面切换下拉里（.pf-pgsel）。项目里没有页面就不出这个按钮。
  const pageItems = (pages || [])
    .map((p, i) => `<button class="pf-page-item${i === 0 ? " active" : ""}" data-page="${esc(p.id)}">${esc(p.name)}</button>`)
    .join("");
  const pageSwitcher = (pages || []).length
    ? `<span class="pf-hdr-sep"></span><div class="pf-pgsel"><button class="pf-pgsel-btn" type="button" aria-expanded="false" title="页面">${pagesIcon(pages.length)}<span class="pf-pgsel-name">${esc(pages[0].name)}</span>${VSEL_CHEV}</button><div class="pf-pgsel-menu" hidden><div class="pf-pgsel-head">页面</div>${pageItems}</div></div>`
    : "";
  const pageOpts = exportBundle
    ? { exportMode: true, singleFile: !!exportBundle.singleFile, heightCache }
    : { heightCache, framePrefix };
  const canvases = (pages || []).length
    ? pages.map((p, i) => buildPageCanvas(p, i, pageOpts)).join("")
    : `<div class="pf-empty">这个项目还没有页面</div>`;

  // 标注（右侧标注面板用）：按页面 → 画板，每块画板一篇 annotations.md + refs（元素要交互才可见时
  // 的前置步骤）。面板渲染选中那块画板的 md，定位/高亮由画板 iframe 负责。
  const annData = {};
  for (const p of pages || []) {
    annData[p.id] = (p.artboards || [])
      .filter((ab) => ab.hasSource && String(ab.annotationsMd || "").trim())
      .map((ab) => ({ artboardId: ab.id, artboardName: ab.name, md: ab.annotationsMd, refs: ab.annotationRefs || {} }));
  }
  const annJson = JSON.stringify(annData).replace(/</g, "\\u003c");
  const escScript = (s) => String(s).replace(/<\/script/gi, "<\\/script");
  // <script type="application/json"> 里放什么都不会被当成脚本执行，只需要防 "</script" 提前把
  // 标签截断，不用像 srcdoc 属性值那样转义 "&"/双引号——JSON.stringify 已经处理好字符串里的引号。
  const jsonScript = (id, data) => `<script type="application/json" id="${id}">${escScript(JSON.stringify(data))}<\/script>`;

  // 导出菜单的行从 ./exportMenu.js 生成（跟 ./exports.js 用同一份 id）——加新格式改那两处，这里不用动。
  // 顶部右侧：全屏（导出的页面也有）+ 分享（只在本地预览里有）
  const exportBtn = `<div class="pf-hdr-r">${fullscreenButtonHtml()}${exportBundle ? "" : `<div class="pf-export-entry">
    <button class="pf-hdr-share" type="button" title="分享">${ICON_SHARE}<span class="pf-export-label">分享</span></button>
    <div class="pf-export-menu" hidden><div class="pf-export-menu__section">导出</div>${exportMenuRowsHtml(CANVAS_EXPORT_MENU)}</div>
  </div>`}</div>`;
  const stateScript = exportBundle
    ? `<script>window.__PF_CANVAS_STATE__ = ${escScript(JSON.stringify(exportBundle.canvasState || {}))};<\/script>`
    : "";
  const generatorMeta = exportBundle ? `<meta name="generator" content="protoflow-canvas-export"/>\n` : "";
  // 单 HTML 导出：库源码压缩后嵌一份 JSON、画板 HTML（含占位路径）嵌另一份 JSON，marked.min.js
  // 混在同一份压缩库里，父文档启动时才解压/建 Blob/替换占位路径（见 buildScript）——都不是这里
  // 静态拼出来的 <script src>，所以目录树导出那句 <script src="lib/marked.min.js"> 在单 HTML
  // 导出里整个不出现。
  const singleFileData = exportBundle && exportBundle.singleFile
    ? jsonScript("pf-artboard-html", exportBundle.artboardHtml || {}) + jsonScript("pf-compressed-libs", exportBundle.compressedLibs || {})
    : "";
  const markedTag = exportBundle && exportBundle.singleFile ? "" : `<script src="${libRelPath}/marked.min.js"><\/script>`;
  const showVersions = versioning && !exportBundle;
  const brandTitle = showVersions
    ? `<div class="pf-vsel"><button class="pf-vsel-btn" type="button" aria-expanded="false"><span class="pf-vsel-name">${esc(projectName)}</span>${versioning.current !== versioning.head ? `<span class="pf-vsel-badge">v${versioning.current}</span>` : ""}${VSEL_CHEV}</button><div class="pf-vsel-menu" hidden></div></div>`
    : `<span class="pf-hdr-title">${esc(projectName)}</span>`;
  const versionsData = showVersions ? jsonScript("pf-versions", { title: projectName, head: versioning.head, current: versioning.current, versions: versioning.versions }) : "";

  return `<!DOCTYPE html><html lang="zh-CN" class="pf-loading"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
${generatorMeta}${FAVICON_LINK}
<title>${esc(projectName)} · protoflow 画布</title>
<style>${CSS}${FULLSCREEN_CSS}</style></head><body>
<header class="pf-hdr" data-pf-chrome><div class="pf-hdr-l"><span data-pf-nav-slot></span>${brandTitle}${pageSwitcher}</div>${exportBtn}</header>
<div class="pf-app">
<main class="pf-main">${canvases}</main>
<aside class="pf-anns" data-pf-chrome></aside>
</div>
<script type="application/json" id="pf-ann-data">${annJson}</script>
${stateScript}
${versionsData}
${singleFileData}
${markedTag}
<script>${buildScript({ exportMode: !!exportBundle, singleFile: !!(exportBundle && exportBundle.singleFile), canvasId })}<\/script>
<script>${fullscreenScript()}<\/script>
</body></html>`;
}
