# 商务版式（mono、swiss 两个样例共用）

汇报、评审、方案、发布这类"讲清楚一件事"的幻灯片的一套版式名和类名。`mono`、`swiss` 用同一套，只是长得不一样——
两者之间换不用改写页面。画布 1920×1080。这套版式好看靠三样：**大字和大数字、图标和图表、深浅交替的节奏**。

它只是样例。相册、纪念、活动、教学这些场合版式和节奏都不一样，按内容自己设计，不用往这里套。
用这套时颜色、字号、字体交给 `mono.css` / `swiss.css` 和 `theme.css`，页里只写结构；需要的东西这里没有，直接加进
幻灯片的 `design/`。图标、图表、数字滚动的写法见 `../references/kit.md`。

## 写之前：先把内容"画出来"

**每页至少要有一个视觉元素**：图表、图标、图片、大数字、流程图之一（`cover` `cover-split` `agenda` `section`
`statement` `quote` `end` 这几种以字为主的版式除外）。**以字为主的页不超过全部页数的四分之一。** 写之前按下表把内容换个说法：

| 内容是 | 别写成 | 写成 |
|---|---|---|
| 一组数字（逐月、分渠道、各环节） | 表格、要点 | `chart`（柱状、条形、折线、漏斗），结论写在左边 |
| 一个关键数字 | 一句话里带个数 | `big-number`，旁边配一张小图表 |
| 2–4 个指标 | 要点 | `metrics`，关键的那个加 `is-key`，可带进度条 |
| 并列的几件事 | 纯文字要点 | `icon-grid` 或带图标的 `cards` |
| 有先后的步骤 | 编号列表 | 流程用 `process`（步骤卡片 + 箭头），带时间的用 `timeline` |
| 两个方案 / 现在 vs 以后 | 两段文字 | `compare`，推荐的一侧加 `is-highlight` |
| 一个结论、一个转折 | 标题 + 要点 | `statement`，关键词用 `<em>` 标成强调色 |
| 截图、设计稿 | 文字描述 | `image-left` / `image-right` / `image-grid` |
| 用户原话 | 要点 | `quote` |

## 节奏

- 任何版式都可以在 section 上加 `class="is-dark"`（深色底）或 `class="is-accent"`（强调色底）。一份 15 页的稿子里，
  深色 / 强调色页放 3–4 页：章节页、最重要的结论、最后的目标或请求。不要连着两页都是深色或强调色。
- 同一种版式不要连着用超过两页；整份稿子至少用 6 种不同的版式。
- 强调色是焦点，一页里只标一处（一个词、一个数字、一根柱子、一张卡片），标多了就没有焦点了。

## 动效

不用写：翻到一页时这套样式自动播放——标题淡入，卡片、步骤、指标一个个出来，图表按自己的方式长出来（柱子长高、条形伸长、
漏斗逐级展开、折线画出、环形转一圈），指标和大数字从 0 滚到目标值，关键的那一步 / 那张卡片（`is-key`、`is-highlight`）
出来后轻轻强调一下。别的地方的数字想滚动，加 `data-count`（比如 `<strong data-count>1,280</strong>`）。导出 PDF、检查、总览、
系统"减少动态效果"时不动，看到的就是最终效果。

自动翻页、循环、背景音乐和逐页旁白写在幻灯片顶层的 `playback.json`（字段见 `get_guide({topic:"deck-writing"})`）。不要在
页面 HTML 里放 `<audio autoplay>`、计时器或切页脚本，否则无法跟阅读页的暂停、手动翻页和历史版本统一。

## 容量

每种版式都写了上限，超了就拆页，比缩字、硬塞好看。需要的东西这里没有，换一种版式，或者自己加进 `design/`。

## 配图

- **宽高比按图位来**（先定图放在哪，再找图 / 截图 / 生成图）：`image-left` / `image-right` 半幅 8:9（960×1080，
  截图用 `contain` 或套外框）；`image-full` 满版 16:9；`image-grid` 两张 4:3、三张 3:4、四张 3:4；`cover-split` 右侧 3:4。
- **截图套外框**：手机截图放进 `<div class="frame-phone"><img src="assets/…"></div>`，网页截图放进
  `<div class="frame-browser"><img src="assets/…"></div>`（放在 `image-left` / `image-right` 的 `figure` 里、或 `image-grid` 的
  `figure` 里），比裸图有场景感。截图本身不要带手机壳、浏览器栏。
