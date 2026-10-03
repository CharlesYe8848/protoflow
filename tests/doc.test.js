import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import * as canvasStore from "../products/canvas/store.js";
import * as docStore from "../products/doc/store.js";
import { buildDoc, createDoc } from "../products/doc/doc.js";
import { buildCanvas } from "../products/canvas/canvasVersion.js";
import { tpl } from "./helpers/productDevTemplate.js";

const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1`, author: "Charles" };

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-doc-"));
  const proj = store.createProject(ws, "招聘", CTX);
  const pg = canvasStore.upsertPage(ws, proj.id, { name: "流程" }, CTX);
  const ab = canvasStore.upsertArtboard(ws, proj.id, pg.id, { name: "列表页" }, CTX);
  canvasStore.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="l">列表</div>; }`);
  return { ws, proj, ab };
}

const ddir = (ws, pid, docId = "prd") => docStore.docDir(ws, pid, docId);
function writeMd(ws, pid, md, docId = "prd") {
  fs.writeFileSync(path.join(ddir(ws, pid, docId), "doc.md"), md);
}

// 截图脚本的产物（skills/protoflow-product-dev/scripts/capture.mjs）：画布先定一版，assets/ 里放图片和出处文件。
function placeCapture(ws, pid, ab, docId = "prd", bytes = "png") {
  if (!canvasStore.canvasHead(ws, pid, "main")) buildCanvas(ws, pid, { note: "v1" }, CTX);
  const a = path.join(ddir(ws, pid, docId), "assets");
  fs.mkdirSync(a, { recursive: true });
  fs.writeFileSync(path.join(a, "cap-a.png"), bytes);
  fs.writeFileSync(path.join(a, "cap-a.png.source.json"), JSON.stringify({ ref: `canvas:main@${canvasStore.canvasHead(ws, pid, "main")}#${ab.id}` }));
}

test("create_doc：content 就是初始正文（模型从流程 skill 的模板起草），labels 原样存进 doc.json", () => {
  const { ws, proj } = setup();
  const r = createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.docId, "prd");
  const dj = docStore.readDocJson(ws, proj.id, "prd");
  assert.deepEqual(dj.labels, ["product-dev/prd"]);
  assert.equal("kind" in dj || "recipe" in dj, false, "不再有文档类型字段，只有标签");
  assert.deepEqual(r.labels, ["product-dev/prd"]);
  assert.equal(dj.head, 0);
  assert.deepEqual(dj.versions, []);
  assert.ok(fs.readFileSync(path.join(ddir(ws, proj.id), "doc.md"), "utf8").includes("<!-- protoflow:changelog -->"));
});

test("create_doc：上线公告 FAQ 模板让答案硬换行显示", () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { docId: "release-note", ...tpl("release-note") }, CTX);
  const md = fs.readFileSync(path.join(ddir(ws, proj.id, "release-note"), "doc.md"), "utf8");
  assert.match(md, /\*\*Q：\[问题1\]？\*\*<br>\nA：\[答案\]/);
});

test("create_doc：传 title 只填内容不改目录——目录名是 docId，doc.md 一级标题和 doc.json.title 自动填成该句", () => {
  const { ws, proj } = setup();
  const r = createDoc(ws, proj.id, { docId: "prd", ...tpl("prd"), title: "推荐候选人卡片与通用详情侧栏" }, CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.docId, "prd", "目录名不受 title 影响");
  const md = fs.readFileSync(path.join(ddir(ws, proj.id, "prd"), "doc.md"), "utf8");
  assert.ok(md.startsWith("# 推荐候选人卡片与通用详情侧栏\n"), "骨架里的一级标题占位被 title 替换，不用建完再手改");
  assert.ok(!/项目名|PRD —/.test(md.split("\n")[0]), "标题里不带项目名/不带「PRD」字样");
  assert.equal(docStore.readDocJson(ws, proj.id, "prd").title, "推荐候选人卡片与通用详情侧栏");
});

test("create_doc：同项目同类型要多篇时换个 docId（可含中文）；同 docId 的第二篇撞 DOC_EXISTS", () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd"), title: "推荐候选人卡片" }, CTX);
  const dup = createDoc(ws, proj.id, { docId: "prd", ...tpl("prd"), title: "面试评价表" }, CTX);
  assert.equal(dup.error.code, "DOC_EXISTS", "都想落 docs/prd/，第二篇必须显式给别的 docId");
  const b = createDoc(ws, proj.id, { ...tpl("prd"), title: "面试评价表", docId: "面试评价表" }, CTX);
  assert.equal(b.ok, true);
  assert.equal(b.docId, "面试评价表");
  assert.equal(docStore.readDocJson(ws, proj.id, "面试评价表").title, "面试评价表");
});

