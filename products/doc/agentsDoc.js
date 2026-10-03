// products/doc/agentsDoc.js — 项目自描述文档（AGENTS.md）里文档的部分，由框架 core/agentsDoc.js 拼接。
export const docAgentsDoc = {
  summary: "文档（`docs/`，markdown）",
  dir: "`docs/`",
  refExample: "`doc:prd@5`",
  layout: `- \`docs/<docId>/\` — 文档。\`docId\`（= 目录名）用模板建时默认 = 模板名（\`docs/prd/\`、
  \`docs/release-note/\`）；同模板要多篇或不用模板时显式传 \`docId\`（可含中文）。\`doc.md\` 一级标题
  只写这篇的主题一句话，不带项目名 / 不带「PRD」之类类型字样 / 不带版本号（\`create_doc\` 传
  \`title\` 会自动填好）。写法见 \`get_guide({topic:"doc-writing"})\`。
  - \`doc.md\` — 当前工作草稿，唯一必须手写的正文（不是结构化 JSON 驱动生成）
  - \`doc.json\` — \`{ title, labels?, head, versions:[{ n, note, author, builtAt, docHash, sources, publishedTo }] }\`。
    \`head\` 是"当前是哪个版本"的唯一真相源；\`labels\`（如 \`["product-dev/prd"]\`）是流程 skill 认文档用的
    标签，框架不解释（其他产品的元信息里同样可以有）
  - \`preview.html\` — head 版本的渲染（含自动生成的修改记录表 + 版本切换器），每次定版重写
  - \`assets/\` — 图片（截图脚本产出 或 手动放入），\`doc.md\` 用 \`![](assets/<file>)\` 引用
  - \`versions/<n>.json\` — 不可变版本清单（版本内路径 \`doc.md\`、\`assets/<file>\` → 内容哈希），
    \`<n>\` 是从 1 递增的整数，不是版本 id。文件本体在项目级 \`objects/\`（见下）。阅读页只有
    \`docs/<docId>/preview.html\` 一个（内嵌全部版本，\`?v=<n>\` 看历史版本）
  - \`captures.json\`（可选）— 要截哪些画板的哪些状态，给产品研发流程 skill 的截图脚本用
    （见产品研发流程 skill 的 \`references/capture.md\`）。截图直接落进 \`assets/\`，
    每张图旁边带出处文件 \`<图>.source.json\``,
  rules: `- 文档：\`doc.json\` 里的 \`docHash\` / \`mdHash\` 是工具算的。手改 \`doc.md\` 只改变草稿，阅读页仍显示 head
  版本，\`build_doc\` 后才更新。文档版本只由显式 \`build_doc(note:"…")\` 产生；属于某个流程的文档什么时候
  该定版，见对应流程 skill 的写作规范。`,
};
