import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as store from "../core/store.js";
import { buildDoc, createDoc } from "../core/doc.js";
import { buildPublishPack } from "../core/publishPack.js";

const CTX = { now: () => 1700000000000, genId: (p) => `${p}_1`, author: "Charles" };

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-doc-"));
  const proj = store.createProject(ws, "招聘", CTX);
  const pg = store.upsertPage(ws, proj.id, { name: "流程" }, CTX);
  const ab = store.upsertArtboard(ws, proj.id, pg.id, { name: "列表页" }, CTX);
  store.saveArtboardSource(ws, proj.id, ab.id, `function Component(){ return <div id="l">列表</div>; }`);
  return { ws, proj, ab };
}

const ddir = (ws, pid, docId = "prd") => store.docDir(ws, pid, docId);
function writeCaptures(ws, pid, caps, docId = "prd") {
  const d = path.join(ddir(ws, pid, docId), ".build");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "captures.json"), JSON.stringify({ captures: caps }));
}
function writeMd(ws, pid, md, docId = "prd") {
  fs.writeFileSync(path.join(ddir(ws, pid, docId), "doc.md"), md);
}

// 走完 snapshot → previews → seal，回到"可以 finalize"的状态。
async function sealOneCapture(ws, pid, ab, docId = "prd") {
  writeCaptures(ws, pid, [{ id: "cap-a", artboardId: ab.id, title: "A", annotationIds: [] }], docId);
  const snap = await buildDoc(ws, pid, docId, "snapshot", {}, CTX);
  assert.equal(snap.ok, true, JSON.stringify(snap));
  await buildPublishPack(ws, pid, docId, "previews", CTX);
  const imgDir = path.join(ddir(ws, pid, docId), ".build", "exported-images");
  fs.writeFileSync(path.join(imgDir, "cap-a.png"), "png");
  const seal = await buildPublishPack(ws, pid, docId, "seal", CTX);
  assert.equal(seal.ok, true, JSON.stringify(seal));
}

test("create_doc：不传 title/docId 时 docId 退回 = kind 名，按模板起草 doc.md，写 doc.json", () => {
  const { ws, proj } = setup();
  const r = createDoc(ws, proj.id, { kind: "prd" }, CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.docId, "prd");
  const dj = store.readDocJson(ws, proj.id, "prd");
  assert.equal(dj.kind, "prd");
  assert.equal(dj.head, 0);
  assert.deepEqual(dj.versions, []);
  assert.ok(fs.readFileSync(path.join(ddir(ws, proj.id), "doc.md"), "utf8").includes("<!-- protoflow:changelog -->"));
});

test("create_doc：上线公告 FAQ 模板让答案硬换行显示", () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { kind: "release-note" }, CTX);
  const md = fs.readFileSync(path.join(ddir(ws, proj.id, "release-note"), "doc.md"), "utf8");
  assert.match(md, /\*\*Q：\[问题1\]？\*\*<br>\nA：\[答案\]/);
});

test("create_doc：传 title 只填内容不改目录——目录名仍是 docs/prd/，doc.md 一级标题和 doc.json.title 自动填成该句", () => {
  const { ws, proj } = setup();
  const r = createDoc(ws, proj.id, { kind: "prd", title: "推荐候选人卡片与通用详情侧栏" }, CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.docId, "prd", "目录名不受 title 影响，仍是类型名");
  const md = fs.readFileSync(path.join(ddir(ws, proj.id, "prd"), "doc.md"), "utf8");
  assert.ok(md.startsWith("# 推荐候选人卡片与通用详情侧栏\n"), "骨架里的一级标题占位被 title 替换，不用建完再手改");
  assert.ok(!/项目名|PRD —/.test(md.split("\n")[0]), "标题里不带项目名/不带「PRD」字样");
  assert.equal(store.readDocJson(ws, proj.id, "prd").title, "推荐候选人卡片与通用详情侧栏");
});

