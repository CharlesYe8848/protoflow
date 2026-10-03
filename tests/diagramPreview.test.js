import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { launch } from "puppeteer-core";
import { renderDiagramPreviewHtml } from "../products/diagram/preview.js";
import { diagramLibs } from "../products/diagram/libs.js";
import { resolveBrowserExecutable } from "../skills/protoflow-product-dev/scripts/lib/headlessBrowser.js";

const MIND = "# 会员体系\n\n## 等级\n- 普通会员\n- 金卡\n\n## 积分\n- 获取\n- 消耗\n  - 抵现\n  - 兑换\n";
const FLOW = "flowchart TD\n  start([开始]) --> vip[计算会员价]\n  vip --> points{使用积分抵现？}\n  points --> submit[提交订单]\n";
const page = (id, name, file, kind, source) => ({ id, name, file, kind, source });

function versions() {
  return [
    { n: 1, note: "初稿", builtAt: "2026-09-24T10:00:00Z", pages: [page("mind", "脑图", "mind.md", "markmap", MIND)] },
    { n: 2, note: "加流程", builtAt: "2026-09-25T10:00:00Z", pages: [
      page("mind", "脑图", "mind.md", "markmap", MIND),
      page("flow", "下单流程", "flow.mmd", "mermaid", FLOW),
      page("broken", "写错的", "broken.mmd", "mermaid", "flowchart TD\n  a -->\n"),
    ] },
  ];
}

