// 修改记录表占位标记 <!-- protoflow:changelog --> 的健康检查。
// 0 个：OK，就是这份文档不展示这张表（哪种类型要不要这张表，看该类型 writing.md 有没有指导
// 写这个标记，不是这里判断的）。
// 2 个以上：error，表会渲染多份。
// 落在 ``` 代码块里：warn，会原样显示成注释文本而不是被替换成表。
const MARKER = "<!-- protoflow:changelog -->";

export default function check(ctx) {
  const md = ctx.docMd || "";
  const idxs = [];
  let i = md.indexOf(MARKER);
  while (i !== -1) { idxs.push(i); i = md.indexOf(MARKER, i + MARKER.length); }
  if (idxs.length === 0) return [];
  const out = [];
  if (idxs.length > 1) {
    out.push({ code: "CHANGELOG_MARKER_DUP", level: "error",
      message: `${MARKER} 出现了 ${idxs.length} 次，修改记录表会渲染多份`, hint: "只保留一处，或全部删掉（这份文档就不展示这张表）" });
  }
  for (const at of idxs) {
    const fencesBefore = (md.slice(0, at).match(/```/g) || []).length;
    if (fencesBefore % 2 === 1) {
      out.push({ code: "CHANGELOG_MARKER_IN_FENCE", level: "warn",
        message: `${MARKER} 落在代码块里，会原样显示成注释文本`, hint: "把标记移到代码块外" });
    }
  }
  return out;
}
