import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { objectHash } from "./hash.js";

function byteHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function captureInputHash(buildDir, captures) {
  const artboardsDir = path.join(buildDir, "snapshot", "artboards");
  const artboards = [...new Set(captures.map((capture) => capture.artboardId))].sort().map((artboardId) => {
    const dir = path.join(artboardsDir, artboardId);
    const files = {};
    for (const name of ["source.jsx", "annotations.md"]) {
      const file = path.join(dir, name);
      files[name] = fs.existsSync(file) ? byteHash(fs.readFileSync(file)) : null;
    }
    const metaFile = path.join(dir, "meta.json");
    files["meta.json"] = fs.existsSync(metaFile)
      ? objectHash(JSON.parse(fs.readFileSync(metaFile, "utf8")))
      : null;
    return { artboardId, files };
  });
  return objectHash({ captures, artboards });
}

export function readInputManifest(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}
