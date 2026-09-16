# ProtoFlow v0.1.0 — 预览版

通过 Claude Code、Cursor、Codex 等 coding agent 创建交互原型、元素标注和 PRD。
原型修改后，用内容指纹检查标注、文档和发布记录是否需要更新。

## 首版能力

- 可缩放、平移的多页面原型画布与实时预览。
- 基于元素 ID 的标注定位和断链检查。
- PRD、上线公告等可扩展文档类型，支持冻结版本和修改记录。
- 自动截图、HTML / ZIP 导出及文档 Markdown 导出。
- MCP 与非交互 CLI 共用 22 个工具。
- 自带购物车与支付方式示例，运行 `npm run demo` 即可体验。

## 安装

需要 Node.js >= 22.12.0。

```bash
git clone https://github.com/CharlesYe8848/protoflow.git
cd protoflow
npm ci
npm run demo
```

MCP 配置见 [README](../README.md)。首次截图若未找到 Chrome，会自动下载浏览器。

## 已知限制

- 预览版，工具参数与项目结构可能继续变化；重要项目请使用版本控制。
- 本次本地验证为 macOS / Node 22.20.0；Linux 和 Node 24 的自动验证由 CI 执行。
- 尚未验证 Windows 完整流程，不承诺 Windows 支持。
- 示例的两个页面独立演示，不共享购物车状态，也不会发起真实支付。
- 本地预览不提供远程协作；打开和执行项目需信任其代码。
- 外部平台发布需自行配置对应连接器和授权。
- 本版通过 GitHub 源码安装，尚未发布 npm 包。
