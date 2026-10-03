// 开放问题标记扫描——正文里用 **加粗** 包住含「待确认/待补充/需要…确认」字样的短语，表示
// "这版确实还没定、需要跟研发/干系人确认"。error 级：按产品研发流程，有这类标记的文档不对外发布，
// 直到确认清楚回填（或用户明确接受带着发布）。
//
// 先把每个「**...**」加粗片段各自独立抠出来（否定先行断言防止跨过中间那对 **——避免
// "**业务规则**：…（正文里普通出现的确认二字）…**校验条件**" 这种前后两个不相关的加粗标题之间
// 夹着含"确认"字样的普通正文时，错把两个 ** 当成一对吞掉一整段），再对每个片段单独判断。
const BOLD_SPAN_RE = /\*\*((?:(?!\*\*)[\s\S])+?)\*\*/g;
const MARKER_RE = /待确认|待补充|需要[\s\S]{0,20}确认/;

export default function check(ctx) {
  const out = [];
  const md = ctx.docMd || "";
  let m;
  BOLD_SPAN_RE.lastIndex = 0;
  while ((m = BOLD_SPAN_RE.exec(md))) {
    const text = m[1].replace(/\s+/g, "");
    if (MARKER_RE.test(text)) {
      out.push({
        code: "OPEN_QUESTION",
        level: "error",
        message: `开放问题未闭环：「${text}」`,
        hint: "与研发/干系人确认清楚后回填正文；用户明确接受带着发布时再发",
      });
    }
  }
  return out;
}
