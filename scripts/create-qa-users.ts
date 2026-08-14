import { PrismaClient, UserRole } from "@prisma/client";
import { hashValue } from "../src/shared/utils/hash";
import { encryptJson } from "../src/shared/utils/encryption";

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

async function ensureAnamnesisCompleted(clientId: string) {
  // Sem isso, o fluxo E2E de agendamento fica travado no botão "Confirmar
  // agendamento" (desabilitado até a ficha de saúde estar completa) — o
  // seed precisa deixar o cliente QA já elegível pra contratar.
  await prisma.clientAnamnesis.upsert({
    where: { clientId },
    update: { status: "COMPLETED", completedAt: new Date() },
    create: {
      clientId,
      status: "COMPLETED",
      completedAt: new Date(),
      answers: encryptJson({ seededForE2E: true })
    }
  });
}

const ATTENDANCE_BOOKING_MARKER = "QA_E2E_ATTENDANCE_BOOKING";

async function ensureAttendanceBooking(
  clientId: string,
  providerId: string,
  categoryId: string,
  priceCents: number
) {
  // O código/QR de presença só fica disponível a partir de N minutos antes
  // do horário marcado (BOOKING_ATTENDANCE_CODE_RELEASE_MINUTES) — sem um
  // agendamento CONFIRMED marcado pra "daqui a pouco", o flow E2E de
  // validação presencial não tem como existir sem depender de relógio real
  // no dia-a-dia. Reseta os campos de código a cada rodada do seed pra
  // sempre gerar um código novo.
  const scheduledAt = new Date(Date.now() + 3 * 60 * 1000);
  const existing = await prisma.booking.findFirst({
    where: { clientId, providerId, notes: ATTENDANCE_BOOKING_MARKER }
  });
  const data = {
    scheduledAt,
    status: "CONFIRMED" as const,
    attendanceCode: null,
    attendanceCodeGeneratedAt: null,
    attendanceCodeExpiresAt: null,
    attendanceCodeValidatedAt: null,
    completedAt: null
  };
  if (existing) {
    await prisma.booking.update({ where: { id: existing.id }, data });
  } else {
    await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        priceCents,
        notes: ATTENDANCE_BOOKING_MARKER,
        ...data
      }
    });
  }
}

async function main() {
  const client = await upsertUser(qaClient);
  const providerUser = await upsertUser(qaProvider);
  await ensureAnamnesisCompleted(client.id);

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

  // Sem isso, o fluxo E2E de agendamento não encontra nenhum horário livre
  // no calendário (Availability vazia == nenhum slot), travando o flow
  // logo na tela de criação de agendamento.
  const existingAvailability = await prisma.availability.count({
    where: { providerId: providerProfile.id }
  });
  if (existingAvailability === 0) {
    await prisma.availability.createMany({
      data: Array.from({ length: 7 }, (_, weekday) => ({
        providerId: providerProfile.id,
        weekday,
        startTime: "08:00",
        endTime: "20:00",
        isActive: true
      }))
    });
  }

  await ensureAttendanceBooking(client.id, providerProfile.id, category.id, providerProfile.priceCents);

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
