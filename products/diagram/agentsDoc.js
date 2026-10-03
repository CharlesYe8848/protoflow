// products/diagram/agentsDoc.js — 项目自描述文档（AGENTS.md）里绘图的部分，由框架 core/agentsDoc.js 拼接。
export const diagramAgentsDoc = {
  summary: "绘图（`diagrams/`，脑图、流程图等，文本写、自动排版）",
  dir: "`diagrams/`",
  refExample: "`diagram:member@2#flow`",
  layout: `- \`diagrams/<diagramId>/\` — 绘图，一个可以有多页。写法见 \`get_guide({topic:"diagram"})\`。
  - \`pages/<pageId>.md\` / \`pages/<pageId>.mmd\` — 每页一个源文件，唯一必须手写的正文：\`.md\` 是 Markmap
    脑图（Markdown 大纲），\`.mmd\` 是 Mermaid（流程图、时序图、状态图等）。页 id = 文件名去掉扩展名
  - \`pages.json\` — \`[{ file, name }]\`，页的顺序和名字；\`pages/\` 里新加的文件定版时自动追加到末尾
  - \`diagram.json\` — \`{ title, labels?, head, versions:[{ n, note, author, builtAt, diagramHash, sources, publishedTo }] }\`
  - \`preview.html\` — head 版本的渲染（页切换 + 版本切换 + 右键标注），每次 \`build_diagram\` 重写
  - \`versions/<n>.json\` — 不可变版本清单（\`pages.json\`、\`pages/<file>\` → 内容哈希），\`<n>\` 从 1 递增`,
  rules: `- 绘图：\`diagram.json\` 里的 \`diagramHash\` 是工具算的。手改 \`pages/\` 下的文件只改变草稿，阅读页只显示定过版的
  内容：改完一轮就 \`build_diagram(note:"…")\` 定一个版本，人才看得到。`,
};
