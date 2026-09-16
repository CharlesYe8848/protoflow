// core/exportCanvasHtml.js — 把整张画布导出成一个自包含单 HTML 文件（下载，不落项目盘）。
//
// 跟目录树导出（core/exportCanvas.js）用的是同一批渲染函数——store.artboardPreviewHtml 产出的
// 画板 HTML 逐字节不变（画板自己的 JSX 还是浏览器端 babel-standalone 编译，跟实时预览/zip 导出
// 行为一致），只是画板挤进了 <iframe srcdoc="..."> 而不是 <iframe src="pages/.../preview.html">。
//
// react/react-dom/babel(/mermaid) 这几个库不会跟着画板一份份重复内联——文件里只压缩存一份
// （core/libCodec.js 的 compressLibSources），画板模板里对应的 <script src=...> 先留一个占位路径
// （PLACEHOLDER_LIB_PATH），父文档启动时解压出源码，把占位标签整段换成内联 <script>源码</script>
// 才把内容塞进 iframe.srcdoc（见 core/canvas.js 的 buildScript + core/libCodec.js 的
// injectArtboardLibsScript）。
//
// 库源码在文件里只有一份，但运行时是各画板各自解压出一份塞进自己的 srcdoc——没有做到"画板之间
// 共享同一份运行时实例"（最早试过用 Blob URL 共享，见下面的教训），但磁盘/下载这份大小的好处
// 完全保留：文件不会跟着画板数量变大。
//
// 回归测试的教训：Blob URL 共享方案（画板 <script src="blob:...">，指向父文档建的同一个 Blob）
// 在本地/开发服务器上完全好用（srcdoc 天然继承父文档 origin，同源共享已验证），但用户把导出的
// 单 HTML 传到飞书云文档这类"预览第三方上传 HTML"的平台后画板整个空白——这类平台几乎都会给
// 托管的文件加一条不放行 script-src blob: 的 CSP（防 XSS 的常规做法），<script src="blob:...">
// 被直接拦掉，React/Babel 都没能加载。本机加同一条 CSP 头复现过一模一样的现象。换成内联
// <script>源码</script> 之后哪儿都能看——纵使是最严格的 CSP 也几乎不会拦内联脚本（拦了页面
// 自己的脚本也跑不起来）。
//
// 这条链路只改"库代码从哪儿来"，画板自身的渲染逻辑（JSX + 浏览器端 babel-standalone 编译）、
// postMessage 交互一律不受影响。
import { loadProjectTree, artboardPreviewHtml, canvasHtml } from "./store.js";
import { readLibSources } from "./preview.js";
import { compressLibSources, PLACEHOLDER_LIB_PATH } from "./libCodec.js";
import { safeFileName } from "./exportUtil.js";
import { readCanvasState } from "./exportCanvas.js";

const BASE_LIB_NAMES = ["react.production.min.js", "react-dom.production.min.js", "babel.min.js"];

export function buildCanvasExportHtml(ws, projectId) {
  const tree = loadProjectTree(ws, projectId);
  const name = safeFileName(tree.name, projectId);
  const canvasState = readCanvasState(ws, projectId);

  const artboardHtml = {};
  let needsMermaid = false;
  for (const pg of tree.pages || []) {
    for (const ab of pg.artboards || []) {
      if (!ab.hasSource) continue;
      const html = artboardPreviewHtml(ws, projectId, ab.id, PLACEHOLDER_LIB_PATH);
      if (html.includes(`${PLACEHOLDER_LIB_PATH}/mermaid.min.js`)) needsMermaid = true;
      artboardHtml[ab.id] = html;
    }
  }

  // marked.min.js 是父文档自己用的（左侧标注侧边栏渲染 markdown），跟画板用的库一起压缩、一起
  // 嵌一份 JSON，父文档解压后直接当脚本执行（不用建 iframe 共享的 Blob URL，见 buildScript）。
  const libNames = needsMermaid ? [...BASE_LIB_NAMES, "mermaid.min.js", "marked.min.js"] : [...BASE_LIB_NAMES, "marked.min.js"];
  const compressedLibs = compressLibSources(readLibSources(libNames));

  const html = canvasHtml(ws, projectId, { canvasState, singleFile: true, artboardHtml, compressedLibs });
  return { filename: `${name}.html`, buffer: Buffer.from(html, "utf8"), mime: "text/html" };
}
