// products/deck/html.js — 每页 HTML 的静态检查和改写（纯函数）：页的约定、标题、素材引用、嵌入标签。
//
// 一页的约定：文件内容的根节点是一个 <section>（前后可以有注释和空白）。框架给这个 section 1920×1080 的画布，
// 里面怎么排由写的人决定（页里的样式脚本、design/ 下全稿共用的）。
const SECTION_RE = /^\s*(?:<!--[\s\S]*?-->\s*)*<section\b([^>]*)>[\s\S]*<\/section>\s*(?:<!--[\s\S]*?-->\s*)*$/i;
export const EMBED_TAG_RE = /<pf-embed\b[^>]*\bref\s*=\s*"([^"]+)"[^>]*>(?:\s*<\/pf-embed>)?/gi;
const ASSET_ATTR_RE = /(\b(?:src|href|poster)\s*=\s*["'])assets\/([^"'?#]+)/gi;
const ASSET_URL_RE = /(url\(\s*["']?)assets\/([^"')?#]+)/gi;

export function checkSlide(html) {
  const m = SECTION_RE.exec(String(html));
  if (!m) return ["文件内容要是一个 <section …>…</section>（整页就这一个根元素）"];
  return [];
}

export function slideLayout(html) {
  const m = SECTION_RE.exec(String(html));
  const lm = m && /\bdata-layout\s*=\s*"([^"]*)"/i.exec(m[1]);
  return lm ? lm[1] : null;
}

const stripTags = (s) => String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// 页标题：section 上的 data-title，否则第一个 h1–h3 的文字，都没有就"第 n 页"。
export function slideTitle(html, i) {
  const t = /<section\b[^>]*\bdata-title\s*=\s*"([^"]+)"/i.exec(html) || /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html);
  const s = t && stripTags(t[1]);
  return s || `第 ${i + 1} 页`;
}

export function assetRefs(html) {
  const out = new Set();
  for (const re of [ASSET_ATTR_RE, ASSET_URL_RE]) for (const m of String(html).matchAll(re)) out.add(decodeURIComponent(m[2]));
  return [...out];
}

export function embedRefs(html) {
  return [...new Set([...String(html).matchAll(EMBED_TAG_RE)].map((m) => m[1].trim()))];
}

// assets/… 引用改写成 urlFor("assets/…") 的结果（阅读页是版本路径，单 HTML 导出是 data URI）。
export function rewriteAssets(html, urlFor) {
  return String(html)
    .replace(ASSET_ATTR_RE, (_m, pre, f) => pre + urlFor(`assets/${f}`))
    .replace(ASSET_URL_RE, (_m, pre, f) => pre + urlFor(`assets/${f}`));
}

// CSS 里相对 url(...)（不是 data:、http:、/ 开头的）按 base 目录改写，给 design/ 下的样式用。
export function rewriteCssUrls(css, urlFor) {
  return String(css).replace(/url\(\s*(["']?)(?!data:|https?:|\/|#)([^"')]+)\1\s*\)/gi, (_m, q, rel) => `url(${q}${urlFor(rel)}${q})`);
}
