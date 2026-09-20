import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCaptureMarkers, validateMarkers } from '../core/captureMarkers.js';
import { layoutMarkers } from '../core/markerLayout.js';
import { resolveBrowserExecutable } from '../core/headlessBrowser.js';
import { launch } from 'puppeteer-core';

test('marker schema rejects ambiguous numbering and malformed values', () => {
  const m = { elementId: 'target', number: 1, label: '校验评价' };
  assert.equal(validateMarkers(undefined), null);
  assert.equal(validateMarkers([m]), null);
  assert.equal(validateMarkers([{ ...m, placement: 'top-end', display: 'callout', offset: { x: 4, y: -2 } }]), null);
  for (const value of [null, {}, [null], [{ ...m, number: 0 }], [{ ...m, label: ' ' }], [m, m]]) assert.ok(validateMarkers(value));
  assert.match(validateMarkers([{ ...m, placement: 'middle' }]), /placement/);
  assert.match(validateMarkers([{ ...m, display: 'badge' }]), /display/);
  assert.match(validateMarkers([{ ...m, offset: { x: Infinity } }]), /offset.x/);
  assert.equal(validateMarkers([{ ...m, number: 999 }]), null);
  assert.match(validateMarkers([{ ...m, number: 1000 }]), /1–999/);
});

test('layout keeps nearby labels apart and honors model placement', () => {
  const viewport = { width: 500, height: 300 };
  const items = [
    { marker: { elementId: 'a', number: 1, label: '校验评价' }, target: { x: 120, y: 120, width: 100, height: 36 }, labelSize: { width: 130, height: 26 } },
    { marker: { elementId: 'b', number: 2, label: '评语润色' }, target: { x: 224, y: 120, width: 100, height: 36 }, labelSize: { width: 130, height: 26 } },
  ];
  const result = layoutMarkers({ viewport, items });
  assert.equal(result.legend, null);
  assert.equal(result.placements[0].placement, 'top-center');
  assert.notEqual(result.placements[1].placement, 'top-center');
  const [a, b] = result.placements.map((p) => p.labelRect);
  assert.equal(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y, false);

  items[0].marker = { ...items[0].marker, placement: 'bottom-end', display: 'callout', offset: { x: 3, y: 2 } };
  const explicit = layoutMarkers({ viewport, items: [items[0]] });
  assert.equal(explicit.placements[0].placement, 'bottom-end');
  assert.equal(explicit.placements[0].labelRect.x, 93);
  assert.equal(explicit.placements[0].labelRect.y, 162);
});

test('dense layouts fall back to numbered pins and an external legend', () => {
  const viewport = { width: 120, height: 80 };
  const item = { marker: { elementId: 'a', number: 1, label: '很长的标注文字' }, target: { x: 10, y: 10, width: 100, height: 60 }, labelSize: { width: 140, height: 26 } };
  const result = layoutMarkers({ viewport, items: [item] });
  assert.equal(result.placements[0].display, 'pin');
  assert.deepEqual(result.diagnostics, [{ number: 1, kind: 'legend-fallback' }]);
  assert.ok(result.legend);
  assert.ok(result.legend.rect.width <= viewport.width - 24);
  assert.ok(result.screenshotHeight > viewport.height);
  assert.throws(() => layoutMarkers({ viewport, items: [{ ...item, marker: { ...item.marker, display: 'callout' } }] }), /没有无碰撞位置/);

  const many = Array.from({ length: 5 }, (_, index) => ({
    marker: { elementId: `p${index}`, number: index + 1, label: `标记 ${index + 1}`, display: 'pin' },
    target: { x: 10 + index * 55, y: 40, width: 40, height: 40 },
    labelSize: { width: 60, height: 26 },
  }));
  const manyResult = layoutMarkers({ viewport: { width: 300, height: 140 }, items: many });
  const pins = manyResult.placements.map((placement) => placement.pinRect);
  for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
    assert.equal(pins[i].x < pins[j].x + pins[j].width && pins[i].x + pins[i].width > pins[j].x
      && pins[i].y < pins[j].y + pins[j].height && pins[i].y + pins[i].height > pins[j].y, false);
  }
  for (let i = 0; i < pins.length; i++) for (let j = 0; j < many.length; j++) {
    if (i === j) continue;
    const target = many[j].target;
    assert.equal(pins[i].x < target.x + target.width && pins[i].x + pins[i].width > target.x
      && pins[i].y < target.y + target.height && pins[i].y + pins[i].height > target.y, false);
  }
  assert.ok(manyResult.legend.rect.y + manyResult.legend.rect.height <= manyResult.screenshotHeight);
  assert.throws(() => layoutMarkers({
    viewport: { width: 100, height: 100 },
    items: [
      { marker: { elementId: 'blocked', number: 1, label: '无位置', display: 'pin' }, target: { x: 0, y: 0, width: 20, height: 20 }, labelSize: { width: 50, height: 26 } },
      { marker: { elementId: 'cover', number: 2, label: '覆盖全屏', display: 'pin' }, target: { x: 0, y: 0, width: 100, height: 100 }, labelSize: { width: 60, height: 26 } },
    ],
  }), /没有无碰撞的编号位置/);
});

