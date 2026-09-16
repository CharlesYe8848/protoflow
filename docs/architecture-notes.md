# 架构决策记录

记录几处"为什么这样做"的实现细节和取舍。日常使用不需要读这篇，改动对应模块或好奇底层机制时再来查。

## Mermaid 画板机制

画板本质是任意 HTML，流程图/时序图/架构图不需要新建画板类型，`source.jsx` 渲染成
`<pre className="mermaid">` 包住 [mermaid](https://mermaid.js.org/) 的文本 DSL 就能自动排版：

```jsx
function Component(){
  var ref = React.useRef(null);
  React.useEffect(() => { window.mermaid.run({ nodes: [ref.current] }); }, []);
  return (
    <div style={{ padding: 32, background: "#f6f7fb" }}>
      <pre className="mermaid" ref={ref} style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(15,23,42,.06)" }}>
        {`graph TD\nA[开始]-->B{判断}\nB-->|是|C[执行]`}
      </pre>
    </div>
  );
}
```

- `mermaid.min.js`（3.5MB，比 react+react-dom+babel 加起来还重）只在源码里出现 "mermaid" 字样时才会被引用，普通 UI 原型画板不受影响。
- `useEffect` 里显式调用是必须的——mermaid 默认在页面 `DOMContentLoaded` 时自动扫描渲染，这个时机早于 React 把内容挂到 `#root`，会扑空。
- 配色（`core/preview.js` 的 `MERMAID_THEME_VARS`）默认跟画布 UI 同一套青色主色调，比 mermaid 自带的淡紫色默认主题更贴合平台整体视觉。
- 外层这个 `<div>` padding/白卡片/圆角是推荐写法，不是平台强加的——画板本质是任意 HTML，具体排版留给画板作者自己决定。

图表类型怎么选（flowchart 还是 sequenceDiagram）、踩过的坑（vh 单位撑爆 iframe、泳道图布局限制）见 `get_guide("diagram")`。

## 本地预览服务器协议

`render_preview` / `render_canvas` / `build_doc` / `build_publish_pack`（`mode:"previews"`）返回结果里都有一个
`url`（`http://127.0.0.1:<port>/...`）——**这是打开这些产物的方式**，请用户或浏览器工具打开这个 `url`。
不要拿返回值里的 `htmlPath`/`canvasPath`/`prdHtmlPath` 自己拼 `file://` 路径去打开：很多 agent 自带的浏览器工具
（沙箱/CDP 类扩展）出于安全限制打不开 `file://`，只有 `url` 是通用的。`htmlPath` 等字段仍然会返回，纯粹是"文件写在
磁盘哪里"这个事实信息，不是打开方式。

### 共享后台服务

这个 `url` 由一个共享的本地静态文件服务器提供——不管是从 MCP 还是从 `bin/protoflow-cli.js` 调用，
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
拒绝隐藏文件，只有 `.protoflow/<key>.json` 与 `docs/<docId>/.build/previews/<captureId>.html`
例外。静态读取、动态视图 URL 和状态写入都会检查路径并拒绝路径中的符号链接。

这些检查保护 HTTP 文件入口，不构成不可信项目的执行沙箱。画板 JSX 会在浏览器执行；
文档类型的 checks 会以当前用户权限在子进程运行。只打开、导入或执行可信项目，
不要通过端口转发将预览服务开放到公网。详见 [安全说明](../SECURITY.md)。

### 派生状态持久化

画布的缩放/平移视角、侧边栏收起状态会持久化到项目内 `.protoflow/canvas.json`（不是
`localStorage`——那是按浏览器 origin 隔离的，换设备/换浏览器/`file://` 与 `http://127.0.0.1`
之间都跟不过去）。写这个文件走的是同一个本地服务器新开的一条通用路由：
`POST /p/<projectId>/__protoflow_state/<stateKey>`，落到 `<项目根目录>/.protoflow/<stateKey>.json`；
`stateKey` 过 `core/ids.js` 的 `assertSafeSegment` 校验，画布用的 key 是 `canvas`，以后有别的
派生状态要存，换个 key 走同一条路由就行，不用再改服务器代码。`.protoflow/` 不是项目"真内容"，
可以放心加进 `.gitignore`。
