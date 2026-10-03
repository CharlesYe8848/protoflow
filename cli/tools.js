// cli/tools.js — CLI 的全部工具：框架自己的几个（项目、图谱与健康、发布登记、指南）+ 各产品在
// 插件描述里提供的（products/<产品>/tools.js）。schema 是 zod raw shape，handler 只做参数处理与调 core。
// 这里是入口层，可以用产品注册表（products/index.js），依赖边界见 tests/boundaries.test.js。
//
// createTools(registry) 按一份注册表（内置的，或按配置加载的）生成工具表；框架工具的说明从注册表里的
// 产品现拼，不写死产品名。模块级的 TOOL_REGISTRY / TOOL_MAP 是内置注册表的那一份，给测试用。
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import * as store from "../core/store.js";
import { fail, pid, dirParam } from "../core/toolKit.js";
import { projectGraph, projectHealth } from "../core/projectGraph.js";
import { parseRef } from "../core/refs.js";
import { artifactKind, writeLabels } from "../core/labels.js";
import { pluginSourceLabel } from "../core/plugin.js";
import { BUILTIN } from "../products/index.js";

// 指南：框架自己的 guides/（跨产品的，如 workflow）+ 各产品注册的 guidesDir。主题 = 文件名去掉 .md，
// 全局唯一（tests/tools.test.js 检查）。
export function guideFiles(frameworkDir, products = BUILTIN.products) {
  const out = {};
  for (const dir of [frameworkDir, ...products.map((p) => p.guidesDir).filter(Boolean)]) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const topic = f.slice(0, -3);
      if (out[topic]) throw new Error(`指南主题重名：${topic}（${out[topic]} 和 ${path.join(dir, f)}）`);
      out[topic] = path.join(dir, f);
    }
  }
  return out;
}

// 流程 skill 声明的依赖产品：SKILL.md frontmatter 的 metadata.requires-products（逗号分隔的类型）。
export function listSkills(skillsDir) {
  if (!skillsDir || !fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir).filter((d) => fs.existsSync(path.join(skillsDir, d, "SKILL.md"))).map((d) => {
    const md = fs.readFileSync(path.join(skillsDir, d, "SKILL.md"), "utf8");
    const fm = (/^---\n([\s\S]*?)\n---/.exec(md) || [])[1] || "";
    const m = /^\s+requires-products:\s*["']?([^"'\n]*)["']?\s*$/m.exec(fm);
    return { name: d, requires: m ? m[1].split(",").map((x) => x.trim()).filter(Boolean) : [] };
  });
}

