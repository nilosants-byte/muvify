import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
const MOBILE_DIR = path.resolve(ROOT_DIR, "mobile-app");
const OUTPUT_BASE_DIR = "C:/Users/Danilo/Documents/testes app";
const CAPTURE_SCRIPT = path.resolve(MOBILE_DIR, "scripts/capture-official-34-screens.mjs");
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

async function waitForHttp(url, { timeoutMs = 180000, intervalMs = 1000, validate } = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (!validate || validate(response.status, body)) {
        return;
      }
    } catch {
      // Keep waiting until timeout.
    }
    await wait(intervalMs);
  }

  throw new Error(`Timeout waiting for ${url}`);
}

function clearPngDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of fs.readdirSync(dir)) {
    if (file.toLowerCase().endsWith(".png")) {
      fs.unlinkSync(path.join(dir, file));
    }
  }
}

async function runCaptureForTheme(mode) {
  const outDir = path.join(OUTPUT_BASE_DIR, `muvify-prints-${mode}`);
  clearPngDir(outDir);

  const expoWeb =
    process.platform === "win32"
      ? spawnProc(
          "cmd.exe",
          ["/c", "npm run web -- --clear"],
          MOBILE_DIR,
          { EXPO_PUBLIC_THEME_MODE: mode }
        )
      : spawnProc(
          "npm",
          ["run", "web", "--", "--clear"],
          MOBILE_DIR,
          { EXPO_PUBLIC_THEME_MODE: mode }
        );

  try {
    await waitForHttp("http://127.0.0.1:8081/status", {
      timeoutMs: 360000,
      validate: (_status, body) => body.includes("packager-status:running")
    });

    await wait(2000);

    const capture = spawnProc(
      process.execPath,
      [CAPTURE_SCRIPT],
      MOBILE_DIR,
      {
        EXPO_PUBLIC_THEME_MODE: mode,
        CAPTURE_OUT_DIR: outDir
      }
    );

    await new Promise((resolve, reject) => {
      capture.on("exit", (code) => {
        if (code === 0) {
          resolve(true);
          return;
        }
        reject(new Error(`Capture script failed for ${mode} with exit code ${code}`));
      });
      capture.on("error", reject);
    });

    const count = fs
      .readdirSync(outDir)
      .filter((name) => name.toLowerCase().endsWith(".png")).length;

    if (count < 34) {
      throw new Error(`Expected >=34 screenshots for ${mode}, got ${count}`);
    }

    console.log(`Tema ${mode} concluído com ${count} screenshots em ${outDir}`);
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

    await runCaptureForTheme("dark");
    await runCaptureForTheme("light");
  } finally {
    await killProcessTree(mockApi);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
