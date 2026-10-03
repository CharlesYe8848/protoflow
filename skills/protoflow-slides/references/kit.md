# 可选工具库 pf-kit（图标、图表、数字滚动、动效）

本 skill 的 `lib/pf-kit.css` + `lib/pf-kit.js`：不想自己画图标、图表、写进场动画时可以用。**要用就把这两个文件拷进
幻灯片的 `design/`**（壳子会加载 `design/` 下所有的 .css、.js），不用就不拷——手写 SVG、用别的库、纯 CSS 都行。
它是这份幻灯片自己的一份拷贝，改了本 skill 里的库不会影响已经拷过去的幻灯片。

## 配色变量

库给这些变量设了默认值（优先级为 0），在自己的样式里用 `:root{…}` 覆盖成这份幻灯片的配色，图标、图表、截图外框就跟着变：

| 变量 | 用途 |
|---|---|
| `--paper` `--ink` `--muted` `--line` | 底色、正文、次要文字、细线和图表网格 |
| `--accent` `--accent-ink` | 强调色（焦点、图表高亮）、强调色底上的字 |
| `--font` `--font-display` `--mono` | 正文、标题、等宽字体 |
| `--ink-2` `--faint` `--tint` `--accent-tint` `--dark` | 次一级文字、更淡的字、浅色面、强调色浅底、深色面 |
| `--chart-soft` `--chart-radius` `--chart-weight` | 图表里次要数据的颜色、柱子圆角（数字）、数字字重 |

## 图标

`<i data-icon="名字"></i>` 画一个图标，跟文字同色、跟字一样大（套个带底色的方块、放多大都由自己的样式定）。图标来自 Lucide（ISC 许可，见 `lib/LICENSE-lucide.txt`）。可用的名字：

箭头趋势 `arrow-right` `arrow-up-right` `arrow-down-right` `trending-up` `trending-down` ·
图表 `chart-column` `chart-bar` `chart-line` `chart-pie` `chart-no-axes-combined` `funnel` `gauge` `activity` ·
目标成果 `target` `flag` `rocket` `zap` `lightbulb` `sparkles` `star` `trophy` `award` `gift` `thumbs-up` `heart` ·
状态 `check` `circle-check` `x` `circle-x` `circle-alert` `triangle-alert` `info` ·
安全 `shield` `shield-check` `lock` `key` `fingerprint` `scan-line` `qr-code` ·
人 `user` `users` `user-check` `user-plus` `handshake` `hand` `brain` `bot` `headphones` ·
商业 `briefcase` `building-2` `store` `shopping-cart` `shopping-bag` `credit-card` `wallet` `banknote` `receipt` `coins`
`piggy-bank` `circle-dollar-sign` `percent` `badge-percent` `scale` ·
物流地点 `package` `truck` `map-pin` `map` `globe` `compass` `route` ·
设备技术 `smartphone` `monitor` `laptop` `tablet` `cloud` `database` `server` `cpu` `code` `git-branch` `settings` `wrench`
`layers` `layout-grid` `puzzle` `workflow` `link` ·
时间 `clock` `timer` `calendar` `hourglass` `repeat` `refresh-cw` ·
沟通文档 `mail` `message-circle` `phone` `bell` `send` `share-2` `search` `filter` `eye` `mouse-pointer-click`
`file-text` `clipboard-list` `list-checks` `book-open` `graduation-cap` `download` `upload` `leaf`

## 图表

```html
<div class="chart" data-chart="bar" data-labels="7月,8月,9月" data-values="34,33,32" data-unit="%" data-highlight="2"></div>
```

| data-chart | 用来 | 数据 |
|---|---|---|
| `bar` | 几个时间点、几个类别比大小 | 3–8 个值 |
| `hbar` | 类别名字长、或要排名 | 3–7 个值 |
| `funnel` | 逐级转化 | 3–6 个值，逐级变小；缺省高亮流失最大的一级 |
| `line` | 趋势 | 4–12 个值 |
| `ring` | 一个比例 | 一个值（`data-max` 缺省 100），`data-labels` 写一行说明 |
| `progress` | 进度、完成度 | 一个值 |
| `stacked` | 每一项由几部分组成（渠道构成、成本构成），顶上写合计 | 2–4 组，每组 3–8 个值 |

**对比两组、三组数据**（今年 vs 去年、方案 A vs B）：`data-values` 用 `|` 分隔每一组，`data-series` 写每组的名字。
`bar` 画成并排的柱子、`line` 画成几条线、`stacked` 叠起来，都自带图例。**第一组是焦点**（强调色），其余是灰色——把结论说的
那一组写在前面。最多 3 组（`stacked` 4 组），再多就看不清了。

```html
<div class="chart" data-chart="bar" data-series="今年,去年" data-labels="7月,8月,9月" data-values="34,33,32|30,31,29" data-unit="%"></div>
```

`data-highlight` 从 0 数，用强调色标出结论说的那一项（不写时柱状、条形、折线标最后一项，漏斗标流失最大的一级）。
数字直接写在 `data-values` 里，**不要**把数字画成表格再嵌进来；项目里已有的表格要展示明细才用 `<pf-embed>`。


## 数字滚动

写了 `data-count` 的元素，翻到这一页时里面的数从 0 滚到目标值，保留前后缀：`<strong data-count>1,280</strong>`、
`<span data-count>+32%</span>`。也可以在 `design/` 的脚本里登记一类元素，页面就不用每处写 `data-count`（先后加载都行）：

```js
(function () { var d = window.PFDesign = window.PFDesign || {}; (d.countSelectors = d.countSelectors || []).push(".metric strong"); })();
```

## 进场动效

翻到一页时播放，每次翻回来重播；导出 PDF、排版检查、总览、系统"减少动态效果"时不动，看到的就是最终效果。

- `data-anim`（`rise` 缺省 / `fade` / `zoom`）：这个元素进场。
- `data-stagger`（同上三种）：它的子元素一个一个出来（卡片、照片、步骤）。
- 图表自己会长出来（柱子长高、条形伸长、漏斗逐级展开、折线画出、环形转一圈）。
- 自己写编排时可以复用关键帧：`pf-rise` `pf-fade` `pf-zoom` `pf-pop` `pf-deco` `pf-nudge`，缓动用 `var(--ease)`，
  写在 `.pf-slide.active …` 选择器下面才会只在当前页播放。

## 标题自适应

`section` 里的 `h1`、`h2`、`blockquote`（写了 `data-nofit` 的除外）：≤ 14 个字不折行、≤ 30 个字最多两行、再长最多三行（每个 `<br>` 多算一行）；放不下逐步缩小，最小到原来的 70%。
还放不下是内容太长，该删字或拆页。

## 截图外框

手机截图放进 `<div class="frame-phone"><img src="assets/…"></div>`，网页截图放进 `<div class="frame-browser"><img src="assets/…"></div>`，
比裸图有场景感。外框按容器大小撑开，截图本身不要带手机壳、浏览器栏。

## 流程图

`<pre class="mermaid">…</pre>` 画 Mermaid 流程图，按容器等比放大。
