import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

// Cria a conta admin compartilhada antes de qualquer arquivo: no banco vazio do CI,
// quem chegasse primeiro definia a senha ("x" direto no banco) e o login dos outros falhava.
export default async function setup() {
  const email = (process.env.ADMIN_ALLOWED_EMAILS ?? "").split(",")[0].trim().toLowerCase();
  if (!email) {
    throw new Error("ADMIN_ALLOWED_EMAILS vazio: os testes de admin precisam de um e-mail na allowlist.");
  }

  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const password = await bcrypt.hash("Test1234", 4);
    await prisma.user.upsert({
      where: { email },
      update: { password, emailVerifiedAt: now },
      create: {
        name: "Admin de Teste",
        email,
        password,
        role: "ADMIN",
        emailVerifiedAt: now,
        termsAcceptedAt: now,
        privacyPolicyAcceptedAt: now,
        termsVersion: "2026.05"
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}
