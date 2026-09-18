// Ativa a assinatura Muvify de uma conta PROVIDER especifica, pra destravar
// fluxos que exigem assinatura ativa (ex: convite de aluno externo) durante
// teste manual, sem pagamento real. Imprime o estado anterior pra poder
// reverter depois com precisao.
// Uso: npx tsx scripts/qa-toggle-subscription.ts --email=x@x.com
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.qa-staging"), override: true });

async function main() {
  const { prisma } = await import("../src/config/prisma");
  const { ProviderSubscriptionStatus } = await import("@prisma/client");

  const emailArg = process.argv.find((a) => a.startsWith("--email="));
  const providerEmail = emailArg?.split("=")[1];
  if (!providerEmail) throw new Error("Uso: --email=...");

  const providerUser = await prisma.user.findUniqueOrThrow({ where: { email: providerEmail } });
  const provider = await prisma.providerProfile.findUniqueOrThrow({ where: { userId: providerUser.id } });
  const before = await prisma.providerSubscription.findUnique({ where: { providerId: provider.id } });

  console.log("ESTADO ANTES:", JSON.stringify(before));

  await prisma.providerSubscription.upsert({
    where: { providerId: provider.id },
    create: { providerId: provider.id, status: ProviderSubscriptionStatus.ACTIVE },
    update: { status: ProviderSubscriptionStatus.ACTIVE }
  });

  console.log("Assinatura ativada (status=ACTIVE) pra", providerEmail);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => {
    const { prisma } = await import("../src/config/prisma");
    await prisma.$disconnect();
  });
