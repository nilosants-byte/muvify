/**
 * start-share.mjs
 *
 * Tunnel apenas do Metro/Expo Go via cloudflared, para compartilhar o app
 * com alguem em outra rede (ex: socio testando de outra cidade). O backend
 * ja e publico (Render staging, configurado via EXPO_PUBLIC_API_BASE_URL
 * no .env), entao nao precisamos tunelar nada do backend nem rodar Docker
 * ou "npm run dev" localmente.
 *
 * Usage:
 *   npm run start:share
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execSync } from "node:child_process";
import { createInterface } from "node:readline";

const CLOUDFLARED_PATTERN = /https:\/\/([a-z0-9]+-[a-z0-9][a-z0-9-]*)\.trycloudflare\.com/i;
const METRO_PORT_CANDIDATES = [8081, 8082, 8083];

// Se um terminal anterior for fechado direto (em vez de Ctrl+C + esperar o
// processo sair), o Metro e/ou o cloudflared ficam "fantasmas" rodando em
// segundo plano, presos numa porta e/ou com um túnel que não aponta mais
// pra nada de útil. Rodadas seguintes então competem com esses processos
// travados, ou o QR/link gerado às vezes acaba resolvendo pro processo
// morto -- é exatamente o que causou o "the request timed out" no Expo Go.
// Limpa qualquer processo preso ANTES de começar uma rodada nova, sem
// depender de ninguém lembrar de fazer isso manualmente.
function killStaleMetroAndTunnelProcesses() {
  if (process.platform === "win32") {
    for (const port of METRO_PORT_CANDIDATES) {
      try {
        const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: "utf8" });
        const pids = new Set(
          out.split("\n").map((line) => line.trim().split(/\s+/).pop()).filter(Boolean)
        );
        for (const pid of pids) {
          try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" }); } catch { /* já não existia mais */ }
        }
      } catch {
        // findstr sem match sai com código != 0 -- porta já livre, ok.
      }
    }
    try {
      execSync(`taskkill /F /IM cloudflared.exe`, { stdio: "ignore" });
    } catch {
      // nenhum cloudflared rodando -- ok.
    }
  } else {
    for (const port of METRO_PORT_CANDIDATES) {
      try { execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: "ignore" }); } catch { /* porta livre */ }
    }
    try { execSync(`pkill -f cloudflared`, { stdio: "ignore" }); } catch { /* nao tinha nenhum */ }
  }
}

// Além do Metro/cloudflared travados na porta, o Metro guarda um cache
// persistente de "quais arquivos existem no projeto" (haste file map) fora
// da pasta do projeto, em os.tmpdir() -- esse cache NÃO é limpo pela flag
// --clear do "expo start" (que só reseta o cache de transform). Quando ele
// fica num estado inconsistente (ex: depois de matar processos Node à
// força durante alguma depuração), o Metro quebra com "Cannot read
// properties of undefined (reading 'get')" dentro de DependencyGraph.js e
// o app nem chega a carregar no Expo Go. Apagar esses arquivos é seguro:
// são só um índice temporário, recriado do zero sozinho na próxima subida
// -- não afeta código, git nem dados do banco.
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

const CLOUDFLARED_BIN = process.platform === "win32"
  ? `${os.homedir()}\\cloudflared.exe`
  : "cloudflared";

function resolveCloudflaredCommand() {
  if (process.platform === "win32" && fs.existsSync(CLOUDFLARED_BIN)) return CLOUDFLARED_BIN;
  return "cloudflared";
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
    // Sem isso, quando o cloudflared morre antes de achar a URL, só
    // sobrava o código de saída (ex: "encerrou com codigo 1") sem
    // nenhuma pista do motivo real -- guarda as últimas linhas pra
    // conseguir mostrar o erro de verdade no reject.
    const recentLines = [];
    function remember(line) {
      recentLines.push(String(line));
      if (recentLines.length > 20) recentLines.shift();
    }

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      reject(new Error("Timeout ao criar tunnel cloudflared para o Metro."));
    }, 45_000);

    function tryResolve(line) {
      remember(line);
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
      const details = recentLines.length ? `\n${recentLines.join("\n")}` : " (sem saida capturada)";
      reject(new Error(`cloudflared encerrou com codigo ${code ?? "desconhecido"}.${details}`));
    });
  });
}

