# 表格（sheet.json）撰写规范

Sheet 是 protoflow 第三种产物类型，跟 doc（`docs/<docId>/doc.md`）平级：`sheets/<sheetId>/sheet.json`
是正文本身，AI 直接用 Read/Edit/Write 改这个文件，改完调 `build_sheet(note:"…")` 定版。没有细粒度的
`set_cell`/`append_row` 之类工具——改内容就是改文件。

定位：这是一个由 AI 生产、人在浏览器里看、可以尽力导出成 `.xlsx` 的结构化表格产物，**不是公式化的
Excel**——不支持公式、不支持跨 sheet 引用、不支持数据透视。

## 整体结构

```json
{
  "schemaVersion": 1,
  "title": "销售数据",
  "sheets": [
    {
      "name": "销售报表",
      "rows": [
        ["2026年销售业绩", "", "", ""],
        ["姓名", "部门", "销售额", "完成率"],
        ["张三", "华东", 120000, "120%"]
      ],
      "merges": [
        { "startRow": 0, "startCol": 0, "endRow": 0, "endCol": 3 }
      ],
      "styles": {
        "table": "font-size:14px;border-collapse:collapse;",
        "rows": { "1": "font-weight:600;background:#f5f5f5;" },
        "columns": { "2": "text-align:right;" },
        "cells": { "0:0": "font-weight:bold;text-align:center;background:#e8f0fe;" }
      }
    }
  ]
}
```

`sheets` 从第一天起就是数组——单 sheet 就是数组长度为 1，不是两套 schema。`title` 是字面字段，不用
像 doc 那样从正文提取标题。

## 坐标是 0-based 数组下标，不是 Excel 的行号/A1 记号

**这是最容易写错的地方**：`rows[0]` 是第一行，不是 Excel 里的"第 1 行"；`styles.cells` 的 key
`"0:2"` 指 `rows[0][2]`（第一行第三列），不是 A1 记号法的 C1。写样式/合并范围前，先数清楚
`rows` 数组的下标，不要按 Excel 的直觉写 1-based 坐标——这个错误在预览里往往不容易一眼看出（比如
表头样式套到了第二行），要养成写完对照 `rows` 逐行核对下标的习惯。

## `rows`：数据

- 二维数组，同一个 sheet 内**所有行长度必须一致**（不允许参差，`rows[0].length` 就是这个 sheet 的列数）。
- 单元格值允许字符串、数字、布尔、`null`。
- **数字类展示（比如百分比、千分位）直接写成你希望呈现的字符串**（`"120%"`），不是数字+格式——
  这版不支持数字格式化，也不支持公式，AI 写好的字符串就是最终呈现，Excel 里也不能拿它排序/计算。
- 追加大量数据时优先整份 `Write` 重写（内容不算大时最简单可靠）；文件变大后用 `Edit` 追加，建议
  把 `old_string` 锚定在 `rows` 数组的收尾括号上（比如匹配 `]\n    }\n  ]\n}` 这一段），不要在数据行
  中间找一段"看起来独特"的文本去匹配——行与行之间经常长得很像（比如同一列都是省份名字），容易撞上
  "匹配到多处"的编辑失败。

## 单元格里放图片

某个格子的值整体写成 `![说明](assets/<file>)`（跟 `docs/<docId>/doc.md` 里引用截图的写法完全
一样），这一格就会渲染成图片而不是文字——图片文件要真实放进 `sheets/<sheetId>/assets/<file>`，
`build_sheet` 会校验引用的文件存不存在（不存在报 `IMAGE_REF_MISSING`），存在的话连同 `assets/`
一起冻结进这个版本（同一张图片跨版本只存一份）。

- 这个写法要求**整个格子就是这一个图片引用**，不能图文混排（`"张三 ![](assets/a.png)"` 不会被
  识别成图片，只会显示这串原始文字）——单元格是原子值，混排在表格场景没有意义。
- 预览页里图片是缩略图（最大 200×150），点一下弹出居中大图看清楚，再点一下关掉。
- 导出 `.xlsx` 时会把真实图片嵌进对应单元格；读不到图片（文件丢了、格式不支持）就退回显示
  `![]()` 原始文本，不会因为一张图坏掉挡住整份导出。