- **项目里的原型直接截**：画布里的画板用流程 skill `protoflow-product-dev` 的截图脚本截：
  `node <protoflow-product-dev 目录>/scripts/capture.mjs <项目目录> --captures <截图配置> --out <项目目录>/decks/<deckId>/assets`
  （截图配置的写法见那个 skill）。截图旁边带出处文件 `<图>.source.json`，`build_deck` 时记进这一版的引用——原型改了，
  幻灯片会提示过期。
- **图里不要有字**：标题、说明写在页里，不要烧进图片；图里必须有的文字（界面截图）跟幻灯片同一种语言。
- **命名**：`<页号>-<含义>.<扩展名>`，比如 `03-新结账页.png`。
- 不要用外部图片地址（导出的单 HTML、PDF 要能离线打开）；没有合适的图就换一种不需要图的版式，不要放无关的装饰图。

---

## cover 封面

标题一句话（≤ 14 字最好），副标题一句（≤ 30 字）。装饰（色块、圆形）是样式自带的。

```html
<section data-layout="cover">
  <div class="kicker">产品评审 · 2026 Q4</div>
  <h1>结账流程改版</h1>
  <p class="sub">把下单转化率从 32% 提到 45%</p>
  <div class="meta"><span>交易产品组</span><span>2026-09-27</span></div>
</section>
```

## cover-split 封面（左右分割）

左边标题，右边一块强调色（里面放一个大图标）或一张图（`<figure><img src="assets/…"></figure>`）。

```html
<section data-layout="cover-split">
  <div class="text">
    <div class="kicker">产品评审 · 2026 Q4</div>
    <h1>结账流程改版</h1>
    <p class="sub">把下单转化率从 32% 提到 45%</p>
    <p class="meta">交易产品组 · 2026-09-27</p>
  </div>
  <figure><i data-icon="shopping-cart"></i></figure>
</section>
```

## agenda 目录

左边标题，右边 3–6 项（每项 ≤ 12 字，可带一行 ≤ 20 字的说明）。

```html
<section data-layout="agenda">
  <h2>今天讲三件事</h2>
  <ol>
    <li><div>现状与问题<span>数据和用户访谈</span></div></li>
    <li><div>改版方案<span>三个改动、两个取舍</span></div></li>
    <li><div>目标与节奏<span>指标和上线计划</span></div></li>
  </ol>
</section>
```

## section 章节页（深色）

编号 + 章节名（≤ 10 字），可加一句说明。

```html
<section data-layout="section">
  <div class="num">01</div>
  <h2>现状与问题</h2>
  <p>先看数据，再看用户在哪一步流失</p>
</section>
```

## statement 一句话观点

一句话 ≤ 30 字；要强调的词用 `<em>`（一处）。最重要的结论配 `is-accent` 或 `is-dark`。

```html
<section data-layout="statement" class="is-dark">
  <div class="kicker">结论</div>
  <h2>一半的流失，发生在<em>填地址</em>这一步</h2>
</section>
```

## bullets 要点

尽量少用（换成 `icon-grid`、`cards`）。标题 + 3–4 条，每条 ≤ 24 字。

```html
<section data-layout="bullets">
  <div class="head"><h2>为什么要改</h2><p class="lead">三个月的数据和 20 场访谈指向同一个问题</p></div>
  <ul>
    <li>结账转化率只有 <strong>32%</strong>，行业平均 45%</li>
    <li>一半用户卡在填地址这一步</li>
    <li>缺少微信支付，移动端流失明显</li>
  </ul>
</section>
```

## icon-grid 图标网格

3 项（默认）、4 项（`.items` 加 `is-4`）或 6 项（`is-6`，图标在左、两行三列）。每项：图标 + 小标题（≤ 8 字）+ 一句
（3、4 项 ≤ 24 字；6 项 ≤ 16 字）。

```html
<section data-layout="icon-grid">
  <div class="head"><h2>三个改动</h2></div>
  <div class="items">
    <div class="item"><span class="icon-badge"><i data-icon="map-pin"></i></span><h3>地址识别</h3><p>粘贴整段地址，自动拆分省市区</p></div>
    <div class="item"><span class="icon-badge"><i data-icon="credit-card"></i></span><h3>支付前置</h3><p>进入结账页就选好支付方式</p></div>
    <div class="item"><span class="icon-badge"><i data-icon="zap"></i></span><h3>一键下单</h3><p>老用户默认上次的地址和支付</p></div>
  </div>
</section>
```

## two-cols 两栏

两块并列的内容。每栏：小标题（可带图标）+ 2–4 条（每条 ≤ 16 字）。

