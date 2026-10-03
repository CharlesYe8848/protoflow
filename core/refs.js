// core/refs.js — 框架唯一的跨产品机制：引用（docs/product-architecture.md §4.3）。
//
// 某个产物的某一版可以记一张引用单 sources：[{ ref, via, fp? }]。框架只回答三个事实问题——
// 谁引用了谁、引用的是哪一版、那一版之后变没变——不判断"该不该引用""变化要不要紧"（归流程 skill）。
//
// 引用格式 类型:id@版本#子部位，版本和子部位都可省：
//   canvas:main@3#ab_123   画布 main 第 3 版的画板 ab_123
//   doc:prd@5              文档 prd 第 5 版（整篇）
//   canvas:main#ab_123     不带版本号：只带子部位指纹 fp（老数据迁移、以及引用时对方还没定过版）
//
// 框架不认识任何产品。判断需要的信息由产品提供一个解析器（resolver），框架只负责比较：
//   { type, label,
//     head(ws, pid, id)                 → 最新版本号（0 = 还没定过版），产物不存在回 null
//     fingerprint(ws, pid, id, n, part) → 第 n 版这个子部位的指纹；n 为 null 表示"现在"（产品自己定义，
//                                          通常就是 head）；子部位不存在回 null
//     describe(ws, pid, id, part)       → 可选，给人看的名字，比如 画布「项目名」的画板「首页」；
//                                          不给就用 <label>「id」 }
// 解析器由入口层（cli/tools.js）按类型组装好传进来，本模块不 import 任何产品。
//
// via：这条引用怎么来的。declared = 定版时声明；asset = 素材自带出处（文件旁边的 .source.json）；
// capture = 截图流水线记下的画板指纹（阶段 4 截图搬进流程 skill 后改为 asset）。
//
// 引用的产品没装或被禁用（项目里登记过、但没有解析器）时，框架只能对上"产物还在、版本号在不在"——
// 版本清单是框架的——子部位指纹要产品才能算，这种引用的状态是 unverifiable（无法校验），不当成失效。
import { projectProducts, readEntityJson } from "./store.js";

