// products/deck/tools.js — 幻灯片的 CLI 工具。reg 是注册表句柄（引用解析器、导出分发）。
import path from "node:path";
import { z } from "zod";
import { fail, labelsParam, pid, pinSources, projectDir, sourcesParam, withUrl, writeExport, embedSourcesFrom } from "protoflow/sdk";
import { createDeck, buildDeck } from "./deck.js";
import { embedRefs } from "./html.js";
import * as deckStore from "./store.js";

export function deckTools(reg) {
  return [
    {
      name: "create_deck",
      description: "在 decks/ 下新建一份幻灯片：decks/<deckId>/（slides/ 每页一个 .html、design/ 全稿共用的样式和脚本（带一份起步样式，直接改）、assets/ 素材、playback.json 放映配置、deck.json），先放一页封面。文件格式看 get_guide(\"deck-writing\")。写完 build_deck(note:\"…\") 定第一个版本",
      schema: { ...pid, deckId: z.string().describe("目录名，人类可读 slug，可含中文"), title: z.string().optional(), labels: labelsParam },
      handler: (a, ctx) => createDeck(ctx.ws, a.projectId, a, ctx),
    },
    {
      name: "build_deck",
      description: "给幻灯片定版：校验每页、素材和 playback.json（自动翻页、页面 id、音频文件）；页里的 <pf-embed ref=\"…\"> 按对方当前版本固定、记进引用；slides/ + assets/ + design/ + playback.json 一起冻结成第 n 版。note 必填。定版不做排版检查。返回的 url（http://127.0.0.1）是打开方式",
      schema: { ...pid, deckId: z.string(), note: z.string(), label: z.string().optional(), author: z.string().optional(), sources: sourcesParam },
      handler: async (a, ctx) => {
        const ps = pinSources(ctx, a.projectId, a.sources, reg.resolvers);
        if (ps.error) return ps.error;
        const raws = [...new Set(deckStore.readDraftSlides(ctx.ws, a.projectId, a.deckId).flatMap((s) => embedRefs(s.html)))];
        const pinned = pinSources(ctx, a.projectId, raws, reg.resolvers);
        if (pinned.error) return { ...pinned.error, error: { ...pinned.error.error, message: `页里的嵌入：${pinned.error.error.message}` } };
        const r = buildDeck(ctx.ws, a.projectId, a.deckId, { note: a.note, label: a.label, author: a.author, sources: ps.sources, embedSources: embedSourcesFrom(raws, pinned.sources) }, ctx);
        if (!r.ok) return r;
        const page = path.join(deckStore.deckDir(ctx.ws, a.projectId, a.deckId), "preview.html");
        return withUrl(a.projectId, projectDir(ctx.ws, a.projectId), page, r);
      },
    },
    {
      name: "export_deck",
      description: "把一份幻灯片的当前（head）版本导出成一个文件，写到 outDir 下（文件名取标题）。format=\"html\"（默认）单个自包含 .html（design/、图片、音频、Mermaid 都内嵌，保留自动翻页和音频）；format=\"pdf\" 每页一张静态 16:9 PDF；format=\"mp4\" 按 playback.json 的时长录成 1920×1080 视频（进场动画、页里视频逐帧录，旁白、背景音乐合进音轨；没开自动翻页的页按 defaultDurationMs；要本机有 ffmpeg）；format=\"zip\" 是源文件包（含 playback.json）；format=\"draft-html\" 用还没定版的草稿出单 HTML（给排版检查用，不算交付）。不需要 protoflow 的预览服务",
      schema: { ...pid, deckId: z.string(), format: z.enum(["html", "pdf", "mp4", "zip", "draft-html"]).optional(), outDir: z.string().describe("文件要写到的目录（绝对路径，或相对 dir 参数解析）；目录不存在会自动创建") },
      handler: async (a, ctx) => {
        const out = await reg.runExport(path.join(ctx.ws, a.projectId), `deck/${encodeURIComponent(a.deckId)}/${a.format || "html"}`);
        if (!out) return fail("DECK_NOT_BUILT", a.format === "draft-html" ? `幻灯片 ${a.deckId} 不存在或 slides/ 下没有页` : `幻灯片 ${a.deckId} 尚未 build_deck，没有任何版本可导出`);
        return writeExport(a.outDir, out);
      },
    },
  ];
}
