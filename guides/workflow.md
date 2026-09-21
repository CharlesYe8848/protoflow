# ProtoFlow 场景工作流

链路：原型 → 元素标注 → 文档版本 → 渠道发布。它描述产物关系，不要求每次完成整条链。
模型负责 JSX、标注与文档内容；工具负责编译、引用校验、指纹、截图、构建和导出。

## 先恢复项目，再选场景

已有项目用 `get_project` 读取结构和健康摘要；`projectId` 是项目文件夹名，`dir` 是父目录。
父目录已知但项目不明确时再 `list_projects`；多个候选无法消歧时询问，不新建同名项目替代。
新建请求才 `create_project`；`import_project` 只接受 ProtoFlow 格式目录，不能直接导入任意
HTML、Figma 或 React 仓库。项目尚未创建时不调用 `chain_status`。

按本次交付物选择路径。组合任务按需连接路径；具体修改不重新访谈，已有信息不重复询问。
`get_guide` 传 `{ "topic": "主题" }`，只读选中场景所需指南。

| 场景 | 按需读取 | 操作与完成标准 |
| --- | --- | --- |
| 新建原型 | `artboard`；画板需要流程/时序图再读 `diagram` | 根据本次目的选择静态、交互或混合表达 → `create_project` → `upsert_page` / `upsert_artboard` → `save_artboard_source` → `render_canvas`。检查所选表达及已实现的交互逻辑并返回预览；未要求标注或文档则到此结束。 |
| 修改已有原型 | `artboard` | 读取目标源码 → `chain_status` 了解既有问题 → 修改并 `save_artboard_source` → 检查受影响交互逻辑 → 再检查链路。保留结构和稳定元素 ID；下游过期按本次范围处理或报告。 |
| 补充或核对元素标注 | `annotation` | `get_annotations` 与目标源码 → 核对规则和实际状态 → `write_annotations` → `chain_status`。引用必须有效，交互后出现的元素按需提供 refs；不自动生成 PRD。 |
| 从原型交付或更新文档 | `doc-writing`；需要新截图再读 `capture` | 按下节文档路径执行。交付要求的正文、图片和版本；不自动发布。 |
| 检查变更影响 | 无需额外写作指南 | `chain_status` → 解释受影响对象、原因、建议动作。只检查时到此结束，不修改源文件、不定版。请求修复时再进入对应路径。 |
| 只预览原型 | 无需额外写作指南 | `render_canvas`，需要特定画板时可用 `render_preview`。使用返回 URL；不因健康提示强制重建文档。 |
| 只导出 | 无需额外写作指南 | 原型用 `export_canvas`；文档用 `export_doc`。文档导出的是 head 版本，先核对 `doc.json`；若只有草稿或用户要导出未定版改动，明确版本选择，不能把旧版当最新草稿交付。返回实际文件路径。 |
| 发布到渠道 | 适用的渠道指南，如 `publish-dingtalk` | 仅在请求发布时使用平台工具。先核对版本和检查项，成功后 `record_publish`；仅请求本地交付时不调用渠道工具。 |

## 文档路径

1. 从项目目录读取已有 `docs/<docId>/doc.json` / `doc.md`，确认更新还是新建。
   `get_doc_kind({ projectId, dir, kind })` 返回模板和写作规则。已有文档直接编辑；
   新文档才 `create_doc`，派生文档用 `from` 记录上游。
2. 基于原型写作时读取相关源码和标注，不把未经核对的标注当作事实。按请求范围运行
   `chain_status` 判断断链、标注待核对或旧截图。
3. 需要新画板截图时，按 `capture` 指南准备 `.build/captures.json` →
   `build_doc(mode:"snapshot")` → `build_publish_pack(mode:"previews")` →
   自动 `capture` 或手动截图 → `seal`。复用仍适用的截图或纯文字修改不重跑截图流水线。
4. 写 `doc.md`，用 `![](assets/<file>)` 引用图片。完成本轮交付时按类型规范
   `build_doc(mode:"finalize", note:"本轮具体修改")`，检查 findings 并交付 URL。
   只要草稿或要求暂不定版时停止在草稿，说明阅读页仍显示 head 版本。

显式指定 ProtoFlow 写独立文档时，可从文档路径进入，不强制新建画板。
普通独立 PRD 写作、需求讨论、生产应用开发或明确指定其他工具的任务，不自动创建项目。

## 检查与修复不同

`chain_status` 是只读检查：计算当前内容与已登记基线的差异，不编译、不更新基线、不创建版本。
修改前可检查以区分原有问题，修改后检查影响；单纯预览不必先做整条链修复。

| 发现项 | 请求修复时的动作 |
| --- | --- |
| broken：元素/引用丢失 | 查明是否删除或改名，修复相关引用，不伪造原对象 |
| unvalidated：源码外部修改未校验 | 读取当前源码，通过 `save_artboard_source` 编译并保存，成功才更新源码基线 |
| review：标注待核对 | 对照源码核对标注，再 `write_annotations` 保存；不要仅为消除提示原样盖章 |
| uncommitted：文档草稿未定版 | 按交付需要 finalize；允许保留草稿 |
| drifted：文档引用的画板已变化 | 更新受影响的内容/截图并创建新版本，不改历史快照 |
| lagging：渠道或派生文档落后 | 核对上游；只有请求包含更新/发布时继续对应操作 |

## 持久化与完成边界

- 原型按 `artboard` 指南做轻量检查后交付预览；浏览器验收按需触发，不作为日常设计的固定步骤。
- 项目文件是事实来源，沿用 `project.json`、源码、标注和 `doc.json`，不另建进度状态。
- 原型预览是源文件实时投影，刷新即最新；文档阅读页来自 finalize 版本，草稿修改不会自动更新它。
- `versions/<n>/` 是不可变历史；指纹、head 等派生字段由工具维护，不手改。
- 文档类型由 `doc-kinds/<kind>/` 的模板、写作规范和检查器定义，项目本地可覆盖或新增。
- 本次产物和必要验证完成即可结束；如实说明待核对或待发布事项，不为“全绿”扩大范围。
