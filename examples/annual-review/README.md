# 年终汇报幻灯片示例

这是一份已经定版的 ProtoFlow 幻灯片项目，内容为虚构的“星河科技企业服务事业部 2026 年终汇报”，所有公司、人物和经营数据仅用于演示。

整套共十页，按“结论 → 数据 → 原因 → 复盘 → 明年计划”的故事线组织，包含大数字、柱状图、图标网格、对比、卡片和时间线等版式。设计使用 `protoflow-slides` 的 `mono` 黑白极简样例与绿色主题。

## 打开

在仓库根目录执行：

```bash
npm run demo
```

打开输出的 `annualReview` 链接。幻灯片支持键盘方向键翻页、`T` 打开缩略图、`F` 全屏、`Esc` 总览。

## 继续修改

把 `npm run demo` 输出的 `annualReviewProjectDir` 告诉 agent，例如：

> 打开这个 ProtoFlow 项目，把年终汇报替换成我们团队的数据，保持这套绿色极简风格，修改后检查并定一个新版本。

页面源码位于 `decks/annual-review/slides/`，共享设计位于 `decks/annual-review/design/`。示例保留手动翻页，适合现场汇报；需要展台循环、旁白或背景音乐时再修改 `playback.json`。
