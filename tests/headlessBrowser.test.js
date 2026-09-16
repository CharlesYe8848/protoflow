import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBrowserExecutable } from "../core/headlessBrowser.js";

test("pickBrowserExecutable：按优先级顺序取第一个真的找到的候选——环境变量 > 系统已装 > 本地缓存，跳过没找到的（null）", () => {
  assert.deepEqual(
    pickBrowserExecutable([{ source: "env", path: "/env/chrome" }, { source: "system", path: "/sys/chrome" }]),
    { source: "env", path: "/env/chrome" },
    "env 排在前面，两个都找到时应该选 env"
  );
  assert.deepEqual(
    pickBrowserExecutable([null, { source: "system", path: "/sys/chrome" }, { source: "cache", path: "/cache/chrome" }]),
    { source: "system", path: "/sys/chrome" },
    "env 没找到（null）时应该跳过，选下一个真的找到的"
  );
  assert.deepEqual(
    pickBrowserExecutable([null, null, { source: "cache", path: "/cache/chrome" }]),
    { source: "cache", path: "/cache/chrome" },
    "前面全没找到时应该落到最后一个真的找到的候选"
  );
  assert.equal(pickBrowserExecutable([null, null, null]), null, "全没找到时应该返回 null，交给调用方去触发下载，不能瞎猜一个路径");
  assert.equal(pickBrowserExecutable([]), null, "空数组也应该安全返回 null");
});