test("create_doc：同项目同类型要多篇时才显式传 docId（可含中文）；不传 docId 的第二篇撞 DOC_EXISTS", () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { kind: "prd", title: "推荐候选人卡片" }, CTX);
  const dup = createDoc(ws, proj.id, { kind: "prd", title: "面试评价表" }, CTX);
  assert.equal(dup.error.code, "DOC_EXISTS", "都想落 docs/prd/，第二篇必须显式给别的 docId");
  const b = createDoc(ws, proj.id, { kind: "prd", title: "面试评价表", docId: "面试评价表" }, CTX);
  assert.equal(b.ok, true);
  assert.equal(b.docId, "面试评价表");
  assert.equal(store.readDocJson(ws, proj.id, "面试评价表").title, "面试评价表");
});

test("create_doc：未知类型报错并列出可用类型；重复创建报错", () => {
  const { ws, proj } = setup();
  const bad = createDoc(ws, proj.id, { kind: "bogus" }, CTX);
  assert.equal(bad.error.code, "KIND_UNKNOWN");
  assert.ok(bad.error.message.includes("prd"));
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  assert.equal(createDoc(ws, proj.id, { kind: "prd" }, CTX).error.code, "DOC_EXISTS");
});

test("create_doc：from 记来源进 doc.json.origin", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  const rn = createDoc(ws, proj.id, { kind: "release-note", from: "prd" }, CTX);
  assert.equal(rn.ok, true, JSON.stringify(rn));
  assert.deepEqual(store.readDocJson(ws, proj.id, "release-note").origin, [{ docId: "prd", version: 1 }]);
});

test("snapshot：读 .build/captures.json，冻结引用到的画板", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  writeCaptures(ws, proj.id, [{ id: "cap-a", artboardId: ab.id, title: "A", annotationIds: [] }]);
  const r = await buildDoc(ws, proj.id, "prd", "snapshot", {}, CTX);
  assert.equal(r.ok, true);
  assert.equal(r.artboardCount, 1);
  assert.ok(fs.existsSync(path.join(ddir(ws, proj.id), ".build", "snapshot", "artboards", ab.id, "source.jsx")));
  assert.ok(fs.existsSync(path.join(ws, proj.id, "lib", "react.production.min.js")), "lib 落项目级，不进 snapshot");
});

test("snapshot：captures.json 缺失/为空/引用不存在画板 → 对应错误码", async () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  assert.equal((await buildDoc(ws, proj.id, "prd", "snapshot", {}, CTX)).error.code, "CAPTURES_MISSING");
  writeCaptures(ws, proj.id, []);
  assert.equal((await buildDoc(ws, proj.id, "prd", "snapshot", {}, CTX)).error.code, "CAPTURES_EMPTY");
  writeCaptures(ws, proj.id, [{ id: "c", artboardId: "ab_ghost", title: "x", annotationIds: [] }]);
  assert.equal((await buildDoc(ws, proj.id, "prd", "snapshot", {}, CTX)).error.code, "CAPTURE_REF_NOT_FOUND");
});

test("finalize：冻结 versions/1/、写 doc.json；唯一阅读页内嵌该版本 markdown + 修改记录表数据", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 校招流程优化\n\n<!-- protoflow:changelog -->\n\n内容\n\n![截图](assets/cap-a.png)\n");
  const r = await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.version, 1);

  const d = ddir(ws, proj.id);
  assert.ok(fs.existsSync(path.join(d, "versions", "1", "doc.md")));
  assert.ok(fs.existsSync(path.join(d, "versions", "1", "assets", "cap-a.png")));
  assert.ok(fs.existsSync(path.join(d, "preview.html")));
  assert.ok(fs.existsSync(path.join(ws, proj.id, "lib", "marked.min.js")));

  // versions/<n>/ 只存冻结内容，没有各自的 html（阅读页只有 docs/<docId>/preview.html 一个）
  assert.ok(!fs.existsSync(path.join(d, "versions", "1", "preview.html")));

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

  const dj = store.readDocJson(ws, proj.id, "prd");
  assert.equal(dj.head, 1);
  assert.equal(dj.versions[0].note, "首版");
  assert.equal(dj.versions[0].docHash, r.docHash);
  assert.ok(dj.versions[0].sourceFingerprints[ab.id]);

  const r2 = await buildDoc(ws, proj.id, "prd", "finalize", { note: "无改动重切" }, CTX);
  assert.equal(r2.version, 2);
  assert.equal(r2.docHash, r.docHash, "内容没变，docHash 不变");
});

