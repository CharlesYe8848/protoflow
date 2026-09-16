// 上线公告标题格式：第一行一级标题应形如「# 【模块】…上线」——带方括号模块名、以"上线"收尾。
export default function check(ctx) {
  const md = ctx.docMd || "";
  const m = md.match(/^#\s+(.+?)\s*$/m);
  if (!m) {
    return [{ code: "TITLE_MISSING", level: "error", message: "缺少一级标题（# ...）" }];
  }
  const title = m[1].trim();
  const out = [];
  if (!/^【.+?】/.test(title)) {
    out.push({ code: "TITLE_NO_MODULE", level: "warn",
      message: `标题「${title}」缺少【模块】前缀`, hint: "如 # 【绩效】组织绩效支持结果申诉上线" });
  }
  if (!/上线\s*$/.test(title)) {
    out.push({ code: "TITLE_NO_SUFFIX", level: "warn",
      message: `标题「${title}」未以"上线"收尾` });
  }
  return out;
}
