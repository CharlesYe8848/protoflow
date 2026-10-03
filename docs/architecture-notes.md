# 架构决策记录

记录几处"为什么这样做"的实现细节和取舍。日常使用不需要读这篇，改动对应模块或好奇底层机制时再来查。

整体产品结构（画布/文档/表格/绘图作为独立产品、关系与流程 skill 可插拔）的目标和分阶段计划见 [product-architecture.md](product-architecture.md)。

## 绘图产品的渲染

绘图（`products/diagram/`）把"一种写法"做成一个渲染器（`engine/renderers/`）：服务端负责校验和预处理，
浏览器端脚本（`engine/client/`，约定见那里的 README）负责画和列出可选中的节点。几处取舍：

- **Markdown 在服务端转成节点树**，浏览器只加载 `markmap-view` + `d3`（约 330KB），不加载 `markmap-lib`
  （677KB）。转换只启用 `sourceLines` 插件，节点带源码行号，标注时 agent 能找回位置。
- **平移、缩放、适应窗口由预览页统一做**，渲染器只画一个固定像素尺寸的内容（markmap 关掉自带的缩放，
  svg 缩到内容大小）。选择、框选、选中框因此对所有写法是同一套代码。
- **节点的"点选"监听在捕获阶段**：markmap 在节点文字上拦截了 `mousedown`，冒泡阶段收不到。
- **不往渲染器生成的元素上加类名**：markmap 每次重排都会重写节点的 `class`，加上去的标记会时有时无
  （测试里出现过偶发失败）。手型光标改成鼠标移动时判断指针下是不是节点。
- **markmap 首次渲染不带动画**：渲染完成时节点要在最终位置上，框选才量得准；之后折叠展开再用动画。
- **Mermaid 的节点 id**：流程图、状态图、类图、ER 图的节点 DOM id 形如 `<svg id>-flowchart-<源码 id>-<n>`，
  从中取出源码里的 id；时序图的参与者用 `data-id`；Mermaid 自带的脑图、时序图的消息只能按文字匹配，
  复制的文本里会注明。Mermaid 升级时这里最容易变，`tests/diagramPreview.test.js` 盯着。
- **Mermaid 语法只能在浏览器里完整检查**（依赖 DOM），定版时只查第一行是不是认识的图表类型，写错的
  语法在阅读页上显示成"渲染失败"。

画板里画 Mermaid 只为兼容老画板保留（`products/canvas/preview.js` 的 `MERMAID_INIT`），删除条件写在那里。

## 本地预览服务器协议

`render_canvas` / `build_canvas` / `build_doc` / `build_sheet` 返回结果里都有一个
`url`（`http://127.0.0.1:<port>/...`）——**这是打开这些产物的方式**，请用户或浏览器工具打开这个 `url`。
不要拿返回值里的 `htmlPath`/`canvasPath`/`prdHtmlPath` 自己拼 `file://` 路径去打开：很多 agent 自带的浏览器工具
（沙箱/CDP 类扩展）出于安全限制打不开 `file://`，只有 `url` 是通用的。`htmlPath` 等字段仍然会返回，纯粹是"文件写在
磁盘哪里"这个事实信息，不是打开方式。

### 共享后台服务

这个 `url` 由一个共享的本地静态文件服务器提供——从 `bin/protoflow-cli.js` 调用时，
两条入口拿到的是**同一个**后台服务：第一次调用时按需 spawn 一个 detached 进程（不挂在调用方进程上，
调用方退出后它继续活着），之后每次调用探活复用，状态记在 `~/.protoflow/server.json`（`{ pid, port,
secret }`，纯运行时记账，不含任何项目路径/id，不是项目数据）。要手动结束这个后台服务，`kill` 掉
`~/.protoflow/server.json` 里记的 `pid` 即可；不影响任何项目数据。

### 端口选择

端口是固定起点（`4287`）往上扫描到第一个空闲端口，不是 `listen(0)` 问 OS 要一个随机端口——参照
HyperFrames（`findPortAndServe`：固定 `startPort` 往上探，被占用才换下一个）。这样每次这台后台
服务重启（睡眠唤醒 / 重启电脑 / 手动 kill 之后被重新 spawn）基本都落回同一个端口，之前开着的
标签页不会因为端口随机变了就集体失效；真被别的进程占用了才会落到 `4288`/`4289`……

### url 结构与项目注册

url 长这样：`http://127.0.0.1:<port>/p/<projectId>/canvas.html`——参照 HyperFrames
（`hyperframes preview` 的 `#project/<name>` + `/api/projects/<name>/...`）：服务端从不把文件系统
绝对路径吐给浏览器，路径里的 `<projectId>` 就是项目名本身（可读，不是不透明 hash），真实根目录在
服务端内部一个内存注册表里维护，第一次给某个项目生成 url 时顺带注册；不同目录撞同名项目按
`core/store.js` 的 `uniqueProjectId` 同一套规则加 `-2`/`-3` 后缀区分。

