// products/doc/index.js — 文档产品的注册描述（docs/product-architecture.md §4.10）。
import { defineEntityProduct } from "protoflow/sdk";
import * as docStore from "./store.js";
import * as docProduct from "./docProduct.js";
import { DOC_EXPORTS } from "./exports.js";
import { docTools } from "./tools.js";
import { docAgentsDoc } from "./agentsDoc.js";
import { fileURLToPath } from "node:url";

export default defineEntityProduct({
  apiVersion: 1,
  type: "doc",
  label: "文档",
  navIcon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v4a2 2 0 0 0 2 2h4M8 13h8M8 17h5"/></svg>',
  entity: docStore.DOC_ENTITY,
  previewHtml: (ws, pid, id, opts = {}) => docStore.docPreviewHtml(ws, pid, id, { embed: opts.embed }),
  openVersion: docStore.openDocVersion,
  guidesDir: fileURLToPath(new URL("./guides/", import.meta.url)),
  agentsDoc: docAgentsDoc,

  exports: { hasId: true, defaultFormat: "zip", formats: DOC_EXPORTS },
  tools: docTools,

  publish: { entity: docStore.DOC_ENTITY, hashField: "docHash", notBuilt: "build_doc" },

  resolver: docProduct.resolver,
  artifacts: docProduct.artifacts,
  health: docProduct.health,
});
