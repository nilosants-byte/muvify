// Cria solicitações de consultoria fictícias pra um profissional real testar
// a Central de Consultoria > Pedidos (responder com proposta) sem precisar
// de uma segunda conta de aluno de verdade enviando o pedido.
//
// Cada aluno fictício é identificável (e-mail terminando em
// "@muvify.qa-seed.local") e é removido junto com tudo que ele gerou por
// `npm run qa:cleanup-students` (já cobre consultancyRequest por clientId).
//
// IMPORTANTE: qualquer import estático de algo em src/ roda ANTES do
// dotenv.config() abaixo (hoisting do ESM/TS) — por isso tudo que depende de
// env é importado dinamicamente dentro de main().
//
// Roda contra o banco apontado por DATABASE_URL em .env.qa-staging (NUNCA
// commitado).
//
// Uso: npm run qa:seed-consultancy-requests -- --email=seu-email-de-provider@exemplo.com

import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.qa-staging"), override: true });

const QA_EMAIL_DOMAIN = "muvify.qa-seed.local";
const HOUR_MS = 60 * 60 * 1000;

function qaEmail(slug: string) {
  return `qa.${slug}@${QA_EMAIL_DOMAIN}`;
}

function qaPhone(n: number) {
  return `1199997${String(n).padStart(4, "0")}`;
}

async function main() {
  const { prisma } = await import("../src/config/prisma");
  const { env } = await import("../src/config/env");

  async function upsertQaClient(slug: string, name: string, phoneSeed: number) {
    return prisma.user.upsert({
      where: { email: qaEmail(slug) },
      update: { name },
      create: {
        name,
        email: qaEmail(slug),
        password: "qa-seed-nao-usado",
        phone: qaPhone(phoneSeed),
        role: "CLIENT"
      }
    });
  }

  const emailArg = process.argv.find((a) => a.startsWith("--email="));
  const providerEmail = emailArg?.split("=")[1];
  if (!providerEmail) {
    throw new Error("Uso: npm run qa:seed-consultancy-requests -- --email=seu-email-de-provider@exemplo.com");
  }

  const providerUser = await prisma.user.findUnique({ where: { email: providerEmail } });
  if (!providerUser || providerUser.role !== "PROVIDER") {
    throw new Error(`Nenhuma conta PROVIDER encontrada com o e-mail "${providerEmail}".`);
  }
  const provider = await prisma.providerProfile.findUnique({ where: { userId: providerUser.id } });
  if (!provider) {
    throw new Error(`Usuário "${providerEmail}" não tem perfil de profissional criado ainda.`);
  }

  const now = new Date();
  const deadlineHours = env.CONSULTANCY_DELIVERY_DEADLINE_HOURS;

  // 1) Solicitação aberta, sem oferta pré-escolhida — testa o profissional
  //    escolhendo a oferta na hora de responder.
  const marina = await upsertQaClient("consultoria.aberta", "QA Marina Solicitação Aberta", 1);
  await prisma.consultancyRequest.create({
    data: {
      providerId: provider.id,
      clientId: marina.id,
      trainingNeedText: "Quero emagrecer e ganhar resistência — treino em casa, sem equipamentos.",
      limitationText: "Dor no joelho direito, evitar impacto.",
      extraInfoText: "Disponibilidade: fim de tarde, de segunda a sexta.",
      status: "OPEN",
      responseDeadlineAt: new Date(now.getTime() + deadlineHours * HOUR_MS)
    }
  });

  // 2) Solicitação aberta perto do prazo (2h pra vencer) — testa o aviso de
  //    urgência/lembrete de resposta, se houver na tela.
  const bruno = await upsertQaClient("consultoria.urgente", "QA Bruno Solicitação Urgente", 2);
  await prisma.consultancyRequest.create({
    data: {
      providerId: provider.id,
      clientId: bruno.id,
      trainingNeedText: "Hipertrofia — já treino há 1 ano, quero evoluir a carga.",
      limitationText: null,
      extraInfoText: null,
      status: "OPEN",
      responseDeadlineAt: new Date(now.getTime() + 2 * HOUR_MS)
    }
  });

  console.log("Solicitações fictícias criadas com sucesso para", providerEmail);
  console.log("Quando terminar de testar, rode: npm run qa:cleanup-students -- --email=" + providerEmail);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../src/config/prisma");
    await prisma.$disconnect();
  });
