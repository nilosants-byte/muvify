import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const MOBILE_DIR = process.cwd();
const ROOT_DIR = path.resolve(MOBILE_DIR, "..");
const OUT_DIR = process.env.CAPTURE_OUT_DIR ?? "C:/Users/Danilo/Documents/testes app/muvify-prints-backend-2026-03-28";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnProc(command, args, cwd, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function killTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("exit", () => resolve(true));
      killer.on("error", () => resolve(true));
    });
    return;
  }
  child.kill("SIGTERM");
}

async function waitForHttp(url, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {
      // keep waiting
    }
    await wait(1000);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function waitNavReady(page) {
  await page.waitForFunction(() => {
    const nav = window.__PERSONALAPP_NAV__;
    return Boolean(nav && typeof nav.isReady === "function" && nav.isReady());
  }, undefined, { timeout: 30000 });
}

async function navigate(page, screen, params) {
  await waitNavReady(page);
  await page.evaluate(
    ({ screen, params }) => {
      const nav = window.__PERSONALAPP_NAV__;
      nav.navigate(screen, params);
    },
    { screen, params }
  );
  await wait(450);
}

async function login(page, email) {
  await page.goto("http://127.0.0.1:8081", { waitUntil: "commit", timeout: 300000 });
  await page.locator("input").first().waitFor({ timeout: 360000 });
  await page.locator("input").nth(0).fill(email);
  await page.locator("input").nth(1).fill("12345678");
  await page.getByRole("button", { name: /entrar/i }).first().click();
  await wait(900);
}

async function withContext(browser, fn) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("@personalapp/onboardingDone", "1");
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

  const mockApi = spawnProc(process.execPath, ["scripts/mock-mobile-api.js"], ROOT_DIR);
  const expoWeb = process.platform === "win32"
    ? spawnProc("cmd.exe", ["/c", "npm run web -- --clear"], MOBILE_DIR, { EXPO_PUBLIC_THEME_MODE: "dark" })
    : spawnProc("npm", ["run", "web", "--", "--clear"], MOBILE_DIR, { EXPO_PUBLIC_THEME_MODE: "dark" });

  try {
    await waitForHttp("http://127.0.0.1:3000/api/health", 120000);
    await waitForHttp("http://127.0.0.1:8081/status", 360000);
    await wait(2000);

    const browser = await chromium.launch({ headless: true });
    try {
      await withContext(browser, async (page) => {
        await login(page, "cliente@demo.com");
        await navigate(page, "ClientAnamnesis");
        await page.getByText(/Anamnese completa/i).first().waitFor({ timeout: 120000 });
        await page.screenshot({ path: path.join(OUT_DIR, "45-client-anamnesis.png"), animations: "disabled" });
      });

      await withContext(browser, async (page) => {
        await login(page, "profissional@demo.com");
        await navigate(page, "ProfessionalStudents");
        await page.getByText(/Gestao de alunos/i).first().waitFor({ timeout: 120000 });
        await page.screenshot({ path: path.join(OUT_DIR, "46-provider-students.png"), animations: "disabled" });

        const assessButton = page.getByRole("button", { name: /avaliacao fisica/i }).first();
        await assessButton.click();
        await page.getByText(/Avaliacao fisica/i).first().waitFor({ timeout: 120000 });
        await page.screenshot({ path: path.join(OUT_DIR, "47-provider-students-assessment-modal.png"), animations: "disabled" });
      });

      await withContext(browser, async (page) => {
        await login(page, "profissional@demo.com");
        await navigate(page, "ProfessionalStudentDetail", { clientId: "user-client-1" });
        await page.getByText(/Perfil do aluno/i).first().waitFor({ timeout: 120000 });
        await page.screenshot({ path: path.join(OUT_DIR, "48-provider-student-detail.png"), animations: "disabled" });
      });
    } finally {
      await browser.close();
    }
  } finally {
    await killTree(expoWeb);
    await killTree(mockApi);
  }

  console.log(`Capturas geradas em ${OUT_DIR}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
