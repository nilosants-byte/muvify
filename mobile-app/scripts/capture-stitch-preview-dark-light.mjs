import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const MOBILE_DIR = path.resolve("C:/Users/Danilo/Documents/dev/personal-app-backend/mobile-app");
const APP_URL = "http://127.0.0.1:8081";
const OUT_BASE =
  process.env.CAPTURE_OUT_BASE ?? "C:/Users/Danilo/Documents/testes app";
const OUT_PREFIX = process.env.CAPTURE_OUT_PREFIX ?? "muvify-prints";

const screenMap = {
  agenda_profissional: {
    dark: "agenda_profissional_dark.png",
    light: "agenda_profissional_light.png"
  },
  ajuda_e_suporte: {
    dark: "ajuda_e_suporte_dark.png",
    light: "ajuda_e_suporte_light.png"
  },
  arquivados_aluno: {
    dark: "arquivados_dark_aluno.png",
    light: "arquivados_light_aluno.png"
  },
  arquivados_profissional: {
    dark: "arquivados_dark_profissional.png",
    light: "arquivados_light_profissional.png"
  },
  avaliar_profissional: {
    dark: "avaliar_profissional_dark.png",
    light: "avaliar_profissional_light.png"
  },
  busca_aluno: {
    dark: "busca_dark_aluno.png",
    light: "busca_light_aluno.png"
  },
  cadastro_gramado: {
    dark: "cadastro_dark_gramado.png",
    light: "cadastro_light_gramado.png"
  },
  categorias_aluno: {
    dark: "categorias_dark_aluno.png",
    light: "categorias_light_aluno.png"
  },
  central_consultoria_profissional: {
    dark: "central_de_consultoria_dark_profissional.png",
    light: "central_de_consultoria_light_profissional.png"
  },
  conclusao_selfie_aluno: {
    dark: "conclus_o_com_selfie_dark.png",
    light: "conclus_o_com_selfie_light.png"
  },
  conclusao_selfie_profissional: {
    dark: "conclus_o_com_selfie_dark_profissional.png",
    light: "conclus_o_com_selfie_light_profissional.png"
  },
  configuracoes_aluno: {
    dark: "configura_es_dark_aluno.png",
    light: "configura_es_light_aluno.png"
  },
  configuracoes_profissional: {
    dark: "configura_es_dark_profissional.png",
    light: "configura_es_light_profissional.png"
  },
  confirmacao_agendamento: {
    dark: "confirma_o_agendamento_dark.png",
    light: "confirma_o_agendamento_light.png"
  },
  conta_recebimento_profissional: {
    dark: "conta_de_recebimento_dark_profissional.png",
    light: "conta_de_recebimento_light_profissional.png"
  },
  criar_agendamento: {
    dark: "criar_agendamento_dark.png",
    light: "criar_agendamento_light.png"
  },
  detalhe_agendamento: {
    dark: "detalhe_agendamento_dark.png",
    light: "detalhe_agendamento_light.png"
  },
  detalhe_atendimento_profissional: {
    dark: "detalhe_atendimento_dark_profissional.png",
    light: "detalhe_atendimento_light_profissional.png"
  },
  detalhe_profissional: {
    dark: "detalhe_profissional_dark.png",
    light: "detalhe_profissional_light.png"
  },
  disponibilidade_semanal: {
    dark: "disponibilidade_semanal_dark.png",
    light: "disponibilidade_semanal_light.png"
  },
  erro_generico: {
    dark: "erro_gen_rico_dark.png",
    light: "erro_gen_rico_light.png"
  },
  escolha_perfil_gramado: {
    dark: "escolha_de_perfil_dark_gramado.png",
    light: "escolha_de_perfil_light_gramado.png"
  },
  favoritos_aluno: {
    dark: "favoritos_dark_aluno.png",
    light: "favoritos_light_aluno.png"
  },
  financeiro_profissional: {
    dark: "financeiro_dark_profissional.png",
    light: "financeiro_light_profissional.png"
  },
  home_aluno_gramado: {
    dark: "home_aluno_dark_gramado.png",
    light: "home_aluno_light_gramado.png"
  },
  home_profissional: {
    dark: "home_profissional_dark.png",
    light: "home_profissional_light.png"
  },
  lista_profissionais_aluno: {
    dark: "lista_profissionais_dark_aluno.png",
    light: "lista_profissionais_light_aluno.png"
  },
  login_gramado: {
    dark: "login_dark_gramado.png",
    light: "login_light_gramado.png"
  },
  meu_perfil_aluno: {
    dark: "meu_perfil_dark_aluno.png",
    light: "meu_perfil_light_aluno.png"
  },
  meus_agendamentos: {
    dark: "meus_agendamentos_dark.png",
    light: "meus_agendamentos_light.png"
  },
  notificacoes: {
    dark: "notifica_es_dark.png",
    light: "notifica_es_light.png"
  },
  onboarding_1_gramado: {
    dark: "onboarding_1_dark_gramado.png",
    light: "onboarding_1_light_gramado.png"
  },
  onboarding_2_gramado: {
    dark: "onboarding_2_dark_gramado.png",
    light: "onboarding_2_light_gramado.png"
  },
  pagamento_aluno: {
    dark: "pagamento_dark_aluno.png",
    light: "pagamento_light_aluno.png"
  },
  perfil_profissional: {
    dark: "perfil_profissional_dark.png",
    light: "perfil_profissional_light.png"
  },
  promocoes: {
    dark: "promo_es_dark.png",
    light: "promo_es_light.png"
  },
  recuperar_senha_gramado: {
    dark: "recuperar_senha_dark_gramado.png",
    light: "recuperar_senha_light_gramado.png"
  },
  sem_internet: {
    dark: "sem_internet_dark.png",
    light: "sem_internet_light.png"
  },
  sessao_expirada_gramado: {
    dark: "sess_o_expirada_dark_gramado.png",
    light: "sess_o_expirada_light_gramado.png"
  },
  seu_treino: {
    dark: "seu_treino_dark.png",
    light: "seu_treino_light.png"
  },
  solicitacao_consultoria: {
    dark: "solicita_o_consultoria_dark.png",
    light: "solicita_o_consultoria_light.png"
  },
  status_pagamento: {
    dark: "status_de_pagamento_dark.png",
    light: "status_de_pagamento_light.png"
  }
};

