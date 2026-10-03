// products/canvas/agentsDoc.js — 项目自描述文档（AGENTS.md）里画布的部分，由框架 core/agentsDoc.js 拼接。
export const canvasAgentsDoc = {
  summary: "画布（`canvases/`，可交互原型：页面、画板 JSX、元素标注）",
  dir: "`canvases/`",
  refExample: "`canvas:main@3#ab_123`",
  layout: `- \`canvases/<canvasId>/\` — 一个画布（一个项目可以有多个，比如管理端、员工端；老项目迁过来的叫 \`main\`）。
  \`create_canvas\` 新建；只有一个画布时各工具不用传 \`canvasId\`，有多个时建页面、看画布、定版、导出要传
  - \`canvas.json\` — 画布名 + 页面 id 列表 + 版本记录（见下）
  - \`icons.jsx\`（可选）— 覆盖项目根的 \`icons.jsx\`
- \`canvases/<canvasId>/pages/<pageId>/page.json\` — 页面名 + 画板 id 列表。页面 id、画板 id 在整个项目里唯一
- \`canvases/<canvasId>/pages/<pageId>/artboards/<artboardId>/\`
  - \`source.jsx\` — 画板源码，须定义名为 \`Component\` 的组件
  - \`meta.json\` — 名称/描述/canvasWidth/\`lastValidatedHash\` / \`annotationsValidatedHash\`（派生字段，见下）
  - \`annotations.md\` — 这块画板的标注，一篇 markdown。要指向具体元素时写行内链接
    \`[显示名](#el/元素id)\`（元素 id = \`source.jsx\` 里该节点的 \`id\`）
  - \`annotations.refs.json\`（可选）— \`{ 元素id: { interactionPath:[…] } }\`，标注里引用的元素若
    需要先点开/悬浮才可见，把定位步骤记在这里；没有就不生成这个文件
- **单画板预览和整站画布不是文件**——它们是这些源文件的实时投影，由本地预览服务按需渲染
  （\`render_canvas\` 返回的 \`http://127.0.0.1:<port>/…\` 地址）。改了
  \`source.jsx\` / \`annotations.md\`、加删页面画板、git checkout / 编辑器 Undo，刷新已打开的
  浏览器标签即最新，不需要重新跑任何工具。例外是画布定过版之后：整站画布显示最新版本，改动要
  \`build_canvas\` 定版后才出现在画布上（单画板预览仍然实时）。
- \`canvases/<canvasId>/\` 里的版本，跟文档/表格一样：改完一轮 \`build_canvas(note:"…")\` 定一个新版本
  - \`canvas.json\` — \`{ title, pageIds, head, versions:[{ n, note, author, builtAt, canvasHash, sources }] }\`
  - \`versions/<n>.json\` — 不可变版本清单：冻结时整个画布（\`pages.json\`、\`icons.jsx\`、
    \`pages/<pageId>/…\` 下的 page.json 和各画板目录的全部文件）→ 内容哈希，文件本体在 \`objects/\`
  - 画布页（\`render_canvas\` 的 url）默认显示最新版本，\`?v=<n>\` 看历史版本；没定版的改动不会
    出现在画布页上（从没定过版的画布显示当前源文件）
  - 第 n 版某块画板的预览地址（截图脚本等外部工具依赖的公开约定，保持兼容）：本地服务上的
    \`canvases/<canvasId>/versions/<n>/pages/<pageId>/artboards/<artboardId>/preview.html\`；预览页 \`<head>\` 里
    \`<meta name="protoflow-artboard" content='{"id","canvasWidth","canvasHeight"}'>\` 声明画板宽度；元素用
    源码里的 \`id\` 定位，交互状态用标准 DOM 操作切换`,
  rules: `- 画布：\`meta.json\` 里的 \`lastValidatedHash\` / \`annotationsValidatedHash\` 是工具算的。源码通过
  \`save_artboard_source\` 编译保存，标注实际核对后用 \`write_annotations\` 保存；手改 \`source.jsx\` /
  \`annotations.md\` 后原型预览刷新即最新。画布版本只由显式 \`build_canvas(note:"…")\` 产生。`,
  commands: (projectId) => [`protoflow render_canvas --projectId ${projectId} --dir ..     # 画布地址`],
  notes: () => `修改已有画板前后都 \`get_project --findings true\`，用 \`save_artboard_source\` 保存后检查 \`idAudit\`；元素、
交互或语义变化影响已有标注时，核对后用 \`write_annotations\` 更新。验证本次影响的交互并报告引用了它的产物
过期；只改原型时不自动更新文档，任务包含文档交付或同步时交给对应的流程 skill。局部修改不重开需求访谈。

看画板/整站画布：用 \`render_canvas\` 返回的 \`url\`（\`http://127.0.0.1:<port>/...\`）——
它确保本地预览服务在跑并给出地址，页面内容始终按磁盘当前状态实时渲染。别自己拼 file:// 路径
（很多浏览器工具打不开），也别期待项目目录里有 \`canvas.html\` / \`preview.html\` 可以直接打开。`,
};
