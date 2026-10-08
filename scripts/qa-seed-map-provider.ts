import * as fs from "fs";
import bcrypt from "bcrypt";
import { PrismaClient, UserRole, CrefValidationStatus, ProviderSubscriptionStatus } from "@prisma/client";

const envContent = fs.readFileSync("C:/Users/Danilo/Documents/dev/personal-app-backend/.env.qa-staging", "utf8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  let value = trimmed.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.env[trimmed.slice(0, eq).trim()] = value;
}

if (!(process.env.DATABASE_URL ?? "").includes("pooler.supabase.com")) {
  throw new Error("Abortado: DATABASE_URL não é o banco de staging.");
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const EMAIL = "qa.mapa.personal@muvify.qa-seed.local";
const PASSWORD = "Qa123456";
// Av. Paulista, São Paulo - o cliente de teste pesquisa esse endereço na Home.
const LAT = -23.5614;
const LNG = -46.6559;
// Marcador falso: a busca só lista profissionais com conta MP conectada.
// Pagamentos com este personal NÃO funcionam (não existe conta real por trás).
const MP_FAKE_ACCOUNT_ID = "QA-SEED-SEM-MP-REAL";
// Achado em teste manual (2026-10-08): a busca por especialidade (tela
// Especialidades) não encontrava este personal porque ele não tinha
// nenhuma especialidade cadastrada - não era bug, só faltava esse dado.
const SPECIALTIES = ["Hipertrofia", "Emagrecimento", "Corrida"];

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const now = new Date();

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { name: "QA Personal Mapa", phone: "11999990003", role: UserRole.PROVIDER, password: passwordHash, emailVerifiedAt: now },
    create: {
      name: "QA Personal Mapa",
      email: EMAIL,
      phone: "11999990003",
      role: UserRole.PROVIDER,
      password: passwordHash,
      emailVerifiedAt: now,
      termsAcceptedAt: now,
      privacyPolicyAcceptedAt: now,
      termsVersion: "2026.05",
    },
  });

  const profile = await prisma.providerProfile.upsert({
    where: { userId: user.id },
    update: {
      displayName: "QA Personal Mapa",
      bio: "Personal de teste (QA) para validar o mapa e a busca.",
      experienceYears: 5,
      priceCents: 12000,
      serviceRadiusKm: 10,
      latitude: LAT,
      longitude: LNG,
      crefValidationStatus: CrefValidationStatus.APPROVED,
      mpAccountId: MP_FAKE_ACCOUNT_ID,
      specialties: SPECIALTIES,
    },
    create: {
      userId: user.id,
      displayName: "QA Personal Mapa",
      bio: "Personal de teste (QA) para validar o mapa e a busca.",
      experienceYears: 5,
      priceCents: 12000,
      serviceRadiusKm: 10,
      latitude: LAT,
      longitude: LNG,
      crefValidationStatus: CrefValidationStatus.APPROVED,
      mpAccountId: MP_FAKE_ACCOUNT_ID,
      specialties: SPECIALTIES,
    },
  });

  const category = await prisma.serviceCategory.findUnique({ where: { name: "Personal Trainer" } });
  if (!category) throw new Error("Categoria 'Personal Trainer' não existe no staging.");
  await prisma.providerCategory.upsert({
    where: { providerId_categoryId: { providerId: profile.id, categoryId: category.id } },
    update: {},
    create: { providerId: profile.id, categoryId: category.id },
  });

  const availabilityCount = await prisma.availability.count({ where: { providerId: profile.id } });
  if (availabilityCount === 0) {
    await prisma.availability.createMany({
      data: Array.from({ length: 7 }, (_, weekday) => ({
        providerId: profile.id,
        weekday,
        startTime: "08:00",
        endTime: "20:00",
        isActive: true,
      })),
    });
  }

  const nextBillingAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await prisma.providerSubscription.upsert({
    where: { providerId: profile.id },
    update: { status: ProviderSubscriptionStatus.ACTIVE, nextBillingAt, cancelAtPeriodEnd: false, consecutiveFailedCharges: 0 },
    create: { providerId: profile.id, status: ProviderSubscriptionStatus.ACTIVE, priceCents: 2990, isFounder: false, nextBillingAt },
  });

  console.log("OK", { email: EMAIL, password: PASSWORD, providerId: profile.id, lat: LAT, lng: LNG });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
