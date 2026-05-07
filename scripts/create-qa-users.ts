import { PrismaClient, UserRole } from "@prisma/client";
import { hashValue } from "../src/shared/utils/hash";

const prisma = new PrismaClient();

type QaUser = {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: UserRole;
};

const qaClient: QaUser = {
  name: "QA Aluno",
  email: "qa.aluno@muvify.local",
  phone: "11999990001",
  password: "Qa123456",
  role: UserRole.CLIENT
};

const qaProvider: QaUser = {
  name: "QA Personal",
  email: "qa.personal@muvify.local",
  phone: "11999990002",
  password: "Qa123456",
  role: UserRole.PROVIDER
};

async function upsertUser(user: QaUser) {
  const passwordHash = await hashValue(user.password);
  return prisma.user.upsert({
    where: { email: user.email },
    update: {
      name: user.name,
      phone: user.phone,
      role: user.role,
      password: passwordHash
    },
    create: {
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      password: passwordHash
    }
  });
}

async function main() {
  const client = await upsertUser(qaClient);
  const providerUser = await upsertUser(qaProvider);

  let category = await prisma.serviceCategory.findUnique({
    where: { name: "Personal Trainer" }
  });
  if (!category) {
    category = await prisma.serviceCategory.create({
      data: { name: "Personal Trainer", description: "Treinamento fisico personalizado." }
    });
  }

  const providerProfile = await prisma.providerProfile.upsert({
    where: { userId: providerUser.id },
    update: {
      displayName: providerUser.name,
      bio: "Personal trainer QA para testes.",
      experienceYears: 5,
      priceCents: 12000,
      serviceRadiusKm: 10
    },
    create: {
      userId: providerUser.id,
      displayName: providerUser.name,
      bio: "Personal trainer QA para testes.",
      experienceYears: 5,
      priceCents: 12000,
      serviceRadiusKm: 10
    }
  });

  await prisma.providerCategory.upsert({
    where: {
      providerId_categoryId: {
        providerId: providerProfile.id,
        categoryId: category.id
      }
    },
    update: {},
    create: {
      providerId: providerProfile.id,
      categoryId: category.id
    }
  });

  console.log("QA users ready:");
  console.log({
    client: { email: qaClient.email, password: qaClient.password },
    provider: { email: qaProvider.email, password: qaProvider.password }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
