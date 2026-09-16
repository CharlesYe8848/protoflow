# checkout（ProtoFlow 项目）

原型（画板 JSX）→ 标注 → 文档（PRD / 上线公告 / …）→ 发布 全链路项目。这个文件夹本身就是全部
状态——`project.json`、`pages/`、`docs/` 都是普通文件，可以直接复制、移动、纳入 git，不依赖
任何常驻服务。

## 文件布局

- `project.json` — 项目名 + 页面 id 列表
- `pages/<pageId>/page.json` — 页面名 + 画板 id 列表
- `pages/<pageId>/artboards/<artboardId>/`
  - `source.jsx` — 画板源码，须定义名为 `Component` 的组件
  - `meta.json` — 名称/描述/canvasWidth/`lastValidatedHash` / `annotationsValidatedHash`（派生字段，见下）
  - `annotations.md` — 这块画板的标注，一篇 markdown。要指向具体元素时写行内链接
    `[显示名](#el/元素id)`（元素 id = `source.jsx` 里该节点的 `id`）
  - `annotations.refs.json`（可选）— `{ 元素id: { interactionPath:[…] } }`，标注里引用的元素若
    需要先点开/悬浮才可见，把定位步骤记在这里；没有就不生成这个文件
- `lib/`（项目根目录）— vendored JS（react/babel/mermaid/marked），一份，被画板预览引用
- **单画板预览和整站画布不是文件**——它们是这些源文件的实时投影，由本地预览服务按需渲染
  （`render_preview` / `render_canvas` 返回的 `http://127.0.0.1:<port>/…` 地址）。改了
  `source.jsx` / `annotations.md`、加删页面画板、git checkout / 编辑器 Undo，刷新已打开的
  浏览器标签即最新，不需要重新跑任何工具。（旧版本会往项目里写 `canvas.html` / `preview.html`
  快照——现在不写了；若目录里还残留，删掉即可，是过期产物。）
- `docs/<docId>/` — 通用文档基座。`docId`（= 目录名）默认 = 类型名（`docs/prd/`、
  `docs/release-note/`）；同项目同类型要多篇时才显式传 `docId`（可含中文）。`doc.md` 一级标题
  只写这篇的主题一句话，不带项目名 / 不带「PRD」之类类型字样 / 不带版本号（`create_doc` 传
  `title` 会自动填好）。
  - `doc.md` — 当前工作草稿，唯一必须手写的正文（不是结构化 JSON 驱动生成）
  - `doc.json` — `{ kind, title, origin, head, versions:[{ n, note, author, builtAt, docHash, publishedTo }] }`。
    `head` 是"当前是哪个版本"的唯一真相源
  - `preview.html` — head 版本的渲染（含自动生成的修改记录表 + 版本切换器），每次 finalize 重写
  - `assets/` — 图片（截图流水线产出 或 手动放入），`doc.md` 用 `![](assets/<file>)` 引用
  - `versions/<n>/` — 不可变版本快照（`doc.md` + `manifest.json` + `assets/`），`<n>` 是从 1
    递增的整数，不是版本 id。阅读页只有 `docs/<docId>/preview.html` 一个（内嵌全部版本，`?v=<n>`
    看历史版本）
  - `.build/` — 截图流水线中间产物（`captures.json` 手写；`snapshot/`、`captures-manifest.json`
    是产物）。可放心加进 `.gitignore`
- `doc-kinds/<kind>/`（项目根目录，可选）— 项目本地的文档类型包，覆盖或新增内置类型
  （`kind.json` + `template.md` + `writing.md` + 可选 `checks/*.mjs`）
- `.protoflow/`（项目根目录，隐藏目录）— 派生的 UI 偏好状态（画布视角、侧边栏收起/展开）

## 硬性规则

- `lastValidatedHash` / `annotationsValidatedHash`（meta.json）、`doc.json` 里的 `docHash`/
  `mdHash`/`head` 都是工具算出来的，**不要手改**。改完 `source.jsx` / `annotations.md` / `doc.md`
  重新跑一次链路检查让工具重算即可。
- 手改 `source.jsx` / `annotations.md` / `doc.md` 是安全的，也不需要之后手动"重新渲染"——预览是实时投影，刷新
  浏览器即最新；只有链路健康字段（见上）要靠跑一次 `chain_status` 让工具重算。`versions/<n>/`
  是冻结的历史，不要改。
- 版本只由显式 `build_doc(mode:"finalize", note:"…")` 产生，不是每次编辑自动切。什么时候该
  finalize 见该类型的 `get_doc_kind` 里的 writing.md。

## 怎么驱动这个项目

**方式一**：当前 agent 已挂载 protoflow 这个 MCP，直接说需求即可；模型会先调 `get_guide("workflow")`。

**方式二**：没挂 MCP 时用同一份代码的非交互 CLI（命令名和参数跟 MCP 工具一一对应，项目 id 就是
这个文件夹的名字 `checkout`）。在这个文件夹内运行：

```
node <protoflow 仓库路径>/bin/protoflow-cli.js chain_status '{"projectId":"checkout","dir":".."}'
node <protoflow 仓库路径>/bin/protoflow-cli.js render_canvas '{"projectId":"checkout","dir":".."}'
node <protoflow 仓库路径>/bin/protoflow-cli.js --help
```

看画板/整站画布：用 render_preview / render_canvas 返回的 `url`（`http://127.0.0.1:<port>/...`）——
它确保本地预览服务在跑并给出地址，页面内容始终按磁盘当前状态实时渲染。别自己拼 file:// 路径
（很多浏览器工具打不开），也别期待项目目录里有 `canvas.html` / `preview.html` 可以直接打开。
