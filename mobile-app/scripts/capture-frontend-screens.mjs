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
const outDir = "C:\\Users\\Danilo\\Documents\\testes app";

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
        // Ignore until timeout.
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
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${path.basename(cwd)}:${command}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${path.basename(cwd)}:${command}:err] ${chunk}`);
  });

  return child;
}

async function clickFirstIfVisible(locator) {
  if ((await locator.count()) > 0 && (await locator.first().isVisible())) {
    await locator.first().click();
    return true;
  }
  return false;
}

async function clickByLabel(page, labels) {
  for (const label of labels) {
    const btn = page.getByRole("button", { name: label }).first();
    if ((await btn.count()) > 0 && (await btn.isVisible())) {
      await btn.click();
      return true;
    }
  }
  return false;
}

async function capture() {
  fs.mkdirSync(outDir, { recursive: true });

  const mockApi = spawnProc("node", ["scripts/mock-mobile-api.js"], rootDir);
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const expoWeb = spawnProc(npmCmd, ["run", "web"], mobileDir);

  try {
    await waitForHttp("http://127.0.0.1:3000/api/health", {
      validate: (status) => status === 200
    });
    await waitForHttp("http://127.0.0.1:8081/status", {
      validate: (_status, body) => body.includes("packager-status:running")
    });

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }
    });
    await context.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // Ignore storage issues.
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

    await delay(2300);
    await page.screenshot({ path: path.join(outDir, "02-onboarding.png") });

    if (!(await clickFirstIfVisible(page.getByRole("button", { name: "Pular" })))) {
      for (let i = 0; i < 3; i += 1) {
        if (await clickFirstIfVisible(page.getByRole("button", { name: "Começar" }))) {
          break;
        }
        if (!(await clickFirstIfVisible(page.getByRole("button", { name: "Próximo" })))) {
          break;
        }
        await delay(350);
      }
    }

    await page.getByPlaceholder("você@email.com").waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(outDir, "03-login.png") });

    await page.getByPlaceholder("você@email.com").fill("cliente@demo.com");
    await page.getByPlaceholder("Sua senha").fill("12345678");
    await page.getByRole("button", { name: "Entrar" }).first().click();

    await page.getByText(/Como você deseja usar o app|Escolha seu perfil/i).first().waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(outDir, "04-role-selection.png") });

    await clickByLabel(page, ["Selecionar", "Ver vantagens"]);
    await page.getByRole("button", { name: "Escolher este perfil" }).waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(outDir, "05-role-summary-modal.png") });

    await page.getByRole("button", { name: "Escolher este perfil" }).click();
    await page.getByText(/Olá,/i).first().waitFor({ timeout: 120000 });
    await delay(800);
    await page.screenshot({ path: path.join(outDir, "06-client-home.png") });

    if (!(await clickFirstIfVisible(page.getByRole("button", { name: "Abrir menu" })))) {
      await page.locator("button").first().click();
    }
    await page.getByText("Meu Perfil").first().waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(outDir, "07-client-menu.png") });

    await page.getByRole("button", { name: "Sair" }).click();
    await page.getByPlaceholder("você@email.com").waitFor({ timeout: 120000 });
    await page.getByPlaceholder("você@email.com").fill("pro@demo.com");
    await page.getByPlaceholder("Sua senha").fill("12345678");
    await page.getByRole("button", { name: "Entrar" }).first().click();

    await page.getByText(/Como você deseja usar o app|Escolha seu perfil/i).first().waitFor({ timeout: 120000 });
    const chooseButtons = page.getByRole("button", { name: /Selecionar|Ver vantagens/i });
    if ((await chooseButtons.count()) > 1) {
      await chooseButtons.nth(1).click();
    } else {
      await clickByLabel(page, ["Selecionar", "Ver vantagens"]);
    }
    await page.getByRole("button", { name: "Escolher este perfil" }).click();

    await page.getByText(/Receita semanal|Bom treino/i).first().waitFor({ timeout: 120000 });
    await delay(800);
    await page.screenshot({ path: path.join(outDir, "08-provider-home.png") });

    if (!(await clickFirstIfVisible(page.getByRole("button", { name: "Abrir menu" })))) {
      await page.locator("button").first().click();
    }
    await page.getByText("Meu Perfil").first().waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(outDir, "09-provider-menu.png") });

    await browser.close();
    // eslint-disable-next-line no-console
    console.log(`Screenshots saved in ${outDir}`);
  } finally {
    mockApi.kill("SIGTERM");
    expoWeb.kill("SIGTERM");
  }
}

capture().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});


