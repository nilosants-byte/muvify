import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PaymentMethod } from "@prisma/client";
import { app } from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { haversineKm } from "../src/shared/utils/geo";
import { jitterPublicCoordinates } from "../src/shared/utils/public-location";
import { toWeekdayInTimezone } from "../src/shared/utils/timezone";
import { atAppTime } from "./helpers/app-time";

// A casa de quem atende a domicílio não pode ser descoberta por quem está de
// fora. O pino do mapa já era deslocado 300-500 m, mas outras respostas ainda
// eram calculadas a partir do endereço REAL e, cruzando pedidos feitos de
// pontos diferentes, entregavam o endereço mesmo assim:
// - a distância "a X km" e o filtro de raio da busca pública (sem login);
// - o "fora do raio de atendimento" ao agendar ou comprar pacote;
// - as telas de consultoria do aluno, que devolviam a coordenada real crua.
//
// Os pontos de teste ficam sobre a linha real -> pino, onde as duas contas
// dão respostas diferentes: só passa se a conta usar o pino público.

const marker = `ORACLE_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const REAL = { latitude: -23.5613, longitude: -46.6558 };
const RADIUS_KM = 1;

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
let offerId = "";
let pin = { latitude: 0, longitude: 0 };

// Ponto a `km` do endereço real, na direção do pino (negativo = lado oposto).
function onJitterAxis(km: number) {
  const jitterKm = haversineKm(REAL.latitude, REAL.longitude, pin.latitude, pin.longitude);
  const factor = km / jitterKm;
  return {
    latitude: REAL.latitude + (pin.latitude - REAL.latitude) * factor,
    longitude: REAL.longitude + (pin.longitude - REAL.longitude) * factor
  };
}

// 0,9 km da casa (dentro do raio de 1 km se contado da casa), mas a mais de
// 1 km do pino (fora, se contado do pino).
const insideRealOutsidePublic = () => onJitterAxis(-0.9);

beforeAll(async () => {
  const now = new Date();
  const category = await prisma.serviceCategory.create({ data: { name: marker, description: "x" } });
  categoryId = category.id;

  const client = await prisma.user.create({
    data: {
      name: `${marker} aluno`,
      email: `${marker.toLowerCase()}_client@test.com`,
      password: "x",
      role: "CLIENT",
      mpCustomerId: `cus_${marker}`,
      emailVerifiedAt: now
    }
  });
  clientId = client.id;
  await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: now } });
  await prisma.customerPaymentMethod.create({
    data: {
      userId: clientId,
      mpCustomerId: `cus_${marker}`,
      mpCardId: `card_${marker}`,
      nickname: "Cartão",
      brand: "visa",
      last4: "4242",
      funding: "CREDIT",
      isDefault: true
    }
  });

  const providerUser = await prisma.user.create({
    data: {
      name: `${marker} profissional`,
      email: `${marker.toLowerCase()}_provider@test.com`,
      password: "x",
      role: "PROVIDER",
      emailVerifiedAt: now
    }
  });
  providerUserId = providerUser.id;
  const provider = await prisma.providerProfile.create({
    data: {
      userId: providerUserId,
      displayName: marker,
      bio: "Atende a domicílio, sem endereço comercial",
      experienceYears: 3,
      priceCents: 10_000,
      mpAccountId: "777888999",
      crefValidationStatus: "APPROVED",
      serviceMode: "BOTH",
      serviceRadiusKm: RADIUS_KM,
      latitude: REAL.latitude,
      longitude: REAL.longitude,
      fixedLocations: [{ id: "studio", name: "Studio" }]
    }
  });
  providerId = provider.id;
  await prisma.providerCategory.create({ data: { providerId, categoryId } });

  const jittered = jitterPublicCoordinates({ id: providerId, ...REAL });
  pin = { latitude: jittered.latitude, longitude: jittered.longitude };

  const offer = await prisma.providerServiceOffer.create({
    data: {
      providerId,
      kind: "PRESENTIAL",
      title: `Pacote ${marker}`,
      billingCycle: "MONTHLY",
      priceCents: 40_000,
      presentialPackageMode: "FLEXIBLE_CREDITS",
      presentialSessionsPerCycle: 4
    }
  });
  offerId = offer.id;
});

afterAll(async () => {
  await prisma.consultancyRequest.deleteMany({ where: { providerId } });
  await prisma.payment.deleteMany({ where: { booking: { providerId } } });
  await prisma.booking.deleteMany({ where: { providerId } });
  await prisma.presentialPackage.deleteMany({ where: { providerId } });
  await prisma.providerServiceOffer.deleteMany({ where: { providerId } });
  await prisma.availability.deleteMany({ where: { providerId } });
  await prisma.providerCategory.deleteMany({ where: { providerId } });
  await prisma.providerProfile.deleteMany({ where: { id: providerId } });
  await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
  await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
  await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
  await prisma.$disconnect();
});

describe("localização do profissional: nada calculado a partir do endereço real vaza pra fora", () => {
  it("pontos de teste estão onde precisam estar", () => {
    const point = insideRealOutsidePublic();
    expect(haversineKm(REAL.latitude, REAL.longitude, point.latitude, point.longitude)).toBeLessThan(RADIUS_KM);
    expect(haversineKm(pin.latitude, pin.longitude, point.latitude, point.longitude)).toBeGreaterThan(RADIUS_KM + 0.15);
  });

  it("busca pública: a distância é até o pino, não até a casa", async () => {
    // Procurando de dentro da casa: com a conta antiga, "a 0,0 km".
    const res = await request(app).get("/api/providers").query({ q: marker, lat: REAL.latitude, lng: REAL.longitude });
    expect(res.status).toBe(200);
    const found = res.body.find((p: { id: string }) => p.id === providerId);
    expect(found).toBeTruthy();

    const toShownPin = haversineKm(REAL.latitude, REAL.longitude, found.latitude, found.longitude);
    expect(found.distanceKm).toBeCloseTo(toShownPin, 1);
    expect(found.distanceKm).toBeGreaterThanOrEqual(0.2);
  });

  it("busca pública: o filtro de raio também conta a partir do pino", async () => {
    const point = insideRealOutsidePublic();
    const res = await request(app)
      .get("/api/providers")
      .query({ q: marker, lat: point.latitude, lng: point.longitude, maxDistanceKm: RADIUS_KM });
    expect(res.status).toBe(200);
    expect(res.body.map((p: { id: string }) => p.id)).not.toContain(providerId);
  });

  it("agendamento a domicílio: o raio de atendimento conta a partir do pino", async () => {
    const day = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await prisma.availability.create({
      data: {
        providerId,
        weekday: toWeekdayInTimezone(day, env.APP_TIMEZONE),
        startTime: "06:00",
        endTime: "22:00"
      }
    });
    const point = insideRealOutsidePublic();

    await expect(
      new BookingService().create(
        clientId,
        providerId,
        categoryId,
        atAppTime(day, 10).toISOString(),
        undefined,
        PaymentMethod.CREDIT_CARD,
        undefined,
        "A domicílio",
        point.latitude,
        point.longitude,
        undefined,
        true
      )
    ).rejects.toThrow(/fora do raio/);
  });

  it("compra de pacote a domicílio: o raio de atendimento conta a partir do pino", async () => {
    const point = insideRealOutsidePublic();
    await expect(
      new PresentialPackageService().purchasePackage(clientId, {
        offerId,
        categoryId,
        paymentMethod: "CREDIT_CARD" as never,
        sessionLocation: "A domicílio",
        clientLatitude: point.latitude,
        clientLongitude: point.longitude
      })
    ).rejects.toThrow(/fora do raio/);
  });

  it("telas de consultoria do aluno mostram o pino, não a casa", async () => {
    await prisma.consultancyRequest.create({
      data: { providerId, clientId, responseDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
    });
    const requests = await new ConsultancyService().listClientRequests(clientId);
    const shown = requests.find((r) => r.providerId === providerId)!.provider;

    expect(shown.latitude).toBeCloseTo(pin.latitude, 9);
    expect(shown.longitude).toBeCloseTo(pin.longitude, 9);
    expect(haversineKm(REAL.latitude, REAL.longitude, shown.latitude!, shown.longitude!)).toBeGreaterThan(0.25);
  });
});
