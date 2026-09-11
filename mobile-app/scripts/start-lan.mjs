import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";

const METRO_PORT = 8081;

// Mesmo problema documentado em start-share.mjs: fechar o terminal direto
// (em vez de Ctrl+C + esperar sair) deixa o Metro anterior travado na
// porta 8081, e a rodada nova acaba brigando com ele ou se comportando de
// forma inconsistente. Limpa antes de começar, sem depender de lembrar.
function killStaleMetroProcess() {
  if (process.platform === "win32") {
    try {
      const out = execSync(`netstat -ano | findstr :${METRO_PORT} | findstr LISTENING`, { encoding: "utf8" });
      const pids = new Set(
        out.split("\n").map((line) => line.trim().split(/\s+/).pop()).filter(Boolean)
      );
      for (const pid of pids) {
        try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" }); } catch { /* já não existia mais */ }
      }
    } catch {
      // porta já livre, ok.
    }
  } else {
    try { execSync(`lsof -ti tcp:${METRO_PORT} | xargs -r kill -9`, { stdio: "ignore" }); } catch { /* porta livre */ }
  }
}

// O Metro guarda um cache persistente de "quais arquivos existem no
// projeto" (haste file map) fora da pasta do projeto, em os.tmpdir() --
// esse cache NÃO é limpo pela flag -c do "expo start" (que só reseta o
// cache de transform). Quando ele fica inconsistente (ex: depois de matar
// processos Node à força), o Metro quebra com "Cannot read properties of
// undefined (reading 'get')" dentro de DependencyGraph.js e o app nem
// chega a carregar no Expo Go. Apagar esses arquivos é seguro: são só um
// índice temporário, recriado do zero sozinho -- não afeta código, git
// nem dados do banco.
function clearStaleMetroFileMapCache() {
  const tmpDir = os.tmpdir();
  try {
    for (const entry of fs.readdirSync(tmpDir)) {
      if (entry.startsWith("metro-file-map-") || entry === "metro-cache") {
        fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
      }
    }
  } catch {
    // best-effort -- problema de permissao aqui nao deve travar o start
  }
  try {
    execSync("watchman watch-del-all", { stdio: "ignore" });
  } catch {
    // watchman pode nao estar instalado/rodando -- Metro cai pro watcher nativo
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log("[start:lan] Limpando processo antigo do Metro, se houver...");
killStaleMetroProcess();
console.log("[start:lan] Limpando cache antigo de arquivos do Metro, se houver...");
clearStaleMetroFileMapCache();
await sleep(2000);

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
      if (isPrivateIpv4(item.address)) {
        return item.address;
      }
    }
  }
  return "127.0.0.1";
}

const hostIp = resolveLanIpv4();
process.env.REACT_NATIVE_PACKAGER_HOSTNAME = hostIp;
process.env.EXPO_NO_DEPENDENCY_VALIDATION = "true";
process.env.EXPO_PACKAGER_PROXY_URL = `http://${hostIp}:8081`;

console.log(`[start:lan] REACT_NATIVE_PACKAGER_HOSTNAME=${hostIp}`);
console.log(`[start:lan] EXPO_NO_DEPENDENCY_VALIDATION=true`);
console.log(`[start:lan] EXPO_PACKAGER_PROXY_URL=http://${hostIp}:8081`);

const expoArgs = ["start", "--go", "--host", "lan", "--port", "8081", "-c"];
const localExpoBin = process.platform === "win32"
  ? path.join(process.cwd(), "node_modules", ".bin", "expo.cmd")
  : path.join(process.cwd(), "node_modules", ".bin", "expo");

const child = fs.existsSync(localExpoBin)
  ? process.platform === "win32"
    ? spawn("cmd.exe", ["/c", `${localExpoBin} ${expoArgs.join(" ")}`], {
        stdio: "inherit",
        env: process.env
      })
    : spawn(localExpoBin, expoArgs, {
        stdio: "inherit",
        env: process.env
      })
  : process.platform === "win32"
    ? spawn("cmd.exe", ["/c", `npx expo ${expoArgs.join(" ")}`], {
        stdio: "inherit",
        env: process.env
      })
    : spawn("npx", ["expo", ...expoArgs], {
        stdio: "inherit",
        env: process.env
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
