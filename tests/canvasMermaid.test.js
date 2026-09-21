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
