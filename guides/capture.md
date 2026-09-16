# 截图分组原则（.build/captures.json）

用画布截图当上下文的文档类型（`contextSource:"canvas"`，如 PRD、上线公告）走这条流水线，把画板
的特定交互状态冻结成图。文件在 `docs/<docId>/.build/captures.json`。

**放进来之前先筛一遍呈现形式**（详见 `get_doc_kind("prd")` 的 writing.md「呈现形式」一节）：能由
Mermaid 完整表达主要信息的关系 / 逻辑类画板（流程、时序、层级、状态机、架构、依赖）不进
`captures.json`，直接在 doc.md 写 ```mermaid 块；只有存在 Mermaid 无法保留的重要视觉信息（并排
对比、颜色编码角色 / 风险、图与说明的视觉分组、布局本身是评审对象）时，才截图或混合呈现。

- 先按标注分组，再按交互状态拆图；不要按标注点机械拆图，也不要把所有状态混成一张。
- 有 group 的标注按 group 聚合，每个 group 独立截图；group 内多个互斥状态拆多张。
- groupId:null 的标注不能忽略；无标注画板（竞品图 / 总览图）保留 annotationIds:[] 的全图截图
  ——除非它传达的是关系 / 逻辑且 Mermaid 能完整表达，那走 ```mermaid 块，不截图。
- 标注/分组的 interactionPath 直接用作 capture 的 actions；互斥状态的不同 interactionPath 拆成多个 capture。
- capture id 用 kebab-case 且语义化（cap-list-default / cap-list-filter-open）。
- captures.json 结构：`{ captures:[{ id, artboardId, title, annotationIds:[], actions?:[{type,selector?,ms?}] }] }`。

## 三阶段

1. `build_doc(mode:"snapshot")` — 把 captures.json 引用到的画板源码/标注冻结进 `.build/snapshot/`。
2. `build_publish_pack(mode:"previews")` — 渲染 `.build/previews/<captureId>.html`，每个 capture 返回一个 url。
3. 截图，两种方式任选：
   - **自动（推荐）**：`build_publish_pack(mode:"capture")`——无头浏览器（本机已装的 Chrome，找不到
     才下载一份，不弹窗）按每个 capture 的 actions 操作后，视口宽度用画板 canvasWidth、高度按内容
     实际撑开量出来再截，直接写 `.build/exported-images/<captureId>.png`。
   - **手动（actions 表达不了复杂交互时）**：浏览器工具打开 previews 返回的 url，按 actions 操作后
     整页截图，PNG 命名 `<captureId>.png` 存入 `.build/exported-images/`。
   - 两种方式产物位置/命名一样，可混用。
4. `build_publish_pack(mode:"seal")` — 核对图片清单一一对应后，把截图**落进 `docs/<docId>/assets/<captureId>.png`**
   + 写 `.build/captures-manifest.json`。之后 `doc.md` 用 `![](assets/<captureId>.png)` 引用。

`build_doc(mode:"finalize")` 会校验 `doc.md` 里 `assets/` 下的图片引用是不是都存在。
截图是画板某个状态的干净图——标注说明另在画布左侧侧边栏，或直接写进 PRD 正文，不再往截图上叠编号。
