// 跨产品嵌入（docs/product-architecture.md §4.11，阶段 14）：形式协商、占位、防循环；文档嵌表格和绘图——
// 定版时固定版本、阅读页和各导出格式按记下的版本展开、对方改了报过期、对方产品没启用显示占位。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { createEmbedder, tableDataToMarkdown } from "../core/embed.js";
import { definePlugin } from "../core/plugin.js";
import { projectGraph } from "../core/projectGraph.js";
import { PRODUCTS } from "../products/index.js";
import { createTestHost } from "protoflow/sdk/testing";

const fake = (type, embed, embedFormats) => definePlugin({ apiVersion: 1, type, label: type, embed, embedFormats });

test("形式协商：挑调用方优先、对方能给的第一种；都给不了降级成链接", () => {
  const box = fake("box", (ws, pid, ref, { as }) => ({ [as]: `${as}:${ref.id}` }), ["markdown", "data"]);
  const embed = createEmbedder([box]);
  assert.deepEqual(embed("", "", "box:a", { prefer: ["html", "data"] }), { as: "data", ref: "box:a", title: "box「a」", data: "data:a" });
  const link = embed("", "", "box:a", { prefer: ["html", "svg"] });
  assert.equal(link.as, "link");
  assert.equal(embed("", "", "nope:x").placeholder, "missing");
  assert.equal(embed("", "", "bad ref").placeholder, "missing");
});

test("防循环：同一个目标在嵌入链上出现第二次、或超过 3 层，就停下显示占位", () => {
  // a 嵌 b，b 又嵌 a
  const a = fake("a", (ws, pid, ref, ctx) => ({ html: `A[${ctx.embed(ws, pid, "b:1", { prefer: ["html"] }).html || "×"}]` }), ["html"]);
  const b = fake("b", (ws, pid, ref, ctx) => {
    const inner = ctx.embed(ws, pid, "a:1", { prefer: ["html"] });
    return { html: `B[${inner.placeholder === "cycle" ? "cycle" : inner.html}]` };
  }, ["html"]);
  assert.equal(createEmbedder([a, b])("", "", "a:1", { prefer: ["html"] }).html, "A[B[cycle]]");

  let depth = 0;
  const deep = fake("deep", (ws, pid, ref, ctx) => { depth++; const r = ctx.embed(ws, pid, `deep:${Number(ref.id) + 1}`, { prefer: ["html"] }); return { html: r.placeholder || r.html }; }, ["html"]);
  createEmbedder([deep])("", "", "deep:1", { prefer: ["html"] });
  assert.equal(depth, 3, "最多嵌 3 层");
});

test("表格数据 → Markdown 表格：转义竖线和换行", () => {
  assert.equal(tableDataToMarkdown({ rows: [["a", "b|c"], ["1", "x\ny"]] }), "| a | b\\|c |\n| --- | --- |\n| 1 | x y |");
});

async function setup(host) {
  const { id } = host.createProject("嵌入");
  const c = async (name, args) => { const r = await host.call(name, { projectId: id, ...args }); assert.notEqual(r && r.ok, false, `${name}: ${JSON.stringify(r)}`); return r; };
  const sheetJson = (rows) => fs.writeFileSync(path.join(host.ws, id, "sheets", "sales", "sheet.json"),
    JSON.stringify({ schemaVersion: 1, title: "销售", sheets: [{ name: "汇总", rows, merges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 1 }], styles: { rows: { "0": "font-weight:bold" } } }] }));
  await c("create_sheet", { sheetId: "sales", title: "销售" });
  sheetJson([["2026 销售", ""], ["张三", "120"]]);
  await c("build_sheet", { sheetId: "sales", note: "v1" });
  await c("create_diagram", { diagramId: "flow", title: "流程" });
  fs.mkdirSync(path.join(host.ws, id, "diagrams", "flow", "pages"), { recursive: true });
  fs.writeFileSync(path.join(host.ws, id, "diagrams", "flow", "pages", "main.mmd"), "flowchart LR\n  A-->B\n");
  await c("build_diagram", { diagramId: "flow", note: "v1" });
  await c("create_doc", { docId: "prd", title: "PRD", content: "# PRD\n\n数据：\n\n```embed\nsheet:sales#汇总\n```\n\n流程：\n\n```embed\ndiagram:flow#main\n```\n" });
  await c("build_doc", { docId: "prd", note: "v1" });
  return { id, c, sheetJson };
}

