import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("@personalapp/onboardingDone", "1");
  localStorage.removeItem("@personalapp/role");
  localStorage.removeItem("@personalapp/roleUserId");
});
const page = await context.newPage();

async function clickAction(label) {
  const roleButton = page.locator('[role="button"]').filter({ hasText: label });
  if ((await roleButton.count()) > 0) {
    await roleButton.first().click();
    return;
  }
  const text = page.getByText(label).first();
  if ((await text.count()) > 0) {
    await text.click();
  }
}

await page.goto("http://127.0.0.1:8081", { waitUntil: "domcontentloaded", timeout: 180000 });
await page.getByPlaceholder("você@email.com").waitFor({ timeout: 120000 });
await page.getByPlaceholder("você@email.com").fill("cliente@demo.com");
await page.getByPlaceholder("Sua senha").fill("12345678");
await clickAction("Entrar");
await page.getByText("Escolha seu perfil").first().waitFor({ timeout: 120000 });
await clickAction("Ver vantagens");
await clickAction("Escolher este perfil");
await page.getByText("Início").waitFor({ timeout: 120000 });

const data = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("[role='button']")).map((el, idx) => ({
    idx,
    text: (el.textContent || "").trim(),
    ariaLabel: el.getAttribute("aria-label"),
    title: el.getAttribute("title"),
    className: el.className
  }));
});
console.log(JSON.stringify(data, null, 2));

await browser.close();



