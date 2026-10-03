// products/sheet/libs.js — 表格用到的依赖库：阅读页解析单元格样式字符串，跟 sheetStyle.js（Node 侧同一份
// 逻辑的另一个消费方）解析同一个第三方库的输出，两边不需要各自猜 CSS 语法。
import { packageFileFrom } from "protoflow/sdk";

const packageFile = packageFileFrom(import.meta.url);

export const SHEET_LIBS = {
  "inline-style-parser.min.js": packageFile("inline-style-parser", "dist/inline-style-parser.min.js"),
};