test("create_doc：docId 必填；不传 content 是只有一级标题的空文档；标签不合法报 BAD_LABELS；没有 template 这个概念", () => {
  const { ws, proj } = setup();
  assert.equal(createDoc(ws, proj.id, {}, CTX).error.code, "DOC_ID_REQUIRED");
  assert.equal(createDoc(ws, proj.id, { docId: "prd" }, CTX).ok, true);
  assert.equal(fs.readFileSync(path.join(ddir(ws, proj.id, "prd"), "doc.md"), "utf8"), "# prd\n");
  assert.equal(createDoc(ws, proj.id, { docId: "prd" }, CTX).error.code, "DOC_EXISTS");
  const plain = createDoc(ws, proj.id, { docId: "会议纪要", title: "周会" }, CTX);
  assert.equal(fs.readFileSync(plain.docMdPath, "utf8"), "# 周会\n");
  assert.equal(docStore.readDocJson(ws, proj.id, "会议纪要").labels, undefined, "没传标签就不写");
  const noH1 = createDoc(ws, proj.id, { docId: "b", title: "标题", content: "正文" }, CTX);
  assert.equal(fs.readFileSync(noH1.docMdPath, "utf8"), "# 标题\n\n正文\n", "正文里没有一级标题就补上");
  assert.equal(createDoc(ws, proj.id, { docId: "c", labels: ["有 空格"] }, CTX).error.code, "BAD_LABELS");
  assert.deepEqual(createDoc(ws, proj.id, { docId: "d", labels: [" a ", "a", "b"] }, CTX).labels, ["a", "b"], "去空白去重");
});

test("create_doc：from 记成待用的引用，第一次 finalize 成为第 1 版的引用，之后沿用", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  const rn = createDoc(ws, proj.id, { docId: "release-note", ...tpl("release-note"), from: "prd" }, CTX);
  assert.equal(rn.ok, true, JSON.stringify(rn));
  assert.deepEqual(docStore.readDocJson(ws, proj.id, "release-note").pendingSources, [{ ref: "doc:prd@1", via: "declared" }]);
  fs.writeFileSync(path.join(ddir(ws, proj.id, "release-note"), "doc.md"), "# 公告\n");
  await buildDoc(ws, proj.id, "release-note", "finalize", { note: "首版" }, CTX);
  await buildDoc(ws, proj.id, "release-note", "finalize", { note: "第二版" }, CTX);
  const dj = docStore.readDocJson(ws, proj.id, "release-note");
  assert.equal(dj.pendingSources, undefined);
  assert.deepEqual(dj.versions.map((v) => v.sources), [[{ ref: "doc:prd@1", via: "declared" }], [{ ref: "doc:prd@1", via: "declared" }]]);
});

test("build_doc 只有 finalize：别的 mode 报 BAD_MODE；mode 可省略", async () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  const r = await buildDoc(ws, proj.id, "prd", "snapshot", {}, CTX);
  assert.equal(r.error.code, "BAD_MODE");
  writeMd(ws, proj.id, "# t\n");
  assert.equal((await buildDoc(ws, proj.id, "prd", undefined, { note: "首版" }, CTX)).ok, true);
});

