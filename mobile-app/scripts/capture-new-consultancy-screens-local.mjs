import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT_DIR = process.env.CAPTURE_OUT_DIR ?? "C:/Users/Danilo/Documents/testes app";
const APP_URL = process.env.CAPTURE_APP_URL ?? "http://127.0.0.1:8081";

const NEW_FILES = [
  "35-client-promotions.png",
  "36-client-my-training.png",
  "37-client-consultancy-request.png",
  "38-client-archived-requests.png",
  "39-provider-consultancy-center.png",
  "40-provider-archived-requests.png",
  "41-auth-onboarding-slide-2.png",
  "42-client-home-menu-open.png",
  "43-provider-home-menu-open.png"
];

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

async function waitForNavReady(page) {
  await page.waitForFunction(() => {
    const nav = window.__PERSONALAPP_NAV__;
    return Boolean(nav && typeof nav.isReady === "function" && nav.isReady());
  }, undefined, { timeout: 30000 });
}

async function navigateGlobal(page, screen, params) {
  await waitForNavReady(page);
  const ok = await page.evaluate(
    ({ screen, params }) => {
      const nav = window.__PERSONALAPP_NAV__;
      if (!nav || typeof nav.navigate !== "function") return false;
      nav.navigate(screen, params);
      return true;
    },
    { screen, params }
  );

  if (!ok) {
    throw new Error(`Global navigation failed for screen: ${screen}`);
  }
}

async function navigateClientTab(page, screen) {
  await navigateGlobal(page, "ClientTabs", { screen });
  await delay(350);
}

async function navigateProfessionalTab(page, screen) {
  await navigateGlobal(page, "ProfessionalTabs", { screen });
  await delay(350);
}

async function gotoApp(page, suffix = "") {
  await page.goto(`${APP_URL}${suffix}`, {
    waitUntil: "commit",
    timeout: 300000
  });
}

async function waitLogin(page) {
  await page.locator("input").first().waitFor({ timeout: 120000 });
}

async function login(page, email) {
  await waitLogin(page);
  await page.locator("input").nth(0).fill(email);
  await page.locator("input").nth(1).fill("12345678");
  await clickAction(page, "Entrar");
}

async function chooseRole(page, role) {
  const hasRoleSelection = await page
    .getByText(/Escolha seu perfil|Como você deseja usar o app/i)
    .first()
    .waitFor({ timeout: 6000 })
    .then(() => true)
    .catch(() => false);

  if (!hasRoleSelection) {
    return false;
  }

  const roleButtons = page.locator('[role="button"]').filter({ hasText: /Ver perfil|Selecionar/i });
  if ((await roleButtons.count()) > 1) {
    if (role === "CLIENT") {
      await roleButtons.first().click();
    } else {
      await roleButtons.nth(1).click();
    }
  } else {
    await clickAction(page, "Ver perfil");
  }

  await page.getByText(/Escolher este perfil/i).first().waitFor({ timeout: 120000 });
  await clickAction(page, "Escolher este perfil");
  return true;
}

async function loginAndEnterClientHome(page) {
  await gotoApp(page);
  await login(page, "cliente@demo.com");
  await chooseRole(page, "CLIENT");
  await page.getByText(/treino/i).first().waitFor({ timeout: 120000 });
  await delay(250);
}

async function loginAndEnterProviderHome(page) {
  await gotoApp(page);
  await login(page, "profissional@demo.com");
  await chooseRole(page, "PROVIDER");
  await page.getByText(/agenda|painel|financeiro/i).first().waitFor({ timeout: 120000 });
  await delay(250);
}

async function openMenu(page) {
  const menuByLabel = page.locator("[aria-label='Abrir menu']");
  if ((await menuByLabel.count()) > 0 && (await menuByLabel.first().isVisible())) {
    await menuByLabel.first().click();
  } else {
    const buttons = page.locator('[role="button"]');
    if ((await buttons.count()) === 0) {
      throw new Error("Menu button not found");
    }
    await buttons.first().click();
  }

  await page.getByText("Meu Perfil").first().waitFor({ timeout: 120000 });
  await delay(250);
}

function screenshotPath(fileName) {
  return path.join(OUT_DIR, fileName);
}

async function take(page, fileName) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await delay(250);
      await page.screenshot({
        path: screenshotPath(fileName),
        animations: "disabled"
      });
      return;
    } catch (error) {
      lastError = error;
      await delay(800);
    }
  }

  throw lastError;
}

async function withFreshContext(browser, { onboardingDone = true } = {}, fn) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(
    ({ onboardingDone }) => {
      localStorage.clear();
      sessionStorage.clear();
      if (onboardingDone) {
        localStorage.setItem("@personalapp/onboardingDone", "1");
      } else {
        localStorage.removeItem("@personalapp/onboardingDone");
      }
      localStorage.removeItem("@personalapp/role");
      localStorage.removeItem("@personalapp/roleUserId");
      localStorage.removeItem("@personalapp/secure/accessToken");
      localStorage.removeItem("@personalapp/secure/refreshToken");
    },
    { onboardingDone }
  );
  const page = await context.newPage();
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const fileName of NEW_FILES) {
    const full = screenshotPath(fileName);
    if (fs.existsSync(full)) {
      fs.unlinkSync(full);
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await navigateClientTab(page, "Promotions");
      await page.getByText(/Promo/i).first().waitFor({ timeout: 120000 });
      await take(page, NEW_FILES[0]);
    });

    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await navigateClientTab(page, "MyTraining");
      await page.getByText(/Seu Treino/i).first().waitFor({ timeout: 120000 });
      await take(page, NEW_FILES[1]);
    });

    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await navigateGlobal(page, "ConsultancyRequest", { professionalId: "prov-1" });
      await page.getByText(/Consultoria online/i).first().waitFor({ timeout: 120000 });
      await take(page, NEW_FILES[2]);
    });

    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await navigateGlobal(page, "ArchivedRequests");
      await page.getByText(/Arquivados/i).first().waitFor({ timeout: 120000 });
      await take(page, NEW_FILES[3]);
    });

    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterProviderHome(page);
      await navigateProfessionalTab(page, "ProfessionalConsultancyCenter");
      await page.getByText(/Central de consultoria/i).first().waitFor({ timeout: 120000 });
      await take(page, NEW_FILES[4]);
    });

    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterProviderHome(page);
      await navigateGlobal(page, "ProfessionalArchivedRequests");
      await page.getByText(/Arquivados/i).first().waitFor({ timeout: 120000 });
      await take(page, NEW_FILES[5]);
    });

    await withFreshContext(browser, { onboardingDone: false }, async (page) => {
      await gotoApp(page);
      await page.getByText(/Pular/i).first().waitFor({ timeout: 120000 });
      await clickAction(page, "Próximo");
      await page.getByText(/Agenda simples, rotina organizada/i).first().waitFor({ timeout: 120000 });
      await take(page, NEW_FILES[6]);
    });

    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await openMenu(page);
      await take(page, NEW_FILES[7]);
    });

    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterProviderHome(page);
      await openMenu(page);
      await take(page, NEW_FILES[8]);
    });
  } finally {
    await browser.close();
  }

  console.log(`New screenshots saved in ${OUT_DIR}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

