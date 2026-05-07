import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = "C:\\Users\\Danilo\\Documents\\testes app";

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
    await textNode.click();
    return true;
  }

  return false;
}

async function openMenu(page) {
  const menuByLabel = page.locator("[aria-label='Abrir menu']");
  if ((await menuByLabel.count()) > 0 && (await menuByLabel.first().isVisible())) {
    await menuByLabel.first().click();
    await delay(420);
    return;
  }

  const buttons = page.locator('[role="button"]');
  if ((await buttons.count()) > 0) {
    await buttons.first().click();
    await delay(420);
  }
}

async function run() {
  fs.mkdirSync(outDir, { recursive: true });
  console.log("step: launch browser");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }
  });

  await context.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("@personalapp/onboardingDone", "1");
      localStorage.removeItem("@personalapp/role");
      localStorage.removeItem("@personalapp/roleUserId");
    } catch {
      // ignore
    }
  });

  const page = await context.newPage();
  await page.goto("http://127.0.0.1:8081", {
    waitUntil: "domcontentloaded",
    timeout: 180000
  });

  await page.locator('[data-testid="auth-splash-logo"]').first().waitFor({ timeout: 120000 });
  await delay(500);
  await page.screenshot({ path: path.join(outDir, "01-splash.png") });

  await page.getByPlaceholder("você@email.com").waitFor({ timeout: 120000 });
  await page.screenshot({ path: path.join(outDir, "02-login.png") });

  await page.getByPlaceholder("você@email.com").fill("cliente@demo.com");
  await page.getByPlaceholder("Sua senha").fill("12345678");
  await clickAction(page, "Entrar");

  await page.getByText("Escolha seu perfil").first().waitFor({ timeout: 120000 });
  await page.screenshot({ path: path.join(outDir, "03-role-selection.png") });

  await clickAction(page, "Ver vantagens");
  await page.getByText("Escolher este perfil").first().waitFor({ timeout: 120000 });
  await delay(450);
  await page.screenshot({ path: path.join(outDir, "04-role-summary-modal.png") });
  await clickAction(page, "Escolher este perfil");

  await page.getByText("Início").waitFor({ timeout: 120000 });
  await delay(900);
  await page.screenshot({ path: path.join(outDir, "05-client-home.png") });

  await openMenu(page);
  await page.getByText("Menu").first().waitFor({ timeout: 120000 });
  await page.screenshot({ path: path.join(outDir, "06-client-menu.png") });

  await clickAction(page, "Sair");
  await page.getByPlaceholder("você@email.com").waitFor({ timeout: 120000 });
  await page.getByPlaceholder("você@email.com").fill("pro@demo.com");
  await page.getByPlaceholder("Sua senha").fill("12345678");
  await clickAction(page, "Entrar");

  await page.getByText("Escolha seu perfil").first().waitFor({ timeout: 120000 });
  const roleButtons = page.locator('[role="button"]').filter({ hasText: "Ver vantagens" });
  if ((await roleButtons.count()) > 1) {
    await roleButtons.nth(1).click();
  } else {
    await clickAction(page, "Ver vantagens");
  }
  await clickAction(page, "Escolher este perfil");

  await page.getByText("Painel").waitFor({ timeout: 120000 });
  await delay(900);
  await page.screenshot({ path: path.join(outDir, "07-provider-home.png") });

  await openMenu(page);
  await page.getByText("Menu").first().waitFor({ timeout: 120000 });
  await page.screenshot({ path: path.join(outDir, "08-provider-menu.png") });

  await browser.close();
  console.log(`Screenshots salvos em: ${outDir}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


