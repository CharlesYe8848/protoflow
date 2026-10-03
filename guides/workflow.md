# ProtoFlow 工作流

ProtoFlow 是一个框架加几个独立产品：**画布**（可交互原型：页面、画板 JSX、元素标注）、**文档**
（`doc.md` markdown）、**表格**（`sheet.json` 数据 + CSS 样式）、**绘图**（脑图、流程图等，`.md` / `.mmd`
文本，自动排版）、**幻灯片**（每页一个 HTML，设计系统可换）。产品之间互不依赖，可以单独用，也可以
互相引用；文档（`embed` 代码块）、幻灯片（`<pf-embed>`）里还能直接嵌表格、绘图；做幻灯片按流程 skill `protoflow-slides` 走。模型负责写内容（JSX、标注、正文、表格数据、
绘图源码），工具负责编译、校验、定版、预览、导出。启用了哪些产品（有的可能被禁用、有的来自插件）用
`protoflow plugins` 看。

把几个产品串成某种流程（比如"原型 → PRD → 上线公告"）的模板、写作规范、截图和检查放在**流程 skill**
里（ProtoFlow 仓库的 `skills/` 目录，也可以装进 agent 的技能目录）。内置的 `protoflow-product-dev` 就是产品研发这条流程。流程 skill 用产物的**标签**（`labels`）认出自己管的产物。
任务涉及 PRD、上线公告、从原型出文档时，先读它的 SKILL.md。

## 怎么调用

所有工具都是 `protoflow <工具> --参数 值`（`protoflow --help` 列出全部，`protoflow help <工具>` 看参数）；本指南
里写成 `工具(参数:值)` 的地方就对应这个写法。参数值是 JSON 就按 JSON 解析，写成 `@文件` 就读文件内容（长正文
不用在命令行里转义）。

## 先恢复项目，再选场景

- 用户开着 ProtoFlow 的页面（地址 `http://127.0.0.1:<端口>/p/<项目>/…`）时，`get_project --url <这个地址>`，之后
  每个命令都带同一个 `--url`。
- 否则用 `--projectId <项目文件夹名> --dir <父目录>`；父目录已知但项目不明确时先 `list_projects`；多个候选无法
  消歧时询问，不新建同名项目替代。
- `get_project` 返回项目文件夹 `projectDir`、结构、项目图谱和健康摘要，结构化信息只从这里拿，不去翻登记表或
  ProtoFlow 源码；加 `--findings true` 带上完整的健康检查项。
- 新建请求才 `create_project`；项目尚未创建时不做健康检查。

按本次交付物选择路径。组合任务按需连接路径；具体修改不重新访谈，已有信息不重复询问。
`get_guide` 传 `{ "topic": "主题" }`，只读选中场景所需指南。

