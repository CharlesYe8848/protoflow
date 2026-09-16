# 参与开发

欢迎提交问题、文档改进和代码。较大的功能请先开 Issue 说明使用场景。

## 本地开发

需要 Node.js >= 22.12.0；仓库提供 `.nvmrc`。在仓库根目录运行：

```bash
npm ci
npm test
npm run selfcheck
npm run demo
```

截图测试需要 Chrome。默认先找本机 Chrome，再找缓存，没有时自动下载；也可以设置
`PROTOFLOW_CHROME_PATH` 为浏览器可执行文件的绝对路径。Linux 需要 Chrome 对应的系统运行库。

## 目录

- `core/`：原型、文档、指纹和导出实现。
- `mcp/tools.js`：MCP 与 CLI 共用的工具定义。
- `bin/`：CLI、预览服务和迁移入口。
- `guides/`：agent 使用流程；`doc-kinds/`：文档模板与检查。
- `tests/`：Node 内置测试；`examples/checkout/`：虚构数据的完整示例。

修改行为时补充能够复现问题的测试，避免只断言实现细节。修复 HTTP 文件边界时，
覆盖读取和状态写入，并检查画布、文档、截图预览是否仍能打开。

示例中的版本和指纹由工具生成，请通过 ProtoFlow 构建流程更新。`npm run demo` 会复制
示例到系统临时目录，适合试验，不会改动仓库里的示例基线。

## 提交 PR

说明问题、最终行为及验证结果。界面变化请附使用虚构数据的截图。
不要提交个人配置、日志、业务项目、密钥或自动生成的第三方库目录。

提交的贡献适用本仓库的 MIT 许可证。

## 技术资料

- [架构说明](docs/architecture-notes.md)：实时预览、本地服务和 Mermaid 渲染。
- [文档类型扩展](doc-kinds/README.md)：增加或调整文档模板与检查规则。
- [Agent 工作流程](guides/workflow.md)：原型、标注、截图和文档版本的工具调用顺序。

### 命令行入口

除 MCP 外，也可通过 CLI 调用同一组工具：

```bash
node bin/protoflow-cli.js --help
node bin/protoflow-cli.js <tool_name> '<json_args>'
```

每次调用可用 `dir` 指定项目父目录；否则使用 `PROTOFLOW_HOME` 或启动目录。
输出为 JSON，`ok:false` 时以非零状态码退出。

### 旧项目迁移

旧 `prd/<versionId>/` 布局可用以下命令检查迁移方案：

```bash
node bin/protoflow-migrate.mjs /path/to/workspace
```

确认方案后加 `--apply` 执行。迁移会将旧目录保留为 `prd.pre-migration/`。
