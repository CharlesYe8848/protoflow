// Export the frozen head as native, editable Word paragraphs and tables.
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { decodeHTML } from "entities";
import { imageSize } from "image-size";
import { Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink,
  Table, TableRow, TableCell, WidthType, HeadingLevel, LevelFormat } from "docx";
import { loadDocHead } from "./exportUtil.js";
import { injectChangelogMarkdown } from "./docPreview.js";

export async function buildDocExportWord(ws, projectId, docId) {
  const head = loadDocHead(ws, projectId, docId);
  if (!head) return null;
  const { v, vDir, name } = head;
  const md = injectChangelogMarkdown(head.md, [v], v.n);
  const numbering = [];
  const text = (value, style = {}) => new TextRun({ text: value, ...style });

  function image(token) {
    // Only embed files from this frozen version; never fetch URLs or read outside it.
    try {
      const source = decodeURIComponent(token.href);
      const file = fs.realpathSync(path.resolve(vDir, source));
      const base = fs.realpathSync(vDir);
      if (!file.startsWith(base + path.sep)) throw new Error("outside version");
      const data = fs.readFileSync(file);
      const size = imageSize(data);
      const type = size.type === "jpg" ? "jpg" : size.type;
      if (!["png", "jpg", "gif", "bmp"].includes(type)) throw new Error("unsupported image");
      const scale = Math.min(1, 600 / size.width, 800 / size.height);
      return new ImageRun({ type, data,
        transformation: { width: Math.round(size.width * scale), height: Math.round(size.height * scale) },
        altText: { title: token.text || "图片", description: token.text || "图片", name: token.text || "图片" } });
    } catch {
      return text(`[图片：${token.text || token.href}]（未嵌入：${token.href}）`);
    }
  }

  function inline(tokens = [], style = {}) {
    return tokens.flatMap((t) => {
      if (t.type === "strong") return inline(t.tokens, { ...style, bold: true });
      if (t.type === "em") return inline(t.tokens, { ...style, italics: true });
      if (t.type === "del") return inline(t.tokens, { ...style, strike: true });
      if (t.type === "codespan") return text(t.text, { ...style, font: "Consolas" });
      if (t.type === "br") return new TextRun({ break: 1 });
      if (t.type === "html" && /^<br\s*\/?\s*>$/i.test((t.raw ?? t.text ?? "").trim())) {
        return new TextRun({ break: 1 });
      }
      if (t.type === "image") return image(t);
      if (t.type === "link") {
        const children = inline(t.tokens, { ...style, color: "0563C1", underline: {} });
        return /^(https?:|mailto:)/i.test(t.href)
          ? new ExternalHyperlink({ link: t.href, children }) : children;
      }
      if (t.tokens) return inline(t.tokens, style);
      // Preserve raw HTML as text rather than silently dropping document content.
      return text(decodeHTML(t.text ?? t.raw ?? ""), style);
    });
  }

  function blocks(tokens, level = 0, firstOptions = {}, state = { used: false }) {
    const paragraph = (options) => {
      const result = new Paragraph({ ...(!state.used ? firstOptions : {}), ...options });
      state.used = true;
      return result;
    };
    return tokens.flatMap((t) => {
      switch (t.type) {
        case "space": return [];
        case "heading": return paragraph({ heading: HeadingLevel[`HEADING_${t.depth}`], children: inline(t.tokens) });
        case "paragraph": case "text": return paragraph({ children: t.tokens ? inline(t.tokens) : [text(t.text)] });
        case "blockquote": return blocks(t.tokens, level, firstOptions, state);
        case "code": return t.text.split("\n").map((line) => paragraph({
          children: [text(line, { font: "Consolas", size: 18 })], spacing: { after: 0 },
          shading: { fill: "F3F4F6" },
        }));
        case "hr": return paragraph({ text: "────────" });
        case "list": {
          const reference = `list-${numbering.length}`;
          numbering.push({ reference, levels: Array.from({ length: 9 }, (_, i) => ({
            level: i, format: t.ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
            text: t.ordered ? `%${i + 1}.` : "•", start: Number(t.start) || 1,
            style: { paragraph: { indent: { left: 360 * (i + 1), hanging: 260 } } },
          })) });
          return t.items.flatMap((item) => {
            const children = blocks(item.tokens, level + 1, { numbering: { reference, level: Math.min(level, 8) } });
            const first = children.find((p) => p instanceof Paragraph);
            if (first) first.addRunToFront(text(item.task ? (item.checked ? "☑ " : "☐ ") : ""));
            return children;
          });
        }
        case "table": {
          const row = (cells, header = false) => new TableRow({ tableHeader: header, children: cells.map((cell) => new TableCell({
            children: [new Paragraph({ children: inline(cell.tokens, header ? { bold: true } : {}) })],
            ...(header ? { shading: { fill: "F3F4F6" } } : {}),
          })) });
          return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [row(t.header, true), ...t.rows.map((r) => row(r))] });
        }
        default: return t.raw ? paragraph({ text: t.raw }) : [];
      }
    });
  }
  const children = blocks(marked.lexer(md));
  const doc = new Document({ title: head.dj.title || name,
    styles: { default: { document: { run: { font: "Arial", size: 22 }, paragraph: { spacing: { after: 160, line: 276 } } } } },
    numbering: { config: numbering },
    sections: [{ properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children: children.length ? children : [new Paragraph("")] }],
  });
  return { filename: `${name}.docx`, buffer: await Packer.toBuffer(doc) };
}
