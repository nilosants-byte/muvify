import "dotenv/config";
import { ConsultancyContractStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";

// One-time migration: popula ConsultancyContract.nextBillingAt/
// lastBilledContentAt pros contratos DELIVERED que existiam antes da
// cobrança de ficha por calendário fixo (esses campos não existiam até
// agora — deliverContract só passou a preenchê-los a partir do commit que
// introduziu essa migração de schema).
//
// nextBillingAt vira o maior validUntil já registrado entre as fichas do
// contrato (o vencimento que já estava implícito, sem calendário nenhum
// antes disso). lastBilledContentAt vira o createdAt mais recente entre
// essas mesmas fichas — trata tudo que já foi entregue até aqui como "já
// contabilizado", pra chargeDueFichaRenewals não achar que há conteúdo
// novo "surpresa" pra cobrar assim que o job rodar pela primeira vez.
//
// Usage:
//   npx tsx scripts/backfill-consultancy-ficha-billing.ts            (dry run, reports only)
//   npx tsx scripts/backfill-consultancy-ficha-billing.ts --apply    (migra de verdade)

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const apply = hasFlag("--apply");

  await prisma.$connect();
  try {
    const contracts = await prisma.consultancyContract.findMany({
      where: {
        status: ConsultancyContractStatus.DELIVERED,
        fichaValidityDays: { not: null },
        nextBillingAt: null
      },
      select: { id: true, deliveredAt: true, createdAt: true }
    });

    console.log(`Encontrados ${contracts.length} contrato(s) DELIVERED sem calendário de cobrança ainda.`);
    if (!apply) {
      console.log("Modo dry-run (padrão) — nada foi alterado. Rode com --apply para migrar de verdade.");
    }

    let updated = 0;
    let skipped = 0;

    for (const contract of contracts) {
      const plans = await prisma.trainingPlan.findMany({
        where: { contractId: contract.id },
        select: { validUntil: true, createdAt: true }
      });

      const latestValidUntil = plans.reduce<Date | null>(
        (latest, p) => (p.validUntil && (!latest || p.validUntil > latest) ? p.validUntil : latest),
        null
      );
      const latestCreatedAt = plans.reduce<Date | null>(
        (latest, p) => (!latest || p.createdAt > latest ? p.createdAt : latest),
        null
      );

      // Sem nenhuma ficha ainda (não deveria acontecer pra um contrato
      // DELIVERED, mas defensivo): usa a própria entrega/criação do
      // contrato como base.
      const nextBillingAt = latestValidUntil ?? contract.deliveredAt ?? contract.createdAt;
      const lastBilledContentAt = latestCreatedAt ?? contract.deliveredAt ?? contract.createdAt;

      console.log(
        `${apply ? "OK " : "would-set"} ${contract.id} -> nextBillingAt=${nextBillingAt.toISOString()} lastBilledContentAt=${lastBilledContentAt.toISOString()}`
      );

      if (apply) {
        await prisma.consultancyContract.update({
          where: { id: contract.id },
          data: { nextBillingAt, lastBilledContentAt }
        });
        updated += 1;
      } else {
        skipped += 1;
      }
    }

    console.log(apply ? `\nAtualizados: ${updated}/${contracts.length}.` : `\nSeriam atualizados: ${skipped}/${contracts.length}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Backfill de cobrança de ficha falhou:", error);
  process.exit(1);
});
