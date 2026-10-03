// products/deck/index.js — 幻灯片产品的插件描述。只依赖 protoflow/sdk 的稳定接口（依赖边界测试守着：
// 不准用 protoflow/sdk/internal），按"外部插件"的标准写：拷走这个目录、npm i protoflow 就能在配置里启用。
import { fileURLToPath } from "node:url";
import { defineEntityProduct } from "protoflow/sdk";
import * as deckStore from "./store.js";
import * as deckProduct from "./deckProduct.js";
import { deckPreviewHtml } from "./page.js";
import { DECK_EXPORTS } from "./exports.js";
import { deckTools } from "./tools.js";
import { deckAgentsDoc } from "./agentsDoc.js";

export default defineEntityProduct({
  apiVersion: 1,
  type: "deck",
  label: "幻灯片",
  navIcon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/></svg>',
  entity: deckStore.DECK_ENTITY,
  previewHtml: (ws, pid, id, opts = {}) => deckPreviewHtml(ws, pid, id, { query: opts.query, embed: opts.embed }),
  openVersion: deckStore.openDeckVersion,
  guidesDir: fileURLToPath(new URL("./guides/", import.meta.url)),
  agentsDoc: deckAgentsDoc,
  exports: { hasId: true, defaultFormat: "html", formats: DECK_EXPORTS },
  tools: deckTools,
  publish: { entity: deckStore.DECK_ENTITY, hashField: "deckHash", notBuilt: "build_deck" },
  resolver: deckProduct.resolver,
  artifacts: deckProduct.artifacts,
  health: deckProduct.health,
});
