# doc-kinds/ — 文档类型包

一个文档类型 = 这个目录下的一个子目录，自包含：

```
<kind>/
  kind.json      { "label": "PRD", "contextSource": "canvas" }
  template.md    起草新文档时的骨架（create_doc 用它初始化 doc.md）
  writing.md     撰写规范/检查清单（需要模型判断的规则，prose）
  checks/        可选。确定性的可执行校验，*.mjs
```

`_shared/checks/` 里的 check 对所有类型生效。

## 发现顺序

`<projectRoot>/doc-kinds/<kind>/` 优先于内置 `<repo>/doc-kinds/<kind>/`——项目本地可以覆盖内置类型，也可以新增内置没有的类型。checks 是叠加：内置 `_shared` → 内置 `<kind>` → 项目 `_shared` → 项目 `<kind>`，存在的全跑。

## check 模块契约

```js
// checks/xxx.mjs
export default function check(ctx) {
  // ctx = { docMd, docJson, assets: string[], docId, versionN }
  return [
    { code: "TITLE_FORMAT", level: "error", message: "...", hint: "..." },
  ];
  // level: "error" | "warn" | "info"
  // error 级会拦截 record_publish（除非传 acknowledgeFindings:true）
}
```

check 在子进程里跑，单次执行有超时，抛错/超时不影响 finalize，只是少一条 finding。
`contextSource` 只是元数据（画布菜单分组、create_doc 起草提示），不 gate 任何行为。