| 场景 | 按需读取 | 操作与完成标准 |
| --- | --- | --- |
| 梳理思路（需求拆解、流程、状态，做原型之前） | `diagram` | 已有绘图直接编辑 `diagrams/<diagramId>/pages/` 下的文件；新的才 `create_diagram`。一页一个文件（`.md` 脑图、`.mmd` Mermaid），写完 `build_diagram(note:"这次改了什么")` 定版并交付 URL。人用右键「标注」复制意见给你，改完一轮定一个版本。 |
| 新建原型 | `artboard`（画板只做界面原型，图用绘图） | 根据本次目的选择静态、交互或混合表达 → `create_project` → `upsert_page` / `upsert_artboard` → `save_artboard_source` → `build_canvas(note:"这次做了什么")`。检查所选表达及已实现的交互逻辑并返回画布 URL；未要求标注或文档则到此结束。 |
| 修改已有原型 | `artboard` | 按下节"修改已有原型的闭环"执行，改完一轮 `build_canvas(note:"这次改了什么")` 定一个新版本再交付。保留结构和稳定元素 ID；引用了它的产物过期时按本次范围处理或报告。 |
| 补充或核对元素标注 | `annotation` | `get_annotations` 与目标源码 → 核对规则和实际状态 → `write_annotations` → `get_project(findings:true)`。引用必须有效，交互后出现的元素按需提供 refs。 |
| 写或更新文档 | `doc-writing`；属于某种流程的文档（PRD、上线公告）先读对应的流程 skill | 已有文档直接编辑 `docs/<docId>/doc.md`；新文档才 `create_doc`（有现成正文就传 `content`）。写完 `build_doc(note:"这次改了什么")` 定版并交付 URL。只要草稿或明确暂不定版时停在草稿。 |
| 从原型出 PRD / 上线公告 | 流程 skill `protoflow-product-dev` | 按它的 SKILL.md：画布定版 → 截图脚本 → 写正文 → 检查脚本 → 定版。 |
| 新建或更新表格（结构化数据、报表） | `sheet-schema` | 已有表格直接编辑 `sheets/<sheetId>/sheet.json`；新表格才 `create_sheet`。写完 `build_sheet(note:"这次改了什么")`，检查校验错误并交付 URL。只要草稿或明确暂不定版时停在草稿。 |
| 检查变更影响 | 无需额外写作指南 | `get_project(findings:true)` → 解释受影响对象、原因、建议动作。只检查时到此结束，不修改源文件、不定版。请求修复时再进入对应路径。流程约定（比如 PRD 有没有关联原型）用流程 skill 的体检脚本。 |
| 只预览 | 无需额外写作指南 | 画布用 `render_canvas`，想看特定画板传 `artboardId`；文档、表格用定版工具返回的 URL。使用返回 URL；不因健康提示强制重建。 |
| 只导出 | 无需额外写作指南 | 画布用 `export_canvas`；文档用 `export_doc`；表格用 `export_sheet`（固定导出 `.xlsx`，尽力还原样式和合并单元格）；绘图用 `export_diagram`（单页 HTML 或源文件包）；幻灯片用 `export_deck`（单个 HTML 或源文件包）。导出的都是最新版本；若只有草稿或用户要导出未定版改动，先说明版本选择，不能把旧版当最新草稿交付。返回实际文件路径。 |
| 删除 | 无需额外写作指南 | 先跟用户确认（不可恢复）。整个产物 `delete(targetId:"canvas:main")`（或 `doc:<id>`、`sheet:<id>`、`diagram:<id>`），页面/画板 `delete(targetId:"pg_…"/"ab_…")`。返回 warning 时告诉用户哪些产物的引用失效了。不要自己 `rm` 项目目录里的文件。 |
| 发布到渠道 | 适用的渠道指南，如 `publish-dingtalk`；属于某个流程 skill 的按它做发布前检查 | 仅在请求发布时使用平台工具。成功后 `record_publish` 登记（`kind` 是产物类型，缺省文档）；仅请求本地交付时不调用渠道工具。 |

## 修改已有原型的闭环

1. 用 `get_project(findings:true)` 获取当前结构和现有问题，读取目标源码和已有标注，区分既有问题与
   本次改动影响。
2. 修改源码并用 `save_artboard_source` 保存，检查返回的 `idAudit`。保留稳定元素 ID；如果元素、
   交互或语义变化影响已有标注，实际核对后用 `write_annotations` 更新。纯视觉变化且语义不变时
   不必重写标注。
3. 验证本次影响的交互链路，包括用户操作、状态变化和可见结果。源码检查不能确认，或用户明确
   要求验收时，再用浏览器实测。
4. 再次 `get_project(findings:true)`，解决本次改动造成的 broken/review 项。只改原型时不自动更新引用了它的
   文档或表格，报告它们过期即可；任务包含同步时再交给对应的流程 skill。
5. `build_canvas(note:"这次改了什么")` 定一个新版本，交付返回的画布 URL。没定版的改动不会出现在
   画布页上。

显式指定 ProtoFlow 写独立文档或表格时，直接从对应路径进入，不强制新建画板。
普通独立 PRD 写作、需求讨论、生产应用开发或明确指定其他工具的任务，不自动创建项目。

