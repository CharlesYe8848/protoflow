// products/canvas/tools.js — 画布的 CLI 工具。reg 是产品注册表（products/index.js）传进来的
// { products, resolvers }：删画板时要看项目图谱、定版时要校验引用，都通过它，不直接认识别的产品。
import { z } from "zod";
import { dirParam, fail, labelsParam, pid, pinSources, projectDir, sourcesParam, withUrl, writeExport } from "protoflow/sdk";
import * as canvasStore from "./store.js";
import { validateJsx, extractElementIds, extractElementHints } from "./compile.js";
import { parseElementRefs, validateRefs, unusedRefKeys } from "./annotations.js";
import { buildCanvas, canvasVersionState } from "./canvasVersion.js";
import { CANVAS_EXPORTS } from "./exports.js";

const canvasIdParam = z.string().optional().describe("画布 id；项目只有一个画布时可省略（get_project 的 canvases 列出全部画布）");

// 工具里"没指定画布就用唯一那个"的统一处理：解析失败回 { error }。
function pickCanvas(ctx, projectId, canvasId) {
  try { return { cid: canvasStore.resolveCanvasId(ctx.ws, projectId, canvasId) }; }
  catch (e) { return { error: fail("CANVAS_NOT_FOUND", e.message) }; }
}

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