const REF_RE = /^([a-z][a-z0-9-]*):([^@#\s]+)(?:@([1-9]\d*))?(?:#([^\s#]+))?$/;

export function parseRef(ref) {
  const m = REF_RE.exec(String(ref || "").trim());
  if (!m) return null;
  return { type: m[1], id: m[2], version: m[3] ? Number(m[3]) : null, part: m[4] || null };
}

export function formatRef({ type, id, version = null, part = null }) {
  return `${type}:${id}${version != null ? `@${version}` : ""}${part ? `#${part}` : ""}`;
}

const fail = (code, message) => ({ ok: false, error: { code, message } });

// 把定版时声明的引用规范成要存下来的样子：不带版本号的固定到对方当前最新版；对方还没定过版、
// 又指了子部位的，记下子部位此刻的指纹；既没有版本也没有子部位可比的拒绝（以后没法判断过期）。
// 返回 { ok:true, sources:[{ ref, via, fp? }] } 或 { ok:false, error }。
export function pinRefs(ws, pid, refs, resolvers, via = "declared") {
  const out = [];
  for (const raw of refs || []) {
    const p = parseRef(raw);
    if (!p) return fail("BAD_SOURCE", `引用格式不对：${raw}（应为 类型:id@版本#子部位，类型可用：${Object.keys(resolvers).join(", ")}）`);
    const r = resolvers[p.type];
    if (!r && registeredProduct(ws, pid, p.type)) return fail("BAD_SOURCE", `引用里的 ${p.type} 产品没有启用（插件没装或在配置里禁用了），现在不能新声明指向它的引用：${raw}`);
    if (!r) return fail("BAD_SOURCE", `引用里的类型 ${p.type} 不认识；可用：${Object.keys(resolvers).join(", ")}`);
    const head = r.head(ws, pid, p.id);
    if (head == null) return fail("BAD_SOURCE", `引用的${r.label} ${p.id} 不存在：${raw}`);
    if (p.version != null && p.version > head) return fail("BAD_SOURCE", `引用的${r.label} ${p.id} 还没有第 ${p.version} 版（最新 v${head}）：${raw}`);
    const version = p.version ?? (head > 0 ? head : null);
    if (p.part && r.fingerprint(ws, pid, p.id, version, p.part) == null) {
      return fail("BAD_SOURCE", `引用的${r.label} ${p.id}${version ? ` v${version}` : ""} 里没有 ${p.part}：${raw}`);
    }
    if (version == null && !p.part) return fail("BAD_SOURCE", `引用的${r.label} ${p.id} 还没有定过版，没法引用；先给它定版，或者指到具体的子部位：${raw}`);
    const entry = { ref: formatRef({ ...p, version }), via };
    if (version == null) entry.fp = r.fingerprint(ws, pid, p.id, null, p.part);
    if (!out.some((x) => x.ref === entry.ref)) out.push(entry);
  }
  return { ok: true, sources: out };
}

// 素材自带的出处：files（[{ path, data }]）里 <文件>.source.json 的 { ref, fp? }。产品定版时把要冻结的
// 文件列表传进来，拿到 via:"asset" 的引用；格式不对的出处文件跳过（它只是素材的附属说明，不该挡住
// 定版）。
export function assetSources(files) {
  const out = [];
  for (const f of files) {
    if (!isSourceSidecar(f.path)) continue;
    try {
      const j = JSON.parse(String(f.data));
      if (!j || !parseRef(j.ref) || out.some((x) => x.ref === j.ref)) continue;
      out.push({ ref: j.ref, via: "asset", ...(j.fp ? { fp: String(j.fp) } : {}) });
    } catch { /* 跳过 */ }
  }
  return out;
}

export const isSourceSidecar = (name) => /\.source\.json$/.test(name);

// 产品没加载时，按项目里的产品登记用通用实体接口对上产物和版本号。
function registeredProduct(ws, pid, type) {
  try { return projectProducts(ws, pid)[type] || null; } catch { return null; } // ws/pid 不是真实项目（纯计算的调用）
}

function evaluateUninstalled(ws, pid, p, base) {
  const reg = registeredProduct(ws, pid, p.type);
  if (!reg) return { ...base, status: "missing", reason: `类型 ${p.type} 的产品不存在` };
  const meta = readEntityJson(ws, pid, { rootSeg: reg.rootSeg, metaFile: reg.metaFile }, p.id);
  const target = `${p.type}「${(meta && meta.title) || p.id}」`;
  if (!meta) return { ...base, status: "missing", head: null, target, reason: `${p.type} ${p.id} 已不存在` };
  const head = meta.head || 0;
  if (p.version != null && p.version > head) return { ...base, status: "missing", head, target, reason: `${target}没有 v${p.version}` };
  return { ...base, status: "unverifiable", head, target, reason: `${p.type} 产品没有启用（插件没装或被禁用），无法校验` };
}

// 一条引用现在是什么状态。fresh = 没变；stale = 引用的内容之后变了；missing = 引用的产物或子部位
// 不在了（旧版本本身不可变，当时的内容仍然能看到）；unverifiable = 引用的产品没有启用，无法校验。
export function evaluateSource(ws, pid, src, resolvers) {
  const p = parseRef(src.ref);
  const base = { ref: src.ref, via: src.via || "declared" };
  if (!p) return { ...base, status: "missing", reason: "引用格式不对" };
  const r = resolvers[p.type];
  if (!r) return evaluateUninstalled(ws, pid, p, base);
  const head = r.head(ws, pid, p.id);
  const name = r.describe ? r.describe(ws, pid, p.id, p.part) : `${r.label}「${p.id}${p.part ? `#${p.part}` : ""}」`;
  if (head == null) return { ...base, status: "missing", head: null, target: name, reason: `${r.label} ${p.id} 已不存在` };
  const out = { ...base, head, target: name };
  if (p.part) {
    const now = r.fingerprint(ws, pid, p.id, null, p.part);
    if (now == null) return { ...out, status: "missing", reason: `${name}已不存在` };
    const then = p.version != null ? r.fingerprint(ws, pid, p.id, p.version, p.part) : src.fp;
    const changed = then !== now;
    return { ...out, status: changed ? "stale" : "fresh",
             reason: changed ? `${name}在${p.version != null ? ` v${p.version}` : "引用"}之后改过${head ? `（最新 v${head}）` : ""}` : "" };
  }
  const changed = p.version != null && head > p.version;
  return { ...out, status: changed ? "stale" : "fresh", reason: changed ? `${name}基于 v${p.version}，已到 v${head}` : "" };
}

export function evaluateSources(ws, pid, sources, resolvers) {
  return (sources || []).map((s) => evaluateSource(ws, pid, s, resolvers));
}

// 这一版要存的引用单：本次声明的（没传就沿用上一版声明的——声明过"基于 PRD v5"，没人重新声明
// 之前它就一直基于 v5）+ 这次定版的素材自带的（asset / capture，每次按这一版的文件重新收集，不沿用）。
// declared 是 pinRefs 规范过的结果，undefined 表示这次没声明。
export function versionSources({ declared, previous, derived }) {
  const out = [...(declared ?? (previous || []).filter((s) => s.via === "declared"))];
  for (const s of derived || []) if (!out.some((x) => x.ref === s.ref)) out.push(s);
  return out;
}