test("finalize：多版本累积进唯一阅读页的 __PF_VERSIONS__，最新在上；表要不要出现完全看正文里有没有那个标记，没有就是没有——不猜、不兜底插到标题下方", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
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
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n<!-- protoflow:changelog -->\n\n正文\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  const prdHtml = fs.readFileSync(path.join(ddir(ws, proj.id), "preview.html"), "utf8");
  assert.ok(prdHtml.includes("function changelogTable(") && prdHtml.includes("function injectChangelog("));
  assert.ok(prdHtml.includes('md.replace(MARKER, changelogTable(upto)'), "有标记时原地替换");

  // 上线公告的写作规范不提这个标记，agent 照规范写就不会带——不需要 kind.json 里配任何开关，
  // 框架这边的渲染代码（injectChangelog/changelogTable）跟 PRD 那份完全一样，没有分叉。
  createDoc(ws, proj.id, { kind: "release-note" }, CTX);
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
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
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
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
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

test("preview：置顶通用工具栏（返回画布 + 版本切换器，右上角不再挂类型标签）", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n<!-- protoflow:changelog -->\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "二版" }, CTX);
  const html = fs.readFileSync(path.join(ddir(ws, proj.id), "preview.html"), "utf8");
  assert.ok(html.includes('<header class="pf-hdr">') && html.includes(".pf-hdr{position:sticky;top:0"), "置顶通用工具栏");
  assert.ok(html.includes('class="pf-hdr-home" href="../../canvas.html"'), "返回画布入口");
  assert.ok(!html.includes("pf-hdr-kind"), "旧的右上角类型标签已拿掉");
  assert.ok(html.includes('class="pf-hdr-share"') && html.includes("__protoflow_export/doc/"), "右上角改成「导出」按钮，POST 到导出端点");
  assert.ok(html.includes('class="pf-export-menu"') && html.includes('data-format="docx"') && html.includes('data-format="html"') && html.includes('data-format="markdown"'), "导出菜单对应 Word、HTML 和 Markdown");
  // 单篇项目：菜单退化成纯版本列表（structured=false），版本行仍带标题
  assert.ok(html.includes('var __PF_KIND__ = "prd";') && html.includes('var __PF_KIND_LABEL__ = "PRD";'));
  assert.ok(html.includes("var structured = SIB.length > 0;"));
  assert.ok(!/document\.createElement\("select"\)/.test(html), "不用原生 select");
  // ghost 按钮：无边框无背景，hover 出浅底
  assert.ok(html.includes(".pf-vsel-btn{") && html.includes("background:transparent;border:0"));
  assert.ok(html.includes('.pf-vsel-btn:hover,.pf-vsel-btn[aria-expanded="true"]{background:'));
  assert.ok(html.includes("pf-vsel-name") && html.includes("pf-vsel-badge"));
  assert.ok(html.includes("(cur !== HEAD)"), "非最新版本才加 v{n} 徽标");
});

