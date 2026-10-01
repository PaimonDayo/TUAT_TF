// Browser regression for image-bearing backdrops. Run with Node and Playwright
// installed, or point GLASS_PLAYWRIGHT_MODULE at an existing Playwright module.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const { chromium, webkit } = require(process.env.GLASS_PLAYWRIGHT_MODULE || 'playwright');
const bundle = readFileSync(resolve(__dirname, '../../public/vendor/liquid-glass/simple-liquid-glass.js'), 'utf8');
const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path fill="${color}" d="M0 0h40v40H0z"/></svg>`;

async function verify() {
  for (const [name, engine] of [['chrome', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch(name === 'chrome' ? { channel: 'chrome' } : {});
    try {
      for (const scenario of ['failed-first-image', 'failed-after-loading', 'distinct-queries']) {
        const failFetch = scenario !== 'distinct-queries';
        const afterLoading = scenario === 'failed-after-loading';
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.addInitScript(() => {
          const serialize = XMLSerializer.prototype.serializeToString;
          XMLSerializer.prototype.serializeToString = function (node) {
            const result = serialize.call(this, node);
            if (result.includes('foreignObject')) window.captureSVG = result;
            return result;
          };
        });
        await page.route('http://glass.test/**', async route => {
          const url = new URL(route.request().url());
          if (url.pathname === '/vendor.js') {
            return route.fulfill({ contentType: 'text/javascript', body: bundle });
          }
          if (url.pathname === '/avatar') {
            // An <img> can display successfully while the capture's fetch is
            // blocked (for example by CORS on an image-storage redirect).
            if (failFetch && route.request().resourceType() === 'fetch') return route.abort();
            return route.fulfill({ contentType: 'image/svg+xml',
              body: svg(url.searchParams.get('id') === 'red' ? 'red' : 'blue') });
          }
          return route.fulfill({ contentType: 'text/html', body: `
            <style>body{margin:0}.app-main{height:1400px;background:#eee}
            .row{position:absolute;top:770px;display:flex;gap:12px}
            img{width:40px;height:40px}
            liquid-glass{position:fixed!important;bottom:12px;left:16px;width:358px;height:68px}</style>
            <main class="app-main"><div class="row">${afterLoading ? 'Loading skeleton' :
              '<img src="/avatar?id=red"><img src="/avatar?id=blue"><span>Visible backdrop text</span>'}</div>
            <span data-system-glass-preview></span></main>
            <liquid-glass backdrop-selector=".app-main" renderer="webgl"></liquid-glass>
            <script src="/vendor.js"></script>` });
        });
        await page.goto('http://glass.test/');
        await page.waitForFunction(() => window.captureSVG && document.querySelector('liquid-glass')?.dataset.glassStrategy === 'webgl');
        if (afterLoading) {
          // A successful loading snapshot must be replaced even if a later
          // feed image cannot be fetched. Renderer status alone misses this.
          await page.evaluate(() => {
            document.querySelector('.row').innerHTML = '<img src="/avatar?id=red"><img src="/avatar?id=blue"><span>Visible backdrop text</span>';
          });
          await page.waitForFunction(() => window.captureSVG?.includes('Visible backdrop text'));
        }
        const result = await page.evaluate(() => ({
          images: [...document.querySelectorAll('img')].map(image => image.naturalWidth),
          svg: window.captureSVG,
        }));
        assert.deepEqual(result.images, [40, 40], 'original page images remain visible');
        assert.ok(result.svg.includes('Visible backdrop text'), 'surrounding backdrop is retained');
        if (!failFetch) {
          for (const color of ['red', 'blue']) {
            assert.ok(result.svg.includes(Buffer.from(svg(color)).toString('base64')),
              'query-distinguished avatars retain their own pixels');
          }
        }
        console.log(`${name}: ${scenario} passed`);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