function startExpo(metroTunnelUrl, metroPort) {
  const hostname = new URL(metroTunnelUrl).hostname;
  const env = {
    ...process.env,
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

  // Fallback de compatibilidade se o binario local nao existir.
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// O link do túnel fica pronto (cloudflared responde) bem antes do Metro
// terminar de montar o haste map/dependency graph -- e o handler de
// "/status" do Expo só responde depois que `getMetroBundler().ready()`
// resolve, ou seja, é o sinal certo de "Metro realmente pronto para
// servir bundle/asset". Sem esperar por isso, o Expo Go conecta assim
// que recebe o link, cai bem no meio da inicialização e quebra com
// "Cannot read properties of undefined (reading 'get'/'exists')" dentro
// do Metro (DependencyGraph.js / Assets.js) -- e como o Expo Go não
// reconecta sozinho depois, nem "Reload JS" resolve.
function waitForMetroReady(metroPort, expoProc, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const deadline = Date.now() + timeoutMs;

    function finish(fn, arg) {
      if (settled) return;
      settled = true;
      expoProc.off("exit", onExpoExit);
      fn(arg);
    }

    function onExpoExit(code) {
      finish(reject, new Error(`O processo do Expo encerrou (codigo ${code ?? "desconhecido"}) antes do Metro ficar pronto.`));
    }
    expoProc.once("exit", onExpoExit);

    async function poll() {
      if (settled) return;
      if (Date.now() > deadline) {
        finish(reject, new Error("Timeout esperando o Metro ficar pronto (endpoint /status nao respondeu a tempo)."));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${metroPort}/status`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          finish(resolve);
          return;
        }
      } catch {
        // Metro ainda nem esta escutando na porta, ou ainda inicializando -- tenta de novo.
      }
      setTimeout(poll, 1000);
    }

    poll();
  });
}

async function main() {
  console.log("[start:share] Limpando processos antigos do Metro/túnel, se houver...");
  killStaleMetroAndTunnelProcesses();
  console.log("[start:share] Limpando cache antigo de arquivos do Metro, se houver...");
  clearStaleMetroFileMapCache();
  // Depois de um taskkill, o Windows leva um instante pra liberar a porta de
  // verdade (netstat pode continuar mostrando LISTENING por alguns segundos
  // mesmo com o processo já encerrado) -- sem essa espera, resolveMetroPort()
  // logo abaixo poderia ver a porta como "ocupada" ainda por engano.
  await sleep(2000);

  const metroPort = await resolveMetroPort();
  console.log(`[start:share] Porta Metro selecionada: ${metroPort}`);
  console.log(`[start:share] Abrindo tunnel do app (Metro ${metroPort}) via cloudflared...`);
  const cloudflaredProc = startCloudflaredForMetro(metroPort);
  const metroTunnelUrl = await waitForCloudflaredUrl(cloudflaredProc);
  const expoGoUrl = `exp://${new URL(metroTunnelUrl).hostname}`;

  const expoProc = startExpo(metroTunnelUrl, metroPort);

  console.log("[start:share] Tunnel criado, aguardando o Metro terminar de inicializar antes de liberar o link...");
  await waitForMetroReady(metroPort, expoProc);

  console.log(`[start:share] Metro tunnel: ${metroTunnelUrl}`);
  console.log(`[start:share] Expo Go URL: ${expoGoUrl}`);
  console.log(`[start:share] Backend (do .env): ${process.env.EXPO_PUBLIC_API_BASE_URL ?? "(nao definido)"}`);

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
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  expoProc.on("exit", (code) => {
    shutdown();
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(`[start:share] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
