# 幻灯片的文件格式

幻灯片是 `decks/<deckId>/` 下的一组普通文件：每页一个 HTML，全稿共用的样式脚本放 `design/`，素材放 `assets/`，放映行为
写 `playback.json`，改完 `build_deck(note:"…")` 定版。**只要符合这份格式，写成什么样都行**——版式、配色、字体、动画、
交互全部由写的人决定，壳子只负责放映、版本、嵌入和导出。怎么做出一份好的幻灯片见流程 skill `protoflow-slides`。

阅读页只显示定过版的内容，开着时定了新版本会自动刷新，每轮改完不用再打开新页面。`?v=<n>` 看历史版本，`#<页码>` 定位到某一页，Esc 总览（有选中元素时先取消选中），T 打开左侧缩略图导航；
顶部菜单栏的「全屏」或 F 键放映，只留幻灯片。

```
decks/<deckId>/
├── slides/*.html   每页一个文件，按文件名排序
├── design/         全稿共用的 .css、.js（create_deck 放了一份起步样式 design.css，直接改、加文件都行）
├── assets/         图片、视频、音频、字体
├── playback.json   自动翻页、背景音乐、旁白（可选）
└── deck.json       壳子维护，不要手改
```

## 一页

- 文件名决定顺序：`01-封面.html`、`02-背景.html`……插页就起个排在中间的名字（`02b-补充.html`）。文件名去掉
  `.html` 就是这一页的 id，引用某一页写 `deck:<deckId>#<页 id>`。
- 文件内容的根节点是**一个** `<section>`，外面不要再包东西；里面放什么 HTML、`<style>`、`<script>` 都行。
  `data-layout`、`class` 这些属性随意写，壳子不看。
- 画布固定 **1920×1080**，框架按窗口等比缩放，不要写响应式、不要按窗口宽度改排版。超出画布的部分会被裁掉。
- **所有页在同一个网页里**（这样全稿共用 `design/`、切页快），所以页里的样式和脚本要管住自己的范围：
  - 样式写在本页范围内：给 section 一个类名，规则都以它开头——`<section class="p-cover">…<style>.p-cover h1{…}</style>`。
    写成 `h1{…}` 会改到每一页。
  - 脚本包在函数里、从本页根节点找元素：
    ```html
    <script>(() => {
      const page = document.currentScript.closest("section");
      page.querySelector(".chart")…
    })();</script>
    ```
    页里的脚本在 `design/` 的脚本之后执行，能直接用 `design/` 里定义的东西。
  - 页里的 `<style>` 在网页里排在 `design/` 的样式后面：选择器一样具体时，页里的赢。要从 `design/` 覆盖页里写的样式，
    选择器得更具体（比如前面加 `:root`）。

## design/：全稿共用的样式和脚本

`design/` 顶层的 `.css`、`.js` 全部加载，按文件名排序（先后有讲究就起 `01-`、`02-` 这样的前缀）；子目录（字体、底纹）
不直接加载，由样式用相对路径引用（`url(fonts/a.woff2)`）。几页都要用的东西——配色、字体、装饰、反复出现的版式——放这里，
不要每页各写一遍。定版时跟着版本一起冻结，改 `design/` 不影响已定的版本。

## 翻页时的事件

翻到一页时，壳子在这一页的 `<section>` 上发 `pf:enter`，离开时发 `pf:leave`（都冒泡，`event.detail` 是 `{ index, id }`）。
进场动画、开始 / 停止一段交互就挂在这上面，不要自己用计时器猜什么时候翻页了：

```js
page.addEventListener("pf:enter", () => page.classList.add("play"));
page.addEventListener("pf:leave", () => page.classList.remove("play"));
```

当前页的外层是 `.pf-slide.active`，CSS 动画可以写在 `.pf-slide.active …` 下面。导出 PDF 时 `<html>` 上有 `pf-print`（导出 MP4 时有 `pf-capture`，动画照常放、逐帧录）、
总览时有 `pf-overview`，系统设了"减少动态效果"时有 `prefers-reduced-motion`——这些时候应该直接显示最终效果，不要停在动画的起点。

