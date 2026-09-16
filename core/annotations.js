// core/annotations.js — 纯计算。标注 = 每块画板一份 markdown（annotations.md），写法像一节 spec：
// 分区用 `##`、一条说明用 `###`，正文里 [显示名](#el/元素id) 是元素指针（点击后在画布上定位到
// 对应位置，见 core/canvas.js 的 renderList / core/preview.js 的 __pfFlashElement）。元素要交互
// 才可见时的前置步骤放旁挂的 annotations.refs.json：{ 元素id: { interactionPath:[...] } }。
// 没有分组数组、没有 order、没有 revision、没有 per-标注 id——顺序 = 文档顺序，分组 = 标题。

// markdown 里的元素引用 [显示名](#el/元素id) → 全部元素 id（去重、保序）。
const EL_REF_RE = /\]\(#el\/([^)\s]+)\)/g;
export function parseElementRefs(md) {
  const out = [];
  const re = new RegExp(EL_REF_RE.source, "g");
  let m;
  while ((m = re.exec(String(md || "")))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// md 里引用的元素 id 是否都在当前源码里。missing 非空 = 有断链引用。
export function validateRefs(md, elementIds) {
  const ids = elementIds || [];
  const missing = parseElementRefs(md).filter((id) => !ids.includes(id));
  return { ok: missing.length === 0, missing };
}

// annotations.refs.json 里有、但 md 里已经不再引用的元素 id（死数据，可提示清理）。
export function unusedRefKeys(md, refs) {
  const referenced = parseElementRefs(md);
  return Object.keys(refs || {}).filter((id) => !referenced.includes(id));
}
