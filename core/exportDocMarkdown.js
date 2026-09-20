// core/exportDocMarkdown.js — 把一篇文档的当前（head）版本导出成一个 .zip（下载，不落项目盘）：
//
//   <标题>.zip 解出来：
//   <标题>/
//   ├─ <标题>.md   doc.md 的当前版本，图片引用保持相对路径 ](assets/x)（不转 data URI）
//   └─ assets/     该版本的图片，真实文件
//
// 早先这里导出单个 .md、图片转 data URI 内联——单文件是轻，但大图转出来的 base64 字符串又长又占地方，
// 粘贴/导入到飞书文档、钉钉文档等其它工具时经常卡顿或直接丢图。参考飞书文档自己的 markdown 导出方案
// （.md + 同级图片文件夹、相对路径引用），改成跟 core/exportDoc.js 一样的"真实文件 + 相对路径"，
// 换 zip 包装是这个通用性换来的代价——多数 markdown 工具都认得这种结构，比长串 data URI 更好导入。
//
// <!-- protoflow:changelog --> 标记按跟浏览器阅读页同一套算法（core/docPreview.js 的
// injectChangelogMarkdown）原地展开成表；没有标记就原样不动——是否展示这张表纯粹看正文内容，这里
// 不额外加任何判断。mermaid 代码块原样保留（doc.md 本来就是 fenced code block 存的，markdown
// 渲染器/钉钉文档等都认这个语法，不用转成图片）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { injectChangelogMarkdown } from "./docPreview.js";
import { loadDocHead } from "./exportUtil.js";
import { zipDirectory } from "./zip.js";

export function buildDocExportMarkdown(ws, projectId, docId) {
  const head = loadDocHead(ws, projectId, docId);
  if (!head) return null;
  const { v, vDir, name } = head;
  let { md } = head;

  // 导出产物只带当前版本，changelog 表也就只有这一行——跟 zip/html 导出「不带历史版本、不带
  // 版本切换」的既有设计一致（core/exportDoc.js）。
  md = injectChangelogMarkdown(md, [{ n: v.n, author: v.author || "", note: v.note || "", builtAt: v.builtAt || "" }], v.n);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "protoflow-export-"));
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });

  try {
    fs.writeFileSync(path.join(dir, `${name}.md`), md);

    // 图片：原样拷真实文件——doc.md 里 ](assets/x) 这条相对路径不用改写（只有一版，不用像
    // 项目内 docs/<id>/preview.html 那样塞进 versions/<n>/assets/ 区分多版）。
    const assetsDir = path.join(vDir, "assets");
    if (fs.existsSync(assetsDir)) fs.cpSync(assetsDir, path.join(dir, "assets"), { recursive: true });

    return { filename: `${name}.zip`, buffer: zipDirectory(tmpDir) };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
