import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const mobileDir = path.resolve(scriptDir, "..");
const rootDir = path.resolve(mobileDir, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const logFile = path.join(mobileDir, "capture-brand.log");

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  fs.appendFileSync(logFile, line);
}

function spawnProc(command, args, cwd, tag) {
  log(`spawn ${tag}: ${command} ${args.join(" ")}`);
  const useShell = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: useShell
  });

  child.stdout.on("data", (chunk) => {
    fs.appendFileSync(logFile, `[${tag}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    fs.appendFileSync(logFile, `[${tag}:err] ${chunk}`);
  });
  child.on("exit", (code) => {
    log(`exit ${tag}: code=${code}`);
  });

  return child;
}

function waitForHttp(
  url,
  { timeoutMs = 240000, intervalMs = 1000, validate, mustStillBeAlive } = {}
) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (mustStillBeAlive && !mustStillBeAlive()) {
        reject(new Error(`Process exited before ${url} became ready`));
        return;
      }
      try {
        const response = await fetch(url);
        const body = await response.text();
        if (!validate || validate(response.status, body)) {
          resolve({ status: response.status, body });
          return;
        }
      } catch {
        // Retry until timeout.
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

function runCommand(command, args, cwd, tag) {
  return new Promise((resolve, reject) => {
    const child = spawnProc(command, args, cwd, tag);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${tag} failed with exit code ${code}`));
    });
    child.on("error", reject);
  });
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

async function run() {
  fs.writeFileSync(logFile, "");
  log("capture brand-updated screenshots: started");
  const mockApi = spawnProc("node", ["scripts/mock-mobile-api.js"], rootDir, "mock-api");
  const expoWeb = spawnProc(npmCmd, ["run", "web"], mobileDir, "expo-web");

  try {
    log("waiting mock api health");
    await waitForHttp("http://127.0.0.1:3000/api/health", {
      validate: (status) => status === 200
    });
    log("mock api ready");

    log("waiting expo web status");
    await waitForHttp("http://127.0.0.1:8081/status", {
      validate: (_status, body) => body.includes("packager-status:running"),
      mustStillBeAlive: () => expoWeb.exitCode === null
    });
    log("expo web ready");

    log("waiting expo web app route");
    await waitForHttp("http://127.0.0.1:8081", {
      timeoutMs: 600000,
      validate: (status) => status === 200,
      mustStillBeAlive: () => expoWeb.exitCode === null
    });
    log("expo web app route ready");

    log("running official 34 screenshot capture");
    await runCommand("node", ["scripts/capture-official-34-screens.mjs"], mobileDir, "capture-34");
    log("official 34 completed");

    log("running 35-43 screenshot capture");
    await runCommand(
      "node",
      ["scripts/capture-new-consultancy-screens-local.mjs"],
      mobileDir,
      "capture-35-43"
    );
    log("35-43 completed");
  } finally {
    log("stopping background processes");
    stopProc(expoWeb);
    stopProc(mockApi);
    log("capture brand-updated screenshots: finished");
  }
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
