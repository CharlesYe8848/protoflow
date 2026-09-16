// core/libCodec.js — 单 HTML 导出内联库源码的压缩/解压，供 core/exportCanvasHtml.js（react/
// react-dom/babel/mermaid，画板去重共享）和 core/exportDocHtml.js（marked/mermaid）共用。
//
// 压缩算法只在这一个文件里出现一次：以后想换算法（比如从 gzip 换成 deflate-raw 省几个字节的
// 包装头），只用改 CODEC_FORMAT 这个常量 + compressText() 这一个函数体，两条导出路径都不用碰。
//
// 格式字符串跟着数据走（{format, base64}，不是写死在调用方）：解压端认的是 Web 标准的
// DecompressionStream，它支持哪些 format（目前 "gzip" | "deflate" | "deflate-raw"），解压脚本
// 原样通用、不用为每种格式写分支——真正会变的只有 Node 端选用哪种格式压缩，压缩方式本身不需要
// 浏览器端配合升级。
import zlib from "node:zlib";

export const CODEC_FORMAT = "gzip";

// 画板模板里 <script src="${libRelPath}/xxx.js"> 用这个占位路径代替真实相对路径（单 HTML 导出
// 专用，core/exportCanvasHtml.js 用它当 libRelPath）——不对应任何真实文件，纯粹是给父文档启动
// 脚本（core/canvas.js 的 buildScript）认的一个标记，运行时整段替换成真实 blob: URL。两边共用
// 同一个常量，不是各自写一份字符串——改这一个值，两边一起变，不会出现"一边改了一边忘改"。
export const PLACEHOLDER_LIB_PATH = "__PF_LIB__";

// text -> { format, base64 }
export function compressText(text) {
  const buf = zlib.gzipSync(Buffer.from(text, "utf8"));
  return { format: CODEC_FORMAT, base64: buf.toString("base64") };
}

// { 文件名: 源码字符串 } -> { 文件名: { format, base64 } }
export function compressLibSources(sources) {
  const out = {};
  for (const [name, text] of Object.entries(sources)) out[name] = compressText(text);
  return out;
}

// 浏览器端解压：给一份 { 文件名: {format, base64} }，解成 { 文件名: 源码字符串 } 的 Promise。
// 用浏览器内置 DecompressionStream，不引入任何第三方解压库/依赖。
export function decompressLibsScript() {
  return `
  function __pfDecompressLibs(compressed){
    var names = Object.keys(compressed || {});
    return Promise.all(names.map(function(name){
      var entry = compressed[name];
      var bin = atob(entry.base64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(entry.format));
      return new Response(stream).text();
    })).then(function(texts){
      var out = {};
      names.forEach(function(name, i){ out[name] = texts[i]; });
      return out;
    });
  }`;
}

// 单 HTML 导出专用：把画板 HTML 里 <script src="__PF_LIB__/xxx"></script> 这种占位标签，逐个换成
// 内联 <script>解压后的源码</script>。
//
// 回归测试的教训：最早这一步是建 Blob URL、把占位路径换成 blob: 链接（画板 iframe 之间共享同一份
// Blob，省内存）——文件大小的账没算错，但传到飞书云文档这类"预览第三方上传 HTML"的平台后画板
// 整个空白：这类平台几乎都会给托管的文件加一条不放行 script-src blob: 的 CSP（防 XSS 的常规
// 做法），<script src="blob:...">被直接拦掉，React/Babel 都没能加载。本机加同一条 CSP 头复现过
// 一模一样的现象。换成内联 <script>源码</script> 这种"文档自己的脚本"，纵使是最严格的 CSP 也
// 几乎不会拦（拦了页面自己的脚本也跑不起来），换成这个之后哪儿都能看——压缩内联去掉的只是
// "文件里一份、画板运行时也共用一份"这个内存优化，磁盘/下载这份大小的好处完全保留（文件里始终
// 只压了一份库源码，不会跟着画板数量变大，画板各自解压出一份放进自己内存，跟当年没去重时的内存
// 占用打平，不算倒退）。
//
// 按已知文件名整段做字符串替换（split/join，不用正则）：不用为文件名里的 "." 之类字符操心转义，
// 也不用在这段要塞进导出页面 <script> 标签的文本里处理"写正则字面量时怎么避免踩到 </script
// 边界"这种嵌套转义问题——待替换目标和替换结果都是完整已知的字符串，没有需要动态匹配的部分。
export function injectArtboardLibsScript() {
  return `
  function __pfInjectArtboardLibs(html, sources){
    Object.keys(sources).forEach(function(name){
      var tag = '<script src="${PLACEHOLDER_LIB_PATH}/' + name + '"></' + 'script>';
      if (html.indexOf(tag) === -1) return;
      // 库源码里万一含闭合脚本标签这个词（压缩前的字符串常量里理论上可能出现），拆开重新拼接
      // 掉，不然会把 HTML 解析器提前截断，把这块画板剩下的内容全部截没。
      var parts = String(sources[name]).split('</' + 'script');
      var safeSrc = parts.join('<' + '\\\\/script');
      var replacement = '<script>' + safeSrc + '</' + 'script>';
      html = html.split(tag).join(replacement);
    });
    return html;
  }`;
}