```html
<section data-layout="two-cols">
  <h2>方案概览</h2>
  <div class="cols">
    <div><h3><i data-icon="smartphone"></i>前台</h3><ul><li>地址自动识别</li><li>支付方式前置</li></ul></div>
    <div><h3><i data-icon="server"></i>后台</h3><ul><li>地址库对接</li><li>支付渠道配置</li></ul></div>
  </div>
</section>
```

## image-left / image-right 图文

图占半幅（8:9，铺满；`figure` 加 `class="contain"` 完整显示、四周留白；截图可以套 `frame-phone` / `frame-browser`）。
文字侧：kicker + 标题（≤ 12 字）+ 一段 ≤ 50 字。`image-right` 图在右，骨架相同。

```html
<section data-layout="image-left">
  <figure><div class="frame-phone"><img src="assets/10-新结账页.png" alt="新结账页"></div></figure>
  <div class="text">
    <div class="kicker">新设计</div>
    <h2>地址一步填完</h2>
    <p>粘贴整段地址自动拆分省市区，填写时间从 48 秒降到 12 秒。</p>
  </div>
</section>
```

## image-full 满版图

图铺满全页，底部标题（≤ 16 字）+ 一句说明（≤ 30 字）。

```html
<section data-layout="image-full">
  <img class="bg" src="assets/scene.jpg" alt="">
  <div class="text"><h2>用户在地铁上下单</h2><p>单手、信号差、随时被打断</p></div>
</section>
```

## image-grid 图片网格

2（`.grid` 加 `is-2`）、3（默认）或 4（`is-4`）张图，每张一行说明（≤ 12 字）。截图加 `class="contain"`。

```html
<section data-layout="image-grid">
  <h2>三个页面</h2>
  <div class="grid">
    <figure class="contain"><img src="assets/p1.png" alt=""><figcaption>购物车</figcaption></figure>
    <figure class="contain"><img src="assets/p2.png" alt=""><figcaption>结账</figcaption></figure>
    <figure class="contain"><img src="assets/p3.png" alt=""><figcaption>支付成功</figcaption></figure>
  </div>
</section>
```

## metrics 数据指标

2–4 个指标。数字 ≤ 5 个字符（`45%`、`12s`、`3.2x`），必须保持一行；“万元”“人”“家”等单位放进下面的说明，
不要在 `<strong>` 里追加单位或 `<small>`。说明 ≤ 14 字；最关键的一个加 `is-key`（强调色）；可在说明下放一根进度条。

```html
<section data-layout="metrics">
  <h2>目标</h2>
  <div class="metrics">
    <div class="metric is-key"><strong>45%</strong><span>下单转化率（现在 32%）</span><div class="chart" data-chart="progress" data-values="45"></div></div>
    <div class="metric"><strong>12s</strong><span>填地址耗时（现在 48s）</span></div>
    <div class="metric"><strong>+18%</strong><span>移动端 GMV</span></div>
  </div>
</section>
```

## big-number 大数字

一个关键数字（≤ 4 个字符，单位放 `<small>`）+ 标题（≤ 16 字）+ 一句解释（≤ 40 字），可再放一张小图表。

```html
<section data-layout="big-number">
  <div class="number">48<small>秒</small></div>
  <div class="text">
    <h2>填一次地址要 48 秒</h2>
    <p>是整个结账流程里最慢的一步，也是流失最多的一步。</p>
    <div class="chart" data-chart="hbar" data-labels="填地址,选支付,确认订单" data-values="48,14,9" data-unit="s" data-highlight="0"></div>
  </div>
</section>
```

## chart 图表

左边写结论（结论就是标题，≤ 20 字），右边一张图表。图表数据见上面「图表」。

```html
<section data-layout="chart">
  <div class="text">
    <div class="kicker">转化漏斗</div>
    <h2>填地址这一步流失最多</h2>
    <p>进入结账的用户里，只有 52% 填完了地址。</p>
  </div>
  <div class="chart" data-chart="funnel" data-labels="进入结账,填完地址,选好支付,下单成功" data-values="100,52,37,32" data-unit="%"></div>
</section>
```

## compare 对比

左右各：小标题（≤ 10 字）+ 3–4 条（每条 ≤ 14 字）；推荐的一侧加 `is-highlight`，可放一个 `<span class="tag">推荐</span>`。

