// core/exportCanvas.js — 把整张画布导出成一个 .zip（下载，不落项目盘）。
//
// 跟实时预览是**同一份模板、同一批渲染函数**（core/store.js 的 canvasHtml/artboardPreviewHtml，
// core/canvas.js 的 buildCanvasHtml、core/preview.js 的 buildPreviewHtml），唯一差别是渲一次写进
// 临时目录、打包、删掉临时目录，而不是每次 GET 现算，外加 buildCanvasHtml 的 exportBundle 参数
// 砍掉几个纯创作期 UI（取元素/模式工具栏/文档菜单/项目切换/「导出」按钮）。目录结构故意跟实时
// 预览的路径**逐段对齐**（pages/<pg>/artboards/<ab>/preview.html，lib/ 在根），这样
// artboardPreviewHtml 里硬编码的 "../../../../lib" 相对路径不用改、直接可用。
//
//   <项目名>.zip 解出来：
//   ├─ index.html                                画布外壳（exportBundle 模式）
//   ├─ lib/  react*.js / babel.min.js / marked.min.js / mermaid.min.js
//   └─ pages/<页面id>/artboards/<画板id>/preview.html   跟实时预览逐字节一样
//
// 不落一个固定的 .export/ 路径——用户点「导出」要自己选存哪、存去哪个文件夹，不是我们替他决定；
// 落盘只发生在系统临时目录，打完包立刻删，POST 请求结束后项目目录里不留任何痕迹。
//
// 画板还是 <iframe src=...>（不是 srcdoc）：这份目录树里画板本来就是独立文件，没必要内联。
// 跨源下父子互摸 DOM 会被拦，但跟画板 iframe 的全部交互都走 postMessage（见 core/canvas.js 的
// setupAnnotations 和 core/preview.js 的 sizeReportScript/ANNOTATION_OVERLAY），不受跨源限制，
// file:// 直接双击 index.html 照样能看、能平移缩放、标注定位高亮也正常。另一种单 HTML 导出（把
// 画板塞进 srcdoc，见 core/exportCanvasHtml.js）用的是同一套 postMessage，两条路径不用分场景
// 判断。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProjectTree, projectDir, artboardPreviewHtml, canvasHtml, ensurePreviewLibs, ensureMarkedLib } from "./store.js";
import { zipDirectory } from "./zip.js";
import { safeFileName } from "./exportUtil.js";

// 导出时的取景（画布 canvas.json 落盘的 { pages:{id:{scale,x,y}}, activePage }）——单 HTML 导出
// （core/exportCanvasHtml.js）也要用同一份，导出到这里。
export function readCanvasState(ws, projectId) {
  const p = path.join(projectDir(ws, projectId), ".protoflow", "canvas.json");
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}

// 渲一份目录树到系统临时目录，打成 zip，删掉临时目录。返回 { filename, buffer }。
export function buildCanvasExportZip(ws, projectId) {
  const tree = loadProjectTree(ws, projectId);
  const name = safeFileName(tree.name, projectId);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "protoflow-export-"));
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });

  try {
    ensurePreviewLibs(path.join(dir, "lib")); // react/react-dom/babel/mermaid
    ensureMarkedLib(path.join(dir, "lib")); // 标注侧边栏渲染用

    for (const pg of tree.pages) {
      for (const ab of pg.artboards) {
        if (!ab.hasSource) continue;
        const html = artboardPreviewHtml(ws, projectId, ab.id); // 跟实时预览完全同一份产物
        const abDir = path.join(dir, "pages", pg.id, "artboards", ab.id);
        fs.mkdirSync(abDir, { recursive: true });
        fs.writeFileSync(path.join(abDir, "preview.html"), html);
      }
    }

    const indexHtml = canvasHtml(ws, projectId, { canvasState: readCanvasState(ws, projectId) });
    fs.writeFileSync(path.join(dir, "index.html"), indexHtml);

    // 打包 tmpDir（不是 dir）：zip 里带一层跟项目同名的顶层文件夹，解压不会把 index.html/lib/
    // pages 散落到用户选的目录里，跟下载一个 GitHub 仓库 zip 解压出 repo-main/ 是同一个习惯。
    return { filename: `${name}.zip`, buffer: zipDirectory(tmpDir) };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