## 多个画布

一个项目可以有多个画布（比如管理端、员工端、实验方案 A/B），各有自己的页面、画板和版本；`get_project`
的 `canvases` 列出全部。要新开一个用 `create_canvas`。只有一个画布时各工具不用传 `canvasId`；有多个时
`upsert_page`（新建）、`render_canvas`、`build_canvas`、`export_canvas` 要传。画板 id 整个项目唯一，
画板级工具不用传画布。

## 版本

画布、文档、表格、绘图同一个模型：改完一轮用定版工具（`build_canvas` / `build_doc` / `build_sheet` / `build_diagram` / `build_deck`，`note`
写这次改了什么）定一个新版本；页面默认显示最新版本，`?v=<n>` 看历史版本；没定版的改动不会出现在
这些页面上（画布从没定过版时显示当前源文件，单画板预览始终实时，画布上悬浮画板点右上角新标签图标单独打开它，改完自查用它）。

## 引用

一个产物的某一版用到了项目里另一个产物的内容，就记一条引用，格式 `类型:id@版本#子部位`（如
`canvas:main@3#ab_123` 画布第 3 版的某块画板、`doc:prd@5`、`sheet:matrix@2#汇总` 表格的某个 sheet、
`diagram:member@2#order-flow` 绘图的某一页）。

- 定版工具都接受 `sources`；不写 `@版本` 就固定到对方当前最新版；不传就沿用上一版声明的，传 `[]` 清空。
- 截图等素材旁边带 `<文件>.source.json` 出处文件的，定版时自动收进来，不用写。
- `get_project` 的 `graph` 列出每个产物最新版的引用和状态（fresh / stale / missing）。
- 框架只报事实（引用的内容变没变），不判断该不该引用、变化要不要紧——那是流程 skill 和你按任务判断的。

## 标签

画布、文档、表格、绘图都可以带标签 `labels`（字符串数组，如 `["product-dev/prd"]`）：建的时候传，或者用
`set_labels` 整组替换。框架只存、在 `get_project` 的 `graph` 里原样返回，不解释含义；流程 skill 用它
认出自己管的产物。

## 检查与修复不同

`get_project(findings:true)` 里的健康检查是只读的：计算当前内容与已登记基线的差异，不编译、不更新基线、不创建版本。
修改前可检查以区分原有问题，修改后检查影响；单纯预览不必先做整条链修复。

| 发现项 | 请求修复时的动作 |
| --- | --- |
| broken：元素/引用丢失（标注引用的元素，或引用的产物、画板已删除） | 查明是否删除或改名，修复相关引用，不伪造原对象 |
| unvalidated：源码外部修改未校验 | 读取当前源码，通过 `save_artboard_source` 编译并保存，成功才更新源码基线 |
| review：标注待核对 | 对照源码核对标注，再 `write_annotations` 保存；不要仅为消除提示原样盖章 |
| uncommitted：画布/文档/表格/绘图有没定版的改动 | 按交付需要定版；允许保留草稿 |
| drifted：最新版引用的内容之后变了（`ref_stale`） | 回看变化；需要跟进就更新内容，定新版本时重新声明引用；不改历史版本。要不要跟进按任务判断 |
| lagging：已发布的版本引用的内容变了 | 核对上游；只有请求包含更新/发布时继续对应操作 |
| advice：建议（比如画板里画了 Mermaid 图） | 不处理也不影响使用；用户要整理时再按建议做 |

## 持久化与完成边界

- 原型按 `artboard` 指南做轻量检查后交付预览；浏览器验收按需触发，不作为日常设计的固定步骤。
- 项目文件是事实来源，沿用 `project.json`、源码、标注、`doc.json`，不另建进度状态。
- `versions/` 和 `objects/` 是不可变历史；指纹、head、引用等派生字段由工具维护，不手改。
- 本次产物和必要验证完成即可结束；如实说明待核对或待发布事项，不为"全绿"扩大范围。
