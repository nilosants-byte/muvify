const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8081/?stitch44=02', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('[data-testid="stitch44-screen-02"]', { timeout: 120000 });
  await page.screenshot({ path: 'C:/Users/Danilo/Documents/testes app/_debug-02.png', animations: 'disabled' });
  await context.close();
  await browser.close();
  console.log('ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
