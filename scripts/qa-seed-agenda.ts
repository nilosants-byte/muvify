// Popula agendamentos fictícios vinculados a uma conta PROVIDER real, pra dar
// massa de dados suficiente pra testar manualmente a Agenda e as telas
// relacionadas (detalhe do agendamento, validação de presença, confirmação
// de conclusão, status de pagamento) sem depender de agendamentos reais.
//
// Datas sempre relativas a "agora" (momento em que o script roda) — ao
// contrário de datas fixas, isso evita o problema de um agendamento "no
// futuro" virar passado (e ser cancelado sozinho) só porque o teste manual
// aconteceu dias depois do seed ter sido rodado.
//
// Roda contra o banco apontado por DATABASE_URL em .env.qa-staging (NUNCA
// commitado) — não o banco local de dev nem o de teste automatizado. Todos
// os registros criados são identificáveis (e-mail terminando em
// "@muvify.qa-seed.local", notes="QA_SEED_STUDENT") e removidos com
// `npm run qa:cleanup-students` (o mesmo script já usado pros alunos).
//
// IMPORTANTE: qualquer import estático de algo em src/ roda ANTES do
// dotenv.config() abaixo (hoisting de "import" do ESM/TS) — por isso tudo
// que depende de env é importado dinamicamente dentro de main().
//
// Uso: npm run qa:seed-agenda -- --email=seu-email-de-provider@exemplo.com

import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.qa-staging"), override: true });

import { BookingStatus } from "@prisma/client";

const QA_EMAIL_DOMAIN = "muvify.qa-seed.local";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function qaEmail(slug: string) {
  return `qa.${slug}@${QA_EMAIL_DOMAIN}`;
}

function qaPhone(n: number) {
  return `1199998${String(n).padStart(4, "0")}`;
}

async function main() {
  const { prisma } = await import("../src/config/prisma");

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

  async function resolveCategoryId(providerId: string): Promise<string> {
    const existing = await prisma.providerCategory.findFirst({
      where: { providerId },
      select: { categoryId: true }
    });
    if (existing) return existing.categoryId;

    const anyCategory = await prisma.serviceCategory.findFirst({ select: { id: true } });
    if (anyCategory) return anyCategory.id;

    const created = await prisma.serviceCategory.create({
      data: { name: "Personal Trainer", description: "Treinamento físico personalizado." }
    });
    return created.id;
  }

  const emailArg = process.argv.find((a) => a.startsWith("--email="));
  const providerEmail = emailArg?.split("=")[1];
  if (!providerEmail) {
    throw new Error("Uso: npm run qa:seed-agenda -- --email=seu-email-de-provider@exemplo.com");
  }

  const providerUser = await prisma.user.findUnique({ where: { email: providerEmail } });
  if (!providerUser || providerUser.role !== "PROVIDER") {
    throw new Error(`Nenhuma conta PROVIDER encontrada com o e-mail "${providerEmail}".`);
  }
  const provider = await prisma.providerProfile.findUnique({ where: { userId: providerUser.id } });
  if (!provider) {
    throw new Error(`Usuário "${providerEmail}" não tem perfil de profissional criado ainda.`);
  }

  const categoryId = await resolveCategoryId(provider.id);
  const now = new Date();

  // 1) Confirmado, daqui a 3 dias — testa abrir o detalhe (p5-1 passo 5),
  //    indicador verde no calendário/faixa da semana.
  const gustavo = await upsertQaClient("agenda.confirmado", "QA Gustavo Agendamento Confirmado", 1);
  await prisma.booking.create({
    data: {
      clientId: gustavo.id,
      providerId: provider.id,
      categoryId,
      priceCents: 12000,
      status: BookingStatus.CONFIRMED,
      scheduledAt: new Date(now.getTime() + 3 * DAY_MS),
      notes: "QA_SEED_STUDENT"
    }
  });

  // 2) Confirmado, mas o horário já passou HOJE — testa o botão "Validar
  //    presença"/"Confirmar conclusão" aparecendo direto na lista (p5-1),
  //    e os fluxos de p5-2/p5-3.
  const helena = await upsertQaClient("agenda.vencido", "QA Helena Agendamento Vencido", 2);
  await prisma.booking.create({
    data: {
      clientId: helena.id,
      providerId: provider.id,
      categoryId,
      priceCents: 12000,
      status: BookingStatus.CONFIRMED,
      scheduledAt: new Date(now.getTime() - 3 * HOUR_MS),
      notes: "QA_SEED_STUDENT"
    }
  });

  // 3) Pendente, amanhã — variedade de status na lista.
  const igor = await upsertQaClient("agenda.pendente", "QA Igor Agendamento Pendente", 3);
  await prisma.booking.create({
    data: {
      clientId: igor.id,
      providerId: provider.id,
      categoryId,
      priceCents: 12000,
      status: BookingStatus.PENDING,
      scheduledAt: new Date(now.getTime() + DAY_MS),
      notes: "QA_SEED_STUDENT"
    }
  });

  console.log("Agendamentos fictícios criados com sucesso para", providerEmail);
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
