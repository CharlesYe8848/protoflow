import { test } from "node:test";
import assert from "node:assert/strict";
import { validateJsx, extractElementIds, extractElementHints } from "../core/compile.js";

const GOOD = `function Component(){\n  return <div id="root-box"><button id="btn-save">保存</button></div>;\n}`;
const BAD = `function Component(){ return <div id="x">`; // 未闭合

test("validateJsx 合法 JSX 返回 ok", () => {
  const r = validateJsx(GOOD);
  assert.equal(r.ok, true);
});

test("validateJsx 语法错误返回 ok:false 且带错误信息", () => {
  const r = validateJsx(BAD);
  assert.equal(r.ok, false);
  assert.ok(typeof r.error === "string" && r.error.length > 0);
});

test("validateJsx 要求存在 Component 声明", () => {
  const r = validateJsx(`function Other(){ return <div/>; }`);
  assert.equal(r.ok, false);
  assert.match(r.error, /Component/);
});

test("extractElementIds 提取静态 id 且去重", () => {
  assert.deepEqual(extractElementIds(GOOD).slice(0, 2), ["root-box", "btn-save"]);
  assert.deepEqual(extractElementIds(`<a id='x'/><b id="x"/>`), ["x"]);
});

test("extractElementHints：title/label 类属性优先，带上次要的 meta/sub", () => {
  const src = `function Component(){ return (
    <div>
      <Section id="sec" title="现状：已具备的能力" sub="v3.1.4 · 已上线"><p>正文</p></Section>
      <Event id="ev-a" title="执行" meta="检查插件状态" />
      <Event id="ev-b" title="执行" meta="检查登录状态" />
      <button id="btn" aria-label="收起侧栏" />
    </div>
  ); }`;
  const h = extractElementHints(src);
  assert.equal(h["sec"], "现状：已具备的能力 · v3.1.4 · 已上线");
  assert.equal(h["ev-a"], "执行 · 检查插件状态");
  assert.equal(h["ev-b"], "执行 · 检查登录状态", "同 title 不同 meta 的行不再撞成一样");
  assert.equal(h["btn"], "收起侧栏");
});

test("extractElementHints：没有 label 属性时退到可见文字（含浅层子元素）", () => {
  const src = `function Component(){ return (
    <div>
      <p id="tagline">把插件升级为通用工具集</p>
      <div id="box"><div className="hd">六条设计原则</div></div>
      <div id="wrap"><div className="mermaid">{flow}</div></div>
      <div id="sum">{tag} · {title}</div>
    </div>
  ); }`;
  const h = extractElementHints(src);
  assert.equal(h["tagline"], "把插件升级为通用工具集");
  assert.equal(h["box"], "六条设计原则");
  assert.equal("wrap" in h, false, "只有变量表达式、没有静态文字 → 不收录");
  assert.equal("sum" in h, false, "表达式之间只剩 ' · ' 这种纯标点 → 不收录");
});

test("extractElementHints：语法坏掉不抛，返回空对象", () => {
  assert.deepEqual(extractElementHints(`function Component(){ return <div id=`), {});
  assert.deepEqual(extractElementHints(""), {});
});
