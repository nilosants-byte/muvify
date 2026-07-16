import "dotenv/config";
import { prisma } from "../src/config/prisma";
import { getPrivateObject, putPrivateObject } from "../src/shared/services/storage.service";

// One-time migration: moves CompletionEvidence rows still holding their encrypted
// selfie directly in the imageBase64 Postgres column onto R2 (storageKey), matching
// how every other media type in the app is stored. The column value is already the
// output of encryptSensitiveText (an "enc:v1:..." string) — uploaded byte-for-byte
// as-is, no decrypt/re-encrypt round trip needed.
//
// Usage:
//   npx tsx scripts/backfill-completion-evidence-r2.ts            (dry run, reports only)
//   npx tsx scripts/backfill-completion-evidence-r2.ts --apply    (migrates for real)

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const apply = hasFlag("--apply");

  await prisma.$connect();
  try {
    const rows = await prisma.completionEvidence.findMany({
      where: { imageBase64: { not: null }, storageKey: null },
      select: { id: true, bookingId: true, userId: true, imageBase64: true }
    });

    console.log(`Encontradas ${rows.length} comprovação(ões) ainda em base64 no banco.`);
    if (!apply) {
      console.log("Modo dry-run (padrão) — nada foi alterado. Rode com --apply para migrar de verdade.");
      return;
    }

    let migrated = 0;
    let failed = 0;

    for (const row of rows) {
      const storageKey = `attendance-proofs/${row.bookingId}_${row.userId}.enc`;
      try {
        await putPrivateObject(storageKey, row.imageBase64!);

        // Round-trip verification before touching the row — only clear imageBase64
        // once we've confirmed the R2 copy reads back identical to what we sent.
        const readBack = await getPrivateObject(storageKey);
        if (readBack !== row.imageBase64) {
          throw new Error("Conteúdo lido do R2 não bate com o original enviado.");
        }

        await prisma.completionEvidence.update({
          where: { id: row.id },
          data: { storageKey, imageBase64: null }
        });
        migrated += 1;
        console.log(`OK  ${row.bookingId}/${row.userId} -> ${storageKey}`);
      } catch (error) {
        failed += 1;
        console.error(`FALHOU ${row.bookingId}/${row.userId}:`, (error as Error).message);
      }
    }

    console.log(`\nMigradas: ${migrated}/${rows.length}. Falhas: ${failed}.`);
    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Backfill de CompletionEvidence falhou:", error);
  process.exit(1);
});
