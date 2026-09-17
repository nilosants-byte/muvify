// Popula "alunos" fictícios vinculados a uma conta PROVIDER real, pra dar
// massa de dados suficiente pra testar manualmente a tela "Lista de alunos"
// e telas relacionadas (anamnese, ficha de treino, pacotes, convite de aluno
// externo) sem depender de contas de teste reais.
//
// Roda contra o banco apontado por DATABASE_URL em .env.qa-staging (NUNCA
// commitado) — não o banco local de dev nem o de teste automatizado. Todos
// os registros criados são identificáveis (e-mail terminando em
// "@muvify.qa-seed.local") pra serem removidos com segurança depois via
// `npm run qa:cleanup-students` (scripts/qa-cleanup-students.ts).
//
// IMPORTANTE: qualquer import estático de algo em src/ (ex: "../src/config/
// prisma") roda ANTES do dotenv.config() abaixo, porque o ESM/TS faz hoisting
// de "import" pro topo do arquivo independente de onde ele aparece no código
// — foi isso que fez a primeira versão deste script gravar tudo no banco
// LOCAL em vez do de staging, mesmo com override:true. Por isso tudo que
// depende de env (prisma, encryptJson, ConsultancyService) é importado
// dinamicamente DENTRO de main(), depois do dotenv.config().
//
// Uso: npm run qa:seed-students -- --email=seu-email-de-provider@exemplo.com

import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.qa-staging"), override: true });

import {
  BookingStatus,
  ConsultancyContractStatus,
  ConsultancyPaymentStatus,
  ConsultancyRequestStatus,
  PresentialPackageMode,
  PresentialPackageStatus,
  ServiceOfferKind
} from "@prisma/client";

const QA_EMAIL_DOMAIN = "muvify.qa-seed.local";
const DAY_MS = 24 * 60 * 60 * 1000;

function qaEmail(slug: string) {
  return `qa.${slug}@${QA_EMAIL_DOMAIN}`;
}

function qaPhone(n: number) {
  return `1199999${String(n).padStart(4, "0")}`;
}

