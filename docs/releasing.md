# 首次公开发布

当前开发仓库的历史包含曾经删除的内部计划和会话文档。首次公开使用当前文件的独立快照，
保留原开发仓库，不从原仓库直接推送历史。

## 生成公开副本

在已检查当前改动的开发仓库根目录执行，目标必须是不存在的新目录：

```bash
node scripts/prepare-public.mjs ../protoflow-public
```

脚本仅复制明确允许的源码、文档、示例和 GitHub 配置，不复制 `.git`、内部计划、个人配置、
依赖或被忽略的产物。新增文件需落在脚本的公开清单内。常见密钥格式检查只是辅助，不能替代人工审核。

## 干净安装验证

在公开副本里执行：

```bash
npm ci
npm test
npm run selfcheck
npm run demo
```

确认画布、标注和 PRD 可打开，再检查公开文件和许可证署名。

## GitHub 发布

目标地址：`https://github.com/CharlesYe8848/protoflow`。

1. 在 GitHub 创建空仓库，选择公开；不要自动创建 README 或许可证。
2. 在公开副本初始化独立 Git 仓库。提交前检查 `git var GIT_AUTHOR_IDENT`，选择希望公开的署名与邮箱；GitHub 隐私邮箱可在账号设置中查看。
3. 创建首次提交并推送：

```bash
git init -b main
git add .
git commit -m "Initial public release of ProtoFlow"
git remote add origin https://github.com/CharlesYe8848/protoflow.git
git push -u origin main
```

4. 等待 Actions 验证成功。开启私密漏洞报告，补仓库简介和主题（mcp、prototype、prd、ai）。
5. 创建 `v0.1.0` tag 和标记为 **Pre-release** 的 GitHub Release，正文使用 [首版说明](release-v0.1.0.md)。Release 中相对文档链接需换成公开仓库链接。

后续公开开发以新仓库为准；不要合并原开发仓库历史，也不要把重复快照覆盖到已经有协作改动的目录。
