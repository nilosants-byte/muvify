/**
 * seed-test-users.ts
 * Cria 2 clientes e 2 profissionais com perfis crus para testes manuais.
 * Uso: npx tsx prisma/seed-test-users.ts
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const SENHA = "Teste@123";

async function main() {
  const hash = await bcrypt.hash(SENHA, 12);

  const users = [
    { name: "Ana Cliente",     email: "cliente1@muvify.test",  phone: "11900000001", role: "CLIENT"   },
    { name: "Bruno Cliente",   email: "cliente2@muvify.test",  phone: "11900000002", role: "CLIENT"   },
    { name: "Carlos Personal", email: "personal1@muvify.test", phone: "11900000003", role: "PROVIDER" },
    { name: "Diana Personal",  email: "personal2@muvify.test", phone: "11900000004", role: "PROVIDER" },
  ] as const;

  for (const u of users) {
    await prisma.user.upsert({
      where:  { email: u.email },
      update: { name: u.name, phone: u.phone, password: hash, role: u.role },
      create: { name: u.name, email: u.email, phone: u.phone, password: hash, role: u.role },
    });
  }

  console.log("\n✓ 4 usuários de teste prontos!\n");
  console.log("  CLIENTES");
  console.log("  cliente1@muvify.test  |  Teste@123");
  console.log("  cliente2@muvify.test  |  Teste@123");
  console.log("\n  PROFISSIONAIS");
  console.log("  personal1@muvify.test |  Teste@123");
  console.log("  personal2@muvify.test |  Teste@123\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => { console.error(err); await prisma.$disconnect(); process.exit(1); });
