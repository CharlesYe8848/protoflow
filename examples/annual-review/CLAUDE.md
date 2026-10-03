# annual-review（ProtoFlow 项目）

ProtoFlow 项目：画布（`canvases/`，可交互原型：页面、画板 JSX、元素标注）、文档（`docs/`，markdown）、表格（`sheets/`，数据 + 样式）、绘图（`diagrams/`，脑图、流程图等，文本写、自动排版）、幻灯片（`decks/`，每页一个 HTML，样式随意写，可嵌表格、绘图，可配置自动翻页和音频）是彼此独立的产品，可以单独用，也可以互相引用（见下面的「引用」）。
把它们串成某种流程（比如原型 → PRD → 上线公告）的模板、写作规范、截图和检查在流程 skill 里
（ProtoFlow 仓库的 `skills/` 目录，内置 `protoflow-product-dev`）。这个文件夹本身就是全部状态——`project.json`、
`canvases/`、`docs/`、`sheets/`、`diagrams/`、`decks/` 都是普通文件，可以直接复制、移动、纳入 git，不依赖任何常驻服务。

## 文件布局

- `project.json` — 项目名 + `formatVersion`（存储格式版本；旧格式的项目工具会报 `FORMAT_OUTDATED`，先跑
  `node <protoflow 仓库路径>/bin/protoflow-migrate.mjs <父目录> --apply`）
- `canvases/<canvasId>/` — 一个画布（一个项目可以有多个，比如管理端、员工端；老项目迁过来的叫 `main`）。
  `create_canvas` 新建；只有一个画布时各工具不用传 `canvasId`，有多个时建页面、看画布、定版、导出要传
  - `canvas.json` — 画布名 + 页面 id 列表 + 版本记录（见下）
  - `icons.jsx`（可选）— 覆盖项目根的 `icons.jsx`
- `canvases/<canvasId>/pages/<pageId>/page.json` — 页面名 + 画板 id 列表。页面 id、画板 id 在整个项目里唯一
- `canvases/<canvasId>/pages/<pageId>/artboards/<artboardId>/`
  - `source.jsx` — 画板源码，须定义名为 `Component` 的组件
  - `meta.json` — 名称/描述/canvasWidth/`lastValidatedHash` / `annotationsValidatedHash`（派生字段，见下）
  - `annotations.md` — 这块画板的标注，一篇 markdown。要指向具体元素时写行内链接
    `[显示名](#el/元素id)`（元素 id = `source.jsx` 里该节点的 `id`）
  - `annotations.refs.json`（可选）— `{ 元素id: { interactionPath:[…] } }`，标注里引用的元素若
    需要先点开/悬浮才可见，把定位步骤记在这里；没有就不生成这个文件
- **单画板预览和整站画布不是文件**——它们是这些源文件的实时投影，由本地预览服务按需渲染
  （`render_canvas` 返回的 `http://127.0.0.1:<port>/…` 地址）。改了
  `source.jsx` / `annotations.md`、加删页面画板、git checkout / 编辑器 Undo，刷新已打开的
  浏览器标签即最新，不需要重新跑任何工具。例外是画布定过版之后：整站画布显示最新版本，改动要
  `build_canvas` 定版后才出现在画布上（单画板预览仍然实时）。
- `canvases/<canvasId>/` 里的版本，跟文档/表格一样：改完一轮 `build_canvas(note:"…")` 定一个新版本
  - `canvas.json` — `{ title, pageIds, head, versions:[{ n, note, author, builtAt, canvasHash, sources }] }`
  - `versions/<n>.json` — 不可变版本清单：冻结时整个画布（`pages.json`、`icons.jsx`、
    `pages/<pageId>/…` 下的 page.json 和各画板目录的全部文件）→ 内容哈希，文件本体在 `objects/`
  - 画布页（`render_canvas` 的 url）默认显示最新版本，`?v=<n>` 看历史版本；没定版的改动不会
    出现在画布页上（从没定过版的画布显示当前源文件）
  - 第 n 版某块画板的预览地址（截图脚本等外部工具依赖的公开约定，保持兼容）：本地服务上的
    `canvases/<canvasId>/versions/<n>/pages/<pageId>/artboards/<artboardId>/preview.html`；预览页 `<head>` 里
    `<meta name="protoflow-artboard" content='{"id","canvasWidth","canvasHeight"}'>` 声明画板宽度；元素用
    源码里的 `id` 定位，交互状态用标准 DOM 操作切换
