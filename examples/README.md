# 结账流程示例

这是一个使用虚构商店、虚构商品的完整 ProtoFlow 项目。包含购物车、支付方式两个页面，
元素标注以及带两张真实截图的 PRD v1。

## 一分钟体验

在 ProtoFlow 仓库根目录执行：

```bash
npm ci
npm run demo
```

命令会复制示例到系统临时目录，并输出 `projectDir`、`canvas` 和 `prd`。
打开 `canvas` 和 `prd` 链接即可；无需 MCP、平台账号或模型 API Key。
临时目录可能被系统清理，长期使用请把输出的 `projectDir` 复制到自己的工作目录。

1. 在购物车页减到 0：合计变为 0，去支付禁用；加回 1 后恢复。
2. 点击画板上的标注按钮，查看规则并点击「数量控件」等链接定位元素。
3. 在左侧切换到支付方式页，选择支付宝，再点击支付，显示模拟成功。
4. 打开 `prd`，查看对应截图、验收标准和修改记录。

两个页面独立演示，不共享订单状态，不产生真实交易。

## 体验“原型变化，文档提醒”

把 `npm run demo` 输出的项目目录告诉 agent：

> 打开这个 ProtoFlow 项目，把购物车商品单价从 129 元改成 139 元，保持元素 ID，
> 然后运行 chain_status，告诉我哪些标注和文档需要更新。

agent 应使用 `projectId: "checkout"`，`dir` 为该项目的父目录。修改之后会看到
`annotation_review` 与 `doc_drifted`；如果直接编辑文件而没有通过工具保存，
还会看到 `unvalidated`。原始示例基线的检查结果为空。

这个提醒基于 PRD 版本中记录的真实截图指纹，不是演示用的硬编码状态。

## 示例文件

- [项目描述](checkout/project.json)
- [PRD 正文](checkout/docs/prd/doc.md)
- `checkout/pages/`：页面、JSX 和标注。
- `checkout/docs/prd/versions/1/`：初始冻结版本及截图。
- `checkout/docs/prd/.build/`：截图清单和基线，供后续构建复用。

`lib/` 和预览 HTML 在运行时根据已安装依赖生成，不纳入版本控制。
