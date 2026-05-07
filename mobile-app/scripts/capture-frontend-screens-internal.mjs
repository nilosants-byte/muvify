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
    await page.getByText("Menu").first().waitFor({ timeout: 120000 });
    await delay(300);
    return;
  }

  const buttons = page.locator('[role="button"]');
  if ((await buttons.count()) > 0) {
    await buttons.first().click();
    await page.getByText("Menu").first().waitFor({ timeout: 120000 });
    await delay(300);
  }
}

async function clickMenuItem(page, key) {
  const item = page.locator(`[aria-label='menu-${key}']`);
  if ((await item.count()) > 0 && (await item.first().isVisible())) {
    await item.first().click();
    await delay(500);
    return true;
  }
  return false;
}

async function openMenuAndClick(page, key) {
  await openMenu(page);
  const ok = await clickMenuItem(page, key);
  if (!ok) {
    throw new Error(`Menu item not found: ${key}`);
  }
}

async function loginAndChooseRole(page, email, role) {
  await page.goto("http://127.0.0.1:8081", {
    waitUntil: "domcontentloaded",
    timeout: 180000
  });

  await page.getByPlaceholder("você@email.com").waitFor({ timeout: 120000 });
  await page.getByPlaceholder("você@email.com").fill(email);
  await page.getByPlaceholder("Sua senha").fill("12345678");
  await clickAction(page, "Entrar");

  await page.getByText("Escolha seu perfil").first().waitFor({ timeout: 120000 });

  const roleButtons = page.locator('[role="button"]').filter({ hasText: "Ver vantagens" });
  if ((await roleButtons.count()) > 1) {
    if (role === "CLIENT") {
      await roleButtons.first().click();
    } else {
      await roleButtons.nth(1).click();
    }
  } else {
    await clickAction(page, "Ver vantagens");
  }

  await page.getByText("Escolher este perfil").first().waitFor({ timeout: 120000 });
  await clickAction(page, "Escolher este perfil");
}

async function withFreshContext(browser, fn) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("@personalapp/onboardingDone", "1");
    localStorage.removeItem("@personalapp/role");
    localStorage.removeItem("@personalapp/roleUserId");
  });
  const page = await context.newPage();
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

async function captureClientSearchFlow(browser) {
  await withFreshContext(browser, async (page) => {
    await loginAndChooseRole(page, "cliente@demo.com", "CLIENT");
    await page.getByText("Início").waitFor({ timeout: 120000 });

    await openMenuAndClick(page, "search");
    await page.getByPlaceholder("Ex.: personal, nutrição, pilates...").waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(outDir, "09-client-search.png") });

    await page.getByPlaceholder("Ex.: personal, nutrição, pilates...").fill("Mariana");
    await delay(700);
    await clickAction(page, "Ver resultados");
    await page.getByText("profissionais encontrados").first().waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(outDir, "10-client-professionals-list.png") });

  const firstProviderCard = page.locator('[role="button"]').filter({ hasText: "Mariana Coach" });
  try {
    if ((await firstProviderCard.count()) > 0) {
      await firstProviderCard.first().click({ timeout: 10000 });
      await page.getByText("Detalhe do profissional").first().waitFor({ timeout: 30000 });
      await page.getByText("Valor por sessão").first().waitFor({ timeout: 30000 });
      await page.screenshot({ path: path.join(outDir, "11-client-professional-detail.png") });
    } else if ((await page.locator("text=Mariana Coach").count()) > 0) {
      // Search and home can keep duplicated nodes mounted; prefer last match from list.
      await page.locator("text=Mariana Coach").last().click({ force: true });
      await page.getByText("Detalhe do profissional").first().waitFor({ timeout: 30000 });
      await page.getByText("Valor por sessão").first().waitFor({ timeout: 30000 });
      await page.screenshot({ path: path.join(outDir, "11-client-professional-detail.png") });
    }
  } catch {
    // optional screenshot
  }
  });
}