- `docs/<docId>/` — 文档。`docId`（= 目录名）用模板建时默认 = 模板名（`docs/prd/`、
  `docs/release-note/`）；同模板要多篇或不用模板时显式传 `docId`（可含中文）。`doc.md` 一级标题
  只写这篇的主题一句话，不带项目名 / 不带「PRD」之类类型字样 / 不带版本号（`create_doc` 传
  `title` 会自动填好）。写法见 `get_guide({topic:"doc-writing"})`。
  - `doc.md` — 当前工作草稿，唯一必须手写的正文（不是结构化 JSON 驱动生成）
  - `doc.json` — `{ title, labels?, head, versions:[{ n, note, author, builtAt, docHash, sources, publishedTo }] }`。
    `head` 是"当前是哪个版本"的唯一真相源；`labels`（如 `["product-dev/prd"]`）是流程 skill 认文档用的
    标签，框架不解释（其他产品的元信息里同样可以有）
  - `preview.html` — head 版本的渲染（含自动生成的修改记录表 + 版本切换器），每次定版重写
  - `assets/` — 图片（截图脚本产出 或 手动放入），`doc.md` 用 `![](assets/<file>)` 引用
  - `versions/<n>.json` — 不可变版本清单（版本内路径 `doc.md`、`assets/<file>` → 内容哈希），
    `<n>` 是从 1 递增的整数，不是版本 id。文件本体在项目级 `objects/`（见下）。阅读页只有
    `docs/<docId>/preview.html` 一个（内嵌全部版本，`?v=<n>` 看历史版本）
  - `captures.json`（可选）— 要截哪些画板的哪些状态，给产品研发流程 skill 的截图脚本用
    （见产品研发流程 skill 的 `references/capture.md`）。截图直接落进 `assets/`，
    每张图旁边带出处文件 `<图>.source.json`
- `sheets/<sheetId>/` — 结构化数据表格，跟 `docs/` 平级但独立，没有截图流水线。
  写法规范见 `get_guide({topic:"sheet-schema"})`。
  - `sheet.json` — 当前工作草稿，唯一必须手写的正文：`{ title, sheets:[{ name, rows, merges?, styles? }] }`，
    `rows` 是二维数组（0-based 下标），`styles` 的值是普通 CSS 声明字符串；某格值整体写成
    `![说明](assets/<file>)` 会渲染/导出成图片
  - `doc.json` — `{ title, head, versions:[{ n, note, author, builtAt, sheetHash, sources, publishedTo }] }`
  - `assets/` — 单元格 `![]()` 引用的图片，真实文件
  - `preview.html` — head 版本的渲染（表格网格 + sheet 切换 + 版本切换器），每次 `build_sheet` 重写
  - `versions/<n>.json` — 不可变版本清单（`sheet.json`、`assets/<file>` → 内容哈希），`<n>` 从 1 递增
- `diagrams/<diagramId>/` — 绘图，一个可以有多页。写法见 `get_guide({topic:"diagram"})`。
  - `pages/<pageId>.md` / `pages/<pageId>.mmd` — 每页一个源文件，唯一必须手写的正文：`.md` 是 Markmap
    脑图（Markdown 大纲），`.mmd` 是 Mermaid（流程图、时序图、状态图等）。页 id = 文件名去掉扩展名
  - `pages.json` — `[{ file, name }]`，页的顺序和名字；`pages/` 里新加的文件定版时自动追加到末尾
  - `diagram.json` — `{ title, labels?, head, versions:[{ n, note, author, builtAt, diagramHash, sources, publishedTo }] }`
  - `preview.html` — head 版本的渲染（页切换 + 版本切换 + 右键标注），每次 `build_diagram` 重写
  - `versions/<n>.json` — 不可变版本清单（`pages.json`、`pages/<file>` → 内容哈希），`<n>` 从 1 递增
- `decks/<deckId>/` — 幻灯片。写法见 `get_guide({topic:"deck-writing"})`，做幻灯片按流程 skill `protoflow-slides` 走。
  - `slides/<nn-名字>.html` — 每页一个文件：根节点是一个 `<section>`，1920×1080，按文件名排序；
    `<pf-embed ref="sheet:…">` 嵌别的产物
  - `assets/` — 页里 `assets/…` 引用的图片等素材
  - `playback.json` — 可选的自动翻页、循环、背景音乐和逐页旁白；音频放 `assets/`，字段见 `get_guide({topic:"deck-writing"})`
  - `design/` — 全稿共用的 `.css`、`.js`（按文件名顺序全部加载），直接改
  - `deck.json` — `{ title, labels, design, head, versions:[{ n, note, author, builtAt, filesHash, deckHash, sources, publishedTo }] }`
  - `versions/<n>.json` — 不可变版本清单（slides/、assets/、design/、playback.json 一起冻结）
