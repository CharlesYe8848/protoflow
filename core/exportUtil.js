// core/exportUtil.js — 各产品导出共用的小工具（框架）：文件名、把版本里的 assets/ 拷出来或内联。
// 只跟某一个产品有关的（比如文档取 head 版本、修改记录表）放在那个产品自己的目录里。
import fs from "node:fs";
import path from "node:path";
import { assetsDataMap } from "./ui.js";
import { isSourceSidecar } from "./refs.js";

// 文件名 = 项目名/文档标题，去掉文件系统不友好的字符；空则回退 fallback（通常是 id）。
export function safeFileName(name, fallback) {
  const s = String(name || "").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "").replace(/\s+/g, " ").trim();
  return (s || fallback).slice(0, 120);
}

// 把版本里 assets/ 下的文件原样写到 destDir（zip / markdown 导出用）。没有图片就什么也不建。
// 素材的出处文件（.source.json，给引用用的，见 core/refs.js）不导出。
export function copyVersionAssets(version, destDir) {
  for (const rel of version.list("assets").filter((r) => !isSourceSidecar(r))) {
    const target = path.join(destDir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(version.filePath(rel), target);
  }
}

// 版本里 assets/ 下图片的 { 文件名: data URI }（单 HTML 导出内联用）。
export function versionAssetsDataMap(version) {
  return assetsDataMap(version.list("assets").map((rel) => ({ name: rel.slice("assets/".length), filePath: version.filePath(rel) })));
}