async function captureClientBookingsFlow(browser) {
  await withFreshContext(browser, async (page) => {
    await loginAndChooseRole(page, "cliente@demo.com", "CLIENT");
    await page.getByText("Início").waitFor({ timeout: 120000 });

    await openMenuAndClick(page, "bookings");
    await page.getByText("Acompanhe status, pagamento e próximos passos.").first().waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(outDir, "12-client-bookings.png") });

  const firstBookingCard = page.locator('[role="button"]').filter({ hasText: "Agendamento #" });
  try {
    if ((await firstBookingCard.count()) > 0) {
      await firstBookingCard.first().click({ timeout: 10000 });
      await page.getByText("Detalhe do agendamento").first().waitFor({ timeout: 30000 });
      await page.screenshot({ path: path.join(outDir, "13-client-booking-detail-payment.png") });
    } else if ((await page.locator("text=Agendamento #").count()) > 0) {
      await page.locator("text=Agendamento #").last().click({ force: true });
      await page.getByText("Detalhe do agendamento").first().waitFor({ timeout: 30000 });
      await page.screenshot({ path: path.join(outDir, "13-client-booking-detail-payment.png") });
    }
  } catch {
    // optional screenshot
  }
  });
}

async function captureProviderAgendaFlow(browser) {
  await withFreshContext(browser, async (page) => {
    await loginAndChooseRole(page, "pro@demo.com", "PROVIDER");
    await page.getByText("Painel").waitFor({ timeout: 120000 });

    await openMenuAndClick(page, "agenda");
    await page
      .getByText("Acompanhe e atualize seus atendimentos.")
      .first()
      .waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(outDir, "14-provider-agenda.png") });

  const firstBookingCard = page.locator('[role="button"]').filter({ hasText: "Cliente Demo" });
  try {
    if ((await firstBookingCard.count()) > 0) {
      await firstBookingCard.first().click({ timeout: 10000 });
      await page.getByText("Detalhe do atendimento").first().waitFor({ timeout: 30000 });
      await page.screenshot({ path: path.join(outDir, "15-provider-booking-detail.png") });

      await clickAction(page, "Abrir status");
      await page.getByText("Status do pagamento").first().waitFor({ timeout: 30000 });
      await page.screenshot({ path: path.join(outDir, "16-provider-payment-status.png") });
    } else if ((await page.locator("text=Cliente Demo").count()) > 0) {
      // Agenda and home can keep duplicated nodes mounted; target the agenda instance.
      await page.locator("text=Cliente Demo").last().click({ force: true });
      await page.getByText("Detalhe do atendimento").first().waitFor({ timeout: 30000 });
      await page.screenshot({ path: path.join(outDir, "15-provider-booking-detail.png") });

      await clickAction(page, "Abrir status");
      await page.getByText("Status do pagamento").first().waitFor({ timeout: 30000 });
      await page.screenshot({ path: path.join(outDir, "16-provider-payment-status.png") });
    }
  } catch {
    // optional screenshot
  }
  });
}

async function captureProviderSettingsFlow(browser) {
  await withFreshContext(browser, async (page) => {
    await loginAndChooseRole(page, "pro@demo.com", "PROVIDER");
    await page.getByText("Painel").waitFor({ timeout: 120000 });

    await openMenuAndClick(page, "profile");
    await page
      .getByText("Preço definido e obrigatório para atuar no marketplace.")
      .first()
      .waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(outDir, "17-provider-profile-editor.png") });
  });

  await withFreshContext(browser, async (page) => {
    await loginAndChooseRole(page, "pro@demo.com", "PROVIDER");
    await page.getByText("Painel").waitFor({ timeout: 120000 });

    await openMenuAndClick(page, "payout");
    await page
      .getByText("Acompanhe a situação da sua conta financeira conectada.")
      .first()
      .waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(outDir, "18-provider-payout-status.png") });
  });
}

async function run() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  try {
    await captureClientSearchFlow(browser);
    await captureClientBookingsFlow(browser);
    await captureProviderAgendaFlow(browser);
    await captureProviderSettingsFlow(browser);
    console.log(`Internal screenshots salvos em: ${outDir}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});




