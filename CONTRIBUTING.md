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
- `cli/tools.js`：CLI 的工具定义（框架的几个 + 各产品在 `products/<产品>/tools.js` 注册的）；`cli/context.js`：调用前的准备（工作目录、`--url` 定位项目）；入口 `bin/protoflow-cli.js`。
- `bin/`：CLI、预览服务和迁移入口。
- `core/`：框架；`products/<产品>/`：画布、文档、表格、绘图、幻灯片各自的代码和注册描述；`guides/`：框架级使用指南；`skills/`：skill——`protoflow` 是入口和路由，`protoflow-<流程>` 是流程 skill（跨产品流程，如 `protoflow-product-dev` 的 PRD / 上线公告模板、截图和检查脚本，以及 `protoflow-slides` 的幻灯片创作流程）。依赖边界见 `tests/boundaries.test.js`。
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
- [产品架构](docs/product-architecture.md)：框架、产品、流程 skill 的分工。新增流程：加一个 `skills/protoflow-<流程>/`（SKILL.md + references/ + scripts/，参照 `protoflow-product-dev`），再在 `skills/protoflow/SKILL.md` 的路由表加一行；框架和产品不用改。
- [Agent 工作流程](guides/workflow.md)：原型、标注、截图和文档版本的工具调用顺序。

### 命令行入口

所有工具都通过 CLI 调用（skill、指南、项目的 AGENTS.md 只讲这一种方式）：

```bash
node bin/protoflow-cli.js --help                  # 每个工具一行
node bin/protoflow-cli.js help <工具>              # 完整说明和参数
node bin/protoflow-cli.js <工具> --参数 值 …        # 值是 JSON 就按 JSON 解析，@文件 读文件内容
node bin/protoflow-cli.js <工具> '<json 参数>'      # 也可以一整个 JSON
```

要项目的工具用 `--projectId` + `--dir`（项目父目录，缺省 `PROTOFLOW_HOME` 或启动目录），或者用 `--url <预览页地址>`
直接定位。输出为 JSON，`ok:false` 时以非零状态码退出。新增工具时只做文件做不了的事（校验、定版、计算、
预览、导出），能直接读写文件完成的不要做成工具。

### 旧项目迁移

运行时只认当前存储格式（`project.json` 的 `formatVersion`），旧项目会报 `FORMAT_OUTDATED`。先预演：

```bash
node bin/protoflow-migrate.mjs /path/to/workspace
```

确认方案后加 `--apply` 执行，每个项目先整份备份到 `<工作区>/.protoflow-backup/<时间>/`。

改存储格式时：`core/store.js` 的 `FORMAT_VERSION` 加一，迁移步骤写进 `core/migrate.js`（框架）或产品的
`migrate.js`（在注册描述里声明 `migrate`），运行时代码不写兼容分支。
