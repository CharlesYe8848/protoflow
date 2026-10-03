#!/usr/bin/env node
// Copy the example so experimenting never changes the checked-in baseline.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canvasHtml } from "../products/canvas/store.js";
import { renderDocPreview } from "../products/doc/store.js";
import { toLocalUrl } from "../core/localServer.js";

const source = fileURLToPath(new URL("../examples/checkout", import.meta.url));
const annualSource = fileURLToPath(new URL("../examples/annual-review", import.meta.url));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "protoflow-demo-"));
const projectDir = path.join(workspace, "checkout");
const annualProjectId = "annual-review";
const annualProjectDir = path.join(workspace, annualProjectId);
fs.cpSync(source, projectDir, { recursive: true, filter: p => !["lib", ".protoflow"].includes(path.basename(p)) });
fs.cpSync(annualSource, annualProjectDir, { recursive: true, filter: p => !["lib", ".protoflow"].includes(path.basename(p)) });
canvasHtml(workspace, "checkout", "main");
renderDocPreview(workspace, "checkout", "prd");
renderDocPreview(workspace, "checkout", "release-note");
const opts = { projectId: "checkout", projectDir };
const annualOpts = { projectId: annualProjectId, projectDir: annualProjectDir };
console.log(JSON.stringify({
  projectDir,
  canvas: await toLocalUrl(path.join(projectDir, "canvases", "main", "canvas.html"), opts),
  prd: await toLocalUrl(path.join(projectDir, "docs/prd/preview.html"), opts),
  releaseNote: await toLocalUrl(path.join(projectDir, "docs/release-note/preview.html"), opts),
  annualReviewProjectDir: annualProjectDir,
  annualReview: await toLocalUrl(path.join(annualProjectDir, "decks/annual-review/preview.html"), annualOpts),
  tip: "打开 canvas 体验原型，或打开 annualReview 体验年终汇报幻灯片。让 agent 使用对应 projectId 和 dir=" + workspace + " 继续编辑。",
}, null, 2));
