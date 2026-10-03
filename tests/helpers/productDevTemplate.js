// 测试用：像模型那样从产品研发流程 skill 的模板起草文档——读 references/<名字>-template.md 里的
// markdown 代码块作为 create_doc 的 content，并打上这个 skill 认的标签。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REFS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "protoflow-product-dev", "references");

export function tpl(name) {
  const raw = fs.readFileSync(path.join(REFS, `${name}-template.md`), "utf8");
  const fenced = raw.match(/```(?:markdown|md)\n([\s\S]*?)\n```/);
  return { content: (fenced ? fenced[1] : raw).trim() + "\n", labels: [`product-dev/${name}`] };
}
