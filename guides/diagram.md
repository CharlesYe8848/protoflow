# 画板画图表（mermaid）

画板本质是任意 HTML，流程图/时序图/架构图不需要新建画板类型，`source.jsx` 渲染成
`<pre className="mermaid">` 或 `<div className="mermaid">` 包住 DSL 字符串即可，机制细节
（3.5MB 按需加载、`startOnLoad:false`、主题配色）见 `docs/architecture-notes.md`「Mermaid 画板机制」一节。
本文档是选型和踩坑经验，动笔前先想清楚。

## 先选对图表类型，别拿 flowchart 硬凑

- **流程有多个角色、且角色之间来回交接**（用户 ↔ 系统 ↔ 插件 ↔ 三方网站这种）：用
  `sequenceDiagram`，不要用 `flowchart` + `subgraph` 模拟"泳道"。`subgraph` 只是 flowchart
  里的视觉分组，默认的 dagre 布局引擎不保证每个 subgraph 渲染成贯穿全宽的色带——节点一多、
  跨组连线一多就会重叠交错，肉眼看起来很乱。`sequenceDiagram` 里参与者天然并列，`alt`/`else`/
  `loop`/`opt` 原生支持分支和循环，表达"角色 A 检查条件、不满足就让角色 B 先去做前置动作"这类
  分支比拿 flowchart 决策菱形去模拟干净得多。
  - 代价：`sequenceDiagram` 是时间轴纵向往下走、角色横向并列的"竖版泳道"，不是"每个角色一条
    通栏、从左到右"的横版泳道。如果用户明确要横版通栏效果，这个方向不对，见下一条。
- **想要真正的横版通栏泳道图**（每个角色一条通栏，从左到右按时间推进）：mermaid 目前没有
  原生支持这个布局。已验证过的两条路都不理想——
  - 换布局引擎（官方 `@mermaid-js/layout-elk`）：能让 subgraph 不再重叠交错，但也不保证是
    "整齐堆叠的通栏"（它按连通性自己决定色块怎么摆，可能是网格状而不是严格顺序堆叠），
    还得额外背 ~4.8MB（比现有 `mermaid.min.js` 本身还重），而且是 ESM 动态 `import()`，
    跟平台现在 `<script src>` 全局变量的加载方式不兼容，要改 `copyPreviewLibs`/
    `buildPreviewHtml` 才能接进来。
  - 拿 `flowchart TB` 顶层 + 每个 subgraph `direction LR` 硬凑：实测直接更差（比默认的
    `flowchart LR` + `direction TB` 4 列并排还乱），不要重复踩这个坑。
  - 真要这个效果，目前诚实的答案是手写 HTML/CSS grid/flex，不是配置 mermaid 就能到位——
    但也因此失去 mermaid 的自动排版，以后改流程步骤要手动调节点位置。跟用户明确这个代价，
    别默认动手。
- **单线程、没有分叉交接的步骤序列**：flowchart 本身就够用，不需要 subgraph。

## `mermaid.initialize` 配置要对应图表类型

`flowchart:{...}` 只对 `flowchart` 生效，`sequenceDiagram` 要用 `sequence:{...}`（如
`actorMargin`/`messageMargin`/`wrap`）。传错类型的配置字段不会报错，也不会生效——容易误以为
"改了参数怎么没用"，其实是传错了配置块。

## 画板根节点别用视口相对单位

根容器（或最外层包一切的 `<div>`）不要用 `minHeight:'100vh'`、`height:'100vh'` 这类视口相对
单位。画布把画板装进 iframe 后会按内容真实高度自动撑高 iframe（`core/preview.js` 的
`sizeReportScript`），`100vh` 会随 iframe 变高重新算出更大的值，形成"resize → vh 变大 →
内容更高 → 再 resize"的正反馈循环——实测能在几秒内把 iframe 撑到近万像素高、卡死标签页。
平台已经在 `sizeReportScript` 里加了兜底（1 秒滚动窗口内 resize 触发频率异常就冻结上报，不
再是靠 MutationObserver 区分"真实内容变化"——mermaid 的 SVG 本身在容器变化时会反过来改写
自己的属性，那套区分方式已知会失效），但从源头上直接不用 vh 单位最省心，不要依赖这个兜底。

## 复杂度是这张图本身决定的，不是引擎的锅

流程步骤多、角色间来回交接多、决策分支多——这种复杂度不管换哪个布局引擎、哪种图表类型都会
体现在连线数量上，不会凭空消失。选对图表类型能让复杂度以更合理的方式呈现（比如
`sequenceDiagram` 的 `alt`/`loop` 有清晰边框，比 flowchart 里裸露的菱形+交叉箭头好读），但
如果用户抱怨"画出来太乱"，先看是不是这张图本身步骤/分支就是多，不要一上来就怀疑是配置或
引擎没调好。
