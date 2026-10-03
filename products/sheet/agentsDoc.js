// products/sheet/agentsDoc.js — 项目自描述文档（AGENTS.md）里表格的部分，由框架 core/agentsDoc.js 拼接。
export const sheetAgentsDoc = {
  summary: "表格（`sheets/`，数据 + 样式）",
  dir: "`sheets/`",
  refExample: "`sheet:matrix@2#汇总`",
  layout: `- \`sheets/<sheetId>/\` — 结构化数据表格，跟 \`docs/\` 平级但独立，没有截图流水线。
  写法规范见 \`get_guide({topic:"sheet-schema"})\`。
  - \`sheet.json\` — 当前工作草稿，唯一必须手写的正文：\`{ title, sheets:[{ name, rows, merges?, styles? }] }\`，
    \`rows\` 是二维数组（0-based 下标），\`styles\` 的值是普通 CSS 声明字符串；某格值整体写成
    \`![说明](assets/<file>)\` 会渲染/导出成图片
  - \`doc.json\` — \`{ title, head, versions:[{ n, note, author, builtAt, sheetHash, sources, publishedTo }] }\`
  - \`assets/\` — 单元格 \`![]()\` 引用的图片，真实文件
  - \`preview.html\` — head 版本的渲染（表格网格 + sheet 切换 + 版本切换器），每次 \`build_sheet\` 重写
  - \`versions/<n>.json\` — 不可变版本清单（\`sheet.json\`、\`assets/<file>\` → 内容哈希），\`<n>\` 从 1 递增`,
  rules: `- 表格：\`doc.json\` 里的 \`sheetHash\` 是工具算的。手改 \`sheet.json\` 只改变草稿，\`build_sheet\` 后阅读页才更新。
  表格版本只由显式 \`build_sheet(note:"…")\` 产生。`,
};
