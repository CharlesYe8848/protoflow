// core/sheetStyle.js — 单元格样式的级联解析，Node 这一侧（core/exportSheetXlsx.js 用）。
//
// 浏览器那侧（core/sheetPreview.js 生成的预览页内嵌脚本）跑的是同一套算法的第二份实现，用
// window.InlineStyleParser（lib/inline-style-parser.min.js）代替这里的 npm 包——两边解析同一个
// 第三方库的输出，不是各自猜 CSS 语法，风险只在 mergeCascade/危险值过滤这几行简单逻辑上，改一处
// 记得改另一处（core/sheetPreview.js 顶部有对应提醒）。
//
// 关键原则：合并要在"解析成扁平属性表"之后做，不能对已经转换成目标格式（比如 ExcelJS 的嵌套
// font/fill/border 对象）的中间结果做合并——那样会用浅合并整体替换掉上一层的兄弟属性（行加粗、
// 格变红，合并完加粗丢了）。这里只产出扁平属性表，"扁平表 → ExcelJS 嵌套样式"的转换是
// core/exportSheetXlsx.js 单独一步，只做一次。
import parseDeclarations from "inline-style-parser";

const DANGEROUS_VALUE_RE = /url\s*\(|@import/i;
const MAX_DECLARATION_VALUE_LEN = 300;

// 一段 CSS 文本 → 扁平属性表 { property: value }。过滤 url()/@import（表格场景用不上，防止被当
// 外链探测/追踪用）和过长的值（防手滑写出巨长字符串拖累渲染），基于解析后的值判断，不是字符串
// 匹配——大小写、空格、转义都不能绕过。
export function parseCssLevel(cssText) {
  if (!cssText) return {};
  const out = {};
  for (const decl of parseDeclarations(String(cssText))) {
    if (decl.type !== "declaration" || !decl.property || decl.value == null) continue;
    const value = String(decl.value).trim();
    if (!value || value.length > MAX_DECLARATION_VALUE_LEN || DANGEROUS_VALUE_RE.test(value)) continue;
    out[decl.property.trim().toLowerCase()] = value;
  }
  return out;
}

// table → row → column → cell，同名属性后者覆盖前者。任意一层可以是 undefined（没设置）。
export function mergeCascade(...levels) {
  return Object.assign({}, ...levels.map(parseCssLevel));
}

// 从一个 sheet 内容对象解出某个格子最终生效的扁平样式表。
export function resolveCellFlatStyle(sheet, r, c) {
  const styles = sheet.styles || {};
  return mergeCascade(
    styles.table,
    (styles.rows || {})[String(r)],
    (styles.columns || {})[String(c)],
    (styles.cells || {})[`${r}:${c}`],
  );
}

export function flatStyleToCssText(flat) {
  return Object.entries(flat).map(([k, v]) => `${k}:${v}`).join(";");
}
