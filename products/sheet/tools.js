// products/sheet/tools.js — 表格的 CLI 工具。reg 是产品注册表（products/index.js）传进来的
// { products, resolvers }。
import path from "node:path";
import { z } from "zod";
import { fail, labelsParam, pid, pinSources, projectDir, sourcesParam, withUrl, writeExport } from "protoflow/sdk";
import { buildSheet, createSheet } from "./sheet.js";

export function sheetTools(reg) {
  return [
    {
      name: "create_sheet",
      description: "在 sheets/ 下新建一张表格：sheets/<sheetId>/（工作草稿 sheet.json + doc.json）。sheet.json 的字段规范先 get_guide(\"sheet-schema\") 看一遍再写。title 是表格主题一句话，会填进 sheet.json.title；不传就是「未命名表格」。写完正文用 build_sheet(note:\"…\") 定第一个版本",
      schema: { ...pid, sheetId: z.string().describe("目录名，人类可读 slug，可含中文"), title: z.string().optional(), labels: labelsParam },
      handler: (a, ctx) => createSheet(ctx.ws, a.projectId, { sheetId: a.sheetId, title: a.title, labels: a.labels }, ctx),
    },
    {
      name: "build_sheet",
      description: "构建表格版本：sheet.json 已手写好，校验 schema（sheets 非空、行等长、样式/合并单元格坐标不越界、合并覆盖格必须为空且互不重叠）、算指纹、冻结成第 n 版（按内容寻址存储）、重渲染 sheets/<sheetId>/preview.html。跟 build_doc 不同，没有 mode 参数、没有截图流水线，一步到位。note 必填（一句话说清这次改了什么）。返回的 url（http://127.0.0.1）是打开方式",
      schema: { ...pid, sheetId: z.string(), note: z.string(), label: z.string().optional(), author: z.string().optional(), sources: sourcesParam },
      handler: async (a, ctx) => {
        const ps = pinSources(ctx, a.projectId, a.sources, reg.resolvers);
        if (ps.error) return ps.error;
        const r = await buildSheet(ctx.ws, a.projectId, a.sheetId, { note: a.note, label: a.label, author: a.author, sources: ps.sources }, ctx);
        if (!r.ok) return r;
        return withUrl(a.projectId, projectDir(ctx.ws, a.projectId), r.headPreviewPath, r);
      },
    },
    {
      name: "export_sheet",
      description: "把一张表格的当前（head）版本导出成 .xlsx，写到 outDir 下（文件名自动取表格标题）。尽力还原样式与合并单元格，不支持公式，超出 Excel 表达能力的部分（圆角/阴影/渐变等）会被直接丢弃，不报错。不需要 protoflow 的预览服务",
      schema: { ...pid, sheetId: z.string(), outDir: z.string().describe("文件要写到的目录（绝对路径，或相对 dir 参数解析）；目录不存在会自动创建") },
      handler: async (a, ctx) => {
        const out = await reg.runExport(path.join(ctx.ws, a.projectId), `sheet/${encodeURIComponent(a.sheetId)}/xlsx`);
        if (!out) return fail("SHEET_NOT_BUILT", `表格 ${a.sheetId} 尚未 build_sheet，没有任何版本可导出`);
        return writeExport(a.outDir, out);
      },
    },
  ];
}
