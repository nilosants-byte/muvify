const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ids = (process.env.CAPTURE_IDS || '02,03,04,05,06,07,10,11,14').split(',').map(s => s.trim()).filter(Boolean);
const outDir = process.env.CAPTURE_OUT_DIR || 'C:/Users/Danilo/Documents/testes app/_debug-stitch44';
const appUrl = process.env.CAPTURE_APP_URL || 'http://127.0.0.1:8081';

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  for (const id of ids) {
    await page.goto(`${appUrl}/?stitch44=${id}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector(`[data-testid="stitch44-screen-${id}"]`, { timeout: 120000 });
    await page.screenshot({ path: path.join(outDir, `${id}.png`), animations: 'disabled' });
  }
  await context.close();
  await browser.close();
  console.log('done', outDir);
})();
