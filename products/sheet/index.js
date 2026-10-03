// products/sheet/index.js — 表格产品的注册描述（docs/product-architecture.md §4.10）。
import { defineEntityProduct } from "protoflow/sdk";
import * as sheetStore from "./store.js";
import * as sheetProduct from "./sheetProduct.js";
import { SHEET_EXPORTS } from "./exports.js";
import { sheetTools } from "./tools.js";
import { sheetAgentsDoc } from "./agentsDoc.js";
import { embedSheet, SHEET_EMBED_FORMATS } from "./embed.js";
import { fileURLToPath } from "node:url";

export default defineEntityProduct({
  apiVersion: 1,
  type: "sheet",
  label: "表格",
  navIcon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M3 14.5h18M9 9v11"/><path d="M5.5 6.5h13" stroke-width="1.5" opacity=".35"/></svg>',
  entity: sheetStore.SHEET_ENTITY,
  previewHtml: (ws, pid, id) => sheetStore.sheetPreviewHtml(ws, pid, id),
  openVersion: sheetStore.openSheetVersion,
  guidesDir: fileURLToPath(new URL("./guides/", import.meta.url)),
  agentsDoc: sheetAgentsDoc,

  exports: { hasId: true, defaultFormat: "xlsx", formats: SHEET_EXPORTS },
  tools: sheetTools,
  publish: { entity: sheetStore.SHEET_ENTITY, hashField: "sheetHash", notBuilt: "build_sheet" },

  resolver: sheetProduct.resolver,
  artifacts: sheetProduct.artifacts,
  health: sheetProduct.health,
  embed: embedSheet,
  embedFormats: SHEET_EMBED_FORMATS,
});
