import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const baseDir = "C:/Users/Danilo/Documents/dev/personal-app-backend/mobile-app/assets/stitch-screens";
const darkDir = "C:/Users/Danilo/Documents/testes app/muvify-prints-dark";
const lightDir = "C:/Users/Danilo/Documents/testes app/muvify-prints-light";

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
  busca_aluno: { dark: "busca_dark_aluno.png", light: "busca_light_aluno.png" },
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
  erro_generico: { dark: "erro_gen_rico_dark.png", light: "erro_gen_rico_light.png" },
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
  login_gramado: { dark: "login_dark_gramado.png", light: "login_light_gramado.png" },
  meu_perfil_aluno: {
    dark: "meu_perfil_dark_aluno.png",
    light: "meu_perfil_light_aluno.png"
  },
  meus_agendamentos: {
    dark: "meus_agendamentos_dark.png",
    light: "meus_agendamentos_light.png"
  },
  notificacoes: { dark: "notifica_es_dark.png", light: "notifica_es_light.png" },
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
  promocoes: { dark: "promo_es_dark.png", light: "promo_es_light.png" },
  recuperar_senha_gramado: {
    dark: "recuperar_senha_dark_gramado.png",
    light: "recuperar_senha_light_gramado.png"
  },
  sem_internet: { dark: "sem_internet_dark.png", light: "sem_internet_light.png" },
  sessao_expirada_gramado: {
    dark: "sess_o_expirada_dark_gramado.png",
    light: "sess_o_expirada_light_gramado.png"
  },
  seu_treino: { dark: "seu_treino_dark.png", light: "seu_treino_light.png" },
  solicitacao_consultoria: {
    dark: "solicita_o_consultoria_dark.png",
    light: "solicita_o_consultoria_light.png"
  },
  status_pagamento: {
    dark: "status_de_pagamento_dark.png",
    light: "status_de_pagamento_light.png"
  }
};

function sha(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function compareMode(mode) {
  const targetDir = mode === "dark" ? darkDir : lightDir;
  const diffs = [];

  for (const screenId of Object.keys(screenMap)) {
    const captured = path.join(targetDir, `${String(Object.keys(screenMap).indexOf(screenId) + 2).padStart(2, "0")}-${screenId}.png`);
    const reference = path.join(baseDir, screenMap[screenId][mode]);
    if (!fs.existsSync(captured) || !fs.existsSync(reference)) {
      diffs.push({
        screenId,
        reason: "missing file",
        capturedExists: fs.existsSync(captured),
        referenceExists: fs.existsSync(reference)
      });
      continue;
    }
    if (sha(captured) !== sha(reference)) {
      diffs.push({
        screenId,
        reason: "hash mismatch"
      });
    }
  }

  return diffs;
}

function main() {
  const darkDiffs = compareMode("dark");
  const lightDiffs = compareMode("light");
  console.log(
    JSON.stringify(
      {
        darkDiffs: darkDiffs.length,
        lightDiffs: lightDiffs.length,
        sampleDark: darkDiffs.slice(0, 10),
        sampleLight: lightDiffs.slice(0, 10)
      },
      null,
      2
    )
  );
}

main();
