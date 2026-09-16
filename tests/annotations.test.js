import { test } from "node:test";
import assert from "node:assert/strict";
import { parseElementRefs, validateRefs, unusedRefKeys } from "../core/annotations.js";

test("parseElementRefs：抽出 md 里全部 [名](#el/id) 的 id，去重保序；无引用返回空", () => {
  assert.deepEqual(parseElementRefs("点 [卡片](#el/card) 打开 [面板](#el/panel)，再点 [卡片](#el/card) 收起"), ["card", "panel"]);
  assert.deepEqual(parseElementRefs("一段没有引用的纯文本"), []);
  assert.deepEqual(parseElementRefs(""), []);
  assert.deepEqual(parseElementRefs(null), []);
});

test("validateRefs：md 里引用的元素都在 elementIds 里则 ok；否则列出 missing", () => {
  assert.deepEqual(
    validateRefs("见 [列表](#el/list) 和 [保存](#el/btn-save)", ["list", "btn-save", "x"]),
    { ok: true, missing: [] },
  );
  const r = validateRefs("点 [幽灵](#el/ghost) 和 [列表](#el/list)", ["list"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["ghost"]);
});

test("validateRefs：纯文本无引用永远 ok（floating note）", () => {
  assert.deepEqual(validateRefs("这个画板演示的是……", []), { ok: true, missing: [] });
});

test("unusedRefKeys：refs 里在 md 中已不再被引用的 key", () => {
  const md = "只提 [列表](#el/list)";
  assert.deepEqual(unusedRefKeys(md, { list: { interactionPath: [] }, panel: { interactionPath: [] } }), ["panel"]);
  assert.deepEqual(unusedRefKeys(md, {}), []);
  assert.deepEqual(unusedRefKeys(md, null), []);
});
