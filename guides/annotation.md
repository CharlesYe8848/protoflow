# 标注编写与核对

一块画板的标注 = 该画板目录下的一篇 **`annotations.md`**（一份普通 markdown 文档），外加可选的
`annotations.refs.json` 侧车。**没有 target、没有 groupId / order / revision、没有一条一张卡片**——
就是一篇文章：分区用标题、要指到画板上某个元素时在正文里写内联链接。

## annotations.md 怎么写

当成给读者的一节 spec 来写：

- **分区**用 `##` 标题（一个业务区块一段），**一条具体说明**用 `###` 标题。只有一块画板、内容不多时
  可以不分区，直接 `##` 一条条排。
- 顺序 = 文档顺序，分组 = 标题层级，不需要任何额外字段。
- 正文是完整 markdown：列表 / 表格 / 代码块 / 引用 / 加粗都支持，marked 渲染（跟 doc 阅读页同一套）。
- 自己加更深的小标题从 `####` 起，别超过 `###` 抢分区/条目那两级。

## 正文里怎么指元素

用 markdown 链接：`[显示名](#el/元素id)`。**两半是两回事，别混**：

- `#el/元素id` 里的 **id** 是源码里的锚点——`source.jsx` 里 `id="..."` 的那个，从 `get_annotations`
  的 `elementIds` 里照抄，读者看不到它。
- **显示名** 是渲染成 chip、读者会读会点的那几个字。用**这东西在界面上是什么**来起名——它的可见
  文字，或它承担的角色——让人一眼就懂。

**别拿元素 id（或 class 名、内部代号、DOM 术语）当显示名。** 元素 id 常是 `bg-tagline`、`card-c1`
这种缩写，直接塞进 chip 读者根本不知道指的是啥。

| 元素 | ❌ 别这么写 | ✅ 这么写 |
| --- | --- | --- |
| `id="bg-tagline"` 定位标语区块 | `[bg-tagline](#el/bg-tagline)` | `[项目定位标语](#el/bg-tagline)` |
| `id="bg-current"` 现状说明块 | `[bg-current](#el/bg-current)` | `[现状说明](#el/bg-current)` |
| `id="list-candidates"` 候选人列表 | `[list-candidates](#el/list-candidates)` | `[候选人卡片列表](#el/list-candidates)` |
| `id="btn-fold-sidebar"` 折叠按钮 | `[btn-fold-sidebar](#el/btn-fold-sidebar)` | `[折叠按钮](#el/btn-fold-sidebar)` |

- `get_annotations` 会回一个 `elementHints`（`{ 元素id: 一句它在界面上大概是什么 }`，从源码静态提取）——
  **用它来起名，别原样粘**：hint 是 `执行 · 检查薪招插件状态` 就写 `[「检查薪招插件状态」步骤]`，
  hint 是 `现状：薪招插件已具备的能力 · …` 就写 `[「现状」区块]`。hint 可能不准，也可能某个 id 压根没有。
- 元素有可见文字就拿它当名字（可精简）：按钮上写「查看详情」→ `[查看详情按钮]`；没有可见文字就
  按它的功能 / 位置起名（`[右上角匹配度分数]`、`[流程图下方的说明]`）。
- 显示名跟着句子走，同一个元素在不同句子里可以叫不同的自然名（`[候选人卡片]` / `[另一张卡片]` /
  `[当前选中的卡片]`），只要都是人话；chip 的定位靠 `#el/元素id`，跟显示名叫什么无关。
- 一段话可以引用 **0 个 / 1 个 / 多个** 元素，横跨几个也行。
- 引用了当前源码没有的 id → `write_annotations` 报 `REF_NOT_FOUND`，整篇拒绝。
- 渲染时 `[显示名](#el/元素id)` 变成一个青色小 chip，跟正文混排：
  - 点它 → 画布平移到那个元素、闪一下高亮
  - 悬停它 → 那个元素在画板上淡红描边
  - 元素已从源码删掉 → chip 变灰、删除线，`chain_status` 报 `annotation_broken`

## 写法示例

### 例 1：分两个区，每区几条

