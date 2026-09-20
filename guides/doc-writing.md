# 文档撰写通用规范（doc.md）

跨文档类型都适用的约定。类型专属的模板和检查清单用 `get_doc_kind("<kind>")`（返回该类型的
template.md + writing.md），不在这里。

## 心智

- `docs/<docId>/doc.md` 就是这份文档的正文本身，手写 markdown。
- 文档有身份（`docs/<docId>/`），版本没有 id——就是 `versions/<n>/` 的整数下标。
- 只有显式 `build_doc(mode:"finalize", note:"…")` 才产生一个版本，不是每次编辑自动切。

## 流程

1. `get_doc_kind("<kind>")` 看该类型的模板和规范。
2. 新文档才 `create_doc({ kind, docId?, from? })` 起草——`doc.md` 会按模板初始化。已有文档直接编辑，不重复创建。`docId` 缺省 = kind 名。
   `from:"<上游docId>"` 记来源（如上线公告基于 PRD），写进 `doc.json.origin`。
3. 写 `doc.md` 正文。用画布截图当上下文的类型（contextSource:"canvas"，如 PRD）走截图流水线
   （见 get_guide("capture")）：`.build/captures.json` → `build_doc(mode:"snapshot")` →
   `build_publish_pack` previews/capture/seal → 截图落进 `assets/`，正文用 `![](assets/<file>)` 引用。
4. `build_doc(mode:"finalize", note:"这一版改了什么")`：校验图片引用、算指纹、冻结成 `versions/<n>/`、
   重渲染 `preview.html`、跑该类型的 checks。
5. 仅请求渠道发布且平台发布成功后，`record_publish({ docId, channel, channelDocId, url? })` 登记——error 级 check finding
   会拦截（传 `acknowledgeFindings:true` 跳过）。

## 何时定版（finalize）

- 用户只要求草稿或明确暂不定版 → 保留 `doc.md`，不 finalize；阅读页仍是 head 版本
- 起草完待交付初稿 → `finalize(note:"首版")`
- 按一轮评审意见改完 → `finalize(note:"补充异常兜底与空态")`
- 从上游文档派生完 → `finalize(note:"首版")`
- `note` 就是修改记录表「修改内容」列，一句话说清这次改了什么，**不要写版本号**
- 不想为某个小改动单独留版本 → 先不 finalize，攒到下次一起
- 已 `record_publish` 的版本冻结，之后的改动进下一个版本
- `chain_status` 里 `doc_uncommitted` 提示"doc.md 有未定版改动"——不强制，按需 finalize

## 修改记录表

想要这张表就在正文里放一个 `<!-- protoflow:changelog -->` 占位标记，**不要手写表格行**——每次
finalize 按 `versions[].note` 自动在标记原地生成整表（版本｜修改日期｜修改人｜修改内容），累积
全部历史版本。不想要这张表（比如面向业务/客户的类型），正文里就不要写这个标记——具体某个类型
要不要，看 `get_doc_kind("<kind>")` 返回的 writing.md 怎么说，这里只讲这个标记本身怎么用。
版本历史不受影响，一直完整存在 `doc.json`/`versions/` 里，只是不放这个标记就不在正文渲染出来。

「修改人」列默认取 `PROTOFLOW_AUTHOR` 环境变量，没设就取本机登录用户名；某次要写别的名字，
`build_doc(mode:"finalize", author:"张三")` 传一下即可。

## 图片引用

- 只认 `![](assets/<file>)` 一种本地来源——finalize 会校验这些文件都在 `docs/<docId>/assets/` 下。
- 外部图床 / 手画图用完整 URL（`http://` / `https://`），不受这条约束。

## 表格

分隔符统一用 `:---`（强制左对齐），不要用 `:-:`（居中）或裸 `---`（有些渲染器默认居中）。

## 流程图

用 mermaid fenced code block（` ```mermaid `），本地预览会渲染成图（带"预览/代码"切换），
不转成图片。

## 开放问题

真正悬而未决、需要跟研发/干系人确认才能定的事，用 **加粗** 包住含"确认"/"待补充"字样的短语
标出来（`**需要与研发确认**`、`**技术方案待确认**`）。`record_publish` 会扫描这类标记并拦截
发布，直到确认清楚回填、或显式 `acknowledgeFindings:true`。

## 标题

第一行 `# 标题` 会被当作这份文档在 `list_docs` / 画布菜单里的标题。不要把版本号写进标题——
版本另有整数序号，画布菜单会单独展示。
