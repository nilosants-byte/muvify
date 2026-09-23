// Gera (ou mostra, se já existir e ainda válido) o código de presença de 6
// dígitos de um agendamento de teste, direto no banco — sem precisar de uma
// segunda conta de aluno/celular pra simular o caminho "cliente abre o
// agendamento e recebe o código". Útil pro teste manual solo do fluxo de
// validação de presença por código (a validação em si continua sendo feita
// de verdade pela tela do profissional).
//
// Só mexe em agendamentos que já são de teste (notes="QA_SEED_STUDENT") -
// nunca gera/sobrescreve código de um agendamento real.
//
// Roda contra o banco apontado por DATABASE_URL em .env.qa-staging (NUNCA
// commitado). Import estático de algo em src/ roda ANTES do dotenv.config()
// abaixo (hoisting do ESM/TS) — por isso tudo que depende de env é
// importado dinamicamente dentro de main().
//
// Uso: npm run qa:attendance-code -- --client=qa.agenda.vencido

import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.qa-staging"), override: true });

const QA_EMAIL_DOMAIN = "muvify.qa-seed.local";

function generateAttendanceCode() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

async function main() {
  const { prisma } = await import("../src/config/prisma");
  const { env } = await import("../src/config/env");

  const clientArg = process.argv.find((a) => a.startsWith("--client="));
  const clientSlug = clientArg?.split("=")[1];
  if (!clientSlug) {
    throw new Error("Uso: npm run qa:attendance-code -- --client=qa.agenda.vencido (o slug antes de @muvify.qa-seed.local)");
  }

  const clientEmail = `${clientSlug}@${QA_EMAIL_DOMAIN}`;
  const client = await prisma.user.findUnique({ where: { email: clientEmail } });
  if (!client) {
    throw new Error(`Nenhum aluno fictício encontrado com o e-mail "${clientEmail}". Rode qa:seed-agenda ou qa:seed-students primeiro.`);
  }

  const booking = await prisma.booking.findFirst({
    where: { clientId: client.id, notes: "QA_SEED_STUDENT" },
    orderBy: { scheduledAt: "desc" }
  });
  if (!booking) {
    throw new Error(`Nenhum agendamento de teste encontrado pro aluno "${clientEmail}".`);
  }

  const now = new Date();
  const isExpired = Boolean(booking.attendanceCodeExpiresAt) && booking.attendanceCodeExpiresAt! < now;
  const alreadyValidated = Boolean(booking.attendanceCodeValidatedAt);

  if (alreadyValidated) {
    console.log(`Esse agendamento (${booking.id}) já teve a presença validada em ${booking.attendanceCodeValidatedAt}.`);
    return;
  }

  let code = booking.attendanceCode;
  if (!code || isExpired) {
    code = generateAttendanceCode();
    const expiresAt = new Date(now.getTime() + env.BOOKING_ATTENDANCE_CODE_EXPIRY_HOURS * 60 * 60 * 1000);
    await prisma.booking.update({
      where: { id: booking.id },
      data: { attendanceCode: code, attendanceCodeGeneratedAt: now, attendanceCodeExpiresAt: expiresAt }
    });
    console.log(`Código gerado agora (válido por ${env.BOOKING_ATTENDANCE_CODE_EXPIRY_HOURS}h).`);
  } else {
    console.log(`Código já existia e ainda é válido (expira em ${booking.attendanceCodeExpiresAt}).`);
  }

  console.log("");
  console.log(`Agendamento: ${booking.id} (${clientEmail})`);
  console.log(`CÓDIGO DE PRESENÇA: ${code}`);
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
