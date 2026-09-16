# ProtoFlow 工作流总览

链路：原型（画板 JSX）→ 标注 → 文档（PRD / 上线公告 / …）→ 发布。
每层产物登记上游内容指纹，`chain_status` 随时算出过期清单。**任何环节开始前，先跑一次 `chain_status`。**

## 角色分工

- 你（模型）：写 JSX、标注内容、`.build/captures.json` 分组、`doc.md` 正文。
- 工具：编译校验、指纹登记、一致性计算、构建、组包、跑该文档类型的 checks。校验不过的内容不落盘。

## 文档基座（通用，不只 PRD）

- 一个文档类型 = `doc-kinds/<kind>/` 一个目录（`kind.json` + `template.md` + `writing.md` +
  可选 `checks/*.mjs`）。内置 `prd`、`release-note`；项目根目录 `doc-kinds/` 可覆盖或新增。
- 核心不认识类型：要不要追画板漂移看版本 `manifest.json` 里有没有 `sourceFingerprints`（图是不是
  从画板截的）；发布前拦不拦截看 `doc.md` 里有没有触发 error 级 check。都不是 flag。
- 版本照 Artifacts：文档有身份（`docs/<docId>/`），版本是 `versions/<n>/` 的整数下标，显式
  `build_doc(mode:"finalize", note:)` 才产生，`head` 是唯一真相源。

## 标准流程

1. `create_project` 或 `import_project`。
2. `upsert_page` / `upsert_artboard` 建结构 → 写 JSX → `save_artboard_source`
   （规范 get_guide("artboard")；流程图/时序图 get_guide("diagram")）。
3. `get_annotations` 拿元素清单 → 写 `annotations.md` → `write_annotations`（原则 get_guide("annotation")）。
4. 任意时候 `render_canvas`，打开返回的 `url`（`http://127.0.0.1`，别拼 file://）——整站画布汇总全部
   页面/画板，是项目源文件的实时投影：改源码/标注、加删页面画板、git 撤回后刷新浏览器即最新，不落盘、
   不用重复调。单块画板单独看用 `render_preview`（同样返回画布 url）。
5. `get_doc_kind("<kind>")` → `create_doc({ kind, docId?, from? })` 起草。
6. 用画布截图当上下文的类型（如 PRD）：写 `docs/<docId>/.build/captures.json`（分组 get_guide("capture")）
   → `build_doc(mode:"snapshot")` → `build_publish_pack` previews → capture → seal（截图落进
   `docs/<docId>/assets/`）。图来自联网搜/别的文档的类型跳过这步，直接把图放进 `assets/`。
7. 写 `docs/<docId>/doc.md`（模板见 get_doc_kind；图片引用 `![](assets/<file>)`）→
   `build_doc(mode:"finalize", note:"这一版改了什么")`。
8. 按渠道 guide（如 get_guide("publish-dingtalk")）发布 `doc.md` 正文 → `record_publish` 登记
   （error 级 check finding 会拦截）。
9. 原型再改动后回第 2 步；`chain_status` 列出所有下游欠账。

## chain_status 发现项（按严重度）

broken（元素/引用丢失）→ unvalidated（源码外部修改未校验）→ review（标注待核对）→
uncommitted（doc.md 有未定版改动）→ drifted（head 版本引用的画板漂移，建新版本）→
lagging（已发布版本漂移要重发 / 派生文档的上游出了新版本）。

## 版本语义

- 版本 = 一次评审/发布的不可变快照；`versions/<n>/` 写完不改。
- 原型改了要更新评审材料 → `build_doc(mode:"finalize")` 切新版本，不改旧版本。
- 已 `record_publish` 的版本冻结。
