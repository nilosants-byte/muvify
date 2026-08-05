import "dotenv/config";
import { prisma } from "../src/config/prisma";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Épico de Frentes, Frente 11, Lote 3: cifra em repouso os dados sensíveis
// que ainda trafegavam em texto plano - ClientAnamnesis.answers (dado de
// saúde), campos biométricos de ProviderStudentAssessment (dado de saúde) e
// os campos de ProviderBankAccount (dado bancário/financeiro). Idempotente -
// encryptSensitiveText detecta payload já cifrado (prefixo "enc:v1:") e
// devolve como está, então rodar de novo não cifra duas vezes.
//
// Usage:
//   npx tsx scripts/encrypt-sensitive-fields.ts            (dry run, reports only)
//   npx tsx scripts/encrypt-sensitive-fields.ts --apply    (migra pra valer)

const ASSESSMENT_FIELDS = [
  "weight", "height", "imc", "bodyFatPercent", "muscleMass",
  "circumferences", "waist", "hip", "chest", "arm", "thigh"
] as const;

const BANK_ACCOUNT_FIELDS = ["agency", "accountNumber", "accountDigit", "holderName", "holderDocument", "pixKey"] as const;

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function isAlreadyEncrypted(value: string | null) {
  return !value || value.startsWith("enc:v1:");
}

async function migrateAnamnesis(apply: boolean) {
  const rows = await prisma.clientAnamnesis.findMany({
    where: { answers: { not: null } },
    select: { id: true, answers: true }
  });
  const pending = rows.filter((r) => !isAlreadyEncrypted(r.answers));
  console.log(`ClientAnamnesis: ${pending.length}/${rows.length} linha(s) pendente(s) de cifragem.`);
  if (!apply) return;
  for (const row of pending) {
    await prisma.clientAnamnesis.update({
      where: { id: row.id },
      data: { answers: encryptSensitiveText(row.answers!) }
    });
  }
  console.log(`ClientAnamnesis: ${pending.length} linha(s) cifrada(s).`);
}

async function migrateAssessments(apply: boolean) {
  const rows = await prisma.providerStudentAssessment.findMany();
  const pending = rows.filter((r) => ASSESSMENT_FIELDS.some((f) => !isAlreadyEncrypted(r[f])));
  console.log(`ProviderStudentAssessment: ${pending.length}/${rows.length} linha(s) pendente(s) de cifragem.`);
  if (!apply) return;
  for (const row of pending) {
    const data: Record<string, string | null> = {};
    for (const field of ASSESSMENT_FIELDS) {
      const value = row[field];
      data[field] = value && !isAlreadyEncrypted(value) ? encryptSensitiveText(value) : value;
    }
    await prisma.providerStudentAssessment.update({ where: { id: row.id }, data });
  }
  console.log(`ProviderStudentAssessment: ${pending.length} linha(s) cifrada(s).`);
}

async function migrateBankAccounts(apply: boolean) {
  const rows = await prisma.providerBankAccount.findMany();
  const pending = rows.filter((r) => BANK_ACCOUNT_FIELDS.some((f) => !isAlreadyEncrypted(r[f])));
  console.log(`ProviderBankAccount: ${pending.length}/${rows.length} linha(s) pendente(s) de cifragem.`);
  if (!apply) return;
  for (const row of pending) {
    const data: Record<string, string | null> = {};
    for (const field of BANK_ACCOUNT_FIELDS) {
      const value = row[field];
      data[field] = value && !isAlreadyEncrypted(value) ? encryptSensitiveText(value) : value;
    }
    await prisma.providerBankAccount.update({ where: { id: row.id }, data });
  }
  console.log(`ProviderBankAccount: ${pending.length} linha(s) cifrada(s).`);
}

async function main() {
  const apply = hasFlag("--apply");
  await prisma.$connect();
  try {
    await migrateAnamnesis(apply);
    await migrateAssessments(apply);
    await migrateBankAccounts(apply);
    if (!apply) {
      console.log("Modo dry-run (padrão) — nada foi alterado. Rode com --apply para migrar de verdade.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
