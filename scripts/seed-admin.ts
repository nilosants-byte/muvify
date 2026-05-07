/**
 * Creates or updates the Muvify admin user.
 * Run once: npx tsx scripts/seed-admin.ts
 */
import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Muvify Admin";

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD no .env antes de rodar este script.");
  process.exit(1);
}

async function main() {
  const rounds = parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10);
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, rounds);

  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });

  if (existing) {
    await prisma.user.update({
      where: { email: ADMIN_EMAIL },
      data: { password: passwordHash, name: ADMIN_NAME, role: UserRole.CLIENT }
    });
    console.log(`Admin user updated: ${ADMIN_EMAIL}`);
  } else {
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        name: ADMIN_NAME,
        password: passwordHash,
        role: UserRole.CLIENT
      }
    });
    console.log(`Admin user created: ${ADMIN_EMAIL}`);
  }

  console.log("Done. The role is resolved to ADMIN at runtime via ADMIN_ALLOWED_EMAILS.");
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