async function main() {
  const { prisma } = await import("../src/config/prisma");
  const { ConsultancyService } = await import("../src/modules/consultancy/services/consultancy.service");
  const { encryptJson } = await import("../src/shared/utils/encryption");
  const consultancyService = new ConsultancyService();

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

  async function setAnamnesis(clientId: string, completed: boolean) {
    if (!completed) return; // ausência de ClientAnamnesis já é o estado "pendente"
    await prisma.clientAnamnesis.upsert({
      where: { clientId },
      update: { status: "COMPLETED", completedAt: new Date() },
      create: {
        clientId,
        status: "COMPLETED",
        completedAt: new Date(),
        answers: encryptJson({ seededForQa: true })
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
    throw new Error("Uso: npm run qa:seed-students -- --email=seu-email-de-provider@exemplo.com");
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

  // 1) Presencial ativo, anamnese NUNCA preenchida (testa p4-1 "Ativo" +
  //    badge de anamnese pendente + p4-3 "não preenchida").
  const ana = await upsertQaClient("ana.presencial", "QA Ana Presencial", 1);
  await prisma.booking.create({
    data: {
      clientId: ana.id,
      providerId: provider.id,
      categoryId,
      priceCents: 12000,
      status: BookingStatus.CONFIRMED,
      scheduledAt: new Date(now.getTime() + 2 * DAY_MS),
      notes: "QA_SEED_STUDENT"
    }
  });

  // 2) Consultoria online ativa sem nenhuma ficha entregue ainda (testa
  //    badge "ficha pendente" + fluxo de criação em p4-6).
  const bruno = await upsertQaClient("bruno.fichapendente", "QA Bruno Ficha Pendente", 2);
  await setAnamnesis(bruno.id, true);
  const brunoOffer = await prisma.providerServiceOffer.create({
    data: {
      providerId: provider.id,
      kind: ServiceOfferKind.ONLINE_CONSULTANCY,
      title: "QA Seed — Consultoria online",
      billingCycle: "MONTHLY",
      priceCents: 20000
    }
  });
  const brunoRequest = await prisma.consultancyRequest.create({
    data: {
      providerId: provider.id,
      clientId: bruno.id,
      status: ConsultancyRequestStatus.ACCEPTED,
      quotedOfferId: brunoOffer.id,
      responseDeadlineAt: now,
      respondedAt: now,
      clientDecisionAt: now
    }
  });
  await prisma.consultancyContract.create({
    data: {
      requestId: brunoRequest.id,
      providerId: provider.id,
      clientId: bruno.id,
      offerId: brunoOffer.id,
      status: ConsultancyContractStatus.ACTIVE,
      paymentStatus: ConsultancyPaymentStatus.CAPTURED,
      paymentAmountCents: 20000,
      providerAmountCents: 18000,
      platformAmountCents: 2000,
      paymentCapturedAt: now,
      billingCycle: "MONTHLY",
      kind: ServiceOfferKind.ONLINE_CONSULTANCY,
      deliveryDeadlineAt: new Date(now.getTime() + 2 * DAY_MS),
      immediateExecutionAcknowledgedAt: now
    }
  });

  // 3) Consultoria com ficha entregue e já vencida/vencendo (testa badge
  //    "renovação pendente").
  const carla = await upsertQaClient("carla.renovacao", "QA Carla Renovação Pendente", 3);
  await setAnamnesis(carla.id, true);
  const carlaOffer = await prisma.providerServiceOffer.create({
    data: {
      providerId: provider.id,
      kind: ServiceOfferKind.ONLINE_CONSULTANCY,
      title: "QA Seed — Consultoria com renovação de ficha",
      billingCycle: "MONTHLY",
      priceCents: 22000
    }
  });
  const carlaRequest = await prisma.consultancyRequest.create({
    data: {
      providerId: provider.id,
      clientId: carla.id,
      status: ConsultancyRequestStatus.ACCEPTED,
      quotedOfferId: carlaOffer.id,
      responseDeadlineAt: now,
      respondedAt: now,
      clientDecisionAt: now
    }
  });
  const carlaContract = await prisma.consultancyContract.create({
    data: {
      requestId: carlaRequest.id,
      providerId: provider.id,
      clientId: carla.id,
      offerId: carlaOffer.id,
      status: ConsultancyContractStatus.DELIVERED,
      paymentStatus: ConsultancyPaymentStatus.CAPTURED,
      paymentAmountCents: 22000,
      providerAmountCents: 19800,
      platformAmountCents: 2200,
      paymentCapturedAt: now,
      billingCycle: "MONTHLY",
      kind: ServiceOfferKind.ONLINE_CONSULTANCY,
      fichaValidityDays: 30,
      deliveryDeadlineAt: now,
      immediateExecutionAcknowledgedAt: now
    }
  });
  await prisma.trainingPlan.create({
    data: {
      providerId: provider.id,
      contractId: carlaContract.id,
      title: "QA Seed — Ficha inicial",
      isActive: true,
      validUntil: new Date(now.getTime() - 1 * DAY_MS)
    }
  });

  // 4) Só um vínculo antigo, sem nada ativo — cliente "Inativo".
  const diego = await upsertQaClient("diego.inativo", "QA Diego Inativo", 4);
  await setAnamnesis(diego.id, true);
  await prisma.booking.create({
    data: {
      clientId: diego.id,
      providerId: provider.id,
      categoryId,
      priceCents: 10000,
      status: BookingStatus.COMPLETED,
      scheduledAt: new Date(now.getTime() - 90 * DAY_MS),
      completedAt: new Date(now.getTime() - 90 * DAY_MS + 60 * 60 * 1000),
      notes: "QA_SEED_STUDENT"
    }
  });

  // 5) Pacote presencial com cobrança de ciclo atrasada — badge "cobrança
  //    pendente".
  const elisa = await upsertQaClient("elisa.pacoteatraso", "QA Elisa Pacote Atrasado", 5);
  await setAnamnesis(elisa.id, true);
  const elisaOffer = await prisma.providerServiceOffer.create({
    data: {
      providerId: provider.id,
      kind: ServiceOfferKind.PRESENTIAL,
      title: "QA Seed — Pacote presencial",
      billingCycle: "MONTHLY",
      priceCents: 8000,
      presentialPackageMode: PresentialPackageMode.FLEXIBLE_CREDITS,
      presentialSessionsPerCycle: 4,
      presentialHasFixedTerm: false
    }
  });
  await prisma.presentialPackage.create({
    data: {
      providerId: provider.id,
      clientId: elisa.id,
      offerId: elisaOffer.id,
      categoryId,
      mode: PresentialPackageMode.FLEXIBLE_CREDITS,
      status: PresentialPackageStatus.PAST_DUE,
      cycleAmountCents: 8000,
      billingCycle: "MONTHLY",
      sessionsPerCycle: 4
    }
  });

  // 6) Combo: consultoria online ativa + pacote presencial vinculado a ela
  //    (badge "Combo").
  const fabio = await upsertQaClient("fabio.combo", "QA Fabio Combo", 6);
  await setAnamnesis(fabio.id, true);
  const fabioConsultOffer = await prisma.providerServiceOffer.create({
    data: {
      providerId: provider.id,
      kind: ServiceOfferKind.ONLINE_CONSULTANCY,
      title: "QA Seed — Combo (metade consultoria)",
      billingCycle: "MONTHLY",
      priceCents: 25000
    }
  });
  const fabioRequest = await prisma.consultancyRequest.create({
    data: {
      providerId: provider.id,
      clientId: fabio.id,
      status: ConsultancyRequestStatus.ACCEPTED,
      quotedOfferId: fabioConsultOffer.id,
      responseDeadlineAt: now,
      respondedAt: now,
      clientDecisionAt: now
    }
  });
  const fabioContract = await prisma.consultancyContract.create({
    data: {
      requestId: fabioRequest.id,
      providerId: provider.id,
      clientId: fabio.id,
      offerId: fabioConsultOffer.id,
      status: ConsultancyContractStatus.ACTIVE,
      paymentStatus: ConsultancyPaymentStatus.CAPTURED,
      paymentAmountCents: 25000,
      providerAmountCents: 22500,
      platformAmountCents: 2500,
      paymentCapturedAt: now,
      billingCycle: "MONTHLY",
      kind: ServiceOfferKind.ONLINE_CONSULTANCY,
      deliveryDeadlineAt: now,
      immediateExecutionAcknowledgedAt: now
    }
  });
  await prisma.trainingPlan.create({
    data: {
      providerId: provider.id,
      contractId: fabioContract.id,
      title: "QA Seed — Ficha do combo",
      isActive: true,
      validUntil: new Date(now.getTime() + 60 * DAY_MS)
    }
  });
  const fabioPresentialOffer = await prisma.providerServiceOffer.create({
    data: {
      providerId: provider.id,
      kind: ServiceOfferKind.PRESENTIAL,
      title: "QA Seed — Combo (metade presencial)",
      billingCycle: "MONTHLY",
      priceCents: 8000,
      presentialPackageMode: PresentialPackageMode.FLEXIBLE_CREDITS,
      presentialSessionsPerCycle: 4,
      presentialHasFixedTerm: false
    }
  });
  await prisma.presentialPackage.create({
    data: {
      providerId: provider.id,
      clientId: fabio.id,
      offerId: fabioPresentialOffer.id,
      categoryId,
      consultancyContractId: fabioContract.id,
      mode: PresentialPackageMode.FLEXIBLE_CREDITS,
      status: PresentialPackageStatus.ACTIVE,
      cycleAmountCents: 8000,
      billingCycle: "MONTHLY",
      sessionsPerCycle: 4
    }
  });

  // 7) Convite de aluno externo pendente (sem conta de cliente ainda) —
  //    testa a lista "CONVITES PENDENTES" e o botão de cancelar (p4-1,
  //    p4-4, p4-5). Exige assinatura Muvify ativa - se a conta de teste não
  //    tiver, pula esse item em vez de derrubar o resto do seed.
  try {
    await consultancyService.createExternalStudentInvite(providerUser.id, {
      studentName: "QA Convite Pendente",
      channel: "WHATSAPP",
      phone: "11999990097"
    });
  } catch (error) {
    console.warn(
      "Aviso: não foi possível criar o convite de aluno externo (provavelmente falta assinatura ativa nessa conta de teste). Pulando esse item.",
      error instanceof Error ? error.message : error
    );
  }

  console.log("Alunos fictícios criados com sucesso para", providerEmail);
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
