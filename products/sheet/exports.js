// products/sheet/exports.js — 表格的导出格式：菜单数据（./exportMenu.js）+ build 函数 + mime。
import { SHEET_EXPORT_MENU } from "./exportMenu.js";
import { buildSheetExportXlsx } from "./exportSheetXlsx.js";

const BUILD = {
  xlsx: { build: buildSheetExportXlsx, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
};
export const SHEET_EXPORTS = SHEET_EXPORT_MENU.map((f) => ({ ...f, ...BUILD[f.id] }));
