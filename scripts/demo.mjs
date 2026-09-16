#!/usr/bin/env node
// Copy the example so experimenting never changes the checked-in baseline.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDocPreview, canvasHtml } from "../core/store.js";
import { toLocalUrl } from "../core/localServer.js";

const source = fileURLToPath(new URL("../examples/checkout/", import.meta.url));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "protoflow-demo-"));
const projectDir = path.join(workspace, "checkout");
fs.cpSync(source, projectDir, { recursive: true, filter: p => !["lib", ".protoflow"].includes(path.basename(p)) });
canvasHtml(workspace, "checkout");
renderDocPreview(workspace, "checkout", "prd");
renderDocPreview(workspace, "checkout", "release-note");
const opts = { projectId: "checkout", projectDir };
console.log(JSON.stringify({
  projectDir,
  canvas: await toLocalUrl(path.join(projectDir, "canvas.html"), opts),
  prd: await toLocalUrl(path.join(projectDir, "docs/prd/preview.html"), opts),
  releaseNote: await toLocalUrl(path.join(projectDir, "docs/release-note/preview.html"), opts),
  tip: "在浏览器打开 canvas。让 agent 使用 projectId=checkout，dir=" + workspace + " 继续编辑。",
}, null, 2));
