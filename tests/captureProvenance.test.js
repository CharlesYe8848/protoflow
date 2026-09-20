import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureInputHash } from "../core/captureProvenance.js";

test("capture input hash preserves visual whitespace in source and annotations", () => {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-capture-hash-"));
  const artboardDir = path.join(buildDir, "snapshot", "artboards", "ab_1");
  fs.mkdirSync(artboardDir, { recursive: true });
  fs.writeFileSync(path.join(artboardDir, "source.jsx"), "const text = `line  `;\n");
  fs.writeFileSync(path.join(artboardDir, "annotations.md"), "说明  \n下一行\n");
  fs.writeFileSync(path.join(artboardDir, "meta.json"), '{"b":2,"a":1}\n');
  const captures = [{ id: "cap", artboardId: "ab_1" }];
  const initial = captureInputHash(buildDir, captures);

  fs.writeFileSync(path.join(artboardDir, "source.jsx"), "const text = `line`;\n");
  assert.notEqual(captureInputHash(buildDir, captures), initial);
  fs.writeFileSync(path.join(artboardDir, "source.jsx"), "const text = `line  `;\n");
  fs.writeFileSync(path.join(artboardDir, "annotations.md"), "说明\n下一行\n");
  assert.notEqual(captureInputHash(buildDir, captures), initial);

  fs.writeFileSync(path.join(artboardDir, "annotations.md"), "说明  \n下一行\n");
  fs.writeFileSync(path.join(artboardDir, "meta.json"), '{\n  "a": 1,\n  "b": 2\n}\n');
  assert.equal(captureInputHash(buildDir, captures), initial);
});
