import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { createHmac } from "node:crypto";
import * as store from "../core/store.js";
import * as sheetStore from "../products/sheet/store.js";
import { freezeVersion, openVersion, objectsDir, normalizeVersionPath } from "../core/versionStore.js";
import { createSheet, buildSheet } from "../products/sheet/sheet.js";
import { resolveProjectFile, renderProjectView } from "../products/index.js";
import { createStaticHandler } from "../core/localServer.js";
import { buildSheetExportXlsx } from "../products/sheet/exportSheetXlsx.js";

const CTX = { now: () => 1700000000000, author: "Charles" };
// 1×1 透明 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

function countObjects(projectDir) {
  const root = objectsDir(projectDir);
  if (!fs.existsSync(root)) return 0;
  return fs.readdirSync(root).reduce((n, d) => n + fs.readdirSync(path.join(root, d)).length, 0);
}

function setupEntity() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-vs-"));
  const entityDir = path.join(projectDir, "docs", "d1");
  fs.mkdirSync(entityDir, { recursive: true });
  return { projectDir, entityDir };
}

test("freezeVersion/openVersion：按路径读回、meta 原样保存、没有 versions/<n>/ 目录", () => {
  const { projectDir, entityDir } = setupEntity();
  freezeVersion(projectDir, entityDir, 1, [
    { path: "doc.md", data: "# 标题\n" },
    { path: "assets/a.png", data: PNG },
  ], { docHash: "abc" });
  const v = openVersion(projectDir, entityDir, 1);
  assert.equal(v.readText("doc.md"), "# 标题\n");
  assert.deepEqual(v.read("assets/a.png"), PNG);
  assert.deepEqual(v.meta, { docHash: "abc" });
  assert.deepEqual(v.list(), ["assets/a.png", "doc.md"]);
  assert.deepEqual(v.list("assets"), ["assets/a.png"]);
  assert.equal(v.read("assets/missing.png"), null);
  assert.ok(fs.existsSync(path.join(entityDir, "versions", "1.json")));
  assert.ok(!fs.existsSync(path.join(entityDir, "versions", "1")));
  assert.equal(openVersion(projectDir, entityDir, 2), null);
});

test("同样的内容跨版本、跨实体只存一份", () => {
  const { projectDir, entityDir } = setupEntity();
  const other = path.join(projectDir, "sheets", "s1");
  fs.mkdirSync(other, { recursive: true });
  for (let n = 1; n <= 5; n++) {
    freezeVersion(projectDir, entityDir, n, [{ path: "doc.md", data: `第 ${n} 版` }, { path: "assets/a.png", data: PNG }]);
  }
  freezeVersion(projectDir, other, 1, [{ path: "assets/a.png", data: PNG }]);
  assert.equal(countObjects(projectDir), 6, "5 份不同的 doc.md + 1 份共享的图片");
  assert.deepEqual(openVersion(projectDir, other, 1).read("assets/a.png"), PNG);
});

test("版本内路径：./ 归一，越界、绝对路径、不在清单里的一律读不到", () => {
  const { projectDir, entityDir } = setupEntity();
  freezeVersion(projectDir, entityDir, 1, [{ path: "assets/a.png", data: PNG }]);
  const v = openVersion(projectDir, entityDir, 1);
  assert.ok(v.has("./assets/a.png"));
  for (const bad of ["../d1/versions/1.json", "/etc/passwd", "assets/../../x", "", "assets\\a.png"]) {
    assert.equal(v.read(bad), null, bad);
  }
  assert.equal(normalizeVersionPath("assets/../doc.md"), "doc.md");
  assert.throws(() => freezeVersion(projectDir, entityDir, 2, [{ path: "../x", data: "x" }]), /不合法/);
});

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("本地服务：versions/<n>/assets/x 按清单解析到对象库，内容类型按请求扩展名；对象库本身不能直接访问", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-vs-srv-"));
  const proj = store.createProject(ws, "服务", CTX);
  createSheet(ws, proj.id, { sheetId: "s" }, CTX);
  const sdir = sheetStore.sheetDir(ws, proj.id, "s");
  fs.writeFileSync(path.join(sdir, "assets", "p.png"), PNG);
  fs.writeFileSync(path.join(sdir, "sheet.json"),
    JSON.stringify({ schemaVersion: 1, title: "s", sheets: [{ name: "S", rows: [["![图](assets/p.png)"]] }] }));
  await buildSheet(ws, proj.id, "s", { note: "首版" }, CTX);

  const root = store.projectDir(ws, proj.id);
  const blob = resolveProjectFile(root, "sheets/s/versions/1/assets/p.png");
  assert.ok(blob && blob.startsWith(path.join(root, "objects")));
  assert.equal(resolveProjectFile(root, "sheets/s/versions/1/assets/nope.png"), null);
  assert.equal(resolveProjectFile(root, "sheets/s/versions/9/assets/p.png"), null);
  assert.equal(resolveProjectFile(root, "canvas.html"), null);

  const secret = "vs";
  const server = await listen(createStaticHandler(secret, renderProjectView, null, () => null, resolveProjectFile));
  const { port } = server.address();
  try {
    const token = createHmac("sha256", secret).update("register:" + path.resolve(root)).digest("hex");
    const { key } = await (await fetch(`http://127.0.0.1:${port}/__protoflow_register?token=${token}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: proj.id, dir: root }),
    })).json();
    const base = `http://127.0.0.1:${port}/p/${encodeURIComponent(key)}/`;
    const img = await fetch(base + "sheets/s/versions/1/assets/p.png");
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
    assert.equal((await fetch(base + "sheets/s/versions/1/assets/nope.png")).status, 404);
    const rel = path.relative(root, blob).split(path.sep).join("/");
    assert.notEqual((await fetch(base + rel)).status, 200, "对象文件不经清单不能直接读");
    const page = await (await fetch(base + "sheets/s/preview.html")).text();
    assert.ok(page.includes("versions/"), "阅读页里的图片地址还是 versions/<n>/assets/…");
  } finally {
    server.close();
  }
});

test("导出经过版本句柄：xlsx 里的图片格从对象库取到图片", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "pf-vs-x-"));
  const proj = store.createProject(ws, "导出", CTX);
  createSheet(ws, proj.id, { sheetId: "s" }, CTX);
  const sdir = sheetStore.sheetDir(ws, proj.id, "s");
  fs.writeFileSync(path.join(sdir, "assets", "p.png"), PNG);
  fs.writeFileSync(path.join(sdir, "sheet.json"),
    JSON.stringify({ schemaVersion: 1, title: "s", sheets: [{ name: "S", rows: [["![图](assets/p.png)"]] }] }));
  await buildSheet(ws, proj.id, "s", { note: "首版" }, CTX);
  const out = await buildSheetExportXlsx(ws, proj.id, "s");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out.buffer);
  assert.equal(wb.worksheets[0].getImages().length, 1);
});
