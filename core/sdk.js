// core/sdk.js — 产品插件的稳定接口（"protoflow/sdk"），docs/product-architecture.md §4.11。
//
// 产品只从这里（和过渡用的 "protoflow/sdk/internal"）拿框架能力，不直接 import core/*，依赖边界测试
// 守着。这里导出的东西受 apiVersion 约束：改签名、改行为、删掉都算不兼容变化；加新的导出不算。
// 新产品（从幻灯片起）只准用这一份。
//
// 注册描述的形状（除了 type、label，其余都可选——产品没有这项能力就不写，框架跳过）：
/**
 * @typedef {object} EntityKind 带版本的实体种类
 * @property {string} rootSeg  项目里的数据目录，也是页面路由的前缀，如 "sheets"
 * @property {string} metaFile 每个实体目录里的元信息文件名，如 "doc.json"
 *
 * @typedef {object} ProductDescriptor
 * @property {string} type   类型名：写进用户数据的引用里（`类型:id@版本#子部位`），发布后不能改
 * @property {string} label  给人看的名字
 * @property {string} [navIcon]  项目侧边栏里的图标（SVG 字符串，stroke 用 currentColor）
 * @property {(ws: string, pid: string) => Array<{id: string, title: string, href: string|null, meta?: string}>} [nav]
 *           项目侧边栏里这个产品的产物清单，顺序由产品定；href 为 null 表示还打不开（比如没定版）
 * @property {(ws: string, pid: string, relPath: string) => ({html: string, current?: {type: string, id: string}}|null)} [render]
 *           本地服务的页面路由：认得这个路径就回 HTML，不认得回 null
 * @property {(ws: string, pid: string, relPath: string) => (string|null)} [resolveFile]
 *           版本里文件的实际位置（版本存在对象库里，URL 不变）
 * @property {{hasId: boolean, defaultFormat: string, formats: object}} [exports]  导出格式
 * @property {(reg: object) => object[]} [tools]  CLI 工具
 * @property {{entity: EntityKind, hashField: string, notBuilt: string}} [publish]  record_publish 能登记发布的实体
 * @property {(ws: string, pid: string) => object} [describeProject]  get_project 里这个产品自己的那部分
 * @property {string} [describeHint]  get_project 的工具说明里，给 agent 讲这部分字段是什么
 * @property {object} [resolver]  引用解析：{ type, label, head(), fingerprint() }
 * @property {Function} [artifacts]  项目图谱里的产物
 * @property {Function} [health]     产品自己的健康规则，返回 finding() 列表
 * @property {EntityKind[]} [entities]  带版本的实体种类
 * @property {Function} [deletePart]  删除产物内部的一部分，不是自己的 id 回 null
 * @property {string} [partHint]  delete 的工具说明里，给 agent 讲哪些 id 是这个产品内部的一部分
 * @property {number} [formatVersion]  这个产品的数据格式版本（缺省 1），项目里按产品登记，变了靠 migrate 升级
 * @property {(ws: string, pid: string, opts: {from: number, to: number, apply: boolean}) => string[]} [migrate]
 *           数据格式 from → to，只由迁移命令调用；apply 为 false 时只返回要改什么；抛错时框架只回滚这个产品
 * @property {(ws: string, pid: string, ref: {type: string, id: string, version: number|null, part: string|null}, ctx: {as: string, embed: Function}) => object|null} [embed]
 *           被别的产品嵌入：按 ctx.as 返回 { html } / { data } / { svg } / { markdown }；目标不存在回 null（core/embed.js）
 * @property {string[]} [embedFormats]  embed 能给的形式，html、data、svg、markdown 的子集
 * @property {string} [guidesDir]     使用指南目录（<主题>.md）
 * @property {object} [agentsDoc]     项目说明（AGENTS.md）里这个产品的部分，形状见 core/agentsDoc.js
 */

// 插件契约：通用的 definePlugin，标准实体产品的 defineEntityProduct（core/plugin.js）。
export { definePlugin, defineEntityProduct } from "./plugin.js";

// 项目容器和带版本的实体：草稿 + 不可变版本 + head，版本本体在内容寻址的对象库里。
export {
  readJson, writeJson, projectDir, projectLibDir, productLibDir, readProject, writeProject,
  entityRoot, entityDir, readEntityJson, writeEntityJson, openEntityVersion, freezeEntityVersion, listEntities,
} from "./store.js";

// id、标签、指纹。
export { newId, slugify, assertSafeSegment, isValidEntityId } from "./ids.js";
export { normalizeLabels } from "./labels.js";
export { contentHash, objectHash } from "./hash.js";
export { hashBytes } from "./versionStore.js";

// 引用：定版时算这一版的 sources；素材旁边的出处文件。
export { versionSources, assetSources, isSourceSidecar } from "./refs.js";

// 健康检查的发现项。
export { finding } from "./chain.js";

// 写 CLI 工具的零件。
export { fail, pid, dirParam, withUrl, sourcesParam, labelsParam, pinSources, writeExport } from "./toolKit.js";

// 页面零件：分享、导出菜单、标注面板；品牌标识、CSS 变量和图形配色。
export { ICON_SHARE, ICON_NOTE, NOTE_PANEL_CSS, notePanelScript, exportDownloadScript, exportMenuRowsHtml } from "./ui.js";
// 全屏：顶部菜单栏的按钮、样式、脚本；产品给菜单栏、工具栏、侧栏打 data-pf-chrome，全屏时统一隐藏。
export { fullscreenButtonHtml, FULLSCREEN_CSS, fullscreenScript } from "./ui.js";
export { FAVICON_LINK, BRAND_CSS_VARS, DIAGRAM_PALETTE } from "./brand.js";

// 依赖库（vendored JS）：产品在自己的 libs.js 里用 packageFileFrom(import.meta.url) 列出来；外部插件拷进
// productLibDir(ws, pid, type)（lib/<type>/），页面里按这个位置引用。
export { packageFileFrom, ensureLibs, copyLibs, readLibSources } from "./libs.js";

// 跨产品嵌入：产品在 render 的 opts.embed、导出 build 的 ctx.embed、工具的 reg.embed 里拿到 embedRef；
// 这里是配套的零件（占位的 HTML、表格数据 → Markdown），以及 Markdown 类产品通用的 embed 代码块。
export { EMBED_FORMATS, EMBED_PREFER, embedPlaceholderHtml, tableDataToMarkdown, embedBlockRefs, embedSourcesFrom, expandEmbedBlocks } from "./embed.js";

// 导出。
export { safeFileName, copyVersionAssets, versionAssetsDataMap } from "./exportUtil.js";
export { zipDirectory } from "./zip.js";
// PDF：无头浏览器把一份自包含的 HTML 渲染成 PDF（分页由页面自己的打印样式决定）。
export { htmlToPdf } from "./pdf.js";
// MP4：无头浏览器逐帧截一份自包含的 HTML（按产品给的场景和时长），ffmpeg 合上音轨；probeMedia 读音视频时长。
export { htmlToMp4, probeMedia } from "./video.js";