### 鉴权模型

预览服务仅监听 `127.0.0.1`，接受匹配本地端口的 `Host`；带 `Origin` 的请求必须同源，
并拒绝 `Sec-Fetch-Site: cross-site`。项目注册仍需要 secret 签名的 HMAC token。

已注册项目的预览读取与派生状态写入不使用登录 cookie。HTTP 静态文件入口限制扩展名，
拒绝隐藏文件，只有 `.protoflow/<key>.json` 例外（以前截图预览页 `docs/<docId>/.build/previews/` 也是
例外，截图搬进流程 skill 后去掉了）。对象库 `objects/` 里的文件没有扩展名，只能经由版本清单按路径取。静态读取、动态视图 URL 和状态写入都会检查路径并拒绝路径中的符号链接。

这些检查保护 HTTP 文件入口，不构成不可信项目的执行沙箱。画板 JSX 会在浏览器执行；
流程 skill 里的脚本（如文档检查、截图）由 agent 以当前用户权限运行。只打开、导入或执行可信项目，
不要通过端口转发将预览服务开放到公网。详见 [安全说明](../SECURITY.md)。

### 派生状态持久化

画布的缩放/平移视角、当前页面、标注面板状态会持久化到项目内 `.protoflow/canvas.json`（不是
`localStorage`——那是按浏览器 origin 隔离的，换设备/换浏览器/`file://` 与 `http://127.0.0.1`
之间都跟不过去）。写这个文件走的是同一个本地服务器新开的一条通用路由：
`POST /p/<projectId>/__protoflow_state/<stateKey>`，落到 `<项目根目录>/.protoflow/<stateKey>.json`；
`stateKey` 过 `core/ids.js` 的 `assertSafeSegment` 校验，画布用的 key 是 `canvas`，以后有别的
派生状态要存，换个 key 走同一条路由就行，不用再改服务器代码。`.protoflow/` 不是项目"真内容"，
可以放心加进 `.gitignore`。

### 页面实时刷新

agent、编辑器、git checkout 改了项目里的源文件，浏览器里开着的页面自己跟上，不用手动刷新
（`core/liveReload.js`）。职责分两半：**文件监听决定什么时候检查，渲染结果的 hash 决定要不要刷新**。

- 服务端：项目有页面开着时才用 `fs.watch(项目根, { recursive: true })` 监听，300ms 合并，经
  `GET /p/<projectId>/__protoflow_live`（SSE）推一个不带内容的 `change`。动态页面的响应带 `ETag`，
  并在 `<head>` 开头注入页面端脚本。
- 页面端：每个标签页只有顶层页面开一条 SSE，同源子 iframe（画布的画板）注册到它上面——浏览器对同一
  域名最多 6 条 HTTP/1.1 连接，每块画板一条会把连接占满。收到 `change` 后各自 `HEAD` 自己的地址，
  ETag 跟加载时注入的不同就 reload（记住并恢复滚动位置）；同一时间只有一个检查，检查中来的变化等它
  结束再查一次；5xx 显示"源文件当前渲染失败"的角落提示；网络错误不重试。SSE 每次重连、标签页切回
  前台都会检查一次，补上漏掉的事件；后台标签页不检查。
- 不需要产品声明依赖：页面都从 `renderView` 出来，渲染函数本身就是"这个页面依赖什么"的唯一真相。
  代价是**渲染必须确定**——同样的源文件渲染两次结果相同，由 `tests/renderDeterminism.test.js` 守着。
- ETag 用不带界面偏好（`ui.json`）、不读本地派生状态（`renderView` 的 `localState: false`，产品不读
  `.protoflow/`）的渲染结果算：这两样也会进 HTML，但都是页面或用户自己写回的，不算内容变化。
- 画布：改某块画板的 `source.jsx` 只重新加载那块画板的 iframe（画布页 HTML 不含画板源码）；改标注、
  页面结构会整页刷新，视角从 `.protoflow/canvas.json` 读回。画板 JSX 在浏览器里编译，写坏时那块画板
  照常重新加载并显示空白（跟手动刷新一样），改好后自动恢复——渲染失败提示只覆盖服务端渲染失败。
- 自动化浏览器（`navigator.webdriver` 为真，puppeteer / playwright）不开 SSE：它们不需要实时刷新，
  一直开着的长连接会让 `waitUntil: "networkidle0"` 永远等不到。
- 开关：`PROTOFLOW_LIVE=0` 启动后台服务时不注入、不开 SSE，回到手动刷新。调试：
  `PROTOFLOW_LIVE_DEBUG=<文件>` 把每次广播和每次检查（路径、耗时）追加写进这个文件。两个变量都要在
  后台服务启动前设置（先 `kill` 掉 `~/.protoflow/server.json` 里记的 `pid`）。
- 拆除：删 `core/liveReload.js`、`tests/liveReload.test.js`、`core/localServer.js` 里引用它的几行、本节。