```markdown
## 候选人卡片

### 卡片信息结构

[候选人卡片列表](#el/list-candidates) 里每张卡结构一致：头像、姓名、职位·公司、
右上角 [匹配度](#el/score)、技能标签、3 条亮点、底栏工作年限·学历。

### 点击打开详情

点任一张 [卡片](#el/card-c1)，右侧展开 800px 的 [通用侧栏](#el/detail-sidebar)，
加载简历详情页。再点同一张、或点 [折叠按钮](#el/btn-fold)，侧栏收起。

## 点击后详情侧栏

### 通用侧栏壳

侧栏壳只有只读 [地址栏](#el/iframe-url)、[新开标签页图标](#el/btn-open-external)、
[折叠按钮](#el/btn-fold)。招聘操作都留在内嵌页里，不放到壳上。
```

### 例 2：一块简单画板，不分区

```markdown
## 时序图说明

[七角色时序图](#el/flow-diagram)：用户 / 服务端 / Skill / 前端桥接 / 插件 / 招聘后端 /
三方网站。工具调用经 Skill→前端桥接→插件，云端不直连。

## 设计说明

[流程图下方的说明](#el/flow-note)：登录是前置门槛，简历入库走招聘后端。
```

### 例 3：带结构（marked 渲染成真正的表格 / 列表 / 引用）

```markdown
## 字段规则

| 字段 | 取值 | 格式 |
| --- | --- | --- |
| [匹配度](#el/score) | 算法给的 0–100 整数 | 右上角 52×52 紫底，数字 17px |
| [技能标签](#el/skills) | 每人 4 个 | 灰底 22px 高，可换行 |

> 边界：`resumeId` 为空时该卡不渲染，列表跳过、不补空卡。
```

## refs：元素要交互后才出现

如果 `[某元素](#el/dropdown-export)` 只有点开某个菜单之后才在 DOM 里，就把到达那一步的操作序列
放进 `annotations.refs.json`（`write_annotations` 时也可以直接传 `refs`）：

```json
{
  "dropdown-export": {
    "interactionPath": [{ "type": "click", "selector": "#menu-btn", "index": 0 }]
  }
}
```

点这个 chip 定位时，如果元素当前不可见，会自动把画板重置到初始态、按 `interactionPath` 依次重放
（真实 `dispatchEvent`），重放完再定位、闪一下。

- `interactionPath` 每步：`{ type: "click" 或 "hover", selector, index? }`。
- 优先用有唯一 id 的元素当 `selector`；否则抄取元素工具自动采集的结构路径（带 `nth-of-type` 一路走
  到文档根，本身唯一定位，不用 index）。只写 tag/class 这种可能命中多个的粗粒度 selector 时才用
  `index`（从 0 起，缺省 0）。
- key 是被引用的元素 id。正文里已经不再引用的 key，`write_annotations` 会在 `warning` 里点名可清理。

## 流程

1. `get_annotations` → `md`（现有全文）、`refs`、`elementIds`、`elementHints`（给 chip 起名的线索，见上）、
   `sourceHash`、`validatedHash`、`brokenRefs`。
2. 写 `annotations.md`：
   - 全量：`write_annotations({ projectId, artboardId, md, refs? })`
   - 补丁：`write_annotations({ projectId, artboardId, edits:[{ oldText, newText }] })`（`oldText` 须唯一匹配）
   - 跟 `save_artboard_source` 完全一个套路。校验每个 `[](#el/元素id)` 命中 `elementIds`，通过后自动把
     `meta.annotationsValidatedHash` 盖成当前 `sourceHash`。
3. 看效果：`render_preview` / `render_canvas` 拿画布 url，打开后点顶部工具栏的「标注」图标——左侧侧边栏
   从页面列表切成「当前页面各画板的 annotations.md 拼成的一篇文章」。改完刷新标签即最新（画布是
   `annotations.md` 的实时投影，不落盘）。

## chain_status

标注 finding 是**画板级**的（一块画板一篇 md，不再 per 标注）：

- `annotation_review`：源码变了，`annotations.md` 上次核对的指纹对不上当前 `sourceHash`。对照当前
  `source.jsx` 核对全文是否仍准确，准确也要重新 `write_annotations` 一次盖新指纹。
- `annotation_broken`：`annotations.md` 里某个 `[](#el/元素id)` 引用的元素已不在源码——改源码恢复该
  元素，或用 `write_annotations` 改掉 / 删掉那段。
