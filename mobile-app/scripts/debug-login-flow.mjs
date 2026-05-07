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
page.on("console", (msg) => console.log("console:", msg.type(), msg.text()));
page.on("pageerror", (err) => {
  console.log("pageerror:", err.message);
  console.log(err.stack ?? "no-stack");
});
page.on("response", async (res) => {
  if (res.url().includes("/api/")) {
    console.log("api:", res.status(), res.url());
    if (!res.ok()) {
      try {
        console.log("api-error-body:", await res.text());
      } catch {
        // ignore
      }
    }
  }
});
page.on("requestfailed", (req) => {
  if (req.url().includes("/api/")) {
    console.log("requestfailed:", req.url(), req.failure()?.errorText);
  }
});

await page.goto("http://127.0.0.1:8081", { waitUntil: "domcontentloaded", timeout: 180000 });
await page.getByPlaceholder("você@email.com").waitFor({ timeout: 120000 });
await page.getByPlaceholder("você@email.com").fill("cliente@demo.com");
await page.getByPlaceholder("Sua senha").fill("12345678");

const loginButtons = page.locator('[role="button"]').filter({ hasText: "Entrar" });
console.log("loginButtons count:", await loginButtons.count());
if ((await loginButtons.count()) > 0) {
  await loginButtons.first().click();
}

await page.waitForTimeout(10000);
await page.screenshot({ path: "C:\\Users\\Danilo\\Documents\\testes app\\debug-login-result.png" });
const bodyText = await page.locator("body").innerText();
console.log("BODY_TEXT_START");
console.log(bodyText.slice(0, 3000));
console.log("BODY_TEXT_END");

await browser.close();