test('markers follow final DOM state, escape labels, and reject hidden/clipped/covered targets', async () => {
  const executable = await resolveBrowserExecutable();
  const browser = await launch({ executablePath: executable.path, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 600, height: 400 });
    await page.setContent('<button onclick="document.getElementById(\'target\').style.display=\'block\'">打开</button><div id="target" style="display:none;margin:50px;width:150px;height:60px">结果</div>');
    const markers = [{ elementId: 'target', number: 2, label: '<b>结果</b>' }];
    await assert.rejects(applyCaptureMarkers(page, markers), /不可见/);
    await page.click('button');
    await applyCaptureMarkers(page, markers);
    const state = await page.evaluate(() => {
      const root = document.querySelector('[data-protoflow-capture-markers]').shadowRoot;
      return { text: root.lastChild.textContent, html: root.querySelector('b'), left: root.firstChild.getBoundingClientRect().left, targetLeft: document.getElementById('target').getBoundingClientRect().left };
    });
    assert.equal(state.text, '2 · <b>结果</b>');
    assert.equal(state.html, null);
    assert.equal(state.left, state.targetLeft);
    await page.setContent('<dialog><div id="target" style="width:100px;height:60px;pointer-events:none">结果</div></dialog>');
    await page.evaluate(() => document.querySelector('dialog').showModal());
    await applyCaptureMarkers(page, markers);
    assert.equal(await page.evaluate(() => document.querySelector('[data-protoflow-capture-markers]').matches(':popover-open')), true);
    assert.equal(await page.$eval('#target', el => el.style.pointerEvents), 'none');

    await page.setViewport({ width: 120, height: 80 });
    await page.setContent('<div id="target" style="margin:10px;width:100px;height:60px">结果</div>');
    const dense = await applyCaptureMarkers(page, [{ elementId: 'target', number: 7, label: '这个标签在窄画布里放不下' }]);
    assert.equal(dense.placements[0].display, 'pin');
    assert.ok(dense.screenshotHeight > 80);
    assert.equal(await page.evaluate(() => document.querySelector('[data-protoflow-capture-markers]').shadowRoot.textContent.includes('这个标签在窄画布里放不下')), true);
    const legendBottom = await page.evaluate(() => {
      const children = document.querySelector('[data-protoflow-capture-markers]').shadowRoot.children;
      const rect = children[children.length - 1].getBoundingClientRect();
      return rect.bottom;
    });
    assert.ok(legendBottom <= dense.screenshotHeight);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 120, height: dense.screenshotHeight }, captureBeyondViewport: true });
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

    await page.setContent('<div id="target" style="margin:10px;width:100px;height:60px">结果</div>');
    await applyCaptureMarkers(page, [{ elementId: 'target', number: 999, label: '三位编号' , display: 'pin' }]);
    const badgeSizing = await page.evaluate(() => {
      const root = document.querySelector('[data-protoflow-capture-markers]').shadowRoot;
      const badges = [...root.querySelectorAll('div,span')].filter((el) => el.textContent === '999');
      return badges.map((el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
    });
    assert.equal(badgeSizing.length, 2);
    assert.ok(badgeSizing.every(({ clientWidth, scrollWidth }) => clientWidth >= scrollWidth));

    await page.setViewport({ width: 600, height: 400 });
    for (const [html, message] of [
      ['<div id="target"></div><div id="target"></div>', /唯一/],
      ['<div style="overflow:hidden;width:20px"><div id="target" style="width:100px;height:30px">X</div></div>', /裁切/],
      ['<div id="target" style="width:100px;height:30px">X</div><div style="position:fixed;inset:0">遮罩</div>', /遮挡/],
    ]) {
      await page.setContent(html);
      await assert.rejects(applyCaptureMarkers(page, markers), message);
    }
  } finally { await browser.close(); }
});
