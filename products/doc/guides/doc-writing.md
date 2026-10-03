# 文档撰写通用规范（doc.md）

文档产品本身的用法，跟写什么类型的文档无关。PRD、上线公告这类属于某种流程的文档，模板、写作
规范和检查在流程 skill 里（比如 `protoflow-product-dev`，在 ProtoFlow 仓库的 `skills/` 目录），不在这里。

## 心智

- `docs/<docId>/doc.md` 就是这份文档的正文本身，手写 markdown。
- 文档有身份（`docs/<docId>/`），版本没有 id——就是从 1 递增的整数下标 `<n>`。
- 只有显式 `build_doc(note:"…")` 才产生一个版本，不是每次编辑自动切。

## 流程

1. 属于某种流程的文档先读对应的流程 skill（比如 PRD：`protoflow-product-dev`）。
2. 新文档才 `create_doc({ docId, title?, content?, labels?, from? })` 起草。`content` 是初始正文（CLI 里写 `--content @文件`）（比如从流程
   skill 的模板起草好的 markdown），不传就是只有一级标题的空文档；`labels` 是流程 skill 认文档用的标签
   （如 `["product-dev/prd"]`），框架不解释。已有文档直接编辑，不重复创建。`from:"<上游docId>"` 记来源（如上线公告基于 PRD），成为第一版的
   引用 `doc:<上游docId>@<版本>`，之后的版本沿用；上游出了新版本，`get_project(findings:true)` 会报这条引用过期。
3. 写 `doc.md` 正文，图片放进 `docs/<docId>/assets/`，用 `![](assets/<file>)` 引用。图片旁边带出处文件
   （`<文件>.source.json`，比如流程 skill 的截图脚本写的）时，定版会自动记下引用。
4. `build_doc(note:"这一版改了什么")`：校验图片引用、收集引用、冻结成第 `<n>` 版、重渲染 `preview.html`。
   用到了项目里其它产物的内容（表格数据、别的文档）就传 `sources` 声明。
5. 仅请求渠道发布且平台发布成功后，`record_publish({ docId, channel, channelDocId, url? })` 登记。
   发布前要不要检查、检查什么，按流程 skill 来。

## 何时定版（finalize）

- 用户只要求草稿或明确暂不定版 → 保留 `doc.md`，不 finalize；阅读页仍是 head 版本
- 起草完待交付初稿 → `build_doc(note:"首版")`
- 按一轮评审意见改完 → `build_doc(note:"补充异常兜底与空态")`
- 从上游文档派生完 → `build_doc(note:"首版")`
- `note` 就是修改记录表「修改内容」列，一句话说清这次改了什么，**不要写版本号**
- 不想为某个小改动单独留版本 → 先不 finalize，攒到下次一起
- 已 `record_publish` 的版本冻结，之后的改动进下一个版本
- `get_project(findings:true)` 里 `doc_uncommitted` 提示"doc.md 有未定版改动"——不强制，按需 finalize

## 修改记录表

想要这张表就在正文里放一个 `<!-- protoflow:changelog -->` 占位标记，**不要手写表格行**——每次
finalize 按 `versions[].note` 自动在标记原地生成整表（版本｜修改日期｜修改人｜修改内容），累积
全部历史版本。不想要这张表（比如面向业务/客户的文档），正文里就不要写这个标记——某种文档要不要，
看它所在流程 skill 的写作规范，这里只讲这个标记本身怎么用。
版本历史不受影响，一直完整存在 `doc.json`/`versions/` 里，只是不放这个标记就不在正文渲染出来。

「修改人」列默认取 `PROTOFLOW_AUTHOR` 环境变量，没设就取本机登录用户名；某次要写别的名字，
`build_doc(note:"…", author:"张三")` 传一下即可。

## 图片引用

- 只认 `![](assets/<file>)` 一种本地来源——finalize 会校验这些文件都在 `docs/<docId>/assets/` 下。
- 外部图床 / 手画图用完整 URL（`http://` / `https://`），不受这条约束。

## 表格

分隔符统一用 `:---`（强制左对齐），不要用 `:-:`（居中）或裸 `---`（有些渲染器默认居中）。

## 流程图

用 mermaid fenced code block（` ```mermaid `），本地预览会渲染成图（带"预览/代码"切换），
不转成图片。

## 嵌入别的产物（表格、绘图……）

项目里已有的表格、绘图可以直接嵌进正文，不用截图、不用抄一份：一个 `embed` 代码块，里面一行引用。

````markdown
```embed
sheet:sales#汇总
```
````

- 引用格式同 `sources`：`类型:id@版本#子部位`。表格的子部位是 sheet 名（不写给第一个 sheet），绘图的子部位
  是页 id（不写给全部页）。一般不写 `@版本`：`build_doc` 会把它固定到对方当时的最新版，记进这一版的引用
  （`via: "embed"`），之后阅读页、导出都按记下的版本展开，对方再改只会让引用变成过期、不会悄悄换内容。
- 表格嵌成表格（Word 导出里是原生表格），Mermaid 绘图嵌成流程图，脑图嵌成层级列表。
- 引用写错、对方不存在，`build_doc` 直接报错；对方产品之后被禁用，阅读页显示一个占位，导出不失败。

## 标题

第一行 `# 标题` 会被当作这份文档在 `list_docs` / 画布菜单里的标题。不要把版本号写进标题——
版本另有整数序号，画布菜单会单独展示。
