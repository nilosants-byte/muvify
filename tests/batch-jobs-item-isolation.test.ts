import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ConsultancyRequestStatus, ProviderSubscriptionStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { processWeeklyReset } from "../src/modules/community/jobs/community.jobs";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { ProviderSubscriptionService } from "../src/modules/providers/services/provider-subscription.service";

// Rotinas automáticas em lote: um item com problema não pode impedir os
// outros. Antes, o erro do primeiro item interrompia o laço; como ele
// continuava "vencido", travava a mesma fila de novo a cada rodada.
//
// As datas ficam no ano 2000 e cada rotina roda com uma data de referência
// também de 2000: assim ela só enxerga os itens deste teste, nunca os de
// outros arquivos rodando em paralelo no mesmo banco.

const marker = `BATCH_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const LONG_AGO = new Date("2000-01-01T00:00:00.000Z");
const REFERENCE = new Date("2000-02-01T00:00:00.000Z");
const userIds: string[] = [];
const providerIds: string[] = [];

async function createUser(label: string, role: "CLIENT" | "PROVIDER") {
  const user = await prisma.user.create({
    data: { name: `${marker} ${label}`, email: `${marker.toLowerCase()}_${label}@test.com`, password: "x", role }
  });
  userIds.push(user.id);
  return user;
}

async function createProvider(label: string) {
  const user = await createUser(label, "PROVIDER");
  const profile = await prisma.providerProfile.create({
    data: { userId: user.id, displayName: `${marker} ${label}`, bio: "x", experienceYears: 1, priceCents: 10_000 }
  });
  providerIds.push(profile.id);
  return profile;
}

// Faz falhar só a primeira chamada que mexe num item DESTE teste (o banco de
// teste pode ter sobras de outras rodadas, que a rotina também processa) e
// repassa todas as outras pro Prisma de verdade. Devolve, em ordem, os ids
// deste teste que a rotina tocou: o primeiro é o que falhou.
// (Não dá pra usar vi.spyOn(...).mockRejectedValueOnce sozinho: nos métodos do
// Prisma, as chamadas seguintes do espião não chegam ao banco e devolvem um
// resultado falso, o que faria o teste passar ou falhar pelo motivo errado.)
function failFirstCallOn<T extends object>(
  delegate: T,
  method: keyof T & string,
  ownIdOf: (args: Record<string, any>) => string | undefined,
  ownIds: string[],
  error: Error
) {
  const original = (delegate[method] as unknown as (...args: unknown[]) => unknown).bind(delegate);
  const touched: string[] = [];
  vi.spyOn(delegate, method as never).mockImplementation(((args: Record<string, any>) => {
    const id = ownIdOf(args);
    if (id && ownIds.includes(id)) {
      touched.push(id);
      if (touched.length === 1) return Promise.reject(error);
    }
    return original(args);
  }) as never);
  return touched;
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.userXpTransaction.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userAchievement.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.feedPost.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.rankingSnapshot.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userNotification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.consultancyRequest.deleteMany({ where: { providerId: { in: providerIds } } });
  await prisma.providerSubscription.deleteMany({ where: { providerId: { in: providerIds } } });
  await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("rotinas em lote: um item com erro não trava os outros", () => {
  it("cobrança de assinatura: o primeiro dá erro de banco, o segundo é cobrado mesmo assim", async () => {
    const providers = [await createProvider("sub1"), await createProvider("sub2")];
    for (const provider of providers) {
      await prisma.providerSubscription.create({
        data: { providerId: provider.id, status: ProviderSubscriptionStatus.PENDING_PAYMENT, nextBillingAt: LONG_AGO }
      });
    }
    const touched = failFirstCallOn(
      prisma.user,
      "findUnique",
      (args) => args?.where?.id,
      providers.map((p) => p.userId),
      new Error("falha simulada no 1º item")
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await new ProviderSubscriptionService().runSubscriptionBilling(REFERENCE);

    // A rotina chegou nos dois, e o que deu erro veio primeiro.
    expect(touched).toHaveLength(2);
    const [failedUserId, nextUserId] = touched;
    const subOf = async (userId: string) =>
      prisma.providerSubscription.findFirstOrThrow({ where: { provider: { userId } } });
    // O seguinte foi tentado normalmente (sem cartão: registra a tentativa e reagenda).
    expect((await subOf(nextUserId)).lastChargeAt?.getTime()).toBe(REFERENCE.getTime());
    // O que deu erro continua vencido: a próxima rodada tenta de novo.
    const failed = await subOf(failedUserId);
    expect(failed.lastChargeAt).toBeNull();
    expect(failed.nextBillingAt?.getTime()).toBe(LONG_AGO.getTime());
  });

  it("pedidos de consultoria sem resposta: o primeiro dá erro, o segundo expira mesmo assim", async () => {
    const provider = await createProvider("req");
    const clients = [await createUser("req_c1", "CLIENT"), await createUser("req_c2", "CLIENT")];
    const requestIds: string[] = [];
    for (const client of clients) {
      const created = await prisma.consultancyRequest.create({
        data: { providerId: provider.id, clientId: client.id, responseDeadlineAt: LONG_AGO }
      });
      requestIds.push(created.id);
    }
    const touched = failFirstCallOn(
      prisma.consultancyRequest,
      "update",
      (args) => args?.where?.id,
      requestIds,
      new Error("falha simulada no 1º item")
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await new ConsultancyService().expireStaleConsultancyRequests(REFERENCE);

    expect(touched).toHaveLength(2);
    const statusOf = async (id: string) => (await prisma.consultancyRequest.findUniqueOrThrow({ where: { id } })).status;
    expect(await statusOf(touched[0])).toBe(ConsultancyRequestStatus.OPEN);
    expect(await statusOf(touched[1])).toBe(ConsultancyRequestStatus.EXPIRED);
  });

  it("prêmio do ranking semanal: o 1º lugar dá erro, o 2º recebe mesmo assim e a rotina avisa pra tentar de novo", async () => {
    const weekKey = `2000-01-${String(3 + Math.floor(Math.random() * 20)).padStart(2, "0")}-${marker}`;
    const first = await createUser("rank1", "CLIENT");
    const second = await createUser("rank2", "CLIENT");
    await prisma.rankingSnapshot.create({
      data: { userId: first.id, periodType: "WEEKLY", periodKey: weekKey, xpEarned: 500 }
    });
    await prisma.rankingSnapshot.create({
      data: { userId: second.id, periodType: "WEEKLY", periodKey: weekKey, xpEarned: 300 }
    });
    // Primeira consulta do awardXp (checagem de "já recebeu?") do 1º colocado falha.
    failFirstCallOn(
      prisma.userXpTransaction,
      "findFirst",
      (args) => args?.where?.userId,
      [first.id, second.id],
      new Error("falha simulada no 1º lugar")
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(processWeeklyReset(weekKey)).rejects.toThrow(/1 prêmio\(s\) falharam/);

    const prizes = await prisma.userXpTransaction.findMany({
      where: { userId: { in: [first.id, second.id] }, referenceId: `weekly:${weekKey}` }
    });
    expect(prizes.map((p) => [p.userId, p.reason])).toEqual([[second.id, "WEEKLY_RANKING_2ND"]]);
  });
});
