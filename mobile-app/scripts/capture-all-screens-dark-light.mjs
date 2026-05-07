import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const ROOT_DIR = path.resolve("C:/Users/Danilo/Documents/dev/personal-app-backend");
const MOBILE_DIR = path.resolve(ROOT_DIR, "mobile-app");
const OUTPUT_BASE = "C:/Users/Danilo/Documents/testes app";

const RUNTIME_SCRIPT = path.resolve(
  MOBILE_DIR,
  "scripts/capture-runtime-all-47-screens.mjs"
);
const STITCH_SCRIPT = path.resolve(
  MOBILE_DIR,
  "scripts/capture-stitch-preview-dark-light.mjs"
);
const STITCH44_SCRIPT = path.resolve(
  MOBILE_DIR,
  "scripts/capture-runtime-44-stitch44.mjs"
);

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

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${path.basename(cwd)}:${command}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${path.basename(cwd)}:${command}:err] ${chunk}`);
  });

  return child;
}

async function killProcessTree(child) {
  if (!child || child.killed) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: false
      });
      killer.on("exit", () => resolve(true));
      killer.on("error", () => resolve(true));
    });
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
        return;
      }
    } catch {
      // keep waiting
    }
    await wait(intervalMs);
  }

  throw new Error(`Timeout waiting for ${url}`);
}

async function runRuntimeForMode(mode) {
  const outDir = path.join(OUTPUT_BASE, `muvify-prints-runtime-${mode}`);
  fs.mkdirSync(outDir, { recursive: true });

  const expoWeb =
    process.platform === "win32"
      ? spawnProc(
          "cmd.exe",
          ["/c", "npm run web -- --clear"],
          MOBILE_DIR,
          { EXPO_PUBLIC_THEME_MODE: mode }
        )
      : spawnProc("npm", ["run", "web", "--", "--clear"], MOBILE_DIR, {
          EXPO_PUBLIC_THEME_MODE: mode
        });

  try {
    await waitForHttp("http://127.0.0.1:8081/status", {
      validate: (_status, body) => body.includes("packager-status:running")
    });

    await wait(2000);

    const capture = spawnProc(process.execPath, [RUNTIME_SCRIPT], MOBILE_DIR, {
      EXPO_PUBLIC_THEME_MODE: mode,
      CAPTURE_OUT_DIR: outDir
    });

    await new Promise((resolve, reject) => {
      capture.on("exit", (code) => {
        if (code === 0) {
          resolve(true);
          return;
        }
        reject(new Error(`Runtime capture failed for ${mode} with exit code ${code}`));
      });
      capture.on("error", reject);
    });
  } finally {
    await killProcessTree(expoWeb);
    await wait(1800);
  }
}

async function runStitchPreview() {
  const capture = spawnProc(process.execPath, [STITCH_SCRIPT], MOBILE_DIR, {
    CAPTURE_OUT_BASE: OUTPUT_BASE,
    CAPTURE_OUT_PREFIX: "muvify-prints-stitch"
  });

  await new Promise((resolve, reject) => {
    capture.on("exit", (code) => {
      if (code === 0) {
        resolve(true);
        return;
      }
      reject(new Error(`Stitch preview capture failed with exit code ${code}`));
    });
    capture.on("error", reject);
  });
}

async function runStitch44ForMode(mode) {
  const outDir = path.join(OUTPUT_BASE, `muvify-prints-stitch44-${mode}`);
  fs.mkdirSync(outDir, { recursive: true });

  const expoWeb =
    process.platform === "win32"
      ? spawnProc(
          "cmd.exe",
          ["/c", "npm run web -- --clear"],
          MOBILE_DIR,
          { EXPO_PUBLIC_THEME_MODE: mode }
        )
      : spawnProc("npm", ["run", "web", "--", "--clear"], MOBILE_DIR, {
          EXPO_PUBLIC_THEME_MODE: mode
        });

  try {
    await waitForHttp("http://127.0.0.1:8081/status", {
      validate: (_status, body) => body.includes("packager-status:running")
    });

    await wait(2000);

    const capture = spawnProc(process.execPath, [STITCH44_SCRIPT], MOBILE_DIR, {
      EXPO_PUBLIC_THEME_MODE: mode,
      CAPTURE_OUT_DIR: outDir
    });

    await new Promise((resolve, reject) => {
      capture.on("exit", (code) => {
        if (code === 0) {
          resolve(true);
          return;
        }
        reject(new Error(`Stitch44 capture failed for ${mode} with exit code ${code}`));
      });
      capture.on("error", reject);
    });
  } finally {
    await killProcessTree(expoWeb);
    await wait(1800);
  }
}

async function main() {
  const mockApi = spawnProc(process.execPath, ["scripts/mock-mobile-api.js"], ROOT_DIR);

  try {
    await waitForHttp("http://127.0.0.1:3000/api/health", {
      timeoutMs: 120000,
      validate: (status) => status === 200
    });

    await runRuntimeForMode("dark");
    await runRuntimeForMode("light");

    await runStitchPreview();

    await runStitch44ForMode("dark");
    await runStitch44ForMode("light");
  } finally {
    await killProcessTree(mockApi);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
