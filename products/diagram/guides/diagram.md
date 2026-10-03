# 绘图（脑图、流程图、时序图……）

绘图用来在做原型之前把思路理清楚：需求怎么拆、流程怎么走、状态怎么变。你（agent）写文本源文件，
工具负责自动排版和渲染；人只看图、对着节点提意见，你再改。**不要算坐标、不要手画 SVG**，写文本就行。

## 基本流程

```
protoflow create_diagram --projectId <项目> --diagramId member --title "会员体系梳理"
# 在 diagrams/member/pages/ 下写页面文件，一页一个
protoflow build_diagram --projectId <项目> --diagramId member --note "初稿：会员等级和积分"
```

- 一个主题一个绘图，一个绘图可以有多页（比如一页脑图 + 两页流程图）。
- 每页一个文本文件，**扩展名决定写法**：`.md` 是 Markmap 脑图，`.mmd` 是 Mermaid。页 id = 文件名去掉
  扩展名，用英文或拼音 slug（`mind.md`、`order-flow.mmd`），别人引用某一页时写的就是它。
- 新建一个文件就多了一页：`build_diagram` 会把 `pages/` 里没登记的文件自动追加到 `pages.json` 末尾。
  只有调整页的顺序、改页名时才需要改 `pages.json`（`[{ "file": "mind.md", "name": "脑图" }]`）。
- **阅读页只显示定过版的内容**。改完一轮（比如处理完人的一批意见）就 `build_diagram(note:"…")` 定一个
  版本，把返回的 `url` 给人看。note 写清这一轮改了什么，人在版本下拉里靠它对比。
- 改页的文件名会让别人对这一页的引用失效，已经被引用的页别改名。

## 选写法

| 要表达的 | 写法 |
|---|---|
| 需求拆解、功能清单、信息架构、会员/权限这类层级结构 | `.md` 脑图 |
| 单线程的步骤、带判断分支的流程 | `.mmd` `flowchart` |
| 多个角色之间来回交接（用户 ↔ 系统 ↔ 第三方） | `.mmd` `sequenceDiagram` |
| 一个对象的状态怎么变（订单、审批） | `.mmd` `stateDiagram-v2` |
| 数据实体和关系 | `.mmd` `erDiagram` / `classDiagram` |

## 脑图（.md）

就是一份 Markdown 大纲：一级标题是中心主题，下面的标题和列表按层级展开成分支。

```markdown
# 会员体系

## 等级
- 普通会员
- 银卡
- 金卡

## 积分
- 获取
  - 下单返积分
  - 每日签到
- 消耗
  - 抵现
  - 兑换礼品
```

- 一个节点一句话，别塞长段落；要补充说明就拆成子节点。
- 行内可以用 **加粗**、`代码`、链接，其他块级元素（表格、代码块、图片）不要用。
- 还没想清楚的点也写成节点（如"待定：积分有效期"），让人一眼看到要决策的地方。

## Mermaid（.mmd）

第一行写图表类型（`flowchart TD`、`sequenceDiagram`、`stateDiagram-v2`……），跟 Mermaid 官方语法一致。
配色由阅读页统一设置，不用写 `init`。

**先选对图表类型，别拿 flowchart 硬凑：**

- **多个角色、角色之间来回交接**：用 `sequenceDiagram`，不要用 `flowchart` + `subgraph` 模拟泳道。
  `subgraph` 只是视觉分组，节点和跨组连线一多就会重叠交错。`sequenceDiagram` 里参与者天然并列，
  `alt`/`else`/`loop`/`opt` 原生支持分支和循环。代价是它是"竖版泳道"（时间往下走、角色横向并列）。
- **想要横版通栏泳道**（每个角色一条通栏、从左到右推进）：Mermaid 没有原生支持，换布局引擎、
  `flowchart TB` + `subgraph direction LR` 都实测过，效果都不理想。跟人说明这个限制，别硬凑。
- **单线程、没有交接的步骤序列**：`flowchart` 就够，不需要 `subgraph`。
- 确实要改某类图的排版参数时，用 frontmatter 的 `config`，并且放对位置：`flowchart:` 只对 flowchart
  生效，`sequence:` 只对时序图生效，放错不报错也不生效。

**复杂度是图本身决定的。** 步骤多、交接多、分支多，换哪种图都会体现在连线数量上。人觉得图太乱时，
先看是不是该拆成几页（比如主流程一页、异常分支一页），而不是怀疑排版引擎。

节点 id 用有意义的英文（`submit`、`pay`），不要 `A`、`B`、`C`：人提意见时复制过来的是节点 id，
有意义的 id 你一眼就知道是哪一个。

## 处理人的意见

人在阅读页上点选节点（⇧/⌘ 点击多选，空白处拖动框选），右键「标注」写意见，复制给你的文本长这样：

```
把"消耗"拆成抵现和兑换两支

[Protoflow 标注]
project: shop
kind: diagram
source: diagrams/member/pages/mind.md
version: v3 (head)
diagram: 会员体系梳理 (member)
page: 脑图 (mind) · 脑图
nodes:
  - path: 会员体系 > 积分 > 消耗   lines: 9-11
```

- 改 `source` 指向的草稿文件，`lines` 是那个版本里的行号（从 1 开始）。
- `version` 标了 `historical` 说明人看的是历史版本，先对比那一版和现在的草稿再改。
- 节点后面标了"按文字匹配"的，行号是按文字找的，可能不准，自己核对一下。
- `nodes: （整页）` 表示意见针对整页，不是某个节点。
- 改完这一批意见定一个版本，note 里写清改了哪些。

## 被别的产品引用

原型、文档是基于某张图做的，定版时声明引用，之后图变了能知道它们过期了：

```
protoflow build_canvas --projectId <项目> --note "按梳理做首版" --sources '["diagram:member@3#order-flow"]'
```
