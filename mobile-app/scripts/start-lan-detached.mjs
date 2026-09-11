import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
console.log("[start-lan-detached] boot");

// Mesmo cuidado de start-lan.mjs/start-share.mjs: o Metro guarda um cache
// persistente de "quais arquivos existem no projeto" (haste file map) fora
// da pasta do projeto, em os.tmpdir() -- não é limpo pela flag -c do
// "expo start". Quando fica inconsistente, o Metro quebra com "Cannot read
// properties of undefined (reading 'get')" em DependencyGraph.js e o app
// nem chega a carregar no Expo Go. Apagar é seguro -- índice temporário,
// recriado sozinho, não afeta código/git/banco.
function clearStaleMetroFileMapCache() {
  const tmpDir = os.tmpdir();
  try {
    for (const entry of fs.readdirSync(tmpDir)) {
      if (entry.startsWith("metro-file-map-") || entry === "metro-cache") {
        fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
      }
    }
  } catch {
    // best-effort
  }
  try {
    execSync("watchman watch-del-all", { stdio: "ignore" });
  } catch {
    // watchman pode nao estar instalado/rodando
  }
}
clearStaleMetroFileMapCache();

function isPrivateIpv4(address) {
  return (
    /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  );
}

function resolveLanIpv4() {
  const interfaces = os.networkInterfaces();
  for (const values of Object.values(interfaces)) {
    if (!values) continue;
    for (const item of values) {
      if (item.family !== "IPv4" || item.internal) continue;
      if (isPrivateIpv4(item.address)) return item.address;
    }
  }
  return "127.0.0.1";
}

const hostIp = resolveLanIpv4();
const appDir = process.cwd();
const repoRoot = path.resolve(appDir, "..");
const logsDir = path.join(repoRoot, "logs");
const logFile = path.join(logsDir, "expo-lan-live.log");

fs.mkdirSync(logsDir, { recursive: true });
fs.writeFileSync(logFile, "");

const env = {
  ...process.env,
  REACT_NATIVE_PACKAGER_HOSTNAME: hostIp,
  EXPO_NO_DEPENDENCY_VALIDATION: "true",
  EXPO_PACKAGER_PROXY_URL: `http://${hostIp}:8081`,
};

const stdioFd = fs.openSync(logFile, "a");
const expoArgs = ["start", "--go", "--host", "lan", "--port", "8081", "-c"];
const localExpoBin = process.platform === "win32"
  ? path.join(appDir, "node_modules", ".bin", "expo.cmd")
  : path.join(appDir, "node_modules", ".bin", "expo");

const command = fs.existsSync(localExpoBin)
  ? process.platform === "win32"
    ? "cmd.exe"
    : localExpoBin
  : process.platform === "win32"
    ? "cmd.exe"
    : "npx";

const args = fs.existsSync(localExpoBin)
  ? process.platform === "win32"
    ? ["/c", `${localExpoBin} ${expoArgs.join(" ")}`]
    : expoArgs
  : process.platform === "win32"
    ? ["/c", `npx expo ${expoArgs.join(" ")}`]
    : ["expo", ...expoArgs];

const child = spawn(command, args, {
  cwd: appDir,
  env,
  detached: true,
  stdio: ["ignore", stdioFd, stdioFd],
});

child.unref();

console.log(`[expo-detached] pid=${child.pid}`);
console.log(`[expo-detached] host=${hostIp}`);
console.log(`[expo-detached] url=exp://${hostIp}:8081`);
console.log(`[expo-detached] log=${logFile}`);
