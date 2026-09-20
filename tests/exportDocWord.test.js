import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import * as store from "../core/store.js";
import { createDoc, buildDoc } from "../core/doc.js";
import { runProjectExport } from "../core/exportService.js";
import { renderProjectView } from "../core/renderService.js";
import { EXPORT_MENU } from "../core/exportMenu.js";

const ctx = { now: () => 1700000000000, genId: (p) => `${p}_1`, author: "Charles" };
test("Word export: native content, embedded images, head only, and current menu on frozen previews", async (t) => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-word-"));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const project = store.createProject(ws, "招聘", ctx);
  const root = path.join(ws, project.id);
  createDoc(ws, project.id, { kind: "prd", title: "招聘 PRD" }, ctx);
  assert.equal(await runProjectExport(root, "doc/prd/docx"), null);
  const dir = store.docDir(ws, project.id, "prd");
  fs.writeFileSync(path.join(dir, "doc.md"), "# 招聘 PRD\n\n旧版内容");
  await buildDoc(ws, project.id, "prd", "finalize", { note: "初版" }, ctx);
  fs.writeFileSync(path.join(dir, "doc.md"), `# 招聘 PRD

**加粗**与*斜体*、[链接](https://example.com)

A &amp; B &#60; C

1. \`\`\`txt
   code &amp;
   \`\`\`
2. 后续条目

   > 引用延续

| 字段 | 说明 |
| --- | --- |
| 状态 | 已完成 |

3. 第三项
4. 第四项

- 一级
  - 二级

![截图](assets/demo.png)

![越界](../../../../secret.png)

\`\`\`mermaid
graph TD; A-->B;
\`\`\`

<!-- protoflow:changelog -->
`);
  const version = dir;
  fs.mkdirSync(path.join(version, "assets"), { recursive: true });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWo0AAAAASUVORK5CYII=", "base64");
  fs.writeFileSync(path.join(version, "assets/demo.png"), png);
  await buildDoc(ws, project.id, "prd", "finalize", { note: "更新" }, ctx);
  const out = await runProjectExport(root, "doc/prd/docx");
  assert.equal(out.filename, "招聘 PRD.docx");
  assert.equal(out.mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const zip = await JSZip.loadAsync(out.buffer);
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /w:val="Heading1"/);
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /<w:tbl>/);
  assert.equal((xml.match(/<w:numPr>/g) || []).length, 6);
  assert.match(xml, /A &amp; B &lt; C/);
  assert.match(xml, /code &amp;amp;/);
  assert.match(xml, /未嵌入/);
  assert.match(xml, /graph TD/);
  assert.match(xml, /更新/);
  assert.doesNotMatch(xml, /旧版内容|protoflow:changelog/);
  assert.match(await zip.file("word/_rels/document.xml.rels").async("string"), /https:\/\/example.com/);
  assert.match(await zip.file("word/numbering.xml").async("string"), /w:start w:val="3"/);
  const media = Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && !zip.files[f].dir);
  assert.equal(media.length, 1);
  assert.deepEqual(await zip.file(media[0]).async("nodebuffer"), png);
  assert.deepEqual(EXPORT_MENU.doc.map((f) => f.id), ["docx", "html", "markdown"]);
  const preview = path.join(dir, "preview.html");
  const frozen = fs.readFileSync(preview, "utf8");
  fs.writeFileSync(preview, frozen.replace('data-format="docx"', 'data-format="zip"').replace('<b>Word</b>', '<b>项目 HTML</b>'));
  const refreshed = renderProjectView(root, "docs/prd/preview.html");
  assert.match(refreshed, /data-format="docx"/);
  assert.doesNotMatch(refreshed, /data-format="zip"/);
  assert.match(fs.readFileSync(preview, "utf8"), /data-format="zip"/);
  assert.equal(runProjectExport(root, "doc/prd/zip").mime, "application/zip");
});

test("Word export: release-note template converts FAQ <br> tags to native line breaks", async (t) => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-word-release-note-"));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const project = store.createProject(ws, "招聘", ctx);
  const root = path.join(ws, project.id);
  createDoc(ws, project.id, { kind: "release-note", title: "【招聘】推荐候选人卡片上线" }, ctx);
  const built = await buildDoc(ws, project.id, "release-note", "finalize", { note: "首版" }, ctx);
  assert.equal(built.ok, true, JSON.stringify(built));

  const out = await runProjectExport(root, "doc/release-note/docx");
  const zip = await JSZip.loadAsync(out.buffer);
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /<w:br\/>/);
  assert.doesNotMatch(xml, /&lt;br\s*\/?&gt;/i);
});
