/**
 * start-ngrok.mjs
 *
 * Stable setup for testing on different networks/cities:
 * - Backend API via cloudflared (port 3000)
 * - Expo Go bundle via cloudflared (Metro port 19000)
 *
 * Usage:
 *   npm run start:ngrok
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const BACKEND_PORT = 3000;
const CLOUDFLARED_PATTERN = /https:\/\/([a-z0-9]+-[a-z0-9][a-z0-9-]*)\.trycloudflare\.com/i;
const METRO_PORT_CANDIDATES = [8081, 8082, 8083];

const CLOUDFLARED_BIN = process.platform === "win32"
  ? `${os.homedir()}\\cloudflared.exe`
  : "cloudflared";


function resolveCloudflaredCommand() {
  if (process.platform === "win32" && fs.existsSync(CLOUDFLARED_BIN)) return CLOUDFLARED_BIN;
  return "cloudflared";
}

function startCloudflaredForBackend() {
  const cloudflaredCmd = resolveCloudflaredCommand();
  return spawn(
    cloudflaredCmd,
    ["tunnel", "--url", `http://127.0.0.1:${BACKEND_PORT}`, "--no-autoupdate"],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function resolveMetroPort() {
  for (const port of METRO_PORT_CANDIDATES) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortAvailable(port)) return port;
  }
  throw new Error("Nenhuma porta livre para o Metro (8081/8082/8083).");
}

function waitForCloudflaredBackendUrl(proc) {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      reject(new Error("Timeout ao criar tunnel cloudflared para o backend."));
    }, 45_000);

    function tryResolve(line) {
      const match = String(line).match(CLOUDFLARED_PATTERN);
      if (!match || resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve(`https://${match[1]}.trycloudflare.com`);
    }

    createInterface({ input: proc.stdout }).on("line", tryResolve);
    createInterface({ input: proc.stderr }).on("line", tryResolve);

    proc.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(new Error(`cloudflared (backend) encerrou com codigo ${code ?? "desconhecido"}.`));
    });
  });
}

function startCloudflaredForMetro(metroPort) {
  const cloudflaredCmd = resolveCloudflaredCommand();
  return spawn(
    cloudflaredCmd,
    ["tunnel", "--url", `http://127.0.0.1:${metroPort}`, "--no-autoupdate"],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
}

function waitForCloudflaredUrl(cloudflaredProc) {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      reject(new Error("Timeout ao criar tunnel cloudflared para o Metro."));
    }, 45_000);

    function tryResolve(line) {
      const match = String(line).match(CLOUDFLARED_PATTERN);
      if (!match || resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve(`https://${match[1]}.trycloudflare.com`);
    }

    createInterface({ input: cloudflaredProc.stdout }).on("line", tryResolve);
    createInterface({ input: cloudflaredProc.stderr }).on("line", tryResolve);

    cloudflaredProc.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(new Error(`cloudflared encerrou com codigo ${code ?? "desconhecido"}.`));
    });
  });
}

function startExpo(backUrl, metroTunnelUrl, metroPort) {
  const hostname = new URL(metroTunnelUrl).hostname;
  const env = {
    ...process.env,
    EXPO_PUBLIC_API_BASE_URL: `${backUrl}/api`,
    EXPO_PACKAGER_PROXY_URL: `https://${hostname}`,
    REACT_NATIVE_PACKAGER_HOSTNAME: hostname,
    EXPO_NO_DEPENDENCY_VALIDATION: "true",
  };

  const localExpoBin = process.platform === "win32"
    ? path.join(process.cwd(), "node_modules", ".bin", "expo.cmd")
    : path.join(process.cwd(), "node_modules", ".bin", "expo");

  const expoArgs = ["start", "--go", "--host", "lan", "--port", String(metroPort), "--clear"];

  if (fs.existsSync(localExpoBin)) {
    if (process.platform === "win32") {
      return spawn("cmd.exe", ["/c", `${localExpoBin} ${expoArgs.join(" ")}`], {
        stdio: "inherit",
        env,
      });
    }
    return spawn(localExpoBin, expoArgs, {
      stdio: "inherit",
      env,
    });
  }

  // Fallback de compatibilidade se o binário local não existir.
  const cmd = process.platform === "win32" ? "cmd.exe" : "npx";
  const args =
    process.platform === "win32"
      ? ["/c", `npx expo ${expoArgs.join(" ")}`]
      : ["expo", ...expoArgs];

  return spawn(cmd, args, {
    stdio: "inherit",
    env,
  });
}

async function main() {
  console.log(`[start:ngrok] Abrindo tunnel do backend (porta ${BACKEND_PORT}) via cloudflared...`);
  const backendProc = startCloudflaredForBackend();
  const backendUrl = await waitForCloudflaredBackendUrl(backendProc);
  console.log(`[start:ngrok] Backend: ${backendUrl}/api`);

  const metroPort = await resolveMetroPort();
  console.log(`[start:ngrok] Porta Metro selecionada: ${metroPort}`);
  console.log(`[start:ngrok] Abrindo tunnel do app (Metro ${metroPort}) via cloudflared...`);
  const cloudflaredProc = startCloudflaredForMetro(metroPort);
  const metroTunnelUrl = await waitForCloudflaredUrl(cloudflaredProc);
  const expoGoUrl = `exp://${new URL(metroTunnelUrl).hostname}`;

  console.log(`[start:ngrok] Metro tunnel: ${metroTunnelUrl}`);
  console.log(`[start:ngrok] Expo Go URL: ${expoGoUrl}`);

  const expoProc = startExpo(backendUrl, metroTunnelUrl, metroPort);

  function shutdown() {
    try {
      expoProc.kill();
    } catch {
      // noop
    }
    try {
      cloudflaredProc.kill();
    } catch {
      // noop
    }
    try {
      backendProc.kill();
    } catch {
      // noop
    }
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  expoProc.on("exit", (code) => {
    shutdown();
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(`[start:ngrok] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