## 图片和素材

放进 `decks/<deckId>/assets/`，页里写相对路径 `assets/<文件>`（`<img src="assets/a.png">`、`style="background-image:url(assets/a.png)"`
都行）；`build_deck` 校验这些文件都在。不要引外部地址——导出的单 HTML 要能离线打开。

## 视频

视频也放进 `assets/`（`.mp4` 或 `.webm`），页里写 `<video src="assets/demo.mp4" poster="assets/demo.jpg" controls></video>`：

- **一定配 `poster`**：左侧缩略图和导出的 PDF 只显示封面，没有封面就是一块空白。
- 要进页自动播就加 `autoplay`：阅读页只在翻到这一页时从头播，翻走就暂停，不会在别的页里偷偷响。人点过「播放」
  或页面上任何地方之后，有声视频可以带声音自动播；还没人操作时浏览器会拦，阅读页会自动退成静音播放。所以**不要为了能自动播加 `muted`**，
  `muted` 只用在本来就该没声音的视频上（纯画面的背景循环、用户明确说不要原声）——写了 `muted` 的视频，阅读页的声音开关也不会打开它。
- **原声默认保留。** 手机拍的 `.MOV`（HEVC）浏览器放不稳，要转成 H.264 的 `.mp4`，转的时候音轨一起转成 AAC，比如
  `ffmpeg -i IMG_1234.MOV -ss 2 -t 12 -c:v libx264 -crf 23 -preset medium -vf "scale=-2:1080" -c:a aac -b:a 128k -movflags +faststart assets/clip.mp4`。
  不要用 `-an` 去掉声音来省体积（音轨只占很小一部分）；确实要去掉原声，先问用户。
- 同时有背景音乐时，给 `backgroundAudio` 写 `duckVolume`，视频出声时背景音乐自动压低（见下一节），不要为了不打架把视频原声去掉。
- 自动放映时想等视频播完再翻页，在 `playback.json` 里给这一页写 `"advance": { "on": "video-ended", "fallbackMs": 30000 }`（见下一节）。
- 视频会原样内嵌进导出的单 HTML，文件大小跟着涨；尽量压缩、控制时长。

## 嵌入表格、绘图

```html
<pf-embed ref="sheet:sales#汇总"></pf-embed>
```

`ref` 同 `sources` 的格式。表格嵌成表格，Mermaid 绘图嵌成流程图，脑图嵌成层级列表。`build_deck` 把引用固定到
对方当时的最新版、记进这一版的引用；对方之后改了只会让引用变成过期，已定版的幻灯片内容不变。对方产品没启用时显示占位。

## 流程图

一条线走到底的流程用 HTML 画（步骤卡片 + 箭头）更清楚；
只有分支、回路画不成一条线时，才用 `<div class="mermaid">flowchart LR … </div>`（阅读页里渲染成图）。

## 自动翻页和音频

新建幻灯片会带一个关闭自动翻页的 `playback.json`。普通汇报保留这个默认值；用户要展台循环播放、背景音乐或逐页旁白时，
本地 Agent 修改它，音频文件放进 `assets/`。不要在页面 HTML 里写 `<audio autoplay>` 或自己的翻页计时器，阅读页统一管理暂停、
手动翻页、页面切换和音频生命周期。

```json
{
  "schemaVersion": 1,
  "autoAdvance": {
    "enabled": true,
    "defaultDurationMs": 8000,
    "loop": false
  },
  "backgroundAudio": {
    "src": "assets/bgm.mp3",
    "volume": 0.3,
    "loop": true,
    "duckVolume": 0.06
  },
  "slides": {
    "02-背景": {
      "audio": { "src": "assets/02-背景.mp3", "volume": 1 },
      "advance": { "on": "audio-ended", "fallbackMs": 15000 }
    },
    "03-方案": {
      "advance": { "on": "timer", "durationMs": 12000 }
    },
    "04-讨论": {
      "advance": { "on": "manual" }
    }
  }
}
```

