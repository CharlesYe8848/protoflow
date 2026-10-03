// products/deck/page.js — 阅读页和单 HTML 导出共用的一步：取某一版、渲染各页、带上 design/ 的样式脚本和 Mermaid 库。
import fs from "node:fs";
import path from "node:path";
import { productLibDir, ensureLibs, readLibSources, safeFileName } from "protoflow/sdk";
import * as deckStore from "./store.js";
import { renderSlides, usesMermaid } from "./render.js";
import { renderDeckPageHtml } from "./preview.js";
import { rewriteCssUrls } from "./html.js";
import { DECK_LIBS } from "./libs.js";
import { parsePlayback, rewritePlaybackAssets } from "./playback.js";

export function pickVersion(dj, query) {
  const want = Number(new URLSearchParams(query || "").get("v"));
  return (dj.versions || []).find((v) => v.n === want) || (dj.versions || []).find((v) => v.n === dj.head);
}

const versionsMeta = (dj) => (dj.versions || []).map((v) => ({ n: v.n, note: v.note || "", builtAt: v.builtAt || "" }));
const escapeScript = (s) => String(s).replace(/<\/(script)/gi, "<\\/$1");

// design/ 顶层的 .css、.js，按文件名排序（先后有讲究就用 01-、02- 前缀）。子目录（字体、底图）不直接加载，由样式引用。
export function designFiles(version, ext) {
  return version.list("design").filter((p) => p.split("/").length === 2 && p.endsWith(ext)).sort();
}

function versionPlayback(version, urlFor) {
  const parsed = parsePlayback(version.readText("playback.json"));
  if (!parsed.ok) throw Object.assign(new Error(parsed.message), { code: parsed.code });
  return rewritePlaybackAssets(parsed.value, urlFor);
}

// 阅读页（本地服务每次 GET 现场渲染）：design/ 和素材都按版本路径引用（本地服务按版本清单解析到对象库）。
// ui 是用户级界面偏好（~/.protoflow/ui.json）：缩略图栏开没开、多宽，所有幻灯片共用。
export function deckPreviewHtml(ws, pid, deckId, { query, embed, ui } = {}) {
  const dj = deckStore.readDeckJson(ws, pid, deckId);
  if (!dj || !dj.head) return null;
  const v = pickVersion(dj, query);
  const version = deckStore.openDeckVersion(ws, pid, deckId, v.n);
  if (!version) return null;
  const base = `versions/${v.n}/`;
  const slides = renderSlides(deckStore.readVersionSlides(version), { ws, pid, embed, sources: v.sources, urlFor: (rel) => base + rel });
  const playback = versionPlayback(version, (rel) => base + rel);
  // design/ 的脚本放在 <head>：先于各页里的脚本执行，页面脚本能直接用它定义的东西
  const headTags = designFiles(version, ".css").map((f) => `<link rel="stylesheet" href="${base}${f}"/>`).join("")
    + designFiles(version, ".js").map((f) => `<script src="${base}${f}"></script>`).join("");
  let bodyTags = "";
  if (usesMermaid(slides)) {
    ensureLibs(productLibDir(ws, pid, "deck"), DECK_LIBS);
    bodyTags = `<script src="../../lib/deck/mermaid.min.js"></script>` + bodyTags;
  }
  return renderDeckPageHtml({ title: dj.title || deckId, deckId, slides, playback, versions: versionsMeta(dj), current: v.n, head: dj.head, headTags, bodyTags,
    thumbs: { open: !!(ui && ui.deckThumbsOpen), width: Number(ui && ui.deckThumbsWidth) || 0 } });
}

// 版本里的文件 → data URI。
function dataUri(version, rel) {
  const buf = version.read(rel);
  if (!buf) return rel;
  const ext = (rel.split(".").pop() || "").toLowerCase();
  const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", mp4: "video/mp4", webm: "video/webm",
    mp3: "audio/mpeg", wav: "audio/wav" }[ext] || "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// 草稿当成一个"版本句柄"（list/read/readText/has），好跟定过的版本走同一条渲染路径。
function draftHandle(ws, pid, deckId) {
  const root = deckStore.deckDir(ws, pid, deckId);
  const files = deckStore.draftFiles(ws, pid, deckId);
  const has = (rel) => files.includes(rel);
  const read = (rel) => (has(rel) ? fs.readFileSync(path.join(root, rel)) : null);
  return {
    list: (prefix = "") => (prefix ? files.filter((f) => f.startsWith(prefix.endsWith("/") ? prefix : prefix + "/")) : files.slice()),
    has, read, readText: (rel) => { const b = read(rel); return b ? b.toString("utf8") : null; },
  };
}

// 单个自包含 HTML：design/ 的 CSS/JS 内联，页里和 CSS 里引用的文件转 data URI；用到 Mermaid 就把库以 base64
// 内嵌、加载时解出来执行（原样内嵌会有 </script> 之类的字符串截断页面）。
// draft：用草稿（没定版的改动）渲染，给排版检查用；嵌入按对方最新版。
export function deckStandaloneHtml(ws, pid, deckId, { embed, draft = false } = {}) {
  const dj = deckStore.readDeckJson(ws, pid, deckId);
  if (!dj) return null;
  let v, version;
  if (draft) {
    version = draftHandle(ws, pid, deckId);
    v = { n: 0, note: "草稿", builtAt: "", sources: [] };
    if (!version.list("slides").length) return null;
  } else {
    if (!dj.head) return null;
    v = (dj.versions || []).find((x) => x.n === dj.head);
    version = deckStore.openDeckVersion(ws, pid, deckId, v.n);
    if (!version) return null;
  }
  const slides = renderSlides(deckStore.readVersionSlides(version), { ws, pid, embed, sources: v.sources, urlFor: (rel) => dataUri(version, rel) });
  const playback = versionPlayback(version, (rel) => dataUri(version, rel));
  const headTags = designFiles(version, ".css").map((f) => {
    const css = rewriteCssUrls(version.readText(f) || "", (rel) => dataUri(version, `design/${rel}`));
    return `<style>\n${css.replace(/<\/(style)/gi, "<\\/$1")}\n</style>`;
  }).join("") + designFiles(version, ".js").map((f) => `<script>\n${escapeScript(version.readText(f))}\n</script>`).join("");
  let bodyTags = "";
  if (usesMermaid(slides)) {
    const b64 = Buffer.from(readLibSources(DECK_LIBS, ["mermaid.min.js"])["mermaid.min.js"], "utf8").toString("base64");
    bodyTags = `<script id="pf-lib-mermaid" type="application/octet-stream">${b64}</script>`
      + `<script>(function(){var b=atob(document.getElementById("pf-lib-mermaid").textContent);var u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);`
      + `var s=document.createElement("script");s.textContent=new TextDecoder().decode(u);document.head.appendChild(s);})();</script>` + bodyTags;
  }
  const html = renderDeckPageHtml({ title: dj.title || deckId, deckId, slides, playback, versions: [{ n: v.n, note: v.note || "", builtAt: v.builtAt || "" }], current: v.n, head: v.n, headTags, bodyTags, standalone: true });
  return { html, name: safeFileName(dj.title || deckId, deckId) };
}