async function withPage(fn) {
  const libs = diagramLibs();
  const server = http.createServer((req, res) => {
    const lib = /^\/lib\/(.+)$/.exec(req.url);
    if (lib && libs[lib[1]]) { res.setHeader("Content-Type", "application/javascript"); res.end(fs.readFileSync(libs[lib[1]]())); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const standalone = req.url.startsWith("/standalone");
    res.end(renderDiagramPreviewHtml({ versions: versions(), head: 2, title: "会员体系梳理", diagramId: "member", libRelPath: "/lib", standalone }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await launch({ executablePath: (await resolveBrowserExecutable()).path, headless: true });
    const p = await browser.newPage();
    await p.setViewport({ width: 1200, height: 760 });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await fn(p, base, errors);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

const ready = (p) => p.waitForFunction(() => window.__pfDiagram && window.__pfDiagram.ready, { timeout: 15000 });
const sel = (p) => p.evaluate(() => window.__pfDiagram.selection.map((i) => i.label));
// 节点文字的中心（脑图的节点末端有折叠圆圈，点文字那一侧）。
const nodeCenter = (p, text) => p.evaluate((text) => {
  const el = [...document.querySelectorAll("g.markmap-node, g.node")].find((n) => n.textContent.trim().replace(/\s+/g, " ") === text);
  if (!el) throw new Error("找不到节点 " + text);
  const r = (el.querySelector("foreignObject") || el).getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, text);

test("绘图阅读页：脑图、流程图的点选 / 多选 / 框选、右键标注复制给 agent、版本和页记在地址里", { timeout: 60000 }, async () => {
  await withPage(async (p, base, errors) => {
    await p.goto(`${base}/p/demo/diagrams/member/preview.html`);
    await p.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } }));
    await ready(p);
    assert.deepEqual(await p.$$eval(".pf-dg-tab", (els) => els.map((e) => e.textContent)), ["脑图", "下单流程", "写错的"]);
    assert.ok(await p.$$eval("g.markmap-node", (els) => els.length) >= 8);

    // 点选、⌘ 加选、点空白取消
    let pt = await nodeCenter(p, "消耗");
    await p.mouse.click(pt.x, pt.y);
    assert.deepEqual(await sel(p), ["消耗"]);
    const other = await nodeCenter(p, "抵现");
    await p.keyboard.down("Meta"); await p.mouse.click(other.x, other.y); await p.keyboard.up("Meta");
    assert.deepEqual((await sel(p)).sort(), ["抵现", "消耗"]);
    await p.mouse.click(1100, 120);
    assert.deepEqual(await sel(p), []);

    // 框选：拖一个框罩住「积分」下面的节点
    const a = await nodeCenter(p, "获取"), b = await nodeCenter(p, "兑换");
    await p.mouse.move(a.x - 30, a.y - 20); await p.mouse.down(); await p.mouse.move(b.x + 40, b.y + 20, { steps: 6 }); await p.mouse.up();
    assert.deepEqual((await sel(p)).sort(), ["兑换", "抵现", "消耗", "获取"]);
    await p.keyboard.press("Escape");
    assert.deepEqual(await sel(p), []);

    // 右键标注：没选中的节点右键先选中它；复制的文本是统一头部 + 节点路径和行号
    pt = await nodeCenter(p, "消耗");
    await p.mouse.click(pt.x, pt.y, { button: "right" });
    await p.click('[data-action="annotate"]');
    await p.type(".pf-note__input", "拆成抵现和兑换两支");
    await p.click(".pf-note__copy");
    const copied = await p.evaluate(() => window.__copied);
    for (const expected of ["拆成抵现和兑换两支", "[Protoflow 标注]", "project: demo", "kind: diagram",
      "source: diagrams/member/pages/mind.md", "version: v2 (head)", "page: 脑图 (mind) · 脑图",
      "path: 会员体系 > 积分 > 消耗   lines: 9-11"]) {
      assert.ok(copied.includes(expected), `复制内容缺少 ${expected}\n${copied}`);
    }
    await p.keyboard.press("Escape");

    // 流程图：节点 id 来自源码，按 id 找到定义那一行
    await p.$$eval(".pf-dg-tab", (tabs) => tabs.find((t) => t.textContent === "下单流程").click());
    await ready(p);
    assert.equal(new URL(p.url()).search, "?page=flow");
    const vip = await nodeCenter(p, "计算会员价");
    await p.mouse.click(vip.x, vip.y, { button: "right" });
    await p.click('[data-action="annotate"]');
    assert.equal(await p.$eval(".pf-note__input", (el) => el.value), "", "换了标注对象，上次写的意见清空");
    await p.click(".pf-note__copy");
    assert.ok((await p.evaluate(() => window.__copied)).includes("id: vip  label: 计算会员价   lines: 2"));
    await p.keyboard.press("Escape");

    // 图 / 源码
    await p.click('.pf-toggle-btn[data-view="source"]');
    assert.equal(await p.$eval("#pfSource", (el) => el.hidden), false);
    assert.ok((await p.$eval("#pfSource", (el) => el.textContent)).includes("vip[计算会员价]"));
    await p.click('.pf-toggle-btn[data-view="diagram"]');

    // 缩放：⌘/Ctrl + 滚轮缩放，普通滚轮平移不缩放
    const z = await p.$eval("#pfView", (el) => {
      const before = window.__pfDiagram.zoom;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true }));
      const afterPan = window.__pfDiagram.zoom;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: -20, ctrlKey: true, bubbles: true, cancelable: true, clientX: 400, clientY: 300 }));
      return { before, afterPan, afterZoom: window.__pfDiagram.zoom };
    });
    assert.equal(z.afterPan, z.before);
    assert.ok(z.afterZoom > z.before);

    // 写错的 Mermaid 明确显示渲染失败
    await p.$$eval(".pf-dg-tab", (tabs) => tabs.find((t) => t.textContent === "写错的").click());
    await ready(p);
    assert.equal(await p.$eval("#pfError", (el) => el.hidden), false);
    assert.ok((await p.$eval("#pfError", (el) => el.textContent)).includes("pages/broken.mmd"));

    // 历史版本：地址记下 ?v=1，标注标成 historical
    await p.click(".pf-vsel-btn");
    await p.$$eval(".pf-vsel-item", (items) => items.find((x) => x.textContent.includes("初稿")).click());
    await ready(p);
    assert.equal(new URL(p.url()).search, "?v=1&page=mind");
    assert.deepEqual(await p.$$eval(".pf-dg-tab", (els) => els.map((e) => e.textContent)), ["脑图"]);
    pt = await nodeCenter(p, "金卡");
    await p.mouse.click(pt.x, pt.y, { button: "right" });
    await p.click('[data-action="annotate"]'); await p.click(".pf-note__copy");
    assert.ok((await p.evaluate(() => window.__copied)).includes("version: v1 (historical)"));

    // 刷新后停在原来的版本和页
    await p.reload(); await ready(p);
    assert.deepEqual(await p.evaluate(() => [window.__pfDiagram.version, window.__pfDiagram.page]), [1, "mind"]);
    assert.deepEqual(errors, []);
  });
});

