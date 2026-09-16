// core/exportDoc.js — 把一篇文档的**当前版本**导出成一个 .zip（下载，不落项目盘）：
//
//   <标题>.zip 解出来：
//   <标题>/
//   ├─ preview.html      跟 docs/<id>/preview.html 同一个模板（core/docPreview.js），只是只带
//   │                    head 这一版——不带历史版本、不带版本切换下拉
//   ├─ lib/               marked.min.js，用到 mermaid 才有 mermaid.min.js（真实文件，不内联）
//   └─ assets/            该版本的图片，真实文件（不转 data-URI）
//
// 不落一个固定的 .export/ 路径——落盘只发生在系统临时目录，打完包立刻删。
// 不 gate、不套引流闸：这份阅读页没有 iframe、没有跨源问题，任何浏览器双击 preview.html 即看。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderDocPreviewHtml } from "./docPreview.js";
import { copyMarkedLib, copyMermaidLib } from "./preview.js";
import { zipDirectory } from "./zip.js";
import { loadDocHead } from "./exportUtil.js";

// 渲一份目录树到系统临时目录，打成 zip，删掉临时目录。返回 { filename, buffer }，或
// null（文档没有任何版本）。
export function buildDocExportZip(ws, projectId, docId) {
  const head = loadDocHead(ws, projectId, docId);
  if (!head) return null;
  const { dj, v, vDir, md, anyMermaid, name } = head;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "protoflow-export-"));
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });

  try {
    // 图片：当前版本的 assets/ 原样拷过去——导出目录里只有一版，doc.md 里 ](assets/x) 这条相对
    // 路径不用改写（不像项目内 docs/<id>/preview.html 要塞进 versions/<n>/assets/ 区分多版）。
    const assetsDir = path.join(vDir, "assets");
    if (fs.existsSync(assetsDir)) fs.cpSync(assetsDir, path.join(dir, "assets"), { recursive: true });

    const html = renderDocPreviewHtml({
      versions: [{ n: v.n, md, note: v.note || "", author: v.author || "", builtAt: v.builtAt || "" }],
      head: v.n,
      title: dj.title || docId,
      kind: dj.kind,
      kindLabel: "",
      anyMermaid,
      libRelPath: "lib",
      standalone: true,
    });
    fs.writeFileSync(path.join(dir, "preview.html"), html);

    copyMarkedLib(path.join(dir, "lib"));
    if (anyMermaid) copyMermaidLib(path.join(dir, "lib"));

    // 打包 tmpDir（不是 dir）：zip 里带一层跟标题同名的顶层文件夹，解压不会把 preview.html/lib/
    // assets 散落到用户选的目录里。
    return { filename: `${name}.zip`, buffer: zipDirectory(tmpDir) };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
