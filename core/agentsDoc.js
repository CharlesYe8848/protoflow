// core/agentsDoc.js — 纯计算：项目根目录自描述文档（AGENTS.md / CLAUDE.md 共用同一份内容）。
// 目的：项目文件夹本身就是全部状态，任何 agent 靠这份文档和 protoflow CLI 就能接手——
// 对应 HyperFrames 每个项目里都放一份 AGENTS.md 的做法。
//
// 框架只写框架自己的部分（project.json、引用、objects/、通用规则、怎么驱动）；各产品的部分由产品
// 注册描述里的 agentsDoc 提供（products/<产品>/agentsDoc.js），按注册表顺序拼进来。形状：
//   summary          一句话介绍，拼进开头的产品列表，如 "画布（可交互原型……，`canvases/`）"
//   dir              产品在项目里的目录，如 "`canvases/`"
//   refExample       引用写法的例子，如 "`canvas:main@3#ab_123`"
//   layout           「文件布局」里这个产品的条目（markdown 列表项，已按两格缩进排好）
//   rules            「硬性规则」里这个产品的条目（markdown 列表项）
//   commands(pid)    「怎么驱动」代码块里追加的命令行（不含换行）
//   notes(pid)       「怎么驱动」末尾追加的段落
// 产品没有哪一项就不写，框架跳过。

const lines = (xs) => xs.filter(Boolean).join("\n");

export function buildAgentsDoc({ projectId, projectName, products = [] }) {
  const parts = products.map((p) => p.agentsDoc).filter(Boolean);
  const summaries = parts.map((a) => a.summary).filter(Boolean).join("、");
  const dirs = parts.map((a) => a.dir).filter(Boolean).join("、");
  const refExamples = parts.map((a) => a.refExample).filter(Boolean).join("、");
  const commands = parts.flatMap((a) => (a.commands ? a.commands(projectId) : []));
  const notes = parts.map((a) => (a.notes ? a.notes(projectId) : "")).filter(Boolean);

  return `# ${projectName}（ProtoFlow 项目）

ProtoFlow 项目：${summaries || "各产品"}是彼此独立的产品，可以单独用，也可以互相引用（见下面的「引用」）。
把它们串成某种流程（比如原型 → PRD → 上线公告）的模板、写作规范、截图和检查在流程 skill 里
（ProtoFlow 仓库的 \`skills/\` 目录，内置 \`protoflow-product-dev\`）。这个文件夹本身就是全部状态——\`project.json\`${dirs ? `、\n${dirs}` : ""} 都是普通文件，可以直接复制、移动、纳入 git，不依赖任何常驻服务。

## 文件布局

- \`project.json\` — 项目名 + \`formatVersion\`（存储格式版本；旧格式的项目工具会报 \`FORMAT_OUTDATED\`，先跑
  \`node <protoflow 仓库路径>/bin/protoflow-migrate.mjs <父目录> --apply\`）
${lines(parts.map((a) => a.layout))}
- \`lib/\`（项目根目录）— 各产品预览页引用的第三方库（vendored JS），一份，缺了由工具补上
- **引用 \`sources\`**（每个产品的每个版本上都有）— \`[{ ref, via, fp? }]\`，这一版用到了项目里哪些
  产物的哪一版：\`ref\` 格式 \`类型:id@版本#子部位\`${refExamples ? `（如 ${refExamples}）` : ""}；\`via\` 是 \`declared\`（定版时声明）/ \`asset\`（素材旁边的 \`<文件>.source.json\`
  出处，定版时自动收集）/ \`capture\`（老的截图流水线记下的）。工具维护，不要手改；定版时用
  \`sources\` 参数声明。
- \`objects/<前两位>/<sha256>\`（项目根目录）— 所有版本的文件本体，按内容哈希存，同样的内容（比如
  没改过的截图）整个项目只存一份。要读某个版本的文件：在 \`versions/<n>.json\` 的 \`files\` 里按路径
  查到 \`hash\`，读 \`objects/<hash 前两位>/<hash>\`。只增不减，不要手改、不要删；**不能**加进
  \`.gitignore\`（历史版本就在这里）
- \`.protoflow/\`（项目根目录，隐藏目录）— 派生的界面状态（视角、侧边栏收起/展开）

## 硬性规则

- 各产品元信息里的哈希字段和 \`head\` 都是工具算出来的，**不要手改**。改完源文件用
  \`get_project --findings true\` 检查影响；它只读计算差异，**不会更新校验基线**。
- \`versions/\` 和 \`objects/\` 是冻结历史，不要改。版本只由各产品的定版工具显式产生，不是每次编辑自动切。
${lines(parts.map((a) => a.rules))}

## 怎么驱动这个项目

先沿用当前项目，不重新创建同名项目；项目 id 是 \`${projectId}\`，\`dir\` 是这个文件夹的父目录。所有操作都用
protoflow CLI（装好了就是 \`protoflow\` 命令，否则 \`node <protoflow 仓库路径>/bin/protoflow-cli.js\`），在这个
文件夹内运行：

\`\`\`
protoflow get_guide --topic workflow                          # 先读工作流，按场景进入
protoflow get_project --projectId ${projectId} --dir .. --findings true   # 结构、版本、引用、健康检查
${lines(commands)}${commands.length ? "\n" : ""}protoflow --help                                              # 全部工具；protoflow help <工具> 看参数
\`\`\`

用户开着这个项目的页面（\`http://127.0.0.1:<端口>/p/…\`）时，可以用 \`--url <页面地址>\` 代替
\`--projectId\` + \`--dir\`。结构化信息只从 \`get_project\` 拿，不读 ProtoFlow 源码推断怎么操作；删除用
\`delete\`，不要自己 rm 目录。预览或检查不自动定版或发布。
${notes.length ? "\n" + notes.join("\n\n") + "\n" : ""}`;
}
