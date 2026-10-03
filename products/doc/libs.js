// products/doc/libs.js — 文档用到的依赖库：阅读页用 marked 渲染 markdown，正文里有 ```mermaid 时再加
// mermaid（3.5MB，只在用到时拷、用到时引）。拷贝、读取的通用逻辑在 core/libs.js。
import { packageFileFrom } from "protoflow/sdk";

const packageFile = packageFileFrom(import.meta.url);

export const DOC_LIBS = {
  "marked.min.js": packageFile("marked", "lib/marked.umd.js"),
  "mermaid.min.js": packageFile("mermaid", "dist/mermaid.min.js"),
};
