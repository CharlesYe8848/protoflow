// products/deck/agentsDoc.js — 项目自描述文档（AGENTS.md）里幻灯片的部分，由框架拼接。
export const deckAgentsDoc = {
  summary: "幻灯片（`decks/`，每页一个 HTML，样式随意写，可嵌表格、绘图，可配置自动翻页和音频）",
  dir: "`decks/`",
  refExample: "`deck:pitch@2#03-数据`",
  layout: `- \`decks/<deckId>/\` — 幻灯片。写法见 \`get_guide({topic:"deck-writing"})\`，做幻灯片按流程 skill \`protoflow-slides\` 走。
  - \`slides/<nn-名字>.html\` — 每页一个文件：根节点是一个 \`<section>\`，1920×1080，按文件名排序；
    \`<pf-embed ref="sheet:…">\` 嵌别的产物
  - \`assets/\` — 页里 \`assets/…\` 引用的图片等素材
  - \`playback.json\` — 可选的自动翻页、循环、背景音乐和逐页旁白；音频放 \`assets/\`，字段见 \`get_guide({topic:"deck-writing"})\`
  - \`design/\` — 全稿共用的 \`.css\`、\`.js\`（按文件名顺序全部加载），直接改
  - \`deck.json\` — \`{ title, labels, design, head, versions:[{ n, note, author, builtAt, filesHash, deckHash, sources, publishedTo }] }\`
  - \`versions/<n>.json\` — 不可变版本清单（slides/、assets/、design/、playback.json 一起冻结）`,
  rules: `- 幻灯片：版本只由显式 \`build_deck(note:"…")\` 产生；阅读页只显示定过版的内容。`,
  commands: (pid) => [`protoflow build_deck --projectId ${pid} --deckId <deckId> --note "…"`],
};