const SEQ = "sequenceDiagram\n  actor HR\n  actor BIZ as 业务部门\n  participant SYS as 招聘系统\n  HR->>SYS: 推荐简历\n  SYS-->>BIZ: 待反馈<br/>通知\n  Note right of SYS: 默认提交后不可改\n  loop 每天\n    BIZ->>SYS: 提交反馈\n  end\n";
const EDGES = "flowchart LR\n  cart[购物车] -->|去结算| pay_now[支付]\n  pay_now --> done[完成]\n";

async function withPages(pages, fn) {
  const libs = diagramLibs();
  const server = http.createServer((req, res) => {
    const lib = /^\/lib\/(.+)$/.exec(req.url);
    if (lib && libs[lib[1]]) { res.setHeader("Content-Type", "application/javascript"); res.end(fs.readFileSync(libs[lib[1]]())); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(renderDiagramPreviewHtml({ versions: [{ n: 1, pages }], head: 1, title: "t", diagramId: "d", libRelPath: "/lib" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await launch({ executablePath: (await resolveBrowserExecutable()).path, headless: true });
    const p = await browser.newPage();
    await p.setViewport({ width: 1200, height: 760 });
    await p.goto(`http://127.0.0.1:${server.address().port}/p/demo/diagrams/d/preview.html`);
    await ready(p);
    await fn(p);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
const selectAllByMarquee = async (p) => {
  await p.mouse.move(24, 60); await p.mouse.down(); await p.mouse.move(1170, 690, { steps: 6 }); await p.mouse.up();
  return p.evaluate(() => window.__pfDiagram.selection);
};

test("绘图阅读页：框选整张图就是全选——时序图的小人、方框、消息（文字 + 箭头）、备注、分组都算，生命线不算", { timeout: 30000 }, async () => {
  await withPages([page("s", "场景", "s.mmd", "mermaid", SEQ)], async (p) => {
    const labels = (await selectAllByMarquee(p)).map((i) => i.label).sort();
    assert.deepEqual(labels, ["HR", "loop [每天]", "业务部门", "待反馈 通知", "推荐简历", "提交反馈", "招聘系统", "默认提交后不可改"].sort());
    // 箭头只有 1px：点在箭头线上也能选中这条消息
    const onArrow = await p.evaluate(() => {
      const line = document.querySelector("#pfStage line[class^='messageLine']");
      const r = line.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 + 2 };
    });
    await p.mouse.click(onArrow.x, onArrow.y);
    assert.deepEqual(await sel(p), ["推荐简历"]);
    // 参与者上下两处是同一个对象
    const bottomActor = await p.evaluate(() => { const r = document.querySelector("#pfStage rect.actor-bottom").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await p.mouse.click(bottomActor.x, bottomActor.y);
    assert.deepEqual(await sel(p), ["招聘系统"]);
    assert.equal(await p.$$eval("#pfSel div", (els) => els.length), 2, "上下两个框都亮");
  });
});

test("绘图阅读页：流程图的连线能选中，复制时写出起止节点和源码行", { timeout: 30000 }, async () => {
  await withPages([page("f", "流程", "f.mmd", "mermaid", EDGES)], async (p) => {
    const infos = await selectAllByMarquee(p);
    assert.deepEqual(infos.map((i) => i.label).sort(), ["cart → pay_now（去结算）", "pay_now → done", "购物车", "支付", "完成"].sort());
    const edge = infos.find((i) => i.label.startsWith("cart"));
    assert.deepEqual([edge.match, edge.lines], ["id", [2, 2]]);
    assert.deepEqual(infos.find((i) => i.label === "pay_now → done").lines, [3, 3]);
  });
});

test("绘图导出页：不接管右键、没有标注和分享", { timeout: 30000 }, async () => {
  await withPage(async (p, base) => {
    await p.goto(`${base}/standalone`);
    await ready(p);
    const prevented = await p.$eval("#pfView", (el) => {
      const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented;
    });
    assert.equal(prevented, false);
    assert.equal(await p.evaluate(() => typeof window.__pfNote), "undefined");
    assert.equal(await p.$(".pf-export-entry"), null);
  });
});
