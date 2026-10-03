// products/diagram/libs.js — 绘图用到的依赖库：各渲染器在 engine 里声明 { 文件名: [包名, 包内路径] }，
// 这里换成框架 core/libs.js 认的库表。
import { packageFileFrom } from "protoflow/sdk";
import { renderers } from "./engine/index.js";

const packageFile = packageFileFrom(import.meta.url);

// kinds 缺省 = 全部渲染器。返回 { 文件名: 路径解析函数 }。
export function diagramLibs(kinds) {
  const out = {};
  for (const r of renderers()) {
    if (kinds && !kinds.includes(r.kind)) continue;
    for (const [name, [pkg, rel]] of Object.entries(r.libs || {})) out[name] = packageFile(pkg, rel);
  }
  return out;
}
