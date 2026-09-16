import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { zipDirectory, readZipEntries } from "../core/zip.js";

function mkTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-zip-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

test("zipDirectory/readZipEntries：往返一致，含中文路径 + 二进制内容", () => {
  const dir = mkTree({
    "画板文件夹/文件一.txt": "内容 A",
    "画板文件夹/子目录/文件二.html": "<html>内容 B，重复重复重复重复重复重复</html>",
    "图片.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255, 254, 253]),
  });
  const buf = zipDirectory(dir);
  const entries = readZipEntries(buf);
  const byName = Object.fromEntries(entries.map((e) => [e.name, e.data]));

  assert.deepEqual(Object.keys(byName).sort(), ["图片.png", "画板文件夹/文件一.txt", "画板文件夹/子目录/文件二.html"].sort());
  assert.equal(byName["画板文件夹/文件一.txt"].toString("utf8"), "内容 A");
  assert.equal(byName["画板文件夹/子目录/文件二.html"].toString("utf8"), "<html>内容 B，重复重复重复重复重复重复</html>");
  assert.ok(byName["图片.png"].equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255, 254, 253])));
});

test("zipDirectory：ZIP 头带 UTF-8 文件名标志位（bit 11），中文文件名不依赖本地编码猜测", () => {
  const dir = mkTree({ "中文名.txt": "x" });
  const buf = zipDirectory(dir);
  // 本地文件头 offset 6-7 是 general purpose flag（小端）
  const flags = buf.readUInt16LE(6);
  assert.equal(flags & 0x0800, 0x0800, "bit 11 (EFS/UTF-8) 必须置位");
});

test("zipDirectory：产出的 zip 是真实合法的 ZIP——用系统 unzip -t 测完整性通过", () => {
  const dir = mkTree({ "a/b.txt": "hello", "c.txt": "world" });
  const buf = zipDirectory(dir);
  const zipPath = path.join(os.tmpdir(), `pf-zip-check-${Date.now()}.zip`);
  fs.writeFileSync(zipPath, buf);
  try {
    const out = execFileSync("unzip", ["-t", zipPath], { encoding: "utf8" });
    assert.ok(/No errors detected/.test(out), "unzip -t 应报告无错误：" + out);
  } finally {
    fs.rmSync(zipPath, { force: true });
  }
});

test("zipDirectory：空目录导出 → 空 zip（无条目也不报错）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-zip-empty-"));
  const entries = readZipEntries(zipDirectory(dir));
  assert.deepEqual(entries, []);
});