test("preview：多类型项目——左上角菜单按类型分组，当前文档展开版本、其它文档只给入口", async () => {
  const { ws, proj, ab } = setup();
  // 另一类型文档先 finalize，好让随后 finalize 的 PRD 的 preview.html 收到这个 sibling
  createDoc(ws, proj.id, { kind: "release-note" }, CTX);
  const rnDir = ddir(ws, proj.id, "release-note");
  fs.writeFileSync(path.join(rnDir, "assets", "s.png"), "png");
  fs.writeFileSync(path.join(rnDir, "doc.md"), "# 【招聘】职位多渠道关联上线\n\n![图](assets/s.png)\n");
  await buildDoc(ws, proj.id, "release-note", "finalize", { note: "首版" }, CTX);
  // 同类型第二篇 PRD
  createDoc(ws, proj.id, { kind: "prd", title: "面试评价表", docId: "面试评价表" }, CTX);
  await sealOneCapture(ws, proj.id, ab, "面试评价表");
  writeMd(ws, proj.id, "# 面试评价表\n\n正文\n\n![x](assets/cap-a.png)\n", "面试评价表");
  await buildDoc(ws, proj.id, "面试评价表", "finalize", { note: "首版" }, CTX);
  // 当前在看的 PRD，最后 finalize，两版
  createDoc(ws, proj.id, { kind: "prd", title: "推荐候选人卡片" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 推荐候选人卡片\n\n正文\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "二版" }, CTX);

  const html = fs.readFileSync(path.join(ddir(ws, proj.id), "preview.html"), "utf8");

  // siblings 跨类型、带 kind + kindLabel，不带版本，href 指向各自阅读页
  const sib = JSON.parse(html.match(/var __PF_SIBLINGS__ = (\[[\s\S]*?\]);\n/)[1]);
  assert.deepEqual(
    sib.map((s) => [s.kind, s.kindLabel, s.title]).sort(),
    [["prd", "PRD", "面试评价表"], ["release-note", "上线公告", "【招聘】职位多渠道关联上线"]].sort(),
  );
  assert.ok(sib.every((s) => !("versions" in s) && !("head" in s)), "sibling 不带版本");
  assert.ok(sib.every((s) => /^\.\.\/[^/]+\/preview\.html$/.test(s.href)), "sibling href 指向各自阅读页");

  // 当前文档类型 + 按类型分组渲染
  assert.ok(html.includes('var __PF_KIND__ = "prd";') && html.includes('var __PF_KIND_LABEL__ = "PRD";'));
  assert.ok(html.includes("function grp(k, label)") && html.includes("groups.push(gmap[k])"), "按类型 key 分组");
  assert.ok(html.includes("grp(KIND, KIND_LABEL).items.push({ current: true })"), "当前文档进自己类型的分组");
  assert.ok(html.includes('hd.className = "pf-vsel-hd"; hd.textContent = g.label'), "组头是类型显示名");
  assert.ok(html.includes('dt.className = "pf-vsel-doc"') && html.includes("dt.textContent = TITLE;"), "当前文档标题行不重复标「当前」");
  assert.ok(html.includes('" pf-vsel-ver"') && html.includes(".pf-vsel-item.pf-vsel-ver{padding-left:"), "版本行在当前文档标题下缩进平铺");
  assert.ok(html.includes('class="pf-vsel-dot"') && html.includes(".pf-vsel-dot{") && html.includes("border-radius:50%"), "当前版本用黑色小圆点标记，不写「当前」二字");
  assert.ok(!html.includes('<span class="cur">当前</span>'), "旧的「当前」文字标记已移除");
  assert.ok(!html.includes("同类其他文档"), "旧的「同类其他文档」小标题被类型分组取代");
});

