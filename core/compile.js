// core/compile.js — 纯计算（@babel/standalone 是 CJS，默认导入拿到 module.exports）
import Babel from "@babel/standalone";

// 编译校验：能被 react preset 转换 = JSX 语法合法。失败绝不落盘由调用方保证。
export function validateJsx(source) {
  if (!/\bfunction\s+Component\b|\bconst\s+Component\b/.test(String(source))) {
    return { ok: false, error: "源码必须定义名为 Component 的组件（function Component 或 const Component）" };
  }
  try {
    Babel.transform(source, { presets: ["react"], filename: "source.jsx" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 500) };
  }
}

// 静态元素 id 提取（与 Axure0.3 同策略：标注 target 必须命中这份集合）
export function extractElementIds(source) {
  const ids = [];
  const re = /\bid=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(String(source)))) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids;
}

// 每个带 id 的 JSX 元素给一句"它在界面上大概是什么"的线索，供写 annotations.md 时给 chip 起人话名
// （见 guides/annotation.md）。**只是线索、可能不准**：模型该据此起名，不该原样当显示名粘进去。
// 取值优先级：同元素上的 title/label 类字符串属性（有次要的 meta/sub 一起带上）→ 直接文字子节点
// → 第一段后代可见文字。取不到、或只剩标点符号就不收录该 id（模型按角色/位置自己起名）。
// 纯静态 AST 分析，不渲染。
const HINT_PRIMARY_PROPS = ["title", "label", "heading", "aria-label", "alt", "placeholder"];
const HINT_SECONDARY_PROPS = ["meta", "sub", "subtitle", "desc", "description", "caption"];
const HINT_MAX = 80;
// 至少要有一个字（中日韩 / 字母 / 数字），否则是纯标点噪声（如表达式之间的 " · "）
const HINT_HAS_WORD = /[\p{L}\p{N}]/u;

function litString(node, t) {
  if (!node) return null;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isJSXExpressionContainer(node)) return litString(node.expression, t);
  if (t.isTemplateLiteral(node) && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  }
  return null;
}

function clip(s) {
  const v = String(s || "").replace(/\s+/g, " ").trim();
  return v.length > HINT_MAX ? v.slice(0, HINT_MAX) + "…" : v;
}

export function extractElementHints(source) {
  const { parser, traverse, types: t } = Babel.packages;
  const traverseFn = traverse.default || traverse;
  let ast;
  try {
    ast = parser.parse(String(source), { plugins: ["jsx"], sourceType: "module", errorRecovery: true });
  } catch {
    return {};
  }

  // 收集第一段可见文字：直接文字子节点，没有就往子元素里浅挖（限量，避免整棵子树拼起来）
  function firstText(children, budget) {
    let out = "";
    for (const c of children || []) {
      if (t.isJSXText(c)) out += c.value;
      else if (t.isJSXExpressionContainer(c)) { const s = litString(c, t); if (s) out += s; }
      else if (t.isJSXElement(c) && budget.n > 0) { budget.n--; out += " " + firstText(c.children, budget); }
      if (clip(out).length >= 3) return clip(out);
    }
    return clip(out);
  }

  const propString = (attrs, names) => {
    for (const name of names) {
      for (const a of attrs) {
        if (t.isJSXAttribute(a) && a.name && a.name.name === name) {
          const s = litString(a.value, t);
          if (s && s.trim()) return s.trim();
        }
      }
    }
    return null;
  };

  const hints = {};
  traverseFn(ast, {
    JSXOpeningElement(path) {
      const attrs = path.node.attributes || [];
      let id = null;
      for (const a of attrs) {
        if (t.isJSXAttribute(a) && a.name && a.name.name === "id" && t.isStringLiteral(a.value)) { id = a.value.value; break; }
      }
      if (id == null || hints[id] != null) return; // 首个命中为准

      let hint = propString(attrs, HINT_PRIMARY_PROPS);
      if (hint) {
        const secondary = propString(attrs, HINT_SECONDARY_PROPS);
        if (secondary && secondary !== hint) hint = `${hint} · ${secondary}`;
      } else {
        hint = firstText(path.parentPath.node.children, { n: 12 });
      }
      hint = clip(hint);
      if (hint.length >= 2 && HINT_HAS_WORD.test(hint)) hints[id] = hint;
    },
  });
  return hints;
}
