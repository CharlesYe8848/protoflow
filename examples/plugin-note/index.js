// examples/plugin-note/index.js — 最小的示例插件"笔记"：一个实体、一个阅读页、建/定版两个工具、导出 Markdown。
// 只依赖 protoflow/sdk（稳定接口），不碰框架内部，可以原样拷到别的仓库、npm i protoflow 后使用。
// 在 protoflow.config.json 的 products 里写上这个目录的路径就能启用。
import { z } from "zod";
import { defineEntityProduct, openEntityVersion, pid, sourcesParam, pinSources } from "protoflow/sdk";
import * as note from "./note.js";

export default defineEntityProduct({
  apiVersion: 1,
  type: "note",
  label: "笔记",
  navIcon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 4h14v16H5zM8 9h8M8 13h6"/></svg>',
  entity: note.NOTE_ENTITY,
  previewHtml: note.notePreviewHtml,
  openVersion: (ws, p, id, n) => openEntityVersion(ws, p, note.NOTE_ENTITY, id, n),
  resolver: note.resolver,
  artifacts: note.artifacts,
  health: () => [],
  exports: {
    hasId: true, defaultFormat: "md",
    formats: [{ id: "md", label: "Markdown", mime: "text/markdown", build(ws, p, id) {
      const v = note.readNoteVersion(ws, p, id);
      return v && { filename: `${id}.md`, buffer: Buffer.from(v.text) };
    } }],
  },
  tools: (reg) => [
    {
      name: "write_note",
      description: "写笔记草稿（没有就新建）",
      schema: { ...pid, noteId: z.string(), title: z.string().optional(), content: z.string() },
      handler: (a, ctx) => note.writeNote(ctx.ws, a.projectId, a, ctx.now()),
    },
    {
      name: "build_note",
      description: "把笔记草稿定成新版本",
      schema: { ...pid, noteId: z.string(), note: z.string().optional(), sources: sourcesParam },
      handler: (a, ctx) => {
        const ps = pinSources(ctx, a.projectId, a.sources, reg.resolvers);
        if (ps.error) return ps.error;
        return note.buildNote(ctx.ws, a.projectId, { ...a, sources: ps.sources }, ctx.now());
      },
    },
  ],
});
