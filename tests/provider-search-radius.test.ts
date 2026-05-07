import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Prisma, UserRole } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

const marker = `RadiusRule_${Date.now()}`;
const clientLat = -23.55052;
const clientLng = -46.633308;
const maxDistanceKm = 5;

const createdUserIds: string[] = [];
const createdProviderIds: string[] = [];

async function createProviderProfile(input: {
  displayName: string;
  latitude?: number;
  longitude?: number;
  serviceRadiusKm?: number;
  fixedLocations?: Prisma.InputJsonValue;
}) {
  const user = await prisma.user.create({
    data: {
      name: input.displayName,
      email: `${input.displayName.toLowerCase()}@test.local`,
      password: "hashed-password-placeholder",
      role: UserRole.PROVIDER
    }
  });
  createdUserIds.push(user.id);

  const profile = await prisma.providerProfile.create({
    data: {
      userId: user.id,
      displayName: input.displayName,
      bio: "Profissional para teste de raio no mapa.",
      experienceYears: 3,
      priceCents: 15000,
      latitude: input.latitude,
      longitude: input.longitude,
      serviceRadiusKm: input.serviceRadiusKm,
      fixedLocations: input.fixedLocations
    }
  });
  createdProviderIds.push(profile.id);
}

describe("provider search radius", () => {
  beforeAll(async () => {
    await prisma.$connect();

    await createProviderProfile({
      displayName: `${marker}_Near`,
      latitude: clientLat + 0.01,
      longitude: clientLng
    });

    await createProviderProfile({
      displayName: `${marker}_FarMainLargeRadius`,
      latitude: clientLat + 0.12,
      longitude: clientLng,
      serviceRadiusKm: 100
    });

    await createProviderProfile({
      displayName: `${marker}_FarFixedLargeRadius`,
      fixedLocations: [
        {
          id: "fixed-1",
          name: "Unidade distante",
          latitude: clientLat + 0.15,
          longitude: clientLng,
          radiusKm: 120
        }
      ]
    });

    await createProviderProfile({
      displayName: `${marker}_NoCoords`
    });
  });

  afterAll(async () => {
    await prisma.providerProfile.deleteMany({
      where: { id: { in: createdProviderIds } }
    });
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } }
    });
    await prisma.$disconnect();
  });

  it("returns only providers physically inside the student's selected radius", async () => {
    const response = await request(app)
      .get("/api/providers")
      .query({
        q: marker,
        lat: clientLat,
        lng: clientLng,
        maxDistanceKm
      });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);

    const displayNames = response.body.map((item: { displayName?: string }) => item.displayName);

    expect(displayNames).toContain(`${marker}_Near`);
    expect(displayNames).not.toContain(`${marker}_FarMainLargeRadius`);
    expect(displayNames).not.toContain(`${marker}_FarFixedLargeRadius`);
    expect(displayNames).not.toContain(`${marker}_NoCoords`);
  });
});