test("finalize：冻结第 1 版、写 doc.json；唯一阅读页内嵌该版本 markdown + 修改记录表数据", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 校招流程优化\n\n<!-- protoflow:changelog -->\n\n内容\n\n![截图](assets/cap-a.png)\n");
  const r = await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.version, 1);

  const d = ddir(ws, proj.id);
  const v1 = docStore.openDocVersion(ws, proj.id, "prd", 1);
  assert.ok(v1.readText("doc.md").includes("# 校招流程优化"));
  assert.deepEqual(v1.list("assets"), ["assets/cap-a.png", "assets/cap-a.png.source.json"], "出处文件跟图片一起冻结");
  // 内容寻址存储：版本是一份清单，没有 versions/1/ 目录
  assert.ok(fs.existsSync(path.join(d, "versions", "1.json")));
  assert.ok(!fs.existsSync(path.join(d, "versions", "1")));
  assert.ok(fs.existsSync(path.join(d, "preview.html")));
  assert.ok(fs.existsSync(path.join(ws, proj.id, "lib", "marked.min.js")));

  // 版本只存冻结内容，没有各自的 html（阅读页只有 docs/<docId>/preview.html 一个）
  assert.ok(!v1.has("preview.html"));

  const html = fs.readFileSync(path.join(d, "preview.html"), "utf8");
  assert.ok(!html.includes("mermaid.min.js"), "没用 mermaid 的文档预览不引用它");
  // 标签页 <title> = 「<文档标题> · protoflow 文档」，不带项目名（项目上下文归画布那侧）
  assert.ok(html.includes("<title>校招流程优化 · protoflow 文档</title>"));
  assert.ok(!html.includes("招聘 · 校招流程优化"), "标签页标题不再前缀项目名");
  assert.ok(html.includes('<link rel="icon" href="data:image/svg+xml,'), "标签页图标：内联 SVG data URI");
  assert.ok(!/https?:\/\//.test(html));
  // 内嵌全部版本的原始 markdown；图片引用改写成版本作用域路径
  const vArr = JSON.parse(html.match(/var __PF_VERSIONS__ = (\[[\s\S]*?\]);\n/)[1]);
  assert.equal(vArr.length, 1);
  assert.equal(vArr[0].n, 1);
  assert.equal(vArr[0].note, "首版");
  assert.equal(vArr[0].author, "Charles");
  assert.ok(vArr[0].md.includes("](versions/1/assets/cap-a.png)"), "图片引用改写成版本作用域");
  // 修改记录表由页内脚本按 __PF_VERSIONS__ 生成，版本列用 vN
  assert.ok(html.includes("function changelogTable(") && html.includes('"| v" + v.n + " | "'));
  assert.ok(html.includes("function injectChangelog("));

  const dj = docStore.readDocJson(ws, proj.id, "prd");
  assert.equal(dj.head, 1);
  assert.equal(dj.versions[0].note, "首版");
  assert.equal(dj.versions[0].docHash, r.docHash);
  // 截图旁边的出处文件成为这一版对那块画板的引用（截自画布第 1 版）
  assert.deepEqual(dj.versions[0].sources, [{ ref: `canvas:main@1#${ab.id}`, via: "asset" }]);
  assert.equal(dj.versions[0].sourceFingerprints, undefined, "新版本不再写 sourceFingerprints");

  const r2 = await buildDoc(ws, proj.id, "prd", "finalize", { note: "无改动重切" }, CTX);
  assert.equal(r2.version, 2);
  assert.equal(r2.docHash, r.docHash, "内容没变，docHash 不变");
});

test("finalize：多版本累积进唯一阅读页的 __PF_VERSIONS__，最新在上；表要不要出现完全看正文里有没有那个标记，没有就是没有——不猜、不兜底插到标题下方", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n正文\n\n![x](assets/cap-a.png)\n"); // 无 changelog 标记
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  writeMd(ws, proj.id, "# t\n\n正文改改\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "补充异常兜底" }, CTX);
  const html = fs.readFileSync(path.join(ddir(ws, proj.id), "preview.html"), "utf8");
  const vArr = JSON.parse(html.match(/var __PF_VERSIONS__ = (\[[\s\S]*?\]);\n/)[1]);
  assert.deepEqual(vArr.map((v) => [v.n, v.note]), [[1, "首版"], [2, "补充异常兜底"]]);
  assert.equal(JSON.parse(html.match(/var __PF_HEAD__ = (\d+);/)[1]), 2);
  // 表按 n 降序生成（谁在用这个标记，最新在上）
  assert.ok(html.includes("return b.n - a.n;"), "changelogTable 按版本降序");
  // 回归测试：早前"正文里没标记"会被兜底插到一级标题下方（lines.splice(h1 + 1, ...)）——这条
  // 兜底本身就是框架在替内容做决定，跟"要不要展示这张表应该完全由 writing 规范/正文内容决定，
  // 框架不该有自己的意见"这条原则冲突，已经去掉。
  assert.ok(!html.includes("lines.splice"), "不该再有「没有标记就兜底插入」这条逻辑");
  assert.ok(!html.includes("SHOW_CHANGELOG"), "不该有按文档类型开关的这个变量——要不要展示这张表只看正文有没有标记，不是 kind.json 配出来的");
});

