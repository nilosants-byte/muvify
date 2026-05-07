import fs from "node:fs";
import path from "node:path";

const sourceAssets =
  "C:/Users/Danilo/Documents/dev/personal-app-backend/mobile-app/assets/stitch-screens";

const outputHistoryRoot = "C:/Users/Danilo/Documents/testes app/muvify-prints-history";
const latestDarkOut = "C:/Users/Danilo/Documents/testes app/muvify-prints-dark";
const latestLightOut = "C:/Users/Danilo/Documents/testes app/muvify-prints-light";
const latestPointerFile = "C:/Users/Danilo/Documents/testes app/muvify-prints-history/LATEST.txt";

const darkSplashCandidates = [
  "C:/Users/Danilo/Documents/testes app/01-auth-splash-intro.png",
  "C:/Users/Danilo/Documents/dev/personal-app-backend/mobile-app/assets/splash-icon.png"
];

const lightSplashCandidates = [
  "C:/Users/Danilo/Documents/testes app/01-auth-splash-intro-light.png",
  "C:/Users/Danilo/Documents/testes app/01-auth-splash-intro.png",
  "C:/Users/Danilo/Documents/dev/personal-app-backend/mobile-app/assets/splash-icon.png"
];

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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  ensureDir(dir);
  for (const file of fs.readdirSync(dir)) {
    if (file.toLowerCase().endsWith(".png")) {
      fs.unlinkSync(path.join(dir, file));
    }
  }
}

function formatStamp(date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}

function resolveSplashPath(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Splash nao encontrada. Verifique uma destas opcoes: ${candidates.join(" | ")}`
  );
}

function buildTheme(mode, outDir, splashFilePath) {
  cleanDir(outDir);

  if (!fs.existsSync(splashFilePath)) {
    throw new Error(`Splash nao encontrada: ${splashFilePath}`);
  }
  fs.copyFileSync(splashFilePath, path.join(outDir, "01-auth-splash-intro.png"));

  const screenIds = Object.keys(screenMap);
  for (let i = 0; i < screenIds.length; i += 1) {
    const screenId = screenIds[i];
    const sourceName = screenMap[screenId][mode];
    const sourcePath = path.join(sourceAssets, sourceName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Arquivo Stitch ausente: ${sourcePath}`);
    }
    const targetName = `${String(i + 2).padStart(2, "0")}-${screenId}.png`;
    fs.copyFileSync(sourcePath, path.join(outDir, targetName));
  }
}

function syncDir(srcDir, dstDir) {
  cleanDir(dstDir);
  for (const file of fs.readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, file);
    const dstPath = path.join(dstDir, file);
    fs.copyFileSync(srcPath, dstPath);
  }
}

function assertCount(dir, expected) {
  const pngCount = fs
    .readdirSync(dir)
    .filter((file) => file.toLowerCase().endsWith(".png")).length;

  if (pngCount !== expected) {
    throw new Error(`Contagem invalida em ${dir}: esperado ${expected}, recebido ${pngCount}.`);
  }
}

function hasLegacySplashSignature(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const buf = fs.readFileSync(filePath);
  const signature = Buffer.from("PersonalApp", "utf8");
  return buf.includes(signature);
}

function main() {
  ensureDir(outputHistoryRoot);

  const stamp = formatStamp(new Date());
  const runRoot = path.join(outputHistoryRoot, `muvify-prints-${stamp}`);
  const darkOut = path.join(runRoot, "muvify-prints-dark");
  const lightOut = path.join(runRoot, "muvify-prints-light");

  const darkSplashPath = resolveSplashPath(darkSplashCandidates);
  const lightSplashPath = resolveSplashPath(lightSplashCandidates);

  buildTheme("dark", darkOut, darkSplashPath);
  buildTheme("light", lightOut, lightSplashPath);

  // Maintain always-updated canonical folders, while also saving history snapshots.
  syncDir(darkOut, latestDarkOut);
  syncDir(lightOut, latestLightOut);

  const expected = Object.keys(screenMap).length + 1;
  assertCount(darkOut, expected);
  assertCount(lightOut, expected);
  assertCount(latestDarkOut, expected);
  assertCount(latestLightOut, expected);

  const darkSplash = path.join(darkOut, "01-auth-splash-intro.png");
  const lightSplash = path.join(lightOut, "01-auth-splash-intro.png");
  if (hasLegacySplashSignature(darkSplash) || hasLegacySplashSignature(lightSplash)) {
    throw new Error("Splash legado detectado. Gere novamente o arquivo base de splash.");
  }

  fs.writeFileSync(
    latestPointerFile,
    [`Ultima geracao: ${new Date().toISOString()}`, `Pasta: ${runRoot}`].join("\n")
  );

  console.log("Pacotes de fidelidade gerados com sucesso.");
  console.log(`Historico: ${runRoot}`);
  console.log(`Latest dark: ${latestDarkOut}`);
  console.log(`Latest light: ${latestLightOut}`);
}

main();