const stitchScreens = Object.keys(screenMap);

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
  if (!child || child.killed) return;

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
      if (!validate || validate(response.status, body)) return;
    } catch {
      // retry
    }
    await wait(intervalMs);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

function getPngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString("ascii", 1, 4) !== "PNG") {
    return { width: 390, height: 844 };
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function cleanPngs(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (name.toLowerCase().endsWith(".png")) {
      fs.unlinkSync(path.join(dir, name));
    }
  }
}

async function runForMode(mode) {
  const outDir = path.join(OUT_BASE, `${OUT_PREFIX}-${mode}`);
  cleanPngs(outDir);

  const expoWeb =
    process.platform === "win32"
      ? spawnProc("cmd.exe", ["/c", "npm run web -- --clear"], MOBILE_DIR, {
          EXPO_PUBLIC_THEME_MODE: mode
        })
      : spawnProc("npm", ["run", "web", "--", "--clear"], MOBILE_DIR, {
          EXPO_PUBLIC_THEME_MODE: mode
        });

  try {
    await waitForHttp("http://127.0.0.1:8081/status", {
      validate: (_status, body) => body.includes("packager-status:running")
    });

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }
    });
    await context.addInitScript(() => {
      try {
        Object.defineProperty(document, "fonts", {
          configurable: true,
          value: {
            ready: Promise.resolve(),
            status: "loaded",
            check: () => true,
            load: () => Promise.resolve([]),
            addEventListener: () => undefined,
            removeEventListener: () => undefined
          }
        });
      } catch {
        // ignore
      }
    });
    const page = await context.newPage();

    try {
      await page.goto(`${APP_URL}?preview=splash&mode=${mode}`, {
        waitUntil: "commit",
        timeout: 240000
      });
      await page
        .waitForSelector('[data-testid="auth-splash-logo"]', {
          timeout: 120000
        })
        .catch(() => undefined);
      await page.waitForTimeout(1200);
      await page.screenshot({
        path: path.join(outDir, "01-auth-splash-intro.png"),
        timeout: 120000
      });

      for (let index = 0; index < stitchScreens.length; index += 1) {
        const screenId = stitchScreens[index];
        const sourceName = screenMap[screenId][mode];
        const sourcePath = path.join(MOBILE_DIR, "assets/stitch-screens", sourceName);
        const { width, height } = getPngSize(sourcePath);

        await page.setViewportSize({ width, height });
        await page.goto(`${APP_URL}?stitch=${screenId}&mode=${mode}`, {
          waitUntil: "commit",
          timeout: 240000
        });
        await page.waitForSelector(`[data-testid=\"stitch-screen-${screenId}\"]`, {
          timeout: 120000
        });
        await page.waitForTimeout(120);

        const fileName = `${String(index + 2).padStart(2, "0")}-${screenId}.png`;
        await page.screenshot({
          path: path.join(outDir, fileName),
          timeout: 120000
        });
      }
    } finally {
      await context.close();
      await browser.close();
    }

    const count = fs
      .readdirSync(outDir)
      .filter((name) => name.toLowerCase().endsWith(".png")).length;
    console.log(`Tema ${mode}: ${count} prints gerados em ${outDir}`);
  } finally {
    await killProcessTree(expoWeb);
    await wait(1500);
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
