// products/diagram/tools.js — 绘图的 CLI 工具。reg 是产品注册表（products/index.js）传进来的
// { products, resolvers }。
import path from "node:path";
import { z } from "zod";
import { fail, labelsParam, pid, pinSources, projectDir, sourcesParam, withUrl, writeExport } from "protoflow/sdk";
import { buildDiagram, createDiagram } from "./diagram.js";

export function diagramTools(reg) {
  return [
    {
      name: "create_diagram",
      description: "在 diagrams/ 下新建一个绘图：diagrams/<diagramId>/（pages/ 放页面源文件，pages.json 记页的顺序和名字）。一个绘图可以有多页，每页一个文本文件：.md 是 Markmap 脑图（Markdown 大纲），.mmd 是 Mermaid（流程图、时序图、状态图等）。写法先 get_guide(\"diagram\") 看一遍。title 是这个绘图的主题一句话。写完页面用 build_diagram(note:\"…\") 定第一个版本",
      schema: { ...pid, diagramId: z.string().describe("目录名，人类可读 slug，可含中文"), title: z.string().optional(), labels: labelsParam },
      handler: (a, ctx) => createDiagram(ctx.ws, a.projectId, { diagramId: a.diagramId, title: a.title, labels: a.labels }, ctx),
    },
    {
      name: "build_diagram",
      description: "构建绘图版本：pages/ 下的页面文件已写好，检查每页内容、把 pages/ 里新加的文件自动登记进 pages.json、冻结成第 n 版、返回阅读页地址。阅读页只显示定过版的内容：改完一轮就定一个版本，人才看得到。note 必填（一句话说清这次改了什么）。返回的 url（http://127.0.0.1）是打开方式",
      schema: { ...pid, diagramId: z.string(), note: z.string(), label: z.string().optional(), author: z.string().optional(), sources: sourcesParam },
      handler: async (a, ctx) => {
        const ps = pinSources(ctx, a.projectId, a.sources, reg.resolvers);
        if (ps.error) return ps.error;
        const r = await buildDiagram(ctx.ws, a.projectId, a.diagramId, { note: a.note, label: a.label, author: a.author, sources: ps.sources }, ctx);
        if (!r.ok) return r;
        return withUrl(a.projectId, projectDir(ctx.ws, a.projectId), r.headPreviewPath, r);
      },
    },
    {
      name: "export_diagram",
      description: "把一个绘图的当前（head）版本导出成一个文件，写到 outDir 下（文件名自动取绘图标题）。format=\"html\"（默认）导出单个自包含 .html，双击即看；format=\"zip\" 导出页面源文件（.md / .mmd）加一份单页 HTML。不需要 protoflow 的预览服务",
      schema: { ...pid, diagramId: z.string(), format: z.enum(["html", "zip"]).optional(), outDir: z.string().describe("文件要写到的目录（绝对路径，或相对 dir 参数解析）；目录不存在会自动创建") },
      handler: async (a, ctx) => {
        const out = await reg.runExport(path.join(ctx.ws, a.projectId), `diagram/${encodeURIComponent(a.diagramId)}/${a.format || "html"}`);
        if (!out) return fail("DIAGRAM_NOT_BUILT", `绘图 ${a.diagramId} 尚未 build_diagram，没有任何版本可导出`);
        return writeExport(a.outDir, out);
      },
    },
  ];
}