test("injectChangelog：正文里有标记就在原地替换成表，没有就原样不动——不看文档类型，只看内容里有没有这个标记字符串", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n<!-- protoflow:changelog -->\n\n正文\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  const prdHtml = fs.readFileSync(path.join(ddir(ws, proj.id), "preview.html"), "utf8");
  assert.ok(prdHtml.includes("function changelogTable(") && prdHtml.includes("function injectChangelog("));
  assert.ok(prdHtml.includes('md.replace(MARKER, changelogTable(upto)'), "有标记时原地替换");

  // 上线公告的写作规范不提这个标记，agent 照规范写就不会带——不需要 kind.json 里配任何开关，
  // 框架这边的渲染代码（injectChangelog/changelogTable）跟 PRD 那份完全一样，没有分叉。
  createDoc(ws, proj.id, { docId: "release-note", ...tpl("release-note") }, CTX);
  writeMd(ws, proj.id, "# 【招聘】职位多渠道关联上线\n\n正文\n", "release-note");
  await buildDoc(ws, proj.id, "release-note", "finalize", { note: "首版" }, CTX);
  const rnHtml = fs.readFileSync(path.join(ddir(ws, proj.id, "release-note"), "preview.html"), "utf8");
  assert.equal(
    rnHtml.match(/function injectChangelog\([\s\S]*?\n  \}/)[0],
    prdHtml.match(/function injectChangelog\([\s\S]*?\n  \}/)[0],
    "两种类型渲染出来的 injectChangelog 函数逐字节相同——框架没有为任何一种类型单独分支",
  );
});

test("finalize：doc.md 用 ```mermaid 时，阅读页引 mermaid.min.js 并有可重复调用的渲染函数", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n![x](assets/cap-a.png)\n");
  const r = await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(fs.existsSync(path.join(ws, proj.id, "lib", "mermaid.min.js")));
  const html = fs.readFileSync(path.join(ddir(ws, proj.id), "preview.html"), "utf8");
  assert.ok(html.includes('src="../../lib/mermaid.min.js"'));
  assert.ok(html.includes("var __PF_ANY_MERMAID__ = true;"));
  assert.ok(html.includes("function renderMermaid(") && html.includes("window.mermaid.run()"));
  assert.ok(html.includes("language-mermaid") && html.includes('diagram.className = "mermaid"'));
  assert.ok(html.includes("pf-toggle-group") && html.includes("eyeBtn") && html.includes("codeBtn"));
});

test("finalize：阅读页有目录容器 + 可重建的目录函数（跳过第一个标题，IntersectionObserver）", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n<!-- protoflow:changelog -->\n\n## 一、背景\n\n### 1.1、现状\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  const html = fs.readFileSync(path.join(ddir(ws, proj.id), "preview.html"), "utf8");
  assert.ok(html.includes('id="tocAside"') && html.includes('id="tocNav"'));
  assert.ok(html.includes("function buildToc(") && html.includes('querySelectorAll("h1, h2, h3")') && html.includes(".slice(1)"));
  assert.ok(html.includes("new IntersectionObserver"));
  assert.ok(html.includes('id="pfDocBar"'), "版本切换器容器");
  // 回归：一级标题后面紧跟二级标题时，点一级标题也要能高亮上——按位置取"滚过阅读线的最后一个
  // 标题"，不是"最后一个 isIntersecting 的 entry"（否则紧跟的二级标题总把一级标题顶掉）。
  assert.ok(html.includes("function syncActive(") && html.includes("<= READ_LINE) cur = links[i]"), "目录高亮按位置算当前标题");
  assert.ok(html.includes('window.addEventListener("scroll", tocScroll'), "scroll 监听是高亮主力，不只靠 IntersectionObserver");
  assert.ok(html.includes('window.removeEventListener("scroll", tocScroll)'), "重建目录（切版本）时要摘掉上一版的 scroll 监听");
  assert.ok(html.includes("scroll-margin-top:56px"), "标题要留出吸顶头的高度，点击跳转后不被 .pf-hdr 挡住");
});

