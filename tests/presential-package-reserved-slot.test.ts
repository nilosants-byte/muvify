import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { toDateKeyInTimezone, toWeekdayInTimezone } from "../src/shared/utils/timezone";
import { env } from "../src/config/env";

// Achado no teste manual do checklist (C6.3, 19/10/2026): o horário semanal
// de um pacote de horário fixo não ficava reservado — outro aluno podia
// marcar aula avulsa (ou outro pacote) nele, e a aula do pacote daquela
// semana era pulada em silêncio na geração (no Pix, ciclo pago inteiro).
// Decisão do Danilo: o horário fica reservado enquanto o pacote estiver ativo.

const packageService = new PresentialPackageService();
const bookingService = new BookingService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// Dia daqui a `daysAhead` dias no fuso do app, às `time`.
function dayAt(daysAhead: number, time: string) {
  const ref = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const key = toDateKeyInTimezone(ref, env.APP_TIMEZONE);
  return { weekday: toWeekdayInTimezone(ref, env.APP_TIMEZONE), date: new Date(`${key}T${time}:00-03:00`) };
}

let providerId = "";
let categoryId = "";
const userIds: string[] = [];
const offerIds: string[] = [];

async function makeClient(label: string) {
  const mpCustomerId = `cus_${uid(label)}`;
  const client = await prisma.user.create({
    data: {
      name: `Cliente ${label}`,
      email: `${uid(label)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      role: "CLIENT",
      mpCustomerId,
      emailVerifiedAt: new Date()
    }
  });
  userIds.push(client.id);
  await prisma.clientAnamnesis.create({ data: { clientId: client.id, status: "COMPLETED", completedAt: new Date() } });
  await prisma.customerPaymentMethod.create({
    data: { userId: client.id, mpCustomerId, mpCardId: `card_${uid("c")}`, nickname: "Cartão", brand: "visa", last4: "4242", funding: "CREDIT" }
  });
  return client.id;
}

async function fixedOffer() {
  const offer = await prisma.providerServiceOffer.create({
    data: {
      providerId,
      kind: "PRESENTIAL",
      title: `Fixo ${uid("o")}`,
      billingCycle: "MONTHLY",
      priceCents: 40000,
      presentialPackageMode: "FIXED_RECURRING",
      presentialSessionsPerCycle: 4,
      acceptsCreditCard: true
    }
  });
  offerIds.push(offer.id);
  return offer.id;
}

describe("Horário fixo de pacote fica reservado", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `RS_${Date.now()}`, description: "test" } });
    categoryId = category.id;
    const providerUser = await prisma.user.create({
      data: { name: "Provider Reserva", email: `${uid("rs_provider")}@test.com`, password: "x", phone: `11${Date.now().toString().slice(-9)}7`, role: "PROVIDER" }
    });
    userIds.push(providerUser.id);
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUser.id,
        displayName: "Provider Reserva",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "444555666",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1
      }
    });
    providerId = provider.id;
    await prisma.availability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ providerId, weekday, startTime: "00:00", endTime: "24:00", isActive: true }))
    });
    await prisma.providerCategory.create({ data: { providerId, categoryId } });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { providerId } } });
    await prisma.booking.deleteMany({ where: { providerId } });
    await prisma.presentialPackageCycle.deleteMany({ where: { package: { providerId } } });
    await prisma.presentialPackage.deleteMany({ where: { providerId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("outro aluno não consegue comprar o mesmo horário fixo nem marcar aula avulsa nele", async () => {
    const owner = await makeClient("dono");
    const other = await makeClient("outro");
    // Bem depois do 1º período do pacote (30 dias), pra testar a reserva em
    // si e não o conflito com uma aula já gerada.
    const later = dayAt(40, "10:00");

    await packageService.purchasePackage(owner, {
      offerId: await fixedOffer(),
      categoryId,
      paymentMethod: "CREDIT_CARD" as any,
      weeklySchedule: [{ weekday: later.weekday, time: "10:00" }]
    });

    await expect(
      packageService.purchasePackage(other, {
        offerId: await fixedOffer(),
        categoryId,
        paymentMethod: "CREDIT_CARD" as any,
        weeklySchedule: [{ weekday: later.weekday, time: "10:30" }]
      })
    ).rejects.toThrow(/já é fixo de outro aluno/);

    await expect(
      bookingService.create(other, providerId, categoryId, later.date.toISOString(), undefined, "CREDIT_CARD" as any, undefined, undefined, undefined, undefined, undefined, true)
    ).rejects.toThrow(/fixo de um pacote/);
  });

  it("não deixa comprar horário fixo que bate com aula já marcada no primeiro ciclo", async () => {
    const buyer = await makeClient("comprador");
    const someoneElse = await makeClient("avulso");
    const soon = dayAt(5, "15:00");
    await prisma.booking.create({
      data: { clientId: someoneElse, providerId, categoryId, scheduledAt: soon.date, priceCents: 15000, status: "CONFIRMED" }
    });

    await expect(
      packageService.purchasePackage(buyer, {
        offerId: await fixedOffer(),
        categoryId,
        paymentMethod: "CREDIT_CARD" as any,
        weeklySchedule: [{ weekday: soon.weekday, time: "15:00" }]
      })
    ).rejects.toThrow(/Já existe uma aula marcada/);
  });
});
