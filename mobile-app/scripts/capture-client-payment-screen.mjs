import path from 'node:path';
import { chromium } from 'playwright';

const OUT_DIR = process.env.CAPTURE_OUT_DIR ?? 'C:/Users/Danilo/Documents/testes app';
const APP_URL = process.env.CAPTURE_APP_URL ?? 'http://127.0.0.1:8081';
const FILE = '44-client-payment-method.png';

function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function clickAction(page,label){
  const roleButton = page.locator('[role="button"]').filter({ hasText: label });
  if(await roleButton.count()>0 && await roleButton.first().isVisible()){ await roleButton.first().click(); return true; }
  const textNode = page.getByText(label).first();
  if(await textNode.count()>0 && await textNode.isVisible()){ await textNode.click({force:true}); return true; }
  return false;
}

async function waitForNavReady(page){
  await page.waitForFunction(() => {
    const nav = window.__PERSONALAPP_NAV__;
    return Boolean(nav && typeof nav.isReady === 'function' && nav.isReady());
  }, undefined, { timeout: 30000 });
}

async function navigateGlobal(page, screen, params){
  await waitForNavReady(page);
  const ok = await page.evaluate(({screen,params})=>{
    const nav = window.__PERSONALAPP_NAV__;
    if(!nav || typeof nav.navigate !== 'function') return false;
    nav.navigate(screen, params);
    return true;
  }, {screen,params});
  if(!ok) throw new Error('navigation failed');
}

async function run(){
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width:390, height:844 } });
  await context.addInitScript(() => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('@personalapp/onboardingDone', '1');
    localStorage.removeItem('@personalapp/role');
    localStorage.removeItem('@personalapp/roleUserId');
    localStorage.removeItem('@personalapp/secure/accessToken');
    localStorage.removeItem('@personalapp/secure/refreshToken');
  });
  const page = await context.newPage();
  try{
    await page.goto(APP_URL, { waitUntil:'commit', timeout:300000 });
    await page.locator('input').first().waitFor({ timeout: 120000 });
    await page.locator('input').nth(0).fill('cliente@demo.com');
    await page.locator('input').nth(1).fill('12345678');
    await clickAction(page,'Entrar');

    // optional role selection
    const hasRole = await page.getByText(/Escolha seu perfil|Como você deseja usar o app/i).first()
      .waitFor({ timeout: 4000 }).then(()=>true).catch(()=>false);
    if(hasRole){
      const roleButtons = page.locator('[role="button"]').filter({ hasText: /Ver perfil|Selecionar/i });
      if(await roleButtons.count()>0){ await roleButtons.first().click(); }
      await page.getByText(/Escolher este perfil/i).first().waitFor({ timeout: 120000 });
      await clickAction(page,'Escolher este perfil');
    }

    await delay(1000);
    await navigateGlobal(page, 'ClientPaymentMethod');
    await page.getByText(/Cartao de pagamento|Cartão de pagamento/i).first().waitFor({ timeout: 120000 });
    await delay(300);
    await page.screenshot({ path: path.join(OUT_DIR, FILE), animations: 'disabled' });
    console.log(`saved ${path.join(OUT_DIR, FILE)}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((e)=>{ console.error(e); process.exitCode=1; });