test("preview：置顶通用工具栏（版本切换器；项目入口在项目侧边栏，不再有「返回画布」）", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n<!-- protoflow:changelog -->\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "二版" }, CTX);
  const html = fs.readFileSync(path.join(ddir(ws, proj.id), "preview.html"), "utf8");
  assert.ok(html.includes('<header class="pf-hdr" data-pf-chrome>') && html.includes(".pf-hdr{position:sticky;top:0"), "置顶通用工具栏");
  assert.ok(!html.includes("pf-hdr-home") && !html.includes("返回画布"), "不再写死回画布的入口");
  assert.ok(!html.includes("pf-hdr-kind"), "旧的右上角类型标签已拿掉");
  assert.ok(html.includes('class="pf-hdr-share"') && html.includes("__protoflow_export/doc/"), "右上角改成「导出」按钮，POST 到导出端点");
  assert.ok(html.includes('class="pf-export-menu"') && html.includes('data-format="docx"') && html.includes('data-format="html"') && html.includes('data-format="markdown"'), "导出菜单对应 Word、HTML 和 Markdown");
  // 版本下拉只列本篇的版本，不再夹带同项目其它文档
  assert.ok(!html.includes("__PF_SIBLINGS__") && !html.includes("__PF_KIND__"));
  assert.ok(!/document\.createElement\("select"\)/.test(html), "不用原生 select");
  // ghost 按钮：无边框无背景，hover 出浅底
  assert.ok(html.includes(".pf-vsel-btn{") && html.includes("background:transparent;border:0"));
  assert.ok(html.includes('.pf-vsel-btn:hover,.pf-vsel-btn[aria-expanded="true"]{background:'));
  assert.ok(html.includes("pf-vsel-name") && html.includes("pf-vsel-badge"));
  assert.ok(html.includes("(cur !== HEAD)"), "非最新版本才加 v{n} 徽标");
});

test("finalize：只重渲染本篇，别的文档阅读页不因新增文档而重写（导航由项目侧边栏实时生成）", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd"), title: "推荐候选人卡片" }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 推荐候选人卡片\n\n正文\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  const prdPreview = path.join(ddir(ws, proj.id, "prd"), "preview.html");
  const before = fs.readFileSync(prdPreview, "utf8");

  createDoc(ws, proj.id, { docId: "release-note", ...tpl("release-note"), title: "【招聘】推荐候选人卡片上线" }, CTX);
  writeMd(ws, proj.id, "# 【招聘】推荐候选人卡片上线\n\n正文\n", "release-note");
  await buildDoc(ws, proj.id, "release-note", "finalize", { note: "首版" }, CTX);

  assert.equal(fs.readFileSync(prdPreview, "utf8"), before, "PRD 的冻结阅读页没被改写");
});

test("preview：版本切换在页内完成，不跳转页面（SPA：history + 重渲染，无 location.href 赋值）", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n<!-- protoflow:changelog -->\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "二版" }, CTX);
  const html = fs.readFileSync(path.join(ddir(ws, proj.id), "preview.html"), "utf8");

  // 唯一阅读页，内嵌全部版本；没有 per-version html 文件
  const vArr = JSON.parse(html.match(/var __PF_VERSIONS__ = (\[[\s\S]*?\]);\n/)[1]);
  assert.deepEqual(vArr.map((v) => v.n), [1, 2]);
  assert.ok(html.includes("var __PF_HEAD__ = 2;"));

  // 切换 = history.pushState + 重渲染，不是导航
  assert.ok(html.includes("history.pushState(") && html.includes("history.replaceState("));
  assert.ok(html.includes("e.preventDefault();") && html.includes("go(v.n, true)"), "菜单项拦默认导航、走页内切换");
  assert.ok(!/location\.href\s*=/.test(html), "没有 location.href 赋值式的跳转");
  assert.ok(html.includes('window.addEventListener("popstate"'), "支持浏览器前进/后退");
  assert.ok(html.includes("function render(n)") && html.includes("docEl.innerHTML = marked.parse("));

  // 版本里没有各自的 html
  for (const n of [1, 2]) {
    assert.ok(!docStore.openDocVersion(ws, proj.id, "prd", n).has("preview.html"));
  }
});

test("finalize：note 缺失 → NOTE_REQUIRED；doc.md 缺失 → DOC_MD_MISSING；文档不存在 → DOC_NOT_FOUND", async () => {
  const { ws, proj } = setup();
  assert.equal((await buildDoc(ws, proj.id, "prd", "finalize", {}, CTX)).error.code, "DOC_NOT_FOUND");
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  fs.rmSync(path.join(ddir(ws, proj.id), "doc.md"));
  assert.equal((await buildDoc(ws, proj.id, "prd", "finalize", { note: "x" }, CTX)).error.code, "DOC_MD_MISSING");
  writeMd(ws, proj.id, "# t\n");
  assert.equal((await buildDoc(ws, proj.id, "prd", "finalize", {}, CTX)).error.code, "NOTE_REQUIRED");
});

