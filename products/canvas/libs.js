// products/canvas/libs.js — 画布用到的依赖库（vendored JS）：画板预览要 react / react-dom / babel（+ 源码
// 用到时的 mermaid），画布页左侧标注侧边栏要 marked。拷贝、读取的通用逻辑在 core/libs.js。
import { packageFileFrom } from "protoflow/sdk";

const packageFile = packageFileFrom(import.meta.url);

export const CANVAS_LIBS = {
  "react.production.min.js": packageFile("react", "umd/react.production.min.js"),
  "react-dom.production.min.js": packageFile("react-dom", "umd/react-dom.production.min.js"),
  "babel.min.js": packageFile("@babel/standalone", "babel.min.js"),
  // 只为兼容老画板：画板里画图的新做法是专门的画图工具，指南里不再介绍（见 preview.js 的 MERMAID_INIT）。
  "mermaid.min.js": packageFile("mermaid", "dist/mermaid.min.js"),
  "marked.min.js": packageFile("marked", "lib/marked.umd.js"),
};

// 画板预览引用的库。mermaid.min.js 压缩后 3.5MB，比 react+react-dom+babel 加起来还重好几倍——文件本身
// 无条件拷进 lib/（磁盘空间不值一提），但 buildPreviewHtml 只在画板源码真的用到 mermaid 时才生成
// <script> 标签引用它，没用到的画板不会多这一份网络/解析成本。
export const PREVIEW_LIB_FILES = ["react.production.min.js", "react-dom.production.min.js", "babel.min.js", "mermaid.min.js"];
