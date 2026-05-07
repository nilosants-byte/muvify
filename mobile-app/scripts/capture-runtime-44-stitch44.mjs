import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT_DIR = process.env.CAPTURE_OUT_DIR ?? "C:/Users/Danilo/Documents/testes app/runtime-44-prints-final";
const APP_URL = process.env.CAPTURE_APP_URL ?? "http://127.0.0.1:8081";

const SCREENS = [
  ["01", "splash"],
  ["02", "onboarding_1"],
  ["03", "onboarding_2"],
  ["04", "login"],
  ["05", "cadastro"],
  ["06", "recuperar"],
  ["07", "escolha_perfil"],
  ["08", "resumo_aluno"],
  ["09", "resumo_profissional"],
  ["10", "sessao_expirada"],
  ["11", "menu_lateral"],
  ["12", "notificacoes"],
  ["13", "configuracoes"],
  ["14", "sem_internet"],
  ["15", "erro_generico"],
  ["16", "home_aluno"],
  ["17", "busca_profissionais"],
  ["18", "lista_profissionais"],
  ["19", "detalhe_profissional"],
  ["20", "favoritos"],
  ["21", "catalogo_servicos"],
  ["22", "solicitacao_consultoria"],
  ["23", "proposta_recebida"],
  ["24", "checkout_pagamento"],
  ["25", "meus_agendamentos"],
  ["26", "detalhe_agendamento_presencial"],
  ["27", "conclusao_presencial"],
  ["28", "preview_selfie"],
  ["29", "seu_treino_lista"],
  ["30", "detalhe_treino"],
  ["31", "promocoes"],
  ["32", "anamnese_aluno"],
  ["33", "home_profissional"],
  ["34", "agenda_semanal_profissional"],
  ["35", "criar_editar_compromisso_manual"],
  ["36", "gestao_de_alunos"],
  ["37", "detalhe_do_aluno"],
  ["38", "servicos_e_precos"],
  ["39", "disponibilidade_semanal"],
  ["40", "consultorias_recebidas"],
  ["41", "responder_consultoria"],
  ["42", "planos_treino_profissional"],
  ["43", "editor_de_treino"],
  ["44", "financeiro"]
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureImageReady(page, screenId) {
  if (screenId === "01") {
    await page.waitForTimeout(1200);
    return;
  }

  await page.waitForSelector(`[data-testid="stitch44-screen-${screenId}"]`, {
    timeout: 120000
  });
}

async function captureWithRetry(page, outPath, screenId, retries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await page.goto(`${APP_URL}?stitch44=${screenId}`, {
        waitUntil: "domcontentloaded",
        timeout: 180000
      });
      await ensureImageReady(page, screenId);
      await delay(350);
      await page.screenshot({
        path: outPath,
        animations: "disabled",
        timeout: 120000
      });

      if (screenId !== "01") {
        const size = fs.statSync(outPath).size;
        if (size < 10000) {
          throw new Error(`Screenshot likely invalid (file too small: ${size} bytes).`);
        }
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(500);
      }
    }
  }

  throw lastError;
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (name.toLowerCase().endsWith(".png")) {
      fs.unlinkSync(path.join(OUT_DIR, name));
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);

  try {
    for (const [id, slug] of SCREENS) {
      const file = `${id}-${slug}.png`;
      const outPath = path.join(OUT_DIR, file);
      await captureWithRetry(page, outPath, id, 4);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`Captured ${SCREENS.length} screens in ${OUT_DIR}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