test("finalize：新增文档后重渲染同项目已有文档，菜单自动补齐入口", async () => {
  const { ws, proj, ab } = setup();

  createDoc(ws, proj.id, { kind: "prd", title: "推荐候选人卡片" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# 推荐候选人卡片\n\n正文\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);

  const prdPreview = path.join(ddir(ws, proj.id, "prd"), "preview.html");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(prdPreview, "utf8").match(/var __PF_SIBLINGS__ = (\[[\s\S]*?\]);\n/)[1]),
    [],
  );

  createDoc(ws, proj.id, { kind: "release-note", title: "【招聘】推荐候选人卡片上线" }, CTX);
  writeMd(ws, proj.id, "# 【招聘】推荐候选人卡片上线\n\n正文\n", "release-note");
  await buildDoc(ws, proj.id, "release-note", "finalize", { note: "首版" }, CTX);

  const siblings = JSON.parse(
    fs.readFileSync(prdPreview, "utf8").match(/var __PF_SIBLINGS__ = (\[[\s\S]*?\]);\n/)[1],
  );
  assert.deepEqual(
    siblings.map((s) => [s.id, s.kindLabel, s.title]),
    [["release-note", "上线公告", "【招聘】推荐候选人卡片上线"]],
  );
});

test("preview：版本切换在页内完成，不跳转页面（SPA：history + 重渲染，无 location.href 赋值）", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
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

  // versions/<n>/ 里没有各自的 html
  for (const n of [1, 2]) {
    assert.ok(!fs.existsSync(path.join(ddir(ws, proj.id), "versions", String(n), "preview.html")));
  }
});

test("finalize：note 缺失 → NOTE_REQUIRED；doc.md 缺失 → DOC_MD_MISSING；文档不存在 → DOC_NOT_FOUND", async () => {
  const { ws, proj } = setup();
  assert.equal((await buildDoc(ws, proj.id, "prd", "finalize", {}, CTX)).error.code, "DOC_NOT_FOUND");
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  fs.rmSync(path.join(ddir(ws, proj.id), "doc.md"));
  assert.equal((await buildDoc(ws, proj.id, "prd", "finalize", { note: "x" }, CTX)).error.code, "DOC_MD_MISSING");
  writeMd(ws, proj.id, "# t\n");
  assert.equal((await buildDoc(ws, proj.id, "prd", "finalize", {}, CTX)).error.code, "NOTE_REQUIRED");
});

test("finalize：截图流水线未走完 → NOT_SNAPSHOTTED / CAPTURES_NOT_SEALED", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  writeCaptures(ws, proj.id, [{ id: "cap-a", artboardId: ab.id, title: "A", annotationIds: [] }]);
  writeMd(ws, proj.id, "# t\n");
  assert.equal((await buildDoc(ws, proj.id, "prd", "finalize", { note: "x" }, CTX)).error.code, "NOT_SNAPSHOTTED");
  await buildDoc(ws, proj.id, "prd", "snapshot", {}, CTX);
  assert.equal((await buildDoc(ws, proj.id, "prd", "finalize", { note: "x" }, CTX)).error.code, "CAPTURES_NOT_SEALED");
});

test("finalize：引用 assets/ 下不存在的图片 → IMAGE_REF_MISSING，不落版本", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n![x](assets/cap-b.png)\n");
  const r = await buildDoc(ws, proj.id, "prd", "finalize", { note: "x" }, CTX);
  assert.equal(r.error.code, "IMAGE_REF_MISSING");
  assert.ok(r.error.message.includes("cap-b.png"));
  assert.ok(!fs.existsSync(path.join(ddir(ws, proj.id), "versions", "1")));
});

test("finalize：外部图片 URL 不受 assets/ 规则约束", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n![外部](https://example.com/x.png)\n\n![截图](assets/cap-a.png)\n");
  assert.equal((await buildDoc(ws, proj.id, "prd", "finalize", { note: "x" }, CTX)).ok, true);
});

