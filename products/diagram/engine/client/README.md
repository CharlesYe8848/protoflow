# 浏览器端渲染脚本的约定

每种写法一个脚本（`<kind>.js`），由服务端按文本读出、原样拼进预览页的 `<script>`。脚本里调用：

```js
PFDiagram.register(kind, {
  render(stage, page, ctx),   // → Promise
  nodes(stage, page),         // → [{ el, key, info }]
  ignoreClick(target),        // 可选 → true 表示这次点击留给渲染器自己（比如脑图的折叠圆圈）
  dispose(stage),             // 可选：离开这一页（切页、切版本）前调用，释放监听器等
});
```

- `stage`：一个空的 `<div>`。`render` 往里放一个**有固定像素尺寸**的元素（通常是 `<svg>`，宽高写成
  px），预览页负责平移、缩放、适应窗口，渲染器不要自己处理。
- `page`：`{ id, name, kind, source, data }`。`source` 是这一页的源码，`data` 是服务端渲染器
  `prepare()` 的结果。`data` 可能被多次渲染复用，要改就先复制一份。
- `ctx`：`{ theme, resized() }`。`theme` 是 Mermaid 配色（`MERMAID_THEME_VARS`）；渲染完成后内容
  尺寸又变了（比如脑图折叠），调 `ctx.resized()`。
- `render` 失败时 reject 一个 `Error`，预览页会显示"渲染失败"和错误信息。
- `nodes` 返回可以被选中的对象，人能看到的每个元素都应该属于某个对象（框选整张图 = 全选）。`el` 是一个元素
  或几个元素组成的数组（比如时序图的消息 = 文字 + 箭头），用来判断点中、算位置、画选中框；`key` 在这一页里唯一，同一个节点出现
  多处（比如时序图上下两排参与者）用同一个 `key`；`info` 进复制给 agent 的标注文本：
  - `label`：显示的文字
  - `id`：源码里的节点 id（能拿到时）
  - `path`：从根到这个节点的路径（脑图）
  - `lines`：`[起, 止]`，源码里的行号，从 1 开始，含两端
  - `match`：`"id"` / `"path"` / `"text"`，说明是怎么定位到源码的；`"text"` 是按文字匹配，可能不准

脚本只能用浏览器 API 和这种写法自己的库（渲染器 `libs` 里声明的），不能依赖预览页的其他内部实现。