- 只支持 PNG/JPEG/GIF；引用外部 URL（`http://...`）不受支持，只认 `assets/` 下的本地文件。

## `merges`：合并单元格（可选）

```json
{ "startRow": 0, "startCol": 0, "endRow": 0, "endCol": 3 }
```

- 坐标跟 `rows`/`styles` 同一套 0-based 约定，`start <= end`。
- **只有左上角格子（`rows[startRow][startCol]`）保留数据和样式**，合并范围内其它格子在 `rows`
  里必须是空字符串 `""`——写了非空值会在 `build_sheet` 时报错，指出具体是哪个被覆盖的格子。
- 合并范围之间不能有重叠；范围不能超出这个 sheet 的实际行数/列数。
- 不支持公式表格常见的"整行/整列自动合并"，每个合并范围都要显式写一条。

## `styles`：样式

样式值就是普通的 CSS 声明字符串（`"font-weight:600;background:#eee"`），不是自造的样式 DSL——
CSS 能写什么，这里就能写什么（在 Excel 表达能力允许的范围内，见下方"导出为 Excel"）。

四个层级，**同名属性后面覆盖前面**：`table`（整个 sheet 的默认样式）→ `rows`（按行号，key 是
字符串化的下标）→ `columns`（按列号）→ `cells`（按 `"行:列"`，比如 `"0:2"`）。比如某一行统一
加粗、其中一格额外要求变红，行样式写 `font-weight:600`，单元格样式只写 `color:#dc2626`，两条会
一起生效（加粗保留、颜色覆盖），不用在单元格样式里重复写一遍加粗。

`table` 这一级只影响会被子元素继承的文字类属性（`font-size`/`color` 这种），预览页里表格本身的
网格线、行号列、字母表头是固定的展示框架（模仿电子表格软件本身的样子），不受 `styles.table` 里
`border-collapse` 这类结构性属性影响——写了也不会报错，只是不生效。

出于安全和体积考虑，样式解析会过滤掉 `url(...)`、`@import`，并对单条样式声明的值长度设上限——
这些在表格场景本来就用不上，写了也不会生效，不用特意避开，只是提前说明不是漏渲染。

合并单元格的样式**只看左上角这一格**，四边都要有框线就在左上角写 `border:1px solid #ccc`——
不需要、也不应该给被合并掉的格子单独写样式（它们在 `rows` 里本来就是空的，导出时也会被合并逻辑
直接忽略，Excel 本身也不会在一个激活的合并区域内部画格线，左上角的完整边框就是整圈的框）。

## 校验规则（`build_sheet` 时检查，错误会带上具体是哪个 sheet/哪一行/哪个坐标）

- `sheet.json` 必须是合法 JSON
- `sheets` 是非空数组，`name` 在同一份文档内不能重复
- 每个 sheet 的 `rows` 是数组的数组，同一 sheet 内所有行长度一致
- `styles.rows`/`styles.columns`/`styles.cells` 的下标必须落在这个 sheet 实际的行数/列数范围内
- `merges`：范围内除左上角外必须为空、范围之间不重叠、范围不超出边界
- 样式值必须是字符串（不校验 CSS 语法本身，写错顶多不生效，不会报错）
- `![]()` 引用的图片文件必须存在于 `assets/` 下，否则报 `IMAGE_REF_MISSING`

## 导出为 Excel

`export_sheet` 尽力把内容转成 `.xlsx`：能对应到 Excel 能力的样式（加粗/斜体/字色/背景色/边框/
对齐/自动换行）会尽量还原，Excel 本身没有的效果（圆角、阴影、渐变等）会被直接丢弃，不报错；
`![]()` 图片格会嵌入真实图片。这是数据模型故意保持"CSS 自由表达"、导出时再做取舍的结果——不要
因为"以后要导出 Excel"就避免使用某些 CSS 属性，写你想要的样式就好。

## 版本

跟 doc 是同一套模型：`sheets/<sheetId>/doc.json` 记 `head`/`versions`（note/author/builtAt/
sheetHash），`sheets/<sheetId>/versions/<n>.json` 是冻结的版本清单（文件本体在项目级
`objects/`），一旦写入不可变。`build_sheet`
的 `note` 必填，一句话说清这次改了什么。没有截图步骤，改完
`sheet.json` 直接一步 `build_sheet(note:"…")`。
