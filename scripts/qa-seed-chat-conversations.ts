// Cria duas conversas fictícias (uma ativa, uma encerrada/histórico) pra um
// profissional real testar a lista de "Conversas" (ícone de balõezinhos na
// Home) sem depender de um aluno de verdade mandando mensagem.
//
// A lista de chats do backend só mostra um agendamento se ele já tiver pelo
// menos 1 BookingMessage — por isso os agendamentos fictícios criados por
// qa-seed-agenda.ts (sem nenhuma mensagem) nunca aparecem lá. Este script
// cria os próprios agendamentos + a primeira mensagem, do lado do aluno.
//
// "Ativa" vs "Inativa" na tela: puramente o status do agendamento
// (PENDING/CONFIRMED = ativa; qualquer outro = encerrada/somente leitura) —
// ver isChatOpen() em chat.controller.ts.
//
// Cada aluno fictício é identificável (e-mail terminando em
// "@muvify.qa-seed.local") e é removido junto com tudo que ele gerou por
// `npm run qa:cleanup-students` (booking com notes="QA_SEED_STUDENT").
//
// IMPORTANTE: qualquer import estático de algo em src/ roda ANTES do
// dotenv.config() abaixo (hoisting do ESM/TS) — por isso tudo que depende de
// env é importado dinamicamente dentro de main().
//
// Roda contra o banco apontado por DATABASE_URL em .env.qa-staging (NUNCA
// commitado).
//
// Uso: npm run qa:seed-chat -- --email=seu-email-de-provider@exemplo.com

import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.qa-staging"), override: true });

const QA_EMAIL_DOMAIN = "muvify.qa-seed.local";
const DAY_MS = 24 * 60 * 60 * 1000;

function qaEmail(slug: string) {
  return `qa.${slug}@${QA_EMAIL_DOMAIN}`;
}

function qaPhone(n: number) {
  return `1199996${String(n).padStart(4, "0")}`;
}

async function main() {
  const { prisma } = await import("../src/config/prisma");
  const { BookingStatus } = await import("@prisma/client");

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
    throw new Error("Uso: npm run qa:seed-chat -- --email=seu-email-de-provider@exemplo.com");
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

  // 1) Conversa ATIVA — agendamento confirmado no futuro, com 1 mensagem do
  //    aluno ainda não lida (testa o badge de não lida + responder).
  const carla = await upsertQaClient("chat.ativa", "QA Carla Conversa Ativa", 1);
  const activeBooking = await prisma.booking.create({
    data: {
      clientId: carla.id,
      providerId: provider.id,
      categoryId,
      priceCents: 12000,
      status: BookingStatus.CONFIRMED,
      scheduledAt: new Date(now.getTime() + 2 * DAY_MS),
      notes: "QA_SEED_STUDENT"
    }
  });
  await prisma.bookingMessage.create({
    data: {
      bookingId: activeBooking.id,
      senderId: carla.id,
      content: "Oi! Posso levar uma toalha e água ou o local já fornece?"
    }
  });

  // 2) Conversa INATIVA — agendamento já cancelado, com histórico de
  //    mensagem (testa "Conversa encerrada — somente leitura" e denunciar).
  const diego = await upsertQaClient("chat.inativa", "QA Diego Conversa Encerrada", 2);
  const closedBooking = await prisma.booking.create({
    data: {
      clientId: diego.id,
      providerId: provider.id,
      categoryId,
      priceCents: 12000,
      status: BookingStatus.CANCELLED,
      scheduledAt: new Date(now.getTime() - 5 * DAY_MS),
      notes: "QA_SEED_STUDENT"
    }
  });
  await prisma.bookingMessage.create({
    data: {
      bookingId: closedBooking.id,
      senderId: diego.id,
      content: "Preciso remarcar, surgiu um imprevisto."
    }
  });

  console.log("Conversas fictícias criadas com sucesso para", providerEmail);
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