- `autoAdvance.enabled` 打开整份稿子的自动翻页；没有逐页覆盖时用 `defaultDurationMs`。`loop` 控制末页是否回到第一页。
- `backgroundAudio` 跨页连续播放；`slides.<页 id>.audio` 是该页旁白。`src` 只能是 `assets/` 下的 `.mp3` 或 `.wav`，
  `volume` 是 0–1。
- `backgroundAudio.duckVolume`（0–1，可不写）：当前页的旁白或有声视频在响时，背景音乐渐变压到这个音量，停了渐变回 `volume`。
  不写就不避让，背景音乐一直按 `volume` 放。有旁白或带原声的视频时一般要写，压到能听见但不抢人声的程度（`0.05`–`0.1`）；
  用户想让音乐和原声一样响、或者全程只要音乐，就不写或按用户说的定。
- `advance.on`：`timer` 按时长翻页，`audio-ended` 等该页旁白结束，`video-ended` 等该页第一个 `<video>` 放完
  （放映到这页会自动开始播），`manual` 停在该页等人操作。音频、视频无法播放时，`audio-ended` / `video-ended` 使用 `fallbackMs` 继续。
- 时长单位是毫秒，范围 500–86400000。`build_deck` 会拒绝不存在的页面、缺失音频、非法时长、不支持的格式，以及页里没有视频却写了 `video-ended`。
- 浏览器要求用户先操作才能播放有声音的媒体，所以阅读页打开后由人点击一次「播放」；之后自动翻页、背景音乐和旁白按配置运行。
- 没有 `playback.json` 的旧幻灯片按手动翻页处理。单 HTML 保留播放能力；PDF 只保留静态页面；MP4 按这份配置录（见「导出」）。

## 处理人的意见

人在阅读页上点选元素（⇧/⌘ 点击多选，空白处拖动框选，⌘A 全选当前页），右键「标注」写意见，复制给你的文本长这样：

```
这两张卡片改成三列，加一张"风险"

[Protoflow 标注]
project: shop
kind: deck
source: decks/q3-review/slides/03-summary.html
version: v4 (head)
deck: Q3 汇报 (q3-review)
slide: 3 / 12 · 本季结论 (03-summary) · layout: cards
elements:
  1. path: section > div.cards > div.card:nth-of-type(1)   text: "增长 用户数 +32%"
  2. path: section > div.cards > div.card:nth-of-type(2)   text: "留存 次月留存 41%"
screenshot: /…/shop/.protoflow/shots/20260927-101500-a1b2.png  （选中的按编号框出，编号对应上面的顺序）
```

- 改 `source` 指向的那一页；`path` 是元素在这页 `<section>` 里的位置（标签、类名、同类里第几个），`text` 是它显示的文字，两个对照着找。
  页面脚本可能改过页面结构，路径对不上时以文字为准。`pf-embed` 指页里的 `<pf-embed>`，`embed:` 后面是它引用的对象。
- `version` 标了 `historical` 说明人看的是历史版本，先对比那一版和现在的草稿再改。
- `screenshot` 是人标注时这一页的截图，选中的元素按上面的编号框出来——**先看图**，确认人指的是哪块、现在长什么样，
  再按 `path` / `text` 去源文件里找。截图没成功时没有这一行。
- `elements: （整页）` 表示意见针对整页，不是某个元素。
- 改完这一批意见 `build_deck` 定一个版本，note 里写清改了哪些。

## 导出

分享菜单或 `export_deck`：PDF（每页一张静态 16:9，要本机有 Chrome，没有会自动下载一个无头浏览器）、MP4 视频（1920×1080，每页时长按
`playback.json`：定时、旁白放完、视频放完，没开自动翻页的页按 `defaultDurationMs`；CSS 动画、过渡和页里的视频逐帧录，
旁白、背景音乐（含避让）、视频原声合进音轨；用 JS 定时器自己驱动的动画录不到过程；要本机有 ffmpeg）、单个 HTML（design/、图片、
音频、Mermaid 都内嵌，双击就能放映）、源文件包（`.zip`）。
