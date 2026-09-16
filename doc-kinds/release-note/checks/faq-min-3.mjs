// FAQ 至少 3 条：数一下正文里 "Q：" / "Q:" 开头的行。
export default function check(ctx) {
  const md = ctx.docMd || "";
  const count = (md.match(/^\s*(?:\*\*)?\s*Q\s*[:：]/gim) || []).length;
  if (count < 3) {
    return [{
      code: "FAQ_TOO_FEW",
      level: "warn",
      message: `FAQ 只有 ${count} 条，规范要求至少 3 条`,
      hint: "补齐用户最关心的问题",
    }];
  }
  return [];
}
