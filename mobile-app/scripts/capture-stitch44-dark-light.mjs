import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const ROOT_DIR = path.resolve("C:/Users/Danilo/Documents/dev/personal-app-backend");
const MOBILE_DIR = path.resolve(ROOT_DIR, "mobile-app");
const OUTPUT_BASE = "C:/Users/Danilo/Documents/testes app";

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

async function runForMode(mode) {
  const outDir = path.join(OUTPUT_BASE, `muvify-prints-stitch44-${mode}`);

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
  await runForMode("dark");
  await runForMode("light");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