- `lib/`（项目根目录）— 各产品预览页引用的第三方库（vendored JS），一份，缺了由工具补上
- **引用 `sources`**（每个产品的每个版本上都有）— `[{ ref, via, fp? }]`，这一版用到了项目里哪些
  产物的哪一版：`ref` 格式 `类型:id@版本#子部位`（如 `canvas:main@3#ab_123`、`doc:prd@5`、`sheet:matrix@2#汇总`、`diagram:member@2#flow`、`deck:pitch@2#03-数据`）；`via` 是 `declared`（定版时声明）/ `asset`（素材旁边的 `<文件>.source.json`
  出处，定版时自动收集）/ `capture`（老的截图流水线记下的）。工具维护，不要手改；定版时用
  `sources` 参数声明。
- `objects/<前两位>/<sha256>`（项目根目录）— 所有版本的文件本体，按内容哈希存，同样的内容（比如
  没改过的截图）整个项目只存一份。要读某个版本的文件：在 `versions/<n>.json` 的 `files` 里按路径
  查到 `hash`，读 `objects/<hash 前两位>/<hash>`。只增不减，不要手改、不要删；**不能**加进
  `.gitignore`（历史版本就在这里）
- `.protoflow/`（项目根目录，隐藏目录）— 派生的界面状态（视角、侧边栏收起/展开）

## 硬性规则

- 各产品元信息里的哈希字段和 `head` 都是工具算出来的，**不要手改**。改完源文件用
  `get_project --findings true` 检查影响；它只读计算差异，**不会更新校验基线**。
- `versions/` 和 `objects/` 是冻结历史，不要改。版本只由各产品的定版工具显式产生，不是每次编辑自动切。
- 画布：`meta.json` 里的 `lastValidatedHash` / `annotationsValidatedHash` 是工具算的。源码通过
  `save_artboard_source` 编译保存，标注实际核对后用 `write_annotations` 保存；手改 `source.jsx` /
  `annotations.md` 后原型预览刷新即最新。画布版本只由显式 `build_canvas(note:"…")` 产生。
- 文档：`doc.json` 里的 `docHash` / `mdHash` 是工具算的。手改 `doc.md` 只改变草稿，阅读页仍显示 head
  版本，`build_doc` 后才更新。文档版本只由显式 `build_doc(note:"…")` 产生；属于某个流程的文档什么时候
  该定版，见对应流程 skill 的写作规范。
- 表格：`doc.json` 里的 `sheetHash` 是工具算的。手改 `sheet.json` 只改变草稿，`build_sheet` 后阅读页才更新。
  表格版本只由显式 `build_sheet(note:"…")` 产生。
- 绘图：`diagram.json` 里的 `diagramHash` 是工具算的。手改 `pages/` 下的文件只改变草稿，阅读页只显示定过版的
  内容：改完一轮就 `build_diagram(note:"…")` 定一个版本，人才看得到。
- 幻灯片：版本只由显式 `build_deck(note:"…")` 产生；阅读页只显示定过版的内容。

## 怎么驱动这个项目

先沿用当前项目，不重新创建同名项目；项目 id 是 `annual-review`，`dir` 是这个文件夹的父目录。所有操作都用
protoflow CLI（装好了就是 `protoflow` 命令，否则 `node <protoflow 仓库路径>/bin/protoflow-cli.js`），在这个
文件夹内运行：

```
protoflow get_guide --topic workflow                          # 先读工作流，按场景进入
protoflow get_project --projectId annual-review --dir .. --findings true   # 结构、版本、引用、健康检查
protoflow render_canvas --projectId annual-review --dir ..     # 画布地址
protoflow build_deck --projectId annual-review --deckId <deckId> --note "…"
protoflow --help                                              # 全部工具；protoflow help <工具> 看参数
```

用户开着这个项目的页面（`http://127.0.0.1:<端口>/p/…`）时，可以用 `--url <页面地址>` 代替
`--projectId` + `--dir`。结构化信息只从 `get_project` 拿，不读 ProtoFlow 源码推断怎么操作；删除用
`delete`，不要自己 rm 目录。预览或检查不自动定版或发布。

修改已有画板前后都 `get_project --findings true`，用 `save_artboard_source` 保存后检查 `idAudit`；元素、
交互或语义变化影响已有标注时，核对后用 `write_annotations` 更新。验证本次影响的交互并报告引用了它的产物
过期；只改原型时不自动更新文档，任务包含文档交付或同步时交给对应的流程 skill。局部修改不重开需求访谈。

看画板/整站画布：用 `render_canvas` 返回的 `url`（`http://127.0.0.1:<port>/...`）——
它确保本地预览服务在跑并给出地址，页面内容始终按磁盘当前状态实时渲染。别自己拼 file:// 路径
（很多浏览器工具打不开），也别期待项目目录里有 `canvas.html` / `preview.html` 可以直接打开。
