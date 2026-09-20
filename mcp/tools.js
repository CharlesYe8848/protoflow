// mcp/tools.js — 22 个工具：schema(zod raw shape) + handler。handler 只做参数处理与调 core。
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import * as store from "../core/store.js";
import { validateJsx, extractElementIds, extractElementHints } from "../core/compile.js";
import { parseElementRefs, validateRefs, unusedRefKeys } from "../core/annotations.js";
import { evaluateChain } from "../core/chain.js";
import { buildDoc, createDoc } from "../core/doc.js";
import { buildPublishPack } from "../core/publishPack.js";
import { importProject } from "../core/importer.js";
import { toLocalUrl } from "../core/localServer.js";
import { resolveKind, listKinds } from "../core/docKinds.js";
import { runChecks } from "../core/checkRunner.js";
import { runProjectExport } from "../core/exportService.js";
import { EXPORT_TARGETS } from "../core/exportFormats.js";

const fail = (code, message, hint) => ({ ok: false, error: { code, message, ...(hint ? { hint } : {}) } });

// 给已有的 htmlPath/canvasPath 之类的 file:// 路径追加一个 http://127.0.0.1 出口，给打不开
// file:// 的浏览器工具用；起本地服务失败（比如沙箱禁止 spawn/bind 端口）不影响原有返回。
async function withUrl(projectId, projectDir, absPath, obj) {
  try { return { ...obj, url: await toLocalUrl(absPath, { projectId, projectDir }) }; }
  catch { return obj; }
}
const dirParam = { dir: z.string().optional().describe("覆盖默认工作目录（项目所在父目录）；相对路径按当前工作目录解析；缺省用 PROTOFLOW_HOME 或启动时的 cwd") };
const pid = { projectId: z.string().describe("项目 id（同时也是项目文件夹名）"), ...dirParam };

function applyEdits(source, edits) {
  let cur = source;
  for (const { oldText, newText } of edits) {
    const first = cur.indexOf(oldText);
    if (first < 0) return { error: fail("EDIT_NO_MATCH", `oldText 未匹配：${oldText.slice(0, 80)}`) };
    if (cur.indexOf(oldText, first + 1) >= 0) return { error: fail("EDIT_AMBIGUOUS", `oldText 匹配多处，需更长的唯一片段：${oldText.slice(0, 80)}`) };
    cur = cur.slice(0, first) + newText + cur.slice(first + oldText.length);
  }
  return { source: cur };
}