export function createTools(registry) {
  const { products: PRODUCTS, resolvers: RESOLVERS } = registry;
  const PUBLISHABLE = PRODUCTS.filter((p) => p.publish);
  const ENTITY_TYPES = PRODUCTS.filter((p) => p.entities && p.entities.length).map((p) => p.type);
  const typeList = ENTITY_TYPES.map((t) => `${t}=${PRODUCTS.find((p) => p.type === t).label}`).join("、");
  const partHints = PRODUCTS.filter((p) => p.deletePart && p.partHint).map((p) => p.partHint);
  const describeParts = PRODUCTS.filter((p) => p.describeProject && p.describeHint).map((p) => p.describeHint);
  const FRAMEWORK_TOOLS = [
    {
      name: "list_projects",
      description: "列出工作目录中所有项目（id 与名称）；id 即项目文件夹名",
      schema: { ...dirParam },
      handler: (_a, ctx) => ({ projects: store.listProjects(ctx.ws) }),
    },
    {
      name: "get_project",
      description: `读项目，所有结构化信息都从这里拿，不要自己去翻 projects.json 或源码：projectDir（项目文件夹的绝对路径）、${describeParts.length ? describeParts.join("、") + "、" : ""}products（当前启用的产品；项目里有、但插件没启用的列在 uninstalledProducts，它们的产物在 graph 里带 installed:false）、项目图谱 graph（schemaVersion + artifacts：每个产物（${typeList}）的 type、id、title、head、dirty、labels，以及最新版引用了谁、每条引用 fresh/stale/missing）、健康摘要 health（各严重级别的发现项计数）。findings:true 附上完整发现项，按严重度排序：broken（标注引用的元素没了、引用的产物或画板没了）> unvalidated（源码被外部改过、没校验）> review（标注待核对）> uncommitted（有没定版的改动）> drifted（最新版引用的内容之后变了）> lagging（已发布的版本引用的内容变了）> advice（建议，不处理也不影响使用）。只报事实，要不要跟进按任务判断；每项含 reason 与 suggestedAction`,
      schema: { ...pid, findings: z.boolean().optional().describe("true 时附上完整的健康检查发现项 findings（按严重度排序，每项含 reason 与 suggestedAction）") },
      handler: (a, ctx) => {
        if (!store.readProject(ctx.ws, a.projectId)) return fail("PROJECT_NOT_FOUND", `项目 ${a.projectId} 不存在`);
        store.syncProjectProducts(ctx.ws, a.projectId, PRODUCTS);
        const uninstalled = store.uninstalledProducts(ctx.ws, a.projectId, PRODUCTS).map((u) => u.type);
        const findings = projectHealth(ctx.ws, a.projectId, PRODUCTS, RESOLVERS);
        const health = {};
        for (const f of findings) health[f.level] = (health[f.level] || 0) + 1;
        const parts = Object.assign({}, ...PRODUCTS.filter((p) => p.describeProject).map((p) => p.describeProject(ctx.ws, a.projectId)));
        return { projectDir: store.projectDir(ctx.ws, a.projectId),
                 products: PRODUCTS.map((p) => ({ type: p.type, label: p.label })), ...(uninstalled.length ? { uninstalledProducts: uninstalled } : {}), ...parts, graph: projectGraph(ctx.ws, a.projectId, PRODUCTS, RESOLVERS), health, findingCount: findings.length, ...(a.findings ? { findings } : {}) };
      },
    },
    {
      name: "create_project",
      description: "创建新项目：在工作目录下建一个以项目名 slug 命名的自包含文件夹（同名冲突自动加序号），并写入 AGENTS.md/CLAUDE.md 供任何 agent 冷启动接手。返回项目 id（即文件夹名）",
      schema: { name: z.string().describe("项目名称"), ...dirParam },
      handler: (a, ctx) => store.createProject(ctx.ws, a.name, ctx, { products: PRODUCTS }),
    },
    {
      name: "plugins",
      description: "列出产品插件：启用了哪些（类型、名字、来源、apiVersion、数据格式版本）、配置文件在哪、配置里禁用了哪些、哪些插件没加载成（描述不合法、版本不兼容、冲突，附原因），以及各流程 skill 需要的产品缺没缺。用某个流程 skill 前先看它需要的产品都在不在",
      schema: {},
      handler: (_a, ctx) => {
        const skills = listSkills(ctx.skillsDir).map((sk) => ({ ...sk, missing: sk.requires.filter((t) => !PRODUCTS.some((p) => p.type === t)) }));
        return {
          configPath: registry.config ? registry.config.path : null,
          configExists: !!(registry.config && registry.config.exists),
          products: PRODUCTS.map((p) => ({ type: p.type, label: p.label, source: pluginSourceLabel((registry.sources || {})[p.type]), apiVersion: p.apiVersion, formatVersion: p.formatVersion || 1 })),
          disabled: registry.disabled || [],
          skipped: registry.skipped || [],
          skills,
        };
      },
    },
    {
      name: "record_publish",
      description: `登记一次渠道发布到某个产物的 head 版本（channel/channelDocId/url），同渠道重复发布追加历史。kind 是产物类型（${PUBLISHABLE.map((p) => `${p.type}=${p.label}`).join("、")}），缺省 ${PUBLISHABLE[0].type}；docId 是它的 id。目标还没定过版时报错。只登记事实，不做发布前检查——检查是流程 skill 的事，发布前按流程 skill 跑`,
      schema: { ...pid, docId: z.string(), kind: z.enum(PUBLISHABLE.map((p) => p.type)).optional().describe(`缺省 ${PUBLISHABLE[0].type}`),
                channel: z.string(), channelDocId: z.string(), url: z.string().optional() },
      handler: async (a, ctx) => {
        const p = PUBLISHABLE.find((x) => x.type === (a.kind || PUBLISHABLE[0].type));
        const { entity, hashField, notBuilt } = p.publish;
        const meta = store.readEntityJson(ctx.ws, a.projectId, entity, a.docId);
        if (!meta || !meta.head) return fail("DOC_NOT_BUILT", `${p.label} ${a.docId} 尚未 ${notBuilt}`);
        const headV = (meta.versions || []).find((v) => v.n === meta.head);
        if (!headV) return fail("DOC_NOT_BUILT", `${p.label} ${a.docId} 的 head 版本记录缺失`);
        const result = store.appendPublishRecord(ctx.ws, a.projectId, entity, a.docId, {
          channel: a.channel, channelDocId: a.channelDocId, url: a.url || "",
          publishedAt: new Date(ctx.now()).toISOString(), [hashField]: headV[hashField],
        });
        return { ok: true, docId: a.docId, version: result.version, [hashField]: headV[hashField], recordCount: result.recordCount };
      },
    },
    {
      name: "delete",
      description: `删除，不可恢复，删之前跟用户确认。targetId 两种写法：整个产物写 类型:id（类型：${typeList}；连同它的全部版本）${partHints.length ? `；产物内部的一部分直接写 id（${partHints.join("；")}）` : ""}。删完如果有别的产物的最新版引用了它，返回 warning 列出来（引用变为失效）。不要自己 rm 项目目录里的文件`,
      schema: { ...pid, targetId: z.string() },
      handler: (a, ctx) => {
        const whole = /^([a-z]+):([^@#]+)$/.exec(a.targetId);
        let result;
        if (whole) {
          const kind = artifactKind(PRODUCTS, whole[1]);
          if (!kind) return fail("BAD_TARGET", `不认识的产物类型 ${whole[1]}；可用：${ENTITY_TYPES.join(", ")}`);
          const dir = store.entityDir(ctx.ws, a.projectId, kind, whole[2]);
          if (!store.readEntityJson(ctx.ws, a.projectId, kind, whole[2])) return fail("NOT_FOUND", `${a.targetId} 不存在`);
          fs.rmSync(dir, { recursive: true, force: true });
          result = { deleted: whole[1], id: whole[2] };
        } else {
          for (const p of PRODUCTS) {
            if (!p.deletePart) continue;
            try { result = p.deletePart(ctx.ws, a.projectId, a.targetId); } catch (e) { return fail("NOT_FOUND", e.message); }
            if (result) break;
          }
          if (!result) return fail("BAD_TARGET", `认不出 ${a.targetId}：整个产物写 类型:id（类型：${ENTITY_TYPES.join(", ")}）${partHints.length ? `，产物内部的一部分：${partHints.join("；")}` : ""}`);
        }
        // 通用做法：删完看项目图谱里哪些引用因此失效了（指向被删的产物，或它里面被删的那一部分）
        const hit = (s) => {
          const r = parseRef(s.ref) || {};
          return whole ? r.type === whole[1] && r.id === whole[2] : r.part === a.targetId;
        };
        const broken = projectGraph(ctx.ws, a.projectId, PRODUCTS, RESOLVERS).artifacts
          .filter((x) => x.sources.some((s) => s.status === "missing" && hit(s)))
          .map((x) => `${x.type}:${x.id}`);
        return { ok: true, ...result, ...(broken.length ? { warning: `这些产物的最新版引用了它，引用已失效：${broken.join(", ")}` } : {}) };
      },
    },
    {
      name: "set_labels",
      description: "整组替换一个产物的标签，如 [\"product-dev/prd\"]。标签框架不解释，在 get_project 的 graph 里原样返回，给流程 skill 认自己管的产物；建产物时也可以直接传 labels。传 [] 清空",
      schema: { ...pid, type: z.enum(ENTITY_TYPES), id: z.string(), labels: z.array(z.string()) },
      handler: (a, ctx) => {
        let labels;
        try { labels = writeLabels(ctx.ws, a.projectId, artifactKind(PRODUCTS, a.type), a.id, a.labels); }
        catch (e) { return fail(e.code || "BAD_LABELS", e.message); }
        if (!labels) return fail("NOT_FOUND", `${a.type}:${a.id} 不存在`);
        return { ok: true, type: a.type, id: a.id, labels };
      },
    },
    {
      name: "get_guide",
      description: "按主题返回 ProtoFlow 各产品的使用指南全文。未知主题时错误信息中列出全部可用主题。某种流程（如 PRD、上线公告）的模板、写作规范、截图和检查在流程 skill 里（仓库 skills/ 目录）",
      schema: { topic: z.string() },
      handler: (a, ctx) => {
        const guides = guideFiles(ctx.guidesDir, PRODUCTS);
        if (!guides[a.topic]) return fail("UNKNOWN_TOPIC", `未知主题 ${a.topic}；可用：${Object.keys(guides).sort().join(", ")}`);
        return { topic: a.topic, content: fs.readFileSync(guides[a.topic], "utf8") };
      },
    },
  ];

  // 产品工具在注册时已经生成好（registry.tools，交给它们的 reg 里有引用解析器、导出分发）；框架工具跟
  // 产品工具重名说明插件越界，直接报错。
  const clash = registry.tools.filter((t) => FRAMEWORK_TOOLS.some((f) => f.name === t.name));
  if (clash.length) throw new Error(`产品工具跟框架工具重名：${clash.map((t) => t.name).join(", ")}`);
  const toolRegistry = [...FRAMEWORK_TOOLS, ...registry.tools];
  return { TOOL_REGISTRY: toolRegistry, TOOL_MAP: Object.fromEntries(toolRegistry.map((t) => [t.name, t])) };
}

export const { TOOL_REGISTRY, TOOL_MAP } = createTools(BUILTIN);
