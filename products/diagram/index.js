// products/diagram/index.js — 绘图产品的注册描述（docs/product-architecture.md §4.10）。框架只按这个形状
// 用绘图：页面路由、版本里的文件、导航、导出、工具、引用解析、健康规则、实体种类、指南、项目说明。
//
// 删掉绘图产品 = 删 products/diagram/ + 删 products/index.js 里那一行 + 删 package.json 里的 markmap 依赖。
// 别的产品指向它的引用会显示"引用失效"，框架和其他产品不用改。
import { defineEntityProduct } from "protoflow/sdk";
import { fileURLToPath } from "node:url";
import * as diagramStore from "./store.js";
import * as diagramProduct from "./diagramProduct.js";
import { DIAGRAM_EXPORTS } from "./exports.js";
import { diagramTools } from "./tools.js";
import { diagramAgentsDoc } from "./agentsDoc.js";
import { embedDiagram, DIAGRAM_EMBED_FORMATS } from "./embed.js";

export default defineEntityProduct({
  apiVersion: 1,
  type: "diagram",
  label: "绘图",
  navIcon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="2.5"/><path d="M7.5 12h3M10.5 12c2 0 2-6 5-6h4M10.5 12h9M10.5 12c2 0 2 6 5 6h4"/></svg>',
  entity: diagramStore.DIAGRAM_ENTITY,
  previewHtml: (ws, pid, id) => diagramStore.diagramPreviewHtml(ws, pid, id),
  openVersion: diagramStore.openDiagramVersion,
  guidesDir: fileURLToPath(new URL("./guides/", import.meta.url)),
  agentsDoc: diagramAgentsDoc,

  exports: { hasId: true, defaultFormat: "html", formats: DIAGRAM_EXPORTS },
  tools: diagramTools,
  publish: { entity: diagramStore.DIAGRAM_ENTITY, hashField: "diagramHash", notBuilt: "build_diagram" },

  resolver: diagramProduct.resolver,
  artifacts: diagramProduct.artifacts,
  health: diagramProduct.health,
  embed: embedDiagram,
  embedFormats: DIAGRAM_EMBED_FORMATS,
});
