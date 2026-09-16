import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateChain } from "../core/chain.js";

// 全绿：一个画板已校验、标注新鲜；一个文档 head=v1，doc.md 与 v1 一致，v1 引用画板 h1、已发布。
const GREEN = {
  artboards: [{ id: "ab_1", name: "列表页", sourceHash: "h1", lastValidatedHash: "h1", elementIds: ["btn"], hasAnnotations: true, annotationRefElementIds: ["btn"], annotationsValidatedHash: "h1" }],
  docs: [{
    id: "prd", kind: "prd", origin: null, head: 1, workingMdHash: "m1",
    versions: [{ n: 1, mdHash: "m1", docHash: "d1", sourceFingerprints: { ab_1: "h1" }, publishedTo: [{ channel: "dingtalk", channelDocId: "doc1" }] }],
  }],
};

function clone() { return structuredClone(GREEN); }
function codes(snap) { return evaluateChain(snap).map((f) => f.code); }

test("全绿场景无发现项", () => assert.deepEqual(codes(clone()), []));

test("unvalidated：当前 hash ≠ lastValidatedHash", () => {
  const s = clone(); s.artboards[0].sourceHash = "h2"; s.artboards[0].annotationsValidatedHash = "h2"; s.docs = [];
  assert.deepEqual(codes(s), ["unvalidated"]);
});

test("annotation_review：源码变了但引用的元素还在", () => {
  const s = clone(); s.artboards[0].sourceHash = "h2"; s.artboards[0].lastValidatedHash = "h2"; s.docs = [];
  assert.deepEqual(codes(s), ["annotation_review"]);
});

test("annotation_broken：引用的元素消失（优先于 review）", () => {
  const s = clone(); s.artboards[0].sourceHash = "h2"; s.artboards[0].lastValidatedHash = "h2"; s.artboards[0].elementIds = []; s.artboards[0].annotationRefElementIds = ["btn"]; s.docs = [];
  assert.deepEqual(codes(s), ["annotation_broken"]);
});

test("doc_uncommitted：草稿从未定版", () => {
  const s = clone(); s.docs[0].head = 0; s.docs[0].versions = [];
  assert.deepEqual(codes(s), ["doc_uncommitted"]);
});

test("doc_uncommitted：doc.md 有未定版的改动", () => {
  const s = clone(); s.docs[0].workingMdHash = "m2"; s.docs[0].versions[0].publishedTo = [];
  assert.deepEqual(codes(s), ["doc_uncommitted"]);
});

test("doc_drifted：head 版本引用的画板漂移", () => {
  const s = clone(); s.artboards[0].sourceHash = "h2"; s.artboards[0].lastValidatedHash = "h2"; s.artboards[0].hasAnnotations = false; s.docs[0].versions[0].publishedTo = [];
  assert.deepEqual(codes(s).sort(), ["doc_drifted"]);
});

test("doc_broken：引用画板已删除", () => {
  const s = clone(); s.artboards = []; s.docs[0].versions[0].publishedTo = []; s.docs[0].workingMdHash = "m1";
  assert.deepEqual(codes(s), ["doc_broken"]);
});

test("publish_lagging：已发布版本引用的画板漂移", () => {
  const s = clone(); s.artboards[0].sourceHash = "h2"; s.artboards[0].lastValidatedHash = "h2"; s.artboards[0].hasAnnotations = false;
  assert.deepEqual(codes(s).sort(), ["doc_drifted", "publish_lagging"]);
});

test("origin_stale：派生文档的上游出了新版本", () => {
  const s = clone();
  s.docs.push({ id: "release-note", kind: "release-note", origin: [{ docId: "prd", version: 1 }], head: 1, workingMdHash: "rm1", versions: [{ n: 1, mdHash: "rm1", docHash: "rd1", sourceFingerprints: {}, publishedTo: [] }] });
  s.docs[0].head = 3; s.docs[0].versions.push({ n: 2, mdHash: "m2", docHash: "d2", sourceFingerprints: { ab_1: "h1" }, publishedTo: [] }, { n: 3, mdHash: "m3", docHash: "d3", sourceFingerprints: { ab_1: "h1" }, publishedTo: [] });
  s.docs[0].workingMdHash = "m3";
  assert.ok(codes(s).includes("origin_stale"));
});

test("发现项按严重度排序且带 suggestedAction", () => {
  const s = clone(); s.artboards[0].sourceHash = "h2"; s.docs[0].workingMdHash = "m9";
  const fs = evaluateChain(s);
  assert.ok(fs.every((f) => f.level && f.target && f.reason && f.suggestedAction));
  const order = ["broken", "unvalidated", "review", "uncommitted", "drifted", "lagging"];
  const levels = fs.map((f) => f.level);
  assert.deepEqual([...levels].sort((a, b) => order.indexOf(a) - order.indexOf(b)), levels);
});