test("finalize：引用 assets/ 下不存在的图片 → IMAGE_REF_MISSING，不落版本", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n![x](assets/cap-b.png)\n");
  const r = await buildDoc(ws, proj.id, "prd", "finalize", { note: "x" }, CTX);
  assert.equal(r.error.code, "IMAGE_REF_MISSING");
  assert.ok(r.error.message.includes("cap-b.png"));
  assert.equal(docStore.openDocVersion(ws, proj.id, "prd", 1), null);
});

test("finalize：外部图片 URL 不受 assets/ 规则约束", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n![外部](https://example.com/x.png)\n\n![截图](assets/cap-a.png)\n");
  assert.equal((await buildDoc(ws, proj.id, "prd", "finalize", { note: "x" }, CTX)).ok, true);
});

test("finalize：无截图流水线的类型（图直接放 assets/）也能 finalize，没有指向画布的引用", async () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { docId: "release-note", ...tpl("release-note") }, CTX);
  const d = ddir(ws, proj.id, "release-note");
  fs.writeFileSync(path.join(d, "assets", "shot.png"), "png");
  fs.writeFileSync(path.join(d, "doc.md"), "# 【招聘】职位多渠道关联功能上线\n\n<!-- protoflow:changelog -->\n\n![图](assets/shot.png)\n");
  const r = await buildDoc(ws, proj.id, "release-note", "finalize", { note: "首版" }, CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(docStore.readDocJson(ws, proj.id, "release-note").versions[0].sources, []);
});

test("finalize：文档产品不跑检查（检查是配方的事），有开放问题标记也照常定版", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  await placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n![x](assets/cap-a.png)\n\n某边界 **需要与研发确认**。\n");
  const r = await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.findings, undefined);
});

test("finalize：纯文字改动直接出新版本，截图和引用照旧；出处文件不算正文图片、不进 checks 的 assets", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  placeCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  writeMd(ws, proj.id, "# t\n\n改了句话\n\n![x](assets/cap-a.png)\n");
  const r2 = await buildDoc(ws, proj.id, "prd", "finalize", { note: "改文案" }, CTX);
  assert.equal(r2.version, 2);
  assert.deepEqual(docStore.readDocJson(ws, proj.id, "prd").versions[1].sources, [{ ref: `canvas:main@1#${ab.id}`, via: "asset" }]);
});

test("mode 非法 → BAD_MODE", async () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { docId: "prd", ...tpl("prd") }, CTX);
  assert.equal((await buildDoc(ws, proj.id, "prd", "bogus", {}, CTX)).error.code, "BAD_MODE");
});

test("preview：release-note 按写作规范不写 changelog 标记，正文就没有那张表；补写一个标记回去，跟 PRD 一样正常出现——纯粹是内容驱动，不是靠某个配置字段拦掉", async () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { docId: "release-note", ...tpl("release-note") }, CTX);
  writeMd(ws, proj.id, "# 【招聘】职位多渠道关联上线\n\n正文\n", "release-note");
  await buildDoc(ws, proj.id, "release-note", "finalize", { note: "首版" }, CTX);
  const noMarkerHtml = fs.readFileSync(path.join(ddir(ws, proj.id, "release-note"), "preview.html"), "utf8");
  const vArr1 = JSON.parse(noMarkerHtml.match(/var __PF_VERSIONS__ = (\[[\s\S]*?\]);\n/)[1]);
  assert.ok(!vArr1[0].md.includes("protoflow:changelog"), "写作规范没让 agent 写这个标记，正文里确实没有");

  // 同一种类型，正文里手动加上标记——一样能正常替换出表，证明"能不能展示"只取决于标记在不在，
  // 不是这个文档类型天生被挡住了。
  createDoc(ws, proj.id, { docId: "release-note", ...tpl("release-note"), docId: "release-note-2" }, CTX);
  writeMd(ws, proj.id, "# 【薪灵】测试上线\n\n<!-- protoflow:changelog -->\n\n正文\n", "release-note-2");
  await buildDoc(ws, proj.id, "release-note-2", "finalize", { note: "首版" }, CTX);
  const withMarkerHtml = fs.readFileSync(path.join(ddir(ws, proj.id, "release-note-2"), "preview.html"), "utf8");
  const vArr2 = JSON.parse(withMarkerHtml.match(/var __PF_VERSIONS__ = (\[[\s\S]*?\]);\n/)[1]);
  assert.ok(vArr2[0].md.includes("protoflow:changelog"), "手动写了标记，正文里就带着，跟类型无关");
});