test("文档嵌表格和绘图：定版时固定版本；阅读页按记下的版本展开；对方改了只报过期，内容不变", async () => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id, c, sheetJson } = await setup(host);
    const dj = JSON.parse(fs.readFileSync(path.join(host.ws, id, "docs", "prd", "doc.json"), "utf8"));
    const embeds = dj.versions[0].sources.filter((s) => s.via === "embed");
    assert.deepEqual(embeds.map((s) => [s.from, s.ref]), [["sheet:sales#汇总", "sheet:sales@1#汇总"], ["diagram:flow#main", "diagram:flow@1#main"]]);

    const page = host.render(id, "docs/prd/preview.html");
    assert.ok(page.includes('colspan=\\"2\\"') || page.includes('colspan="2"'), "表格以 HTML 嵌入，合并单元格保留");
    assert.ok(page.includes("2026 销售") && page.includes("font-weight:bold"));
    assert.ok(page.includes("```mermaid\\nflowchart LR"), "绘图以 Mermaid 代码块嵌入，走文档自己的 Mermaid 渲染");
    assert.ok(page.includes("mermaid.min.js"), "嵌入里有 Mermaid，页面就带上 Mermaid 库");

    sheetJson([["2026 销售", ""], ["张三", "999"]]);
    await c("build_sheet", { sheetId: "sales", note: "v2 改了数" });
    const again = host.render(id, "docs/prd/preview.html");
    assert.ok(again.includes(">120</td>") && !again.includes(">999</td>"), "已定版的文档复现当时的表格，不悄悄换成新数据");
    const graph = projectGraph(host.ws, id, host.products, host.reg.resolvers);
    const src = graph.artifacts.find((a) => a.id === "prd").sources.find((s) => s.ref === "sheet:sales@1#汇总");
    assert.equal(src.status, "stale", "对方改了由引用过期提示");
  } finally { host.cleanup(); }
});

test("文档导出：Markdown 里嵌入变成 Markdown 表格和 Mermaid 代码块；Word 里表格是原生表格", async () => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id } = await setup(host);
    const md = await host.export(id, "doc/prd/markdown");
    const zip = await JSZip.loadAsync(md.buffer);
    const mdText = await zip.file(Object.keys(zip.files).find((f) => f.endsWith(".md"))).async("string");
    assert.ok(mdText.includes("| 2026 销售 |  |\n| --- | --- |\n| 张三 | 120 |"), mdText);
    assert.ok(mdText.includes("```mermaid\nflowchart LR"));
    assert.ok(!mdText.includes("```embed"));

    const docx = await host.export(id, "doc/prd/docx");
    const xml = await (await JSZip.loadAsync(docx.buffer)).file("word/document.xml").async("string");
    assert.ok(xml.includes("<w:tbl>") && xml.includes("张三"), "嵌入的表格进了 Word 的原生表格");

    const html = await host.export(id, "doc/prd/html");
    assert.ok(html.buffer.toString().includes("2026 销售"));
  } finally { host.cleanup(); }
});

test("对方产品没启用：阅读页显示占位，导出不失败；引用标无法校验", async () => {
  const host = createTestHost(PRODUCTS);
  try {
    const { id } = await setup(host);
    const noSheet = createTestHost(PRODUCTS.filter((p) => p.type !== "sheet"), { ws: host.ws });
    const page = noSheet.render(id, "docs/prd/preview.html");
    assert.ok(page.includes("pf-embed--uninstalled") && page.includes("没有启用"));
    const md = await noSheet.export(id, "doc/prd/markdown");
    const mdText = await (await JSZip.loadAsync(md.buffer)).file(/\.md$/)[0].async("string");
    assert.match(mdText, /> 嵌入：销售（sheet:sales@1#汇总）——sheet 产品没有启用/);
  } finally { host.cleanup(); }
});
