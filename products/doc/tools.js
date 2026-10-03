// products/doc/tools.js — 文档的 CLI 工具。reg 是产品注册表（products/index.js）传进来的
// { products, resolvers }。
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { embedSourcesFrom, fail, labelsParam, pid, pinSources, projectDir, sourcesParam, withUrl, writeExport } from "protoflow/sdk";
import { buildDoc, createDoc } from "./doc.js";
import * as docStore from "./store.js";
import { embedRefsIn } from "./embeds.js";

export function docTools(reg) {
  return [
    {
      name: "create_doc",
      description: "在 docs/ 下新建一个文档：docs/<docId>/（doc.md 工作草稿 + doc.json）。docId 是目录名（人类可读 slug，可含中文）。title 是主题一句话——不带项目名、不带「PRD」之类类型字样、不带版本号，传了会填进一级标题和 doc.json.title。content 是初始正文（比如从流程 skill 的模板起草好的 markdown），不传就是只有一级标题的空文档。labels 是标签（如 [\"product-dev/prd\"]），框架不解释，给流程 skill 认自己管的文档。from 记来源（from:\"prd\" 基于 prd 文档 head 版本、from:\"prd@3\" 指定版本），成为第一版的引用 doc:prd@<版本>、之后的版本沿用。写完正文 build_doc(note:\"…\") 定第一个版本",
      schema: { ...pid, docId: z.string(), title: z.string().optional(), content: z.string().optional(), labels: labelsParam, from: z.string().optional() },
      handler: (a, ctx) => createDoc(ctx.ws, a.projectId, { docId: a.docId, title: a.title, content: a.content, labels: a.labels, from: a.from }, ctx),
    },
    {
      name: "build_doc",
      description: "给文档定版（finalize）：doc.md 已写好、图片已放进 docs/<docId>/assets/——校验 ![](assets/…) 引用是否都落地、收集引用（sources 参数 + assets/ 里素材旁边的 .source.json 出处）、冻结成第 n 版（按内容寻址存储，没改的图片不重复存）、按 note 自动重生成修改记录表、重渲染 docs/<docId>/preview.html。note 必填（一句话说清这次改了什么，进修改记录表；不写版本号）。截图、文档检查不是这里的一步：由流程 skill 的脚本做（如产品研发流程的截图脚本、check.mjs），截图和出处文件直接落进 assets/。mode 可省略，只有 finalize。返回的 url（http://127.0.0.1）是打开方式",
      schema: { ...pid, docId: z.string(), mode: z.string().optional().describe("可省略，只有 finalize"), note: z.string().optional(), label: z.string().optional(), author: z.string().optional(), sources: sourcesParam },
      handler: async (a, ctx) => {
        const ps = pinSources(ctx, a.projectId, a.sources, reg.resolvers);
        if (ps.error) return ps.error;
        // 正文里的嵌入块：引用经框架固定到对方当前版本，记成这一版的 sources（via: "embed"，from 是原文）
        const mdPath = path.join(docStore.docDir(ctx.ws, a.projectId, a.docId), "doc.md");
        const raws = fs.existsSync(mdPath) ? embedRefsIn(fs.readFileSync(mdPath, "utf8")) : [];
        const pinned = pinSources(ctx, a.projectId, raws, reg.resolvers);
        if (pinned.error) return { ...pinned.error, error: { ...pinned.error.error, message: `正文里的嵌入：${pinned.error.error.message}` } };
        const embedSources = embedSourcesFrom(raws, pinned.sources);
        const r = await buildDoc(ctx.ws, a.projectId, a.docId, a.mode, { note: a.note, label: a.label, author: a.author, sources: ps.sources, embedSources }, ctx);
        if (!r.ok) return r;
        return withUrl(a.projectId, projectDir(ctx.ws, a.projectId), r.headPreviewPath, r);
      },
    },
    {
      name: "export_doc",
      description: "把一篇文档的当前（head）版本导出成一个文件，写到 outDir 下（文件名自动取文档标题）。format=\"docx\" 导出可编辑 Word；format=\"zip\"（默认，兼容旧调用）导出目录树（preview.html + lib/ + assets/，不带历史版本、不带版本切换）；format=\"html\" 导出单个自包含 .html（marked/mermaid、图片全内联，双击即看）；format=\"markdown\" 导出一个 .zip（<标题>.md + assets/ 真实图片文件，图片引用是相对路径、不转 data URI，比 html 更通用，便于导入飞书文档、钉钉文档等其它工具）。不需要 protoflow 的预览服务。跟文档阅读页右上角「导出」按钮菜单同一份逻辑，区别是按钮触发浏览器下载、这个工具直接写到你指定的目录",
      schema: {
        ...pid,
        docId: z.string(),
        format: z.enum(["zip", "html", "markdown", "docx"]).optional().describe("导出格式，默认 zip（目录树）；docx 是可编辑 Word；html 是单文件；markdown 是 .md + assets/ 图片的 .zip 包"),
        outDir: z.string().describe("文件要写到的目录（绝对路径，或相对 dir 参数解析）；目录不存在会自动创建"),
      },
      handler: async (a, ctx) => {
        const out = await reg.runExport(path.join(ctx.ws, a.projectId), `doc/${encodeURIComponent(a.docId)}/${a.format || "zip"}`);
        if (!out) return fail("DOC_NOT_BUILT", `文档 ${a.docId} 尚未 build_doc(mode:"finalize")，没有任何版本可导出`);
        return writeExport(a.outDir, out);
      },
    },
  ];
}