export const TOOL_REGISTRY = [
  {
    name: "list_projects",
    description: "列出工作目录中所有项目（id 与名称）；id 即项目文件夹名",
    schema: { ...dirParam },
    handler: (_a, ctx) => ({ projects: store.listProjects(ctx.ws) }),
  },
  {
    name: "get_project",
    description: "返回项目树（页面/画板层级、画板 sourcePath 绝对路径，可用文件工具直接读）与链路健康摘要（各严重级别发现项计数）",
    schema: pid,
    handler: (a, ctx) => {
      const tree = store.loadProjectTree(ctx.ws, a.projectId);
      const findings = evaluateChain(store.loadChainSnapshot(ctx.ws, a.projectId));
      const health = {};
      for (const f of findings) health[f.level] = (health[f.level] || 0) + 1;
      return { project: tree, health, findingCount: findings.length };
    },
  },
  {
    name: "create_project",
    description: "创建新项目：在工作目录下建一个以项目名 slug 命名的自包含文件夹（同名冲突自动加序号），并写入 AGENTS.md/CLAUDE.md 供任何 agent 冷启动接手。返回项目 id（即文件夹名）",
    schema: { name: z.string().describe("项目名称"), ...dirParam },
    handler: (a, ctx) => store.createProject(ctx.ws, a.name, ctx),
  },
  {
    name: "import_project",
    description: "从外部已有的 protoflow 项目目录（project.json + pages/ 布局）导入到工作目录。只读源目录，补登指纹基线、补写 AGENTS.md/CLAUDE.md；目标目录已有同 id 项目时报错",
    schema: { sourceDir: z.string().describe("源项目目录绝对路径"), ...dirParam },
    handler: (a, ctx) => importProject(ctx.ws, a.sourceDir, ctx),
  },
  {
    name: "upsert_page",
    description: "无 id 创建页面，有 id 改名。返回页面 id。画布是项目结构的实时投影——已打开的画布标签刷新一下，新/改名页面就出现在左侧侧边栏，无需重新调用 render_canvas",
    schema: { ...pid, id: z.string().optional(), name: z.string() },
    handler: (a, ctx) => store.upsertPage(ctx.ws, a.projectId, { id: a.id, name: a.name }, ctx),
  },
  {
    name: "upsert_artboard",
    description: "无 id 在页面下创建画板，有 id 更新名称/描述。可选 canvasWidth（画布中该画板的真实像素宽度，即 Figma 式 Frame 宽度，默认 1440；移动端画板可传 375/414 等）。返回画板 id。画布实时投影项目结构——刷新已打开的画布标签即可看到新/改名画板，无需重新调用 render_canvas",
    schema: { ...pid, pageId: z.string(), id: z.string().optional(), name: z.string(), description: z.string().optional(), canvasWidth: z.number().int().positive().optional() },
    handler: (a, ctx) => store.upsertArtboard(ctx.ws, a.projectId, a.pageId, a, ctx),
  },
  {
    name: "reorder_artboards",
    description: "调整一个页面下画板在画布里的显示顺序（新建画板默认追加到末尾，用这个工具调整）。artboardIds 必须是该页面现有画板 id 的完整顺序（一个全排列，不能少画板也不能带别的页面的画板 id）——先用 loadProjectTree/get_project 之类的读操作看一眼现有顺序，再整体给出目标顺序。刷新已打开的画布标签即可看到新顺序",
    schema: { ...pid, pageId: z.string(), artboardIds: z.array(z.string()) },
    handler: (a, ctx) => store.reorderArtboards(ctx.ws, a.projectId, a.pageId, a.artboardIds),
  },
  {
    name: "delete",
    description: "按 id 删除页面（pg_ 前缀，级联删画板）或画板（ab_ 前缀）。若目标被某文档版本的截图引用，返回中带 warning。刷新已打开的画布标签即可看到移除结果",
    schema: { ...pid, targetId: z.string() },
    handler: (a, ctx) => {
      const referencing = store.listDocs(ctx.ws, a.projectId).filter((d) => {
        const dj = store.readDocJson(ctx.ws, a.projectId, d.id);
        return (dj?.versions || []).some((v) => v.sourceFingerprints && v.sourceFingerprints[a.targetId]);
      }).map((d) => d.id);
      const r = store.deleteTarget(ctx.ws, a.projectId, a.targetId);
      return { ...r, ...(referencing.length ? { warning: `被文档引用：${referencing.join(", ")}，相关版本将变为 broken` } : {}) };
    },
  },
  {
    name: "save_artboard_source",
    description: "写画板 JSX 源码。source（全量）与 edits（补丁 [{oldText,newText}]，oldText 须唯一匹配）二选一。Babel 编译校验失败不落盘。成功返回 sourceHash 与 idAudit（消失的元素 id 及 annotations.md 里对它们的断链引用）。画板 preview 和整站画布都是 source.jsx 的实时投影：刷新已打开的画布标签即最新，无需重新调用 render_preview / render_canvas",
    schema: { ...pid, artboardId: z.string(), source: z.string().optional(),
              edits: z.array(z.object({ oldText: z.string(), newText: z.string() })).optional() },
    handler: (a, ctx) => {
      const before = store.readArtboard(ctx.ws, a.projectId, a.artboardId);
      let next = a.source;
      if (next == null) {
        if (!a.edits || !a.edits.length) return fail("BAD_ARGS", "source 与 edits 必须传一个");
        if (before.source == null) return fail("NO_SOURCE", "画板尚无源码，不能用 edits，请传全量 source");
        const r = applyEdits(before.source, a.edits);
        if (r.error) return r.error;
        next = r.source;
      }
      const v = validateJsx(next);
      if (!v.ok) return fail("COMPILE_ERROR", v.error, "artboard");
      const hash = store.saveArtboardSource(ctx.ws, a.projectId, a.artboardId, next);
      const idsAfter = extractElementIds(next);
      const idsRemoved = before.elementIds.filter((id) => !idsAfter.includes(id));
      const brokenRefs = parseElementRefs(store.readAnnotationsMd(ctx.ws, a.projectId, a.artboardId))
        .filter((eid) => idsRemoved.includes(eid));
      return { ok: true, sourceHash: hash, sourceLines: next.split("\n").length,
               ...(idsRemoved.length ? { idAudit: { idsRemoved, brokenAnnotationRefs: brokenRefs } } : {}) };
    },
  },
  {
    name: "get_annotations",
    description: "返回这块画板的标注：md（annotations.md 全文，一篇 markdown）、refs（annotations.refs.json，{ 元素id: { interactionPath:[...] } }）、elementIds（当前源码里的元素 id 清单，md 里 [名](#el/元素id) 引用的 id 要从这里选）、elementHints（{ 元素id: 一句它在界面上大概是什么 }，从源码静态提取，用来给 chip 起人话显示名——只是线索、可能不准、别原样当显示名粘进去；取不到线索的 id 不在这个表里）、sourceHash、validatedHash（md 上次核对于哪版源码）、brokenRefs（md 里引用但源码已没有的元素 id）",
    schema: { ...pid, artboardId: z.string() },
    handler: (a, ctx) => {
      const ab = store.readArtboard(ctx.ws, a.projectId, a.artboardId);
      const md = store.readAnnotationsMd(ctx.ws, a.projectId, a.artboardId);
      const { missing } = validateRefs(md, ab.elementIds);
      return {
        md, refs: store.readAnnotationRefs(ctx.ws, a.projectId, a.artboardId),
        elementIds: ab.elementIds,
        elementHints: ab.source == null ? {} : extractElementHints(ab.source),
        sourceHash: ab.sourceHash,
        validatedHash: store.readAnnotationValidatedHash(ctx.ws, a.projectId, a.artboardId),
        brokenRefs: missing,
      };
    },
  },
  {
    name: "write_annotations",
    description: "写这块画板的标注。md（annotations.md 全文）与 edits（补丁 [{oldText,newText}]）二选一，跟 save_artboard_source 一个套路。md 是一篇 markdown，写法像一节 spec：分区用 ## 标题、一条说明用 ### 标题；正文里想让读者点击定位到某元素就写内联链接 [显示名](#el/元素id)——显示名要用人话（这东西在界面上是什么、可见文字或角色，如「折叠按钮」「候选人卡片列表」），别拿元素 id / class 名 / 内部代号当显示名；#el/元素id 里的 id 才从 elementIds 照抄。顺序 = 文档顺序、分组 = 标题，没有 groupId / order / revision。可选 refs：{ 元素id: { interactionPath:[{type:'click'或'hover',selector,index?}] } }，仅当某个被引用的元素要交互之后才在 DOM 里时才需要。md 里 [名](#el/元素id) 引用了当前源码没有的元素 id → REF_NOT_FOUND，整个拒绝。成功自动把 meta.annotationsValidatedHash 盖成当前源码指纹。标注是 annotations.md 的实时投影——刷新已打开的画布标签即最新",
    schema: { ...pid, artboardId: z.string(), md: z.string().optional(),
              edits: z.array(z.object({ oldText: z.string(), newText: z.string() })).optional(),
              refs: z.record(z.any()).optional() },
    handler: (a, ctx) => {
      const ab = store.readArtboard(ctx.ws, a.projectId, a.artboardId);
      let md = a.md;
      if (md == null) {
        if (!a.edits || !a.edits.length) return fail("BAD_ARGS", "md 与 edits 必须传一个");
        const r = applyEdits(store.readAnnotationsMd(ctx.ws, a.projectId, a.artboardId), a.edits);
        if (r.error) return r.error;
        md = r.source;
      }
      const { ok, missing } = validateRefs(md, ab.elementIds);
      if (!ok) return fail("REF_NOT_FOUND", `annotations.md 引用了当前源码里没有的元素：${missing.join(", ")}（[名](#el/元素id) 里的 id 必须命中 get_annotations 返回的 elementIds）`);
      const refs = a.refs ?? store.readAnnotationRefs(ctx.ws, a.projectId, a.artboardId);
      store.writeAnnotationsMd(ctx.ws, a.projectId, a.artboardId, md, refs, ab.sourceHash);
      const dead = unusedRefKeys(md, refs);
      return { ok: true, mdLines: md.split("\n").length, refElementIds: parseElementRefs(md),
               ...(dead.length ? { warning: `refs 里这些 key 在 md 里已不再被引用，可清理：${dead.join(", ")}` } : {}) };
    },
  },
  {
    name: "render_preview",
    description: "确认某画板可以在整站画布里观察：校验它已有源码，确保本地预览服务在跑，返回整站画布的 http://127.0.0.1 url（不是画板单独地址——画布能看到项目全部内容，悬浮这块画板点右上角新标签图标即可单独打开它）。画布/画板 preview 是 source.jsx + annotations.md + 项目结构的实时投影：改了源文件（含通用 agent 直接改、编辑器 Undo、git checkout）刷新浏览器即最新，不写盘、不需要重复调用。曾用于生成落盘 preview.html——现在不再落盘",
    schema: { ...pid, artboardId: z.string() },
    handler: async (a, ctx) => {
      const ab = store.readArtboard(ctx.ws, a.projectId, a.artboardId);
      if (ab.source == null) return fail("NO_SOURCE", `画板 ${a.artboardId} 尚无源码`);
      return withUrl(a.projectId, store.projectDir(ctx.ws, a.projectId), store.canvasPath(ctx.ws, a.projectId), { ok: true });
    },
  },
  {
    name: "render_canvas",
    description: "打开整站画布：确保本地预览服务在跑，返回它的 http://127.0.0.1 url（浏览器工具打不开 file://，别拿路径自己拼）。画布把项目所有页面和画板汇进一份自包含文档——左侧侧边栏切页面（文档内显隐、无跳转），每页独立的可缩放可平移画布（滚轮平移，Ctrl/Cmd+滚轮或触控板捏合缩放，拖拽平移，一键适应窗口），画板按各自 canvasWidth 真实像素宽度显示、高度随内容自撑。画布是项目 source.jsx / annotations / 结构的**实时投影**：加删/改名页面画板、改源码、改标注、git 撤回后，刷新已打开的画布标签即最新，不写盘、不需要重复调用本工具",
    schema: pid,
    handler: async (a, ctx) => {
      const tree = store.loadProjectTree(ctx.ws, a.projectId);
      if (!tree.pages.length) return fail("NO_PAGES", "项目尚无页面，请先 upsert_page");
      return withUrl(a.projectId, store.projectDir(ctx.ws, a.projectId), store.canvasPath(ctx.ws, a.projectId), { ok: true, pageCount: tree.pages.length });
    },
  },
  {
    name: "chain_status",
    description: "计算整条链的过期清单，按严重度排序：broken（元素/引用丢失）> unvalidated（源码外部修改未校验）> review（标注待核对）> drifted（PRD 版本落后）> lagging（渠道文档落后）。每项含 reason 与 suggestedAction",
    schema: pid,
    handler: (a, ctx) => ({ findings: evaluateChain(store.loadChainSnapshot(ctx.ws, a.projectId)) }),
  },
  {
    name: "create_doc",
    description: "在 docs/ 下新建一个文档：docs/<docId>/（doc.md 工作草稿 + doc.json）。kind 是文档类型（doc-kinds/<kind>/ 目录，如 prd、release-note；未知类型报错并列出可用的）。docId（= 目录名）默认 = kind 名（docs/prd/、docs/release-note/），一个项目一种类型一篇是常态；同类型要多篇时才显式传 docId（可含中文）。title 是这篇文档的主题一句话——不带项目名、不带「PRD」之类类型字样、不带版本号（项目上下文由所在项目给，类型和版本号画布菜单单独展示）；传了会直接填进 doc.md 的一级标题和 doc.json.title，省得建完再手改，不影响目录名。from 记来源（如 from:\"prd\" 基于 prd 文档 head 版本、from:\"prd@3\" 指定版本），写进 doc.json.origin，之后上游出新版本 chain_status 会提示。doc.md 按该类型的 template.md 起草——起草完写正文，再 build_doc(mode:\"finalize\", note:\"…\") 定第一个版本",
    schema: { ...pid, kind: z.string(), title: z.string().optional(), docId: z.string().optional(), from: z.string().optional() },
    handler: (a, ctx) => createDoc(ctx.ws, a.projectId, { kind: a.kind, title: a.title, docId: a.docId, from: a.from }, ctx),
  },
  {
    name: "get_doc_kind",
    description: "返回某文档类型的起始模板（template.md）+ 撰写规范（writing.md）+ 元数据（label、contextSource）。写这类文档前先调一次。未知类型时错误信息里列出全部可用类型",
    schema: { ...pid, kind: z.string() },
    handler: (a, ctx) => {
      const pdir = store.projectDir(ctx.ws, a.projectId);
      const km = resolveKind(pdir, a.kind);
      if (!km) return fail("KIND_UNKNOWN", `未知文档类型 ${a.kind}；可用：${listKinds(pdir).map((k) => k.kind).join(", ") || "（无）"}`);
      return {
        kind: km.kind, label: km.label, contextSource: km.contextSource,
        template: km.templatePath ? fs.readFileSync(km.templatePath, "utf8") : "",
        writing: km.writingPath ? fs.readFileSync(km.writingPath, "utf8") : "",
      };
    },
  },
  {
    name: "build_doc",
    description: "构建文档版本，两阶段。snapshot：读 docs/<docId>/.build/captures.json（这个文档要截哪些画板的哪些状态），冻结引用到的画板进 .build/snapshot/，供 build_publish_pack 截图（只有用画布截图当上下文的类型才需要，如 PRD/上线公告）。finalize：doc.md 已手写好、（用截图流水线的话）截图已 seal——校验 ![](assets/…) 引用是否都落地、算指纹、冻结成 versions/<n>/、按 note 自动重生成修改记录表重渲染 docs/<docId>/preview.html（文档阅读页是冻结版本内容的产物，仍然落盘）、跑该类型的 checks。note 必填（一句话说清这次改了什么，进修改记录表；不写版本号）。纯 prose 改动可直接 finalize，复用已有 .build/ 产物。返回的 url（http://127.0.0.1）是打开方式，findings 里 error 级会在 record_publish 拦截发布",
    schema: { ...pid, docId: z.string(), mode: z.enum(["snapshot", "finalize"]), note: z.string().optional(), label: z.string().optional(), author: z.string().optional() },
    handler: async (a, ctx) => {
      const r = await buildDoc(ctx.ws, a.projectId, a.docId, a.mode, { note: a.note, label: a.label, author: a.author }, ctx);
      if (!r.ok || r.mode !== "finalize") return r;
      return withUrl(a.projectId, store.projectDir(ctx.ws, a.projectId), r.headPreviewPath, r);
    },
  },
  {
    name: "build_publish_pack",
    description: "截图流水线三阶段（PRD/上线公告等用画布截图当上下文的类型的 sidecar）。previews：校验 docs/<docId>/.build/captures.json 并渲染 .build/previews/<captureId>.html，每个 capture 返回的 url（http://127.0.0.1）给浏览器工具打开、按 actions 操作后截图；capture：可选的自动化截图——无头浏览器（本机 Chrome，找不到才下载，不弹窗）按 actions 操作后按内容真实高度截图，可通过 captures.json 的 markers（elementId、number、label；可选 placement、display、offset）叠加定位标记。默认自动避让标签，密集区域降级为编号与图例；模型可按画面指定方位。产物写 .build/exported-images/<captureId>.png；actions 表达不了的复杂交互可跳过这步手动截图放同一位置。seal：核对图片清单，把截图落进 docs/<docId>/assets/<captureId>.png + 写 .build/captures-manifest.json（doc.md 用 ![](assets/<captureId>.png) 引用）",
    schema: { ...pid, docId: z.string(), mode: z.enum(["previews", "capture", "seal"]) },
    handler: async (a, ctx) => {
      const r = await buildPublishPack(ctx.ws, a.projectId, a.docId, a.mode, ctx);
      if (!r.ok || r.mode !== "previews") return r;
      const projectDir = store.projectDir(ctx.ws, a.projectId);
      // 自动 capture 可根据 captures.json 的 markers 叠加定位框与编号短名称。
      const previews = await Promise.all(r.previews.map((p) => withUrl(a.projectId, projectDir, p.htmlPath, p)));
      return { ...r, previews };
    },
  },
  {
    name: "record_publish",
    description: "登记一次渠道发布到当前文档 head 版本（channel/channelDocId/url），同渠道重复发布追加历史。文档未 finalize 时报错。发布前会跑该类型的 checks——任何 error 级 finding（如未闭环的开放问题标记）默认拦截并列出清单；确需带着发布传 acknowledgeFindings:true 跳过",
    schema: { ...pid, docId: z.string(), channel: z.string(), channelDocId: z.string(), url: z.string().optional(), acknowledgeFindings: z.boolean().optional() },
    handler: async (a, ctx) => {
      const dj = store.readDocJson(ctx.ws, a.projectId, a.docId);
      if (!dj || !dj.head) return fail("DOC_NOT_BUILT", `文档 ${a.docId} 尚未 build_doc(mode:"finalize")`);
      const headV = (dj.versions || []).find((v) => v.n === dj.head);
      if (!headV) return fail("DOC_NOT_BUILT", `文档 ${a.docId} 的 head 版本记录缺失`);
      if (!a.acknowledgeFindings) {
        const vdir = store.docVersionDir(ctx.ws, a.projectId, a.docId, dj.head);
        const md = fs.readFileSync(path.join(vdir, "doc.md"), "utf8");
        const assetsDir = path.join(vdir, "assets");
        const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
        const findings = await runChecks(store.projectDir(ctx.ws, a.projectId), dj.kind,
          { docMd: md, docJson: dj, assets, docId: a.docId, versionN: dj.head });
        const errors = findings.filter((f) => f.level === "error");
        if (errors.length) {
          return fail("CHECKS_FAILED",
            `发布前检查未通过（${errors.length} 项），确认清楚后再发或传 acknowledgeFindings:true：\n- ${errors.map((e) => e.message).join("\n- ")}`,
            "doc-writing");
        }
      }
      headV.publishedTo = headV.publishedTo || [];
      headV.publishedTo.push({ channel: a.channel, channelDocId: a.channelDocId, url: a.url || "", publishedAt: new Date(ctx.now()).toISOString(), docHash: headV.docHash });
      store.writeDocJson(ctx.ws, a.projectId, a.docId, dj);
      return { ok: true, docId: a.docId, version: dj.head, docHash: headV.docHash, recordCount: headV.publishedTo.length };
    },
  },
  {
    name: "export_canvas",
    description: "把整张画布导出成一个文件，写到 outDir 下（文件名自动取项目名）。format=\"zip\"（默认）导出目录树（index.html + lib/ + pages/.../preview.html，标注定位/高亮在纯 file:// 下会静默失效，其它都正常）；format=\"html\" 导出单个自包含 .html（所有画板、库都内联，双击即看，无跨源限制，但画板越多文件越大）。渲染逻辑跟实时预览（render_canvas）完全一样——只是渲一次落盘/拼字符串，不是另一套。跟画布页面右上角「导出」按钮菜单走的是同一份逻辑，区别是按钮触发浏览器下载、这个工具直接写到你指定的目录",
    schema: {
      ...pid,
      format: z.enum(["zip", "html"]).optional().describe("导出格式，默认 zip（目录树）；html 是单文件"),
      outDir: z.string().describe("文件要写到的目录（绝对路径，或相对 dir 参数解析）；目录不存在会自动创建"),
    },
    handler: (a, ctx) => {
      const fmt = EXPORT_TARGETS.canvas.formats.find((f) => f.id === (a.format || "zip"));
      const { filename, buffer } = fmt.build(ctx.ws, a.projectId);
      const outPath = path.resolve(a.outDir, filename);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buffer);
      return { ok: true, path: outPath, bytes: buffer.length };
    },
  },
  {
    name: "export_doc",
    description: "把一篇文档的当前（head）版本导出成一个文件，写到 outDir 下（文件名自动取文档标题）。format=\"docx\" 导出可编辑 Word；format=\"zip\"（默认，兼容旧调用）导出目录树（preview.html + lib/ + assets/，不带历史版本、不带版本切换）；format=\"html\" 导出单个自包含 .html（marked/mermaid、图片全内联，双击即看）；format=\"markdown\" 导出一个 .zip（<标题>.md + assets/ 真实图片文件，图片引用是相对路径、不转 data URI，比 html 更通用，便于导入飞书文档、钉钉文档等其它工具）。不需要 protoflow 的预览服务。跟文档阅读页右上角「导出」按钮菜单同一份逻辑，区别是按钮触发浏览器下载、这个工具直接写到你指定的目录",
    schema: {
      ...pid,
      docId: z.string(),
      format: z.enum(["zip", "html", "markdown", "docx"]).optional().describe("导出格式，默认 zip（目录树）；docx 是可编辑 Word；html 是单文件；markdown 是 .md + assets/ 图片的 .zip 包"),
      outDir: z.string().describe("文件要写到的目录（绝对路径，或相对 dir 参数解析）；目录不存在会自动创建"),
    },
    handler: async (a, ctx) => {
      const out = await runProjectExport(path.join(ctx.ws, a.projectId), `doc/${encodeURIComponent(a.docId)}/${a.format || "zip"}`);
      if (!out) return fail("DOC_NOT_BUILT", `文档 ${a.docId} 尚未 build_doc(mode:"finalize")，没有任何版本可导出`);
      const outPath = path.resolve(a.outDir, out.filename);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, out.buffer);
      return { ok: true, path: outPath, bytes: out.buffer.length };
    },
  },
  {
    name: "get_guide",
    description: "按主题返回策略文档全文。topic 即 guides/ 下文件名（不含 .md），未知主题时错误信息中列出全部可用主题。文档类型专属的模板/规范用 get_doc_kind，不在这里",
    schema: { topic: z.string() },
    handler: (a, ctx) => {
      const topics = fs.readdirSync(ctx.guidesDir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
      if (!topics.includes(a.topic)) return fail("UNKNOWN_TOPIC", `未知主题 ${a.topic}；可用：${topics.join(", ")}`);
      return { topic: a.topic, content: fs.readFileSync(path.join(ctx.guidesDir, a.topic + ".md"), "utf8") };
    },
  },
];

export const TOOL_MAP = Object.fromEntries(TOOL_REGISTRY.map((t) => [t.name, t]));
