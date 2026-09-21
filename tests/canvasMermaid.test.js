import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from 'puppeteer-core';
import { buildCanvasHtml } from '../core/canvas.js';
import { buildPreviewHtml, copyPreviewLibs } from '../core/preview.js';
import { resolveBrowserExecutable } from '../core/headlessBrowser.js';

test('Mermaid on an inactive canvas page renders and survives page switches without reload', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-canvas-mermaid-'));
  let browser;
  try {
    copyPreviewLibs(path.join(dir, 'lib'));
    const pages = [
      { id: 'pg_home', name: 'Home', artboards: [] },
      { id: 'pg_diagram', name: 'Diagram', artboards: [{ id: 'ab_sequence', name: 'Sequence', hasSource: true, canvasWidth: 800 }] },
    ];
    const previewDir = path.join(dir, 'pages/pg_diagram/artboards/ab_sequence');
    fs.mkdirSync(previewDir, { recursive: true });
    fs.writeFileSync(path.join(previewDir, 'preview.html'), buildPreviewHtml({
      artboardId: 'ab_sequence', libRelPath: '../../../../lib',
      source: `function Component(){
        const [count, setCount] = React.useState(0);
        React.useEffect(() => {
          window.mermaid.run().catch(e => { window.renderError = e.message || e.str; }).finally(() => { window.renderDone = true; });
        }, []);
        return <div><button id="counter" onClick={() => setCount(count + 1)}>{count}</button>
          <pre className="mermaid">{'sequenceDiagram\\n Alice->>Bob: Hello\\n Bob-->>Alice: OK'}</pre></div>;
      }`,
    }));
    fs.writeFileSync(path.join(dir, 'canvas.html'), buildCanvasHtml({ projectName: 'Regression', pages, docs: [] }));
    browser = await launch({ executablePath: (await resolveBrowserExecutable()).path, headless: true });
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(dir, 'canvas.html')).href);
    const frame = page.frames().find(f => f.url().endsWith('/preview.html'));
    assert.ok(frame);
    await frame.waitForFunction(() => window.renderDone);
    assert.equal(await page.$eval('[data-page="pg_diagram"].pf-page-canvas', el => el.hidden), true);
    assert.equal(await frame.evaluate(() => window.renderError), undefined, 'hidden-page SVG must stay in the render tree');
    for (let i = 0; i < 3; i++) {
      await page.click('.pf-page-item[data-page="pg_diagram"]');
      await page.waitForSelector('.pf-page-canvas[data-page="pg_diagram"]:not(.pf-loading):not([hidden])');
      await frame.waitForSelector('#counter', { visible: true });
      assert.equal(await frame.$eval('.mermaid', el => el.textContent.includes('Syntax error')), false);
      assert.ok(await frame.$eval('.mermaid svg', el => el.getBBox().width > 0));
      await frame.click('#counter');
      assert.equal(await frame.$eval('#counter', el => el.textContent), String(i + 1), 'switching must preserve component state');
      await page.click('.pf-page-item[data-page="pg_home"]');
    }
  } finally {
    if (browser) await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('switching to a page with a saved viewport refreshes iframe height without resetting zoom or state', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-canvas-height-'));
  let browser;
  try {
    copyPreviewLibs(path.join(dir, 'lib'));
    const previewDir = path.join(dir, 'pages/pg_mobile/artboards/ab_mobile');
    fs.mkdirSync(previewDir, { recursive: true });
    fs.writeFileSync(path.join(previewDir, 'preview.html'), buildPreviewHtml({
      artboardId: 'ab_mobile', libRelPath: '../../../../lib',
      source: `function Component(){const [n,setN]=React.useState(0);return <div style={{height:900+n*100}}><button id="count" onClick={()=>setN(n+1)}>{n}</button><div style={{marginTop:800}}>Bottom</div></div>}`,
    }));
    fs.writeFileSync(path.join(dir, 'canvas.html'), buildCanvasHtml({
      projectName: 'Saved viewport', docs: [],
      pages: [{ id: 'pg_home', name: 'Home', artboards: [] }, { id: 'pg_mobile', name: 'Mobile', artboards: [{ id: 'ab_mobile', name: 'Mobile', hasSource: true, canvasWidth: 375 }] }],
      exportBundle: { canvasState: { activePage: 'pg_home', pages: { pg_mobile: { scale: 0.7, x: 80, y: 40 } } } },
    }));
    browser = await launch({ executablePath: (await resolveBrowserExecutable()).path, headless: true });
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(dir, 'canvas.html')).href);
    const frame = page.frames().find(f => f.url().endsWith('/preview.html'));
    await frame.waitForSelector('#count');
    // All initial load reports have occurred while the page is inactive.
    await new Promise(resolve => setTimeout(resolve, 1200));
    const transform = await page.$eval('[data-page="pg_mobile"] .pf-canvas', el => el.style.transform);
    await page.click('.pf-page-item[data-page="pg_mobile"]');
    await page.waitForFunction(() => document.querySelector('iframe').clientHeight >= 900, { timeout: 2000 });
    assert.equal(await page.$eval('[data-page="pg_mobile"] .pf-canvas', el => el.style.transform), transform);
    await frame.click('#count');
    await page.waitForFunction(() => document.querySelector('iframe').clientHeight >= 1000);
    await page.click('.pf-page-item[data-page="pg_home"]');
    await frame.evaluate(() => document.querySelector('#count').click());
    await new Promise(resolve => setTimeout(resolve, 100));
    await page.click('.pf-page-item[data-page="pg_mobile"]');
    await page.waitForFunction(() => document.querySelector('iframe').clientHeight >= 1100, { timeout: 2000 });
    assert.equal(await frame.$eval('#count', el => el.textContent), '2');
    assert.equal(await page.$eval('[data-page="pg_mobile"] .pf-canvas', el => el.style.transform), transform);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
