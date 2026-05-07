import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const mobileDir = path.resolve(scriptDir, "..");
const rootDir = path.resolve(mobileDir, "..");
const OUT_DIR = "C:/Users/Danilo/Documents/testes app";
const APP_URL = "http://127.0.0.1:8081";

const NEW_FILES = [
  "35-client-promotions.png",
  "36-client-my-training.png",
  "37-client-consultancy-request.png",
  "38-client-archived-requests.png",
  "39-provider-consultancy-center.png",
  "40-provider-archived-requests.png"
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForHttp(url, { timeoutMs = 120000, intervalMs = 1000, validate } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const response = await fetch(url);
        const text = await response.text();
        if (!validate || validate(response.status, text)) {
          resolve({ status: response.status, body: text });
          return;
        }
      } catch {
        // ignore until timeout
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timeout waiting for ${url}`));
        return;
      }

      setTimeout(tick, intervalMs);
    };

    void tick();
  });
}

function spawnProc(command, args, cwd) {
  const useShell = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
  // eslint-disable-next-line no-console
  console.log(`[spawn] ${command} ${args.join(" ")} (cwd=${cwd})`);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: useShell
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${path.basename(cwd)}:${command}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${path.basename(cwd)}:${command}:err] ${chunk}`);
  });
  child.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error(`[${path.basename(cwd)}:${command}:error]`, error);
  });
  child.on("exit", (code, signal) => {
    // eslint-disable-next-line no-console
    console.log(
      `[${path.basename(cwd)}:${command}:exit] code=${code ?? "null"} signal=${signal ?? "null"}`
    );
  });

  return child;
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

async function gotoApp(page) {
  await page.goto(APP_URL, {
    waitUntil: "domcontentloaded",
    timeout: 180000
  });
}

async function waitLogin(page) {
  await page.getByPlaceholder("você@email.com").waitFor({ timeout: 120000 });
}

async function login(page, email) {
  await waitLogin(page);
  await page.getByPlaceholder("você@email.com").fill(email);
  await page.getByPlaceholder("Sua senha").fill("12345678");
  await clickAction(page, "Entrar");
}

async function chooseRole(page, role) {
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

async function loginAndEnterClientHome(page) {
  await gotoApp(page);
  await login(page, "cliente@demo.com");
  await chooseRole(page, "CLIENT");
  await page.getByText("Início").first().waitFor({ timeout: 120000 });
  await delay(400);
}

async function loginAndEnterProviderHome(page) {
  await gotoApp(page);
  await login(page, "pro@demo.com");
  await chooseRole(page, "PROVIDER");
  await page.getByText("Painel").first().waitFor({ timeout: 120000 });
  await delay(400);
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

  await page.getByText("Menu").first().waitFor({ timeout: 120000 });
  await delay(250);
}

async function clickMenuItem(page, key) {
  const item = page.locator(`[aria-label='menu-${key}']`);
  if ((await item.count()) > 0 && (await item.first().isVisible())) {
    await item.first().click();
    await delay(500);
    return;
  }

  throw new Error(`Menu item not found: ${key}`);
}

async function openMenuAndClick(page, key) {
  await openMenu(page);
  await clickMenuItem(page, key);
}

function screenshotPath(fileName) {
  return path.join(OUT_DIR, fileName);
}

async function take(page, fileName) {
  await delay(180);
  await page.screenshot({ path: screenshotPath(fileName) });
}

async function withFreshContext(browser, fn) {
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

  const mockApi = spawnProc("node", ["scripts/mock-mobile-api.js"], rootDir);
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const expoWeb = spawnProc(npmCmd, ["run", "web"], mobileDir);

  try {
    // eslint-disable-next-line no-console
    console.log("[wait] mock api");
    await waitForHttp("http://127.0.0.1:3000/api/health", {
      validate: (status) => status === 200
    });
    // eslint-disable-next-line no-console
    console.log("[wait] expo web");
    await waitForHttp("http://127.0.0.1:8081/status", {
      validate: (_status, body) => body.includes("packager-status:running")
    });

    const browser = await chromium.launch({ headless: true });

    try {
      await withFreshContext(browser, async (page) => {
        await loginAndEnterClientHome(page);
        await openMenuAndClick(page, "promotions");
        await page.getByText("Promoções").first().waitFor({ timeout: 120000 });
        await take(page, NEW_FILES[0]);
      });

      await withFreshContext(browser, async (page) => {
        await loginAndEnterClientHome(page);
        await openMenuAndClick(page, "my-training");
        await page.getByText("Seu Treino").first().waitFor({ timeout: 120000 });
        await take(page, NEW_FILES[1]);
      });

      await withFreshContext(browser, async (page) => {
        await loginAndEnterClientHome(page);
        await navigateGlobal(page, "ConsultancyRequest", { professionalId: "prov-1" });
        await page.getByText("Consultoria online").first().waitFor({ timeout: 120000 });
        await take(page, NEW_FILES[2]);
      });

      await withFreshContext(browser, async (page) => {
        await loginAndEnterClientHome(page);
        await navigateGlobal(page, "ArchivedRequests");
        await page.getByText("Arquivados").first().waitFor({ timeout: 120000 });
        await take(page, NEW_FILES[3]);
      });

      await withFreshContext(browser, async (page) => {
        await loginAndEnterProviderHome(page);
        await openMenuAndClick(page, "consultancy");
        await page.getByText("Central de consultoria").first().waitFor({ timeout: 120000 });
        await take(page, NEW_FILES[4]);
      });

      await withFreshContext(browser, async (page) => {
        await loginAndEnterProviderHome(page);
        await navigateGlobal(page, "ProfessionalArchivedRequests");
        await page.getByText("Arquivados").first().waitFor({ timeout: 120000 });
        await take(page, NEW_FILES[5]);
      });
    } finally {
      await browser.close();
    }

    // eslint-disable-next-line no-console
    console.log(`New screenshots saved in ${OUT_DIR}`);
  } finally {
    mockApi.kill("SIGTERM");
    expoWeb.kill("SIGTERM");
  }
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});



