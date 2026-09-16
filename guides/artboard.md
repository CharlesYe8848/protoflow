# 画板 JSX 写作规范

- 源码必须定义 `function Component()`（或 const Component），单文件自包含。
- 硬性上限 ≤600 行；重复结构提取局部子组件；列表用数组 map 渲染。
- 可标注元素必须有静态 `id="..."`（标注 target 只能命中静态 id）。id 语义化：`btn-save`、`list-candidates`。
- 画板命名"<载体>-<业务域>-<页面角色>"三段式，如 "PC端-绩效沟通-入口页"。
- 图标：inline SVG 图标函数（viewBox 0 0 24 24，stroke=currentColor，strokeWidth=2，1-3 个基础子元素，lucide-like）；
  禁止 emoji、字体图标、远程图片、文字色块冒充图标。
- 图片资产放画板 `assets/` 目录，源码内用相对文件名 `<img src="assets/xx.png">`（预览页会自动内联为 data URI）。
- 禁止 import/require 外部依赖；React 由预览页全局提供。
- 交互状态（弹窗、Tab、下拉）用 React.useState 实现真实切换，供截图时通过 actions 触达。
- 修改画板后关注 save_artboard_source 返回的 idAudit：消失的 id、annotations.md 里对它们的断链引用，当场处理。
- 想让用户看到构建过程：设计会话开始时对目标画板调一次 render_preview，把返回的 url（整站画布，不是这块画板单独的
  地址）告诉用户（或用浏览器工具打开）——鼠标悬浮这块画板、点右上角新标签图标就能单独打开它。
  画布和画板预览是 source.jsx / annotations.md 的**实时投影**（本地预览服务按需渲染，不落盘）：之后每次
  save_artboard_source / write_annotations 之后，提醒用户刷新已打开的标签即最新，不需要再调 render_preview。
- 画板要装流程图/时序图/架构图（mermaid）而不是 UI 原型：动笔前先看 get_guide("diagram")——图表类型选型
  （flowchart 还是 sequenceDiagram）、常见踩坑（vh 单位、初始化配置传错块）都在里面，别凭直觉现场试错。
