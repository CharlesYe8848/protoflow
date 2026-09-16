import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { CODEC_FORMAT, compressText, compressLibSources, decompressLibsScript, injectArtboardLibsScript, PLACEHOLDER_LIB_PATH } from "../core/libCodec.js";

test("compressText：格式跟着数据走（entry 自带 format），gzip 压缩产物能被还原成原文——不是自己瞎编的字节", () => {
  const text = "var x = 1;".repeat(5000); // 有重复内容才压得动
  const { format, base64 } = compressText(text);
  assert.equal(format, CODEC_FORMAT);
  const restored = zlib.gunzipSync(Buffer.from(base64, "base64")).toString("utf8");
  assert.equal(restored, text);
  // 真的变小了（不是随手裹了层 base64 反而变大）
  assert.ok(base64.length < text.length, `压缩后 ${base64.length} 应该明显小于原文 ${text.length}`);
});

test("compressLibSources：多份源码各自独立压缩，互不影响，key 是文件名", () => {
  const sources = { "a.js": "console.log('a');".repeat(200), "b.js": "console.log('b');".repeat(300) };
  const out = compressLibSources(sources);
  assert.deepEqual(Object.keys(out).sort(), ["a.js", "b.js"]);
  for (const [name, text] of Object.entries(sources)) {
    const restored = zlib.gunzipSync(Buffer.from(out[name].base64, "base64")).toString("utf8");
    assert.equal(restored, text, name);
    assert.equal(out[name].format, CODEC_FORMAT);
  }
});

test("decompressLibsScript：产出的是一段引用 DecompressionStream 的浏览器端脚本源文本（不是压缩逻辑本身重复实现一遍），且不含会截断外层 <script> 标签的裸露闭合序列", () => {
  const script = decompressLibsScript();
  assert.equal(typeof script, "string");
  assert.ok(script.includes("DecompressionStream"), "解压端用 Web 标准 API，不是手搓解压算法");
  assert.ok(script.includes("__pfDecompressLibs"), "导出的函数名跟调用方约定的一致");
  assert.equal(script.search(/<\/script/i), -1, "这段文本会被原样嵌进导出页面的 <script> 标签里，本身不能含裸露的闭合脚本序列，不然会把外层标签提前截断");
});

// injectArtboardLibsScript 产出的是一段浏览器端脚本源文本——不依赖任何 Web-only API（不用
// DecompressionStream/Blob 那些），可以直接 eval 到 Node 里验证真实行为，不用起浏览器。
function loadInjectFn() {
  const script = injectArtboardLibsScript();
  const sandbox = {};
  new Function("module", "exports", script + "\nmodule.exports = __pfInjectArtboardLibs;")(sandbox, sandbox);
  return sandbox.exports;
}

test("injectArtboardLibsScript：产出的文本本身不含裸露的闭合脚本序列——回归测试：早前这段代码自己的注释里字面写了这几个字，被嵌进导出页面后会把外层 <script> 标签提前截断，整个画布启动脚本被切掉后半段", () => {
  const script = injectArtboardLibsScript();
  assert.equal(script.search(/<\/script/i), -1, "生成的脚本源文本不能含裸露的 </script（哪怕是在注释里）");
});

test("injectArtboardLibsScript：把画板 HTML 里 __PF_LIB__ 占位标签换成内联脚本，库源码里出现的关闭脚本标签会被拆开、不会截断画板内容，用不到的库不会被误替换", () => {
  const inject = loadInjectFn();
  const raw = `<html><head><script src="${PLACEHOLDER_LIB_PATH}/react.production.min.js"></script><script src="${PLACEHOLDER_LIB_PATH}/babel.min.js"></script></head><body>hi</body></html>`;
  const sources = {
    "react.production.min.js": "var React = 1; // normal source",
    "babel.min.js": "var Babel = 1; /* 藏了一个关闭标签：" + "</scr" + "ipt> 就在这里 */",
    "mermaid.min.js": "不该被用到——这块画板的 HTML 里根本没有引用它的占位标签",
  };
  const out = inject(raw, sources);
  assert.ok(out.includes("var React = 1"), "react 源码内联进去了");
  assert.ok(out.includes("var Babel = 1"), "babel 源码内联进去了");
  assert.ok(!out.includes("不该被用到"), "没有对应占位标签的库不会被塞进去");
  const closingTagCount = (out.match(/<\/script/gi) || []).length;
  assert.equal(closingTagCount, 2, `只应该有两个真正的闭合脚本标签（react 一个、babel 一个），藏在 babel 源码里那个假的应该被拆开、不计入这个数——实际数出 ${closingTagCount} 个`);
  assert.ok(out.includes("<\\/script> 就在这里"), "babel 源码里的关闭标签被拆成了转义形式，内容本身还在（没丢数据），只是不会被 HTML 解析器认成真的闭合标签");
});
