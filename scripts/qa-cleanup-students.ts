// Remove tudo que scripts/qa-seed-students.ts criou — só alcança registros
// identificáveis pela própria marca do seed (e-mail terminando em
// "@muvify.qa-seed.local", ofertas com título "QA Seed — ...", bookings com
// notes="QA_SEED_STUDENT", convite com studentName="QA Convite Pendente").
// Nunca apaga nada fora desse escopo — seguro rodar mesmo que o profissional
// já tenha alunos reais.
//
// Import estático de algo em src/ roda ANTES do dotenv.config() abaixo
// (hoisting de "import" do ESM/TS) — por isso o prisma é importado
// dinamicamente dentro de main(), depois do dotenv.config() já ter rodado.

import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.qa-staging"), override: true });

const QA_EMAIL_DOMAIN = "muvify.qa-seed.local";

async function main() {
  const { prisma } = await import("../src/config/prisma");

  const emailArg = process.argv.find((a) => a.startsWith("--email="));
  const providerEmail = emailArg?.split("=")[1];
  if (!providerEmail) {
    throw new Error("Uso: npm run qa:cleanup-students -- --email=seu-email-de-provider@exemplo.com");
  }

  const providerUser = await prisma.user.findUnique({ where: { email: providerEmail } });
  if (!providerUser) {
    console.log("Nenhum usuário encontrado com esse e-mail — nada a limpar.");
    return;
  }
  const provider = await prisma.providerProfile.findUnique({ where: { userId: providerUser.id } });
  if (!provider) {
    console.log("Usuário sem perfil de profissional — nada a limpar.");
    return;
  }

  const qaClients = await prisma.user.findMany({
    where: { email: { endsWith: `@${QA_EMAIL_DOMAIN}` }, role: "CLIENT" },
    select: { id: true, email: true }
  });
  const qaClientIds = qaClients.map((c) => c.id);

  if (qaClientIds.length === 0) {
    console.log("Nenhum aluno fictício (@" + QA_EMAIL_DOMAIN + ") encontrado — nada a limpar.");
  } else {
    const trainingPlansDeleted = await prisma.trainingPlan.deleteMany({
      where: { contract: { clientId: { in: qaClientIds } } }
    });
    const packagesDeleted = await prisma.presentialPackage.deleteMany({
      where: { clientId: { in: qaClientIds } }
    });
    const contractsDeleted = await prisma.consultancyContract.deleteMany({
      where: { clientId: { in: qaClientIds } }
    });
    const requestsDeleted = await prisma.consultancyRequest.deleteMany({
      where: { clientId: { in: qaClientIds } }
    });
    const offersDeleted = await prisma.providerServiceOffer.deleteMany({
      where: { providerId: provider.id, title: { startsWith: "QA Seed —" } }
    });
    const anamnesisDeleted = await prisma.clientAnamnesis.deleteMany({
      where: { clientId: { in: qaClientIds } }
    });
    const bookingsDeleted = await prisma.booking.deleteMany({
      where: { clientId: { in: qaClientIds }, notes: "QA_SEED_STUDENT" }
    });
    const usersDeleted = await prisma.user.deleteMany({ where: { id: { in: qaClientIds } } });

    console.log("Removidos:", {
      trainingPlans: trainingPlansDeleted.count,
      presentialPackages: packagesDeleted.count,
      consultancyContracts: contractsDeleted.count,
      consultancyRequests: requestsDeleted.count,
      providerServiceOffers: offersDeleted.count,
      clientAnamnesis: anamnesisDeleted.count,
      bookings: bookingsDeleted.count,
      users: usersDeleted.count
    });
  }

  const invitesDeleted = await prisma.externalStudentInvite.deleteMany({
    where: { providerId: provider.id, studentName: "QA Convite Pendente" }
  });
  console.log("Convites de teste removidos:", invitesDeleted.count);

  console.log("Limpeza concluída para", providerEmail);
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