export function canvasTools(reg) {
  return [
    {
      name: "create_canvas",
      description: "在项目里新建一个画布（一个项目可以有多个画布，比如管理端原型、员工端原型、实验方案 A/B，各自有页面、画板和版本）。title 是画布名；canvasId 是目录名，缺省按 title 生成。返回画布 id，之后 upsert_page 传 canvasId 往里加页面。只需要一个画布时不用调它：第一次 upsert_page 会自动建一个 main",
      schema: { ...pid, title: z.string(), canvasId: z.string().optional(), labels: labelsParam },
      handler: (a, ctx) => {
        try { return { ok: true, ...canvasStore.createCanvas(ctx.ws, a.projectId, { title: a.title, canvasId: a.canvasId, labels: a.labels }, ctx) }; }
        catch (e) { return fail("CANVAS_CREATE_FAILED", e.message); }
      },
    },
    {
      name: "upsert_page",
      description: "无 id 创建页面，有 id 改名。返回页面 id 和所在画布 canvasId。项目有多个画布时新建页面要传 canvasId；只有一个画布时可省略；还没有画布时自动建一个 main。画布是项目结构的实时投影——已打开的画布标签刷新一下，新/改名页面就出现在左侧侧边栏，无需重新调用 render_canvas",
      schema: { ...pid, id: z.string().optional(), name: z.string(), canvasId: canvasIdParam },
      handler: (a, ctx) => {
        try { return canvasStore.upsertPage(ctx.ws, a.projectId, { id: a.id, name: a.name, canvasId: a.canvasId }, ctx); }
        catch (e) { return fail("PAGE_UPSERT_FAILED", e.message); }
      },
    },
    {
      name: "upsert_artboard",
      description: "无 id 在页面下创建画板，有 id 更新名称/描述。可选 canvasWidth（画布中该画板的真实像素宽度，即 Figma 式 Frame 宽度，默认 1440；移动端画板可传 375/414 等）。可选 canvasHeight——通常不需要传，画布会在每次真实渲染后自动测量并回填，只有明确要把这个画板做成固定尺寸的设备屏（超出内容内部滚动而不是画板自动撑高）时才手动声明。返回画板 id。画布实时投影项目结构——刷新已打开的画布标签即可看到新/改名画板，无需重新调用 render_canvas",
      schema: { ...pid, pageId: z.string(), id: z.string().optional(), name: z.string(), description: z.string().optional(), canvasWidth: z.number().int().positive().optional(), canvasHeight: z.number().int().positive().optional() },
      handler: (a, ctx) => canvasStore.upsertArtboard(ctx.ws, a.projectId, a.pageId, a, ctx),
    },
    {
      name: "reorder_artboards",
      description: "调整一个页面下画板在画布里的显示顺序（新建画板默认追加到末尾，用这个工具调整）。artboardIds 必须是该页面现有画板 id 的完整顺序（一个全排列，不能少画板也不能带别的页面的画板 id）——先用 loadProjectTree/get_project 之类的读操作看一眼现有顺序，再整体给出目标顺序。刷新已打开的画布标签即可看到新顺序",
      schema: { ...pid, pageId: z.string(), artboardIds: z.array(z.string()) },
      handler: (a, ctx) => canvasStore.reorderArtboards(ctx.ws, a.projectId, a.pageId, a.artboardIds),
    },
    {
      name: "save_artboard_source",
      description: "写画板 JSX 源码。source（全量）与 edits（补丁 [{oldText,newText}]，oldText 须唯一匹配）二选一。Babel 编译校验失败不落盘。成功返回 sourceHash 与 idAudit（消失的元素 id 及 annotations.md 里对它们的断链引用）。画板 preview 和整站画布都是 source.jsx 的实时投影：刷新已打开的画布标签即最新，无需重新调用 render_canvas",
      schema: { ...pid, artboardId: z.string(), source: z.string().optional(),
                edits: z.array(z.object({ oldText: z.string(), newText: z.string() })).optional() },
      handler: (a, ctx) => {
        const before = canvasStore.readArtboard(ctx.ws, a.projectId, a.artboardId);
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
        const hash = canvasStore.saveArtboardSource(ctx.ws, a.projectId, a.artboardId, next);
        const idsAfter = extractElementIds(next);
        const idsRemoved = before.elementIds.filter((id) => !idsAfter.includes(id));
        const brokenRefs = parseElementRefs(canvasStore.readAnnotationsMd(ctx.ws, a.projectId, a.artboardId))
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
        const ab = canvasStore.readArtboard(ctx.ws, a.projectId, a.artboardId);
        const md = canvasStore.readAnnotationsMd(ctx.ws, a.projectId, a.artboardId);
        const { missing } = validateRefs(md, ab.elementIds);
        return {
          md, refs: canvasStore.readAnnotationRefs(ctx.ws, a.projectId, a.artboardId),
          elementIds: ab.elementIds,
          elementHints: ab.source == null ? {} : extractElementHints(ab.source),
          sourceHash: ab.sourceHash,
          validatedHash: canvasStore.readAnnotationValidatedHash(ctx.ws, a.projectId, a.artboardId),
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
        const ab = canvasStore.readArtboard(ctx.ws, a.projectId, a.artboardId);
        let md = a.md;
        if (md == null) {
          if (!a.edits || !a.edits.length) return fail("BAD_ARGS", "md 与 edits 必须传一个");
          const r = applyEdits(canvasStore.readAnnotationsMd(ctx.ws, a.projectId, a.artboardId), a.edits);
          if (r.error) return r.error;
          md = r.source;
        }
        const { ok, missing } = validateRefs(md, ab.elementIds);
        if (!ok) return fail("REF_NOT_FOUND", `annotations.md 引用了当前源码里没有的元素：${missing.join(", ")}（[名](#el/元素id) 里的 id 必须命中 get_annotations 返回的 elementIds）`);
        const refs = a.refs ?? canvasStore.readAnnotationRefs(ctx.ws, a.projectId, a.artboardId);
        canvasStore.writeAnnotationsMd(ctx.ws, a.projectId, a.artboardId, md, refs, ab.sourceHash);
        const dead = unusedRefKeys(md, refs);
        return { ok: true, mdLines: md.split("\n").length, refElementIds: parseElementRefs(md),
                 ...(dead.length ? { warning: `refs 里这些 key 在 md 里已不再被引用，可清理：${dead.join(", ")}` } : {}) };
      },
    },
    {
      name: "render_canvas",
      description: "打开整站画布（想看某块画板就传 artboardId：先校验它已有源码，再打开它所在的画布；画布上悬浮画板点右上角新标签图标可以单独打开它）：确保本地预览服务在跑，返回它的 http://127.0.0.1 url（浏览器工具打不开 file://，别拿路径自己拼）。画布把项目所有页面和画板汇进一份自包含文档——左侧侧边栏切页面（文档内显隐、无跳转），每页独立的可缩放可平移画布（滚轮平移，Ctrl/Cmd+滚轮或触控板捏合缩放，拖拽平移，一键适应窗口），画板按各自 canvasWidth 真实像素宽度显示、高度随内容自撑。画布是项目 source.jsx / annotations / 结构的**实时投影**：加删/改名页面画板、改源码、改标注、git 撤回后，刷新已打开的画布标签即最新，不写盘、不需要重复调用本工具。画布定过版之后（build_canvas），跟文档/表格阅读页一样默认显示最新版本、?v=<n> 看历史版本，没定版的改动不会出现在画布页上——返回的 canvas.dirty 为 true 时说明有改动还没定版",
      schema: { ...pid, canvasId: canvasIdParam, artboardId: z.string().optional().describe("想看的画板；传了就打开它所在的画布，canvasId 不用传") },
      handler: async (a, ctx) => {
        if (!canvasStore.listCanvases(ctx.ws, a.projectId).length) return fail("NO_PAGES", "项目尚无页面，请先 upsert_page");
        let canvasId = a.canvasId;
        if (a.artboardId) {
          const ab = canvasStore.readArtboard(ctx.ws, a.projectId, a.artboardId);
          if (ab.source == null) return fail("NO_SOURCE", `画板 ${a.artboardId} 尚无源码`);
          canvasId = canvasStore.canvasOfArtboard(ctx.ws, a.projectId, a.artboardId);
        }
        const pc = pickCanvas(ctx, a.projectId, canvasId);
        if (pc.error) return pc.error;
        const tree = canvasStore.loadCanvasTree(ctx.ws, a.projectId, pc.cid);
        if (!tree.pages.length) return fail("NO_PAGES", `画布 ${pc.cid} 尚无页面，请先 upsert_page`);
        const cv = canvasVersionState(ctx.ws, a.projectId, pc.cid);
        return withUrl(a.projectId, projectDir(ctx.ws, a.projectId), canvasStore.canvasPath(ctx.ws, a.projectId, pc.cid),
          { ok: true, canvasId: pc.cid, pageCount: tree.pages.length, canvas: { head: cv.head, dirty: cv.head > 0 && cv.dirty } });
      },
    },
    {
      name: "build_canvas",
      description: "给画布定版，跟 build_doc(finalize) / build_sheet 一样：一轮修改（画板源码、标注、页面结构、图片、icons.jsx）做完后调一次，把当前内容冻结成第 n 版。画布定过版之后，画布页默认显示最新版本，没定版的改动不会出现在画布页上，所以改完原型要交给用户看之前必须定版。note 必填（一句话说清这次改了什么，进版本记录；不写版本号）。按内容寻址存储，没改的画板/图片不重复占空间。返回的 url 就是画布页（显示刚定的这一版），左上角画布名旁的下拉可切历史版本。项目有多个画布时传 canvasId。内容跟上一版完全一样时照常出新版本，返回 unchanged:true",
      schema: { ...pid, canvasId: canvasIdParam, note: z.string(), label: z.string().optional().describe("可选的版本别名，如「评审版」"), author: z.string().optional(), sources: sourcesParam },
      handler: async (a, ctx) => {
        const ps = pinSources(ctx, a.projectId, a.sources, reg.resolvers);
        if (ps.error) return ps.error;
        const r = buildCanvas(ctx.ws, a.projectId, { canvasId: a.canvasId, note: a.note, label: a.label, author: a.author, sources: ps.sources }, ctx);
        if (!r.ok) return r;
        return withUrl(a.projectId, projectDir(ctx.ws, a.projectId), canvasStore.canvasPath(ctx.ws, a.projectId, r.canvasId), r);
      },
    },
    {
      name: "export_canvas",
      description: "把一个画布导出成一个文件，写到 outDir 下（文件名自动取画布名）。format=\"zip\"（默认）导出目录树（index.html + lib/ + pages/.../preview.html，标注定位/高亮在纯 file:// 下会静默失效，其它都正常）；format=\"html\" 导出单个自包含 .html（所有画板、库都内联，双击即看，无跨源限制，但画板越多文件越大）。渲染逻辑跟实时预览（render_canvas）完全一样——只是渲一次落盘/拼字符串，不是另一套。跟画布页面右上角「导出」按钮菜单走的是同一份逻辑，区别是按钮触发浏览器下载、这个工具直接写到你指定的目录",
      schema: {
        ...pid,
        canvasId: canvasIdParam,
        format: z.enum(["zip", "html"]).optional().describe("导出格式，默认 zip（目录树）；html 是单文件"),
        outDir: z.string().describe("文件要写到的目录（绝对路径，或相对 dir 参数解析）；目录不存在会自动创建"),
      },
      handler: (a, ctx) => {
        const pc = pickCanvas(ctx, a.projectId, a.canvasId);
        if (pc.error) return pc.error;
        const fmt = CANVAS_EXPORTS.find((f) => f.id === (a.format || "zip"));
        return writeExport(a.outDir, fmt.build(ctx.ws, a.projectId, pc.cid));
      },
    },
  ];
}
