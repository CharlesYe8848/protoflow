---
name: protoflow-product-dev
description: >-
  ProtoFlow 的产品研发流程：梳理（绘图）→ 原型画布 → PRD → 上线公告。基于 ProtoFlow 原型写或更新 PRD、上线公告，
  按标注截原型图，发布前检查，看 PRD/公告是否落后于原型时使用。只做原型、独立文档或表格不用它；
  不确定该用哪个时先看 /protoflow。
metadata:
  requires-products: "canvas, doc"
---

# 产品研发流程：梳理 → 原型 → PRD → 上线公告

ProtoFlow 的绘图、画布、文档、表格是彼此独立的产品，这个 skill 把它们串成产品研发流程。框架和产品都不
认识这条流程：模板、写作规范、截图、检查、"PRD 应该关联原型"这类约定都在这个目录里。

开始前先跑 `protoflow plugins`，确认这个 skill 需要的产品（画布 canvas、文档 doc；梳理那一步用到绘图 diagram）
都已启用：`skills` 里本 skill 的 `missing` 不为空，就先告诉用户启用对应的插件，不要跑到一半才报错。

工具的通用用法（项目、绘图、画布、文档、表格、版本、引用、标签）见 `get_guide({"topic":"workflow"})`，这里
只写这条流程特有的部分。

## 这个 skill 管哪些文档

用标签认：PRD 打 `product-dev/prd`，上线公告打 `product-dev/release-note`。建文档时传 `labels`；已有
文档没打标签的用 `set_labels({ projectId, type:"doc", id:"<docId>", labels:[…] })` 补上。检查和体检脚本
只认带这两个标签的文档（检查也可以用 `--type` 临时指定）。

## 目录

| 文件 | 用途 |
| --- | --- |
| `references/prd-template.md` / `prd-writing.md` | PRD 模板、写作规范（呈现形式、截图、何时定版） |
| `references/release-note-template.md` / `release-note-writing.md` | 上线公告模板、写作规范 |
| `references/capture.md` | 截图：captures.json 的分组原则、定位标记、截图脚本用法 |
| `scripts/capture.mjs` | 对已定版的画布截图，图片旁边带出处文件 |
| `scripts/check.mjs` | 文档检查（开放问题未闭环、修改记录表标记、公告 FAQ 数量和标题格式……） |
| `scripts/status.mjs` | 关系体检：PRD 有没有关联原型、公告有没有基于 PRD、引用的内容变没变 |

下面的 `<skill 目录>` 就是这个 SKILL.md 所在的目录（没安装时是 ProtoFlow 仓库的 `skills/protoflow-product-dev/`）。
脚本用 `node <skill 目录>/scripts/<脚本> <项目目录> …` 运行（项目目录就是 `get_project` 返回的 `projectDir`），只调 protoflow 的 CLI。命令的写法见 `/protoflow`：
下面写成 `工具({ 参数 })` 的地方对应 `protoflow 工具 --参数 值`，用户开着 ProtoFlow 页面时用 `--url <页面地址>` 定位项目。

## 流程

### 0. 梳理（可选，需求还没想清楚时）

需求拆解、主流程、状态变化还不清楚时，先按 `get_guide({"topic":"diagram"})` 画出来给人看：脑图
（`.md`）拆需求，Mermaid（`.mmd`）画流程和状态。人在阅读页上对节点右键「标注」复制意见给你，你改完
一轮就 `build_diagram(note:"…")` 定一个版本。人确认后再进入原型。需求已经清楚、或用户直接要原型时跳过。

### 1. 原型

按 `get_guide({"topic":"artboard"})` 画原型，改完一轮 `build_canvas(note:"…")` 定一个版本。原型是按
梳理出来的图做的，定版时声明引用（`sources:["diagram:<id>@<n>#<页>"]`），之后图改了能看出原型跟没跟上。
要写 PRD 之前原型必须定版：截图只截已定版的画布，PRD 引用的是"第几版原型"。

### 2. PRD

1. 读 `references/prd-template.md` 和 `references/prd-writing.md`。
2. 新 PRD：把模板代码块里的 markdown 存成一个临时文件，`protoflow create_doc --url <页面地址> --docId prd
   --title "<主题>" --content @<临时文件> --labels '["product-dev/prd"]'`。同项目多篇 PRD 时 `docId` 取别的名字（可含中文）。已有 PRD 直接编辑
   `docs/<docId>/doc.md`，不重复创建。
3. 需要截图：按 `references/capture.md` 写 `docs/<docId>/captures.json`，运行
   `node <skill 目录>/scripts/capture.mjs <项目目录> <docId>`。截图和出处文件直接落进 `assets/`，
   定版时自动成为"这一版 PRD 基于原型第几版的哪些画板"的引用。能用 Mermaid 表达的关系/流程
   不截图（见 prd-writing.md「呈现形式」）。
4. 写正文，图片用 `![](assets/<captureId>.png)` 引用。
5. `node <skill 目录>/scripts/check.mjs <项目目录> <docId>` 检查，处理 error / warn。
6. `build_doc({ projectId, docId, note:"这一版改了什么" })` 定版。

### 3. 上线公告

1. 读 `references/release-note-template.md` 和 `references/release-note-writing.md`。
2. 模板代码块存成临时文件，`protoflow create_doc --url <页面地址> --docId release-note --title "<主题>"
   --content @<临时文件> --labels '["product-dev/release-note"]' --from <prd 的 docId>`：`from` 让公告的第一版引用 PRD 当前最新版。
3. 写正文，`check.mjs` 检查，`build_doc` 定版。公告跟上了新版 PRD 时，定版传
   `sources:["doc:<prd 的 docId>"]` 重新声明（固定到 PRD 当前最新版）。

### 4. 发布到渠道

只在用户要求发布时做（如钉钉：`get_guide({"topic":"publish-dingtalk"})`）。发布前先跑 `check.mjs`：
有 error（比如 `**需要与研发确认**` 这类开放问题没闭环）就不发，先跟用户确认；用户明确接受带着
问题发布才继续。发布成功后 `record_publish({ projectId, docId, channel, channelDocId, url })` 登记。

### 5. 原型改了之后

`node <skill 目录>/scripts/status.mjs <项目目录>` 看关系：

- `SOURCE_STALE`：PRD 截图所在的画板在新版原型里改过 / 公告基于的 PRD 出了新版。回看变化，需要跟进
  就重截图或更新内容，再定新版本；改个错别字这种不影响的可以不跟。
- `PRD_NO_CANVAS`：PRD 没有引用任何原型——截图不是用截图脚本截的（没有出处），或者根本没截图。
- `RELEASE_NOTE_NO_PRD`：公告没有基于任何 PRD。

`get_project --findings true` 也会报引用过期（`ref_stale`），这是框架给的事实；要不要跟、怎么跟由这个 skill 和用户
决定。只改原型时不自动重写 PRD，报告落后即可。

## 约定

- **修改记录表**：PRD 在正文放 `<!-- protoflow:changelog -->` 标记，定版时自动生成整表；上线公告
  面向业务/客户，不放。
- **开放问题**：真正待定的事用 `**…需要与研发确认…**` 这类加粗短语标出来，`check.mjs` 报 error，
  发布前必须闭环或经用户同意。
- **定版时机**：起草完交付初稿、按一轮评审意见改完、从上游派生完各定一版；`note` 写这次改了什么，
  不写版本号。用户只要草稿时不定版。
