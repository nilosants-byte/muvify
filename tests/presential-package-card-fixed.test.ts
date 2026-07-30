import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";

// Frente 3b.2 do roteiro de segurança de pagamentos: pacote presencial de
// horário fixo pago em cartão passa a cobrar sessão por sessão (mesmo motor
// da sessão avulsa — reserva perto da hora, captura na conclusão) em vez de
// uma cobrança única por ciclo. Pix e o formato de créditos flexíveis
// continuam intocados (fora do escopo desta frente).

const service = new PresentialPackageService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const offerIds: string[] = [];
const CYCLE_AMOUNT_CENTS = 40000;
const SESSIONS_PER_CYCLE = 4;

// Todos os 7 dias da semana, pra garantir pelo menos uma ocorrência dentro
// de qualquer período, independente de em que dia da semana o teste roda.
// Cada teste usa um horário diferente pra não colidir com reservas de
// outro teste no mesmo profissional (o conflito é checado por
// providerId+horário, não por pacote).
function weeklyScheduleAt(time: string) {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, time }));
}

async function makeOffer() {
  const offer = await prisma.providerServiceOffer.create({
    data: {
      providerId,
      kind: "PRESENTIAL",
      title: `Pacote horário fixo ${uid("offer")}`,
      billingCycle: "MONTHLY",
      priceCents: CYCLE_AMOUNT_CENTS,
      presentialPackageMode: "FIXED_RECURRING",
      presentialSessionsPerCycle: SESSIONS_PER_CYCLE
    }
  });
  offerIds.push(offer.id);
  return offer.id;
}

describe("Pacote presencial de horário fixo pago em cartão — sessão por sessão", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `PPC_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Package Client",
        email: `${uid("pkg_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_pkg"
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_pkg",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Package Provider",
        email: `${uid("pkg_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Package Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "999888777",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { clientId, categoryId } } });
    await prisma.booking.deleteMany({ where: { clientId, categoryId } });
    await prisma.presentialPackageCycle.deleteMany({ where: { package: { clientId } } });
    await prisma.presentialPackage.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("compra: gera sessões com preço real e reserva individual, sem nenhuma cobrança de ciclo", async () => {
    const offerId = await makeOffer();
    const { package: pkg, payment } = await service.purchasePackage(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any,
      weeklySchedule: weeklyScheduleAt("10:00")
    });

    expect(payment.status).toBe("SCHEDULED");
    expect((payment as any).sessionsScheduled).toBeGreaterThan(0);
    expect(pkg.status).toBe("ACTIVE");
    expect(pkg.billingCardId).toBeTruthy();

    const perSessionPriceCents = Math.round(CYCLE_AMOUNT_CENTS / SESSIONS_PER_CYCLE);
    const bookings = await prisma.booking.findMany({
      where: { clientId, providerId, categoryId, packageId: pkg.id },
      include: { payment: true }
    });

    expect(bookings.length).toBeGreaterThan(0);
    for (const booking of bookings) {
      expect(booking.priceCents).toBe(perSessionPriceCents);
      expect(booking.status).toBe("CONFIRMED");
      expect(booking.payment).not.toBeNull();
      expect(booking.payment!.status).toBe("PENDING_AUTH");
      expect(booking.payment!.method).toBe("CREDIT_CARD");
      expect(booking.payment!.mpCardToken).toBe(pkg.billingCardId);
    }

    // Marcador de período — sem nenhum valor de pagamento associado.
    const cycle = await prisma.presentialPackageCycle.findFirst({ where: { packageId: pkg.id, cycleIndex: 1 } });
    expect(cycle).not.toBeNull();
    expect(cycle!.amountCents).toBeNull();
    expect(cycle!.capturedAt).toBeNull();
  });

  it("não gera o próximo período antes da hora, mas avança corretamente quando forçado a vencer", async () => {
    const offerId = await makeOffer();
    const { package: pkg } = await service.purchasePackage(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any,
      weeklySchedule: weeklyScheduleAt("14:00")
    });

    // Ainda não é hora (nextBillingAt está ~1 mês no futuro) — não deve
    // criar o marcador do ciclo 2.
    await service.generateDueCardFixedPeriods();
    const cycle2Before = await prisma.presentialPackageCycle.findFirst({ where: { packageId: pkg.id, cycleIndex: 2 } });
    expect(cycle2Before).toBeNull();

    // Força o vencimento e roda de novo — agora deve processar o período 2:
    // cria o marcador do ciclo (mesmo que nenhuma sessão nova sobre, porque
    // as datas coincidem com o período 1 nesse cenário forçado — o
    // conflito sendo pulado é o comportamento de segurança correto, não um
    // bug) e avança nextCycleIndex/nextBillingAt.
    await prisma.presentialPackage.update({
      where: { id: pkg.id },
      data: { nextBillingAt: new Date(Date.now() - 60 * 1000) }
    });
    await service.generateDueCardFixedPeriods();

    const cycle2After = await prisma.presentialPackageCycle.findFirst({ where: { packageId: pkg.id, cycleIndex: 2 } });
    expect(cycle2After).not.toBeNull();
    expect(cycle2After!.amountCents).toBeNull();

    const updatedPkg = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(updatedPkg.nextCycleIndex).toBe(3);
    expect(updatedPkg.nextBillingAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("cancelar o pacote libera as sessões futuras (nenhuma será cobrada)", async () => {
    const offerId = await makeOffer();
    const { package: pkg } = await service.purchasePackage(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any,
      weeklySchedule: weeklyScheduleAt("18:00")
    });

    const cancelled = await service.cancelPackage(clientId, pkg.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.nextBillingAt).toBeNull();

    const bookings = await prisma.booking.findMany({ where: { packageId: pkg.id } });
    expect(bookings.length).toBeGreaterThan(0);
    for (const booking of bookings) {
      expect(booking.status).toBe("CANCELLED");
    }
  });
});
