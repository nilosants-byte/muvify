import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const categories = [
    { name: "Diarista", description: "Limpeza residencial e comercial." },
    { name: "Eletricista", description: "Instalacoes e manutencao eletrica." },
    { name: "Encanador", description: "Servicos hidraulicos e reparos." },
    { name: "Personal Trainer", description: "Treinamento fisico personalizado." }
  ];
  for (const category of categories) {
    await prisma.serviceCategory.upsert({
      where: { name: category.name },
      update: category,
      create: category
    });
  }

  // Usuários de teste
  const testUsers = [
    { name: "Ana Cliente",      email: "cliente1@muvify.test",  password: "$2a$12$hFnoG0I8hgfP09PkUHLFy.XzlPAwEyGZ5zlclIQr97.zLB0A/cGXW", role: "CLIENT"   as const },
    { name: "Fulaninho Fulano", email: "cliente2@muvify.test",  password: "$2a$12$hFnoG0I8hgfP09PkUHLFy.XzlPAwEyGZ5zlclIQr97.zLB0A/cGXW", role: "CLIENT"   as const },
    { name: "Carlos Personal",  email: "personal1@muvify.test", password: "$2a$12$hFnoG0I8hgfP09PkUHLFy.XzlPAwEyGZ5zlclIQr97.zLB0A/cGXW", role: "PROVIDER" as const },
    { name: "Diana Personal",   email: "personal2@muvify.test", password: "$2a$12$hFnoG0I8hgfP09PkUHLFy.XzlPAwEyGZ5zlclIQr97.zLB0A/cGXW", role: "PROVIDER" as const },
  ];

  for (const user of testUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: user
    });
  }

  // Perfis dos personais
  const carlos = await prisma.user.findUnique({ where: { email: "personal1@muvify.test" } });
  const diana  = await prisma.user.findUnique({ where: { email: "personal2@muvify.test" } });

  if (carlos) {
    await prisma.providerProfile.upsert({
      where: { userId: carlos.id },
      update: {},
      create: {
        userId:         carlos.id,
        displayName:    "Carlos Personal",
        bio:            "Personal trainer com 8 anos de experiência. Especialista em hipertrofia e emagrecimento.",
        priceCents:     10000,
        serviceMode:    "BOTH",
        latitude:       -8.0322834,
        longitude:      -34.8978494,
        experienceYears: 8,
        serviceRadiusKm: 3,
        specialties:    ["Hipertrofia", "Emagrecimento", "LPO (Levantamento de Peso Olímpico)"],
      }
    });
  }

  if (diana) {
    await prisma.providerProfile.upsert({
      where: { userId: diana.id },
      update: {},
      create: {
        userId:         diana.id,
        displayName:    "Prof.Danilo Santos",
        bio:            "Bom em Tudo",
        priceCents:     15000,
        serviceMode:    "BOTH",
        latitude:       -8.00721621220297,
        longitude:      -34.87878786859092,
        experienceYears: 3,
        serviceRadiusKm: 10,
        specialties:    ["Hipertrofia", "Alongamento", "Emagrecimento", "Tudo"],
      }
    });
  }
}
main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