```html
<section data-layout="compare">
  <h2>方案对比</h2>
  <div class="compare">
    <div class="col"><h3>A：小改</h3><ul><li>两周上线</li><li>只解决地址问题</li><li>转化 +5%</li></ul></div>
    <div class="col is-highlight"><span class="tag">推荐</span><h3>B：重做</h3><ul><li>六周上线</li><li>地址、支付一起解决</li><li>转化 +13%</li></ul></div>
  </div>
</section>
```

## cards 卡片

3（默认）、4（`.cards` 加 `is-4`）或 6（`is-6`）张。每张：编号或图标 + 小标题（≤ 8 字）+ 一句（≤ 24 字；6 张 ≤ 16 字）。
要突出的一张加 `is-highlight`。

```html
<section data-layout="cards">
  <h2>三个取舍</h2>
  <div class="cards">
    <div class="card"><div class="idx">01</div><h3>先做移动端</h3><p>七成订单来自手机</p></div>
    <div class="card is-highlight"><div class="idx">02</div><h3>地址库外采</h3><p>自建要三个月，外采两周</p></div>
    <div class="card"><div class="idx">03</div><h3>保留老流程</h3><p>灰度期间可以一键切回</p></div>
  </div>
</section>
```

## timeline 时间线

3–5 步。每步：时间（≤ 8 字）+ 事项（≤ 6 字），可再加一句（≤ 14 字）；当前或最关键的一步加 `is-now`。

```html
<section data-layout="timeline">
  <h2>节奏</h2>
  <ol class="timeline">
    <li><strong>10 月第 1 周</strong><span>设计评审</span></li>
    <li class="is-now"><strong>10 月第 3 周</strong><span>开发完成</span><p>地址库联调</p></li>
    <li><strong>11 月第 1 周</strong><span>灰度 10%</span></li>
    <li><strong>11 月第 3 周</strong><span>全量</span></li>
  </ol>
</section>
```

## process 流程

3–5 步（竖排 `is-vertical` 可到 6 步）。每步：可选图标 + 名称（≤ 6 字）+ 一句说明（4 步以内 ≤ 10 字、5 步 ≤ 8 字；竖排不写说明）；
关键的一步加 `is-key`。
编号和箭头是版式自带的。`.flow` 也可以放进别的版式（比如 `image-left` 的文字侧用 `is-vertical`）。
**流程图一律用这个**，不要用 Mermaid——Mermaid 只留给有分支、有回路、画不成一条线的复杂图（放 `figure` 里）。

```html
<section data-layout="process">
  <div class="head"><h2>新流程：从五步到三步</h2></div>
  <ol class="flow">
    <li><span class="icon-badge"><i data-icon="shopping-bag"></i></span><b>浏览商品</b><span>首页、搜索、推荐</span></li>
    <li><span class="icon-badge"><i data-icon="shopping-cart"></i></span><b>加入购物车</b><span>可以跨店合并</span></li>
    <li class="is-key"><span class="icon-badge"><i data-icon="zap"></i></span><b>一屏结账</b><span>地址和支付在同一屏</span></li>
    <li><span class="icon-badge"><i data-icon="circle-check"></i></span><b>下单成功</b><span>订单号、预计送达</span></li>
  </ol>
</section>
```

## figure 图表 / 嵌入 / 复杂流程图

标题 + 一大块内容区（一张图表、一张嵌入的表格、一个有分支的复杂流程图），可加一行图注。嵌入的表格超过 8 行拆页或
只嵌汇总；数字要比较时优先用 `chart`；一条线走到底的流程用 `process`，只有分支、回路画不成一条线时才在这里放 Mermaid。

```html
<section data-layout="figure">
  <h2>退款流程</h2>
  <div class="figure"><div class="mermaid">flowchart LR
  A[申请退款] --> B{已发货?}
  B -- 否 --> C[直接退款]
  B -- 是 --> D[退货] --> C</div></div>
</section>
```

```html
<section data-layout="figure">
  <h2>各渠道明细</h2>
  <div class="figure"><pf-embed ref="sheet:sales#汇总"></pf-embed></div>
  <p class="caption">数据：2026 年 7–9 月</p>
</section>
```

## quote 引言

引文 ≤ 40 字 + 出处。引号、竖线这些装饰是样式自带的。

```html
<section data-layout="quote">
  <blockquote>每次都要重新填地址，填到一半就不想买了。</blockquote>
  <cite>—— 用户访谈 #12，上海，28 岁</cite>
</section>
```

## end 结束页

```html
<section data-layout="end">
  <h2>谢谢</h2>
  <p>问题和建议：交易产品组</p>
</section>
```
