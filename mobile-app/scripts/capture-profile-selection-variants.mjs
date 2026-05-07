import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT_DIR = "C:/Users/Danilo/Documents/testes app";
const APP_URL = "http://127.0.0.1:8081";

const FILES = {
  elegant: "07-auth-profile-selection-elegant.png",
  compact: "07-auth-profile-selection-compact.png"
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickAction(page, label) {
  const roleButton = page.locator('[role="button"]').filter({ hasText: label });
  if ((await roleButton.count()) > 0 && (await roleButton.first().isVisible())) {
    await roleButton.first().click();
    return true;
  }

  const textNode = page.getByText(label).first();
  if ((await textNode.count()) > 0 && (await textNode.isVisible())) {
    await textNode.click({ force: true });
    return true;
  }

  return false;
}

async function waitLogin(page) {
  await page.getByPlaceholder("você@email.com").waitFor({ timeout: 120000 });
}

async function loginToRoleSelection(page) {
  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "user-client-demo",
          name: "Cliente Demo",
          email: "cliente@demo.com",
          role: null
        },
        accessToken: "token-demo-access",
        refreshToken: "token-demo-refresh"
      })
    });
  });

  await waitLogin(page);
  await page.getByPlaceholder("você@email.com").fill("cliente@demo.com");
  await page.getByPlaceholder("Sua senha").fill("12345678");
  await clickAction(page, "Entrar");
  await page.getByText("Escolha seu perfil").first().waitFor({ timeout: 120000 });
}

async function captureVariant(browser, variant, outFile) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("@personalapp/onboardingDone", "1");
    localStorage.removeItem("@personalapp/role");
    localStorage.removeItem("@personalapp/roleUserId");
    localStorage.removeItem("@personalapp/secure/accessToken");
    localStorage.removeItem("@personalapp/secure/refreshToken");
  });

  const page = await context.newPage();

  try {
    await page.goto(`${APP_URL}?profileLayout=${variant}`, {
      waitUntil: "commit",
      timeout: 300000
    });

    await loginToRoleSelection(page);
    await delay(220);
    await page.screenshot({ path: path.join(OUT_DIR, outFile) });
  } finally {
    await context.close();
  }
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    await captureVariant(browser, "elegant", FILES.elegant);
    await captureVariant(browser, "compact", FILES.compact);
  } finally {
    await browser.close();
  }

  for (const fileName of Object.values(FILES)) {
    const fullPath = path.join(OUT_DIR, fileName);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Screenshot not generated: ${fullPath}`);
    }
  }

  console.log(`OK: variantes salvas em ${OUT_DIR}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