test("finalize：无截图流水线的类型（图直接放 assets/）也能 finalize，sourceFingerprints 为空", async () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { kind: "release-note" }, CTX);
  const d = ddir(ws, proj.id, "release-note");
  fs.writeFileSync(path.join(d, "assets", "shot.png"), "png");
  fs.writeFileSync(path.join(d, "doc.md"), "# 【招聘】职位多渠道关联功能上线\n\n<!-- protoflow:changelog -->\n\n![图](assets/shot.png)\n");
  const r = await buildDoc(ws, proj.id, "release-note", "finalize", { note: "首版" }, CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(store.readDocJson(ws, proj.id, "release-note").versions[0].sourceFingerprints, {});
});

test("finalize：跑该类型的 checks，结果进 findings（不拦 finalize）", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n![x](assets/cap-a.png)\n\n某边界 **需要与研发确认**。\n");
  const r = await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.findings.some((f) => f.code === "OPEN_QUESTION" && f.level === "error"));
});

test("finalize：清掉 .build/previews，保留 captures.json / snapshot（供纯 prose 改动复用）", async () => {
  const { ws, proj, ab } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  await sealOneCapture(ws, proj.id, ab);
  writeMd(ws, proj.id, "# t\n\n![x](assets/cap-a.png)\n");
  await buildDoc(ws, proj.id, "prd", "finalize", { note: "首版" }, CTX);
  const b = path.join(ddir(ws, proj.id), ".build");
  assert.ok(!fs.existsSync(path.join(b, "previews")));
  assert.ok(fs.existsSync(path.join(b, "captures.json")));
  assert.ok(fs.existsSync(path.join(b, "snapshot")));
  // 纯 prose 改动 → 直接 finalize v2，不用重跑截图流水线
  writeMd(ws, proj.id, "# t\n\n改了句话\n\n![x](assets/cap-a.png)\n");
  const r2 = await buildDoc(ws, proj.id, "prd", "finalize", { note: "改文案" }, CTX);
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r2.version, 2);
});

test("mode 非法 → BAD_MODE", async () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { kind: "prd" }, CTX);
  assert.equal((await buildDoc(ws, proj.id, "prd", "bogus", {}, CTX)).error.code, "BAD_MODE");
});

test("preview：release-note 按写作规范不写 changelog 标记，正文就没有那张表；补写一个标记回去，跟 PRD 一样正常出现——纯粹是内容驱动，不是靠某个配置字段拦掉", async () => {
  const { ws, proj } = setup();
  createDoc(ws, proj.id, { kind: "release-note" }, CTX);
  writeMd(ws, proj.id, "# 【招聘】职位多渠道关联上线\n\n正文\n", "release-note");
  await buildDoc(ws, proj.id, "release-note", "finalize", { note: "首版" }, CTX);
  const noMarkerHtml = fs.readFileSync(path.join(ddir(ws, proj.id, "release-note"), "preview.html"), "utf8");
  const vArr1 = JSON.parse(noMarkerHtml.match(/var __PF_VERSIONS__ = (\[[\s\S]*?\]);\n/)[1]);
  assert.ok(!vArr1[0].md.includes("protoflow:changelog"), "写作规范没让 agent 写这个标记，正文里确实没有");

  // 同一种类型，正文里手动加上标记——一样能正常替换出表，证明"能不能展示"只取决于标记在不在，
  // 不是这个文档类型天生被挡住了。
  createDoc(ws, proj.id, { kind: "release-note", docId: "release-note-2" }, CTX);
  writeMd(ws, proj.id, "# 【薪灵】测试上线\n\n<!-- protoflow:changelog -->\n\n正文\n", "release-note-2");
  await buildDoc(ws, proj.id, "release-note-2", "finalize", { note: "首版" }, CTX);
  const withMarkerHtml = fs.readFileSync(path.join(ddir(ws, proj.id, "release-note-2"), "preview.html"), "utf8");
  const vArr2 = JSON.parse(withMarkerHtml.match(/var __PF_VERSIONS__ = (\[[\s\S]*?\]);\n/)[1]);
  assert.ok(vArr2[0].md.includes("protoflow:changelog"), "手动写了标记，正文里就带着，跟类型无关");
});
