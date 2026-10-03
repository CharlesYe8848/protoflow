# 原型截图（captures.json + 截图脚本）

PRD、上线公告这类基于原型的文档把画板的特定交互状态截成图。截图是产品研发流程的一步，不是
文档的构建步骤：配置写在 `docs/<docId>/captures.json`，由本 skill 的截图脚本 `scripts/capture.mjs`
对**已定版的画布**截图，图片直接落进
`docs/<docId>/assets/`，每张图旁边带一份出处文件，文档定版时自动成为引用。

**放进来之前先筛一遍呈现形式**（详见本 skill `references/prd-writing.md`「呈现形式」一节）：能由
Mermaid 完整表达主要信息的关系 / 逻辑类画板（流程、时序、层级、状态机、架构、依赖）不进
`captures.json`，直接在 doc.md 写 ```mermaid 块；只有存在 Mermaid 无法保留的重要视觉信息（并排
对比、颜色编码角色 / 风险、图与说明的视觉分组、布局本身是评审对象）时，才截图或混合呈现。

- 先按标注分组，再按交互状态拆图；不要按标注点机械拆图，也不要把所有状态混成一张。
- 同一需求下按交互状态聚合标注；互斥状态拆成多张。
- 无标注画板（竞品图 / 总览图）保留 annotationIds:[] 的全图截图
  ——除非它传达的是关系 / 逻辑且 Mermaid 能完整表达，那走 ```mermaid 块，不截图。
- 把到达目标状态的交互路径写成 actions；互斥状态拆成多个 capture。
- capture id 用 kebab-case 且语义化（cap-list-default / cap-list-filter-open）。
- captures.json 结构：`{ captures:[{ id, artboardId, title, annotationIds:[], actions?:[{type,selector?,ms?}], markers?:[{elementId,number,label,placement?,display?,offset?}] }] }`。
  actions 的 type 是 `click` / `hover` / `wait`，selector 用元素 id（如 `#entry-review`）。

## 流程

1. 画布先定版：`build_canvas(note:"…")`。脚本只截已定版的画布——地址里带版本号，截图可复现；
   画布有没定版的改动时脚本报 `CANVAS_DIRTY`，先定版再截，免得截到的不是现在的原型。
2. 写 `docs/<docId>/captures.json`。
3. 截图，两种方式任选：
   - **自动（推荐）**：`node <skill 目录>/scripts/capture.mjs <项目目录> <docId>`（skill 目录就是这个 skill 所在的目录）。
     无头浏览器（本机已装的 Chrome，找不到才下载，不弹窗）打开画布最新版里这块画板，按 actions
     操作后截图：视口宽度用画板宽度，高度按内容实际撑开量出来。图片写 `assets/<captureId>.png`，
     旁边写 `assets/<captureId>.png.source.json`（`{ "ref": "canvas:<画布id>@<版本>#<画板id>" }`）。
     整批要么全部成功，要么 `assets/` 不动。输出 JSON 里有每张图的 `markerDiagnostics`。
   - **手动（actions 表达不了复杂交互时）**：加 `--urls` 只打印每张图的地址、操作步骤、要保存的路径和
     出处文件内容；用浏览器工具打开地址、操作后整页截图，存到 `saveAs`，并按 `sourceFile` 写出处文件。
   - 其它输出位置（比如给表格用）：`capture.mjs <项目目录> --captures <文件> --out <目录>`。
4. `doc.md` 用 `![](assets/<captureId>.png)` 引用，然后 `build_doc(note:"…")`。
   出处文件自动成为这一版的引用；之后画板改了并定了新版本，`get_project --findings true` 会报这一版过期。
   纯文字改动直接 finalize，不用重截。

`build_doc` 会校验 `doc.md` 里 `assets/` 下的图片引用是不是都存在。
## 可选的截图定位标记

需要读者对照正文定位元素时，在 capture 中添加 `markers`：

```json
{
  "id": "cap-review-entry",
  "artboardId": "ab_example",
  "title": "校验评价入口",
  "annotationIds": ["entry-review"],
  "markers": [
    {
      "elementId": "entry-review",
      "number": 1,
      "label": "校验评价",
      "placement": "top-end"
    }
  ]
}
```

自动截图在 actions 执行并确定最终视口后，按 DOM 元素位置叠加红框和“1 · 校验评价”。
标记直接进入 PNG，HTML、Word、Markdown 导出共用同一张图；不改变原型源码和在线原型。
`annotationIds` 只记录关联标注，不会自动变成定位标记。未配置 `markers` 时仍输出原图。

- `elementId` 必须在目标状态中唯一存在、完整可见；缺失、隐藏、裁切或中心被遮挡时报错，不静默漏标。
- `number` 为 1–999 的整数，同一张图不能重复；`label` 是 1–30 字短名称。同一元素不能重复标记。
- `placement` 默认 `auto`。模型可按实际画面指定 `top/right/bottom/left` 与
  `start/center/end` 的组合，例如 `top-end`、`right-center`。工具计算精确坐标并检查越界、
  目标遮挡和标签碰撞，不接受绝对坐标作为主要布局方式。
- `display` 默认 `auto`：存在无碰撞位置时显示完整标签；放不下时改为元素边缘的编号圆点，并在
  原图下方增加图例，不覆盖页面内容。`callout` 强制显示完整标签，无合法位置就报错；`pin` 强制
  使用编号和图例。capture 返回每张图的 `markerDiagnostics`；出现 `legend-fallback` 时模型应目视
  检查图例效果，也可以改用显式 `placement` 后重跑。
- `offset:{x,y}` 只用于模型目视检查后的少量微调；绝对值不超过 2000。优先调整 `placement`，
  不把偏移量当作常规排版方式。
- PRD 编号对应当前需求小节的字段详情表序号；同一小节跨截图沿用，不按图片重新编号。
- 正文写“点击校验评价（1）”，图后只放一句用途说明，详细规则仍在现有产品逻辑、交互逻辑和字段表中。
- 只标关键位置，选择范围明确且互不嵌套的元素。默认布局会在 12 个锚点中避让其他标记目标和
  已放置标签；模型知道页面语义，必要时应指定 `placement`。自动排布和碰撞检查不能替代交付前目视检查。
- `markers` 只由自动截图绘制，预览页不显示；手动截图时需自行完成同等标记并检查。
- 一批里任何一张失败，整批都不写入 `assets/`；修正配置后重跑。
