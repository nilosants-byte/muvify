import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright";

const ROOT_DIR = path.resolve(process.cwd(), "..");
const MOBILE_DIR = process.cwd();
const OUT_FILE = "C:/Users/Danilo/Documents/testes app/01-auth-splash-intro.png";
const APP_URL = "http://127.0.0.1:8081";
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function spawnProc(command, args, cwd, tag) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd")
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[${tag}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${tag}:err] ${chunk}`));
  return child;
}

function stopProc(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

async function waitForHttp(url, { timeoutMs = 360000, intervalMs = 1000, validate } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (!validate || validate(response.status, body)) {
        return { status: response.status, body };
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function run() {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  const mockApi = spawnProc("node", ["scripts/mock-mobile-api.js"], ROOT_DIR, "mock-api");
  const expoWeb = spawnProc(npmCmd, ["run", "web"], MOBILE_DIR, "expo-web");

  try {
    await waitForHttp("http://127.0.0.1:3000/api/health", {
      validate: (status) => status === 200
    });

    await waitForHttp("http://127.0.0.1:8081/status", {
      validate: (_status, body) => body.includes("packager-status:running")
    });
    await waitForHttp(APP_URL, {
      timeoutMs: 600000,
      validate: (status) => status === 200
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addInitScript(() => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem("@personalapp/onboardingDone", "1");
      });
      const page = await context.newPage();
      await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 600000 });
      await page.locator('[data-testid="auth-splash-logo"]').first().waitFor({ timeout: 120000 });
      await page.locator('[data-testid="auth-splash-loader"]').first().waitFor({ timeout: 120000 });
      await page.waitForTimeout(20);
      await page.screenshot({ path: OUT_FILE });
      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    stopProc(expoWeb);
    stopProc(mockApi);
  }

  // eslint-disable-next-line no-console
  console.log(`OK: splash salvo em ${OUT_FILE}`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
