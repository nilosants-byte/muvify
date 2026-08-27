import { BookingStatus, ConsultancyContractStatus, PresentialPackageStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../config/prisma";
import { AppError } from "../errors/app-error";

// Bloco 3 (exclusividade de marketplace): um cliente só pode ter um
// profissional ativo por vez — pode trocar/adicionar serviço com o MESMO
// profissional livremente, mas não contrata outro enquanto o vínculo durar.
// Comentário original que aponta pra cá: consultancy.service.ts, guarda de
// createExternalStudentContract (Bloco 1).
//
// "Ativo" por modelo segue a mesma convenção que o próprio código já usa em
// cada guarda existente (conflito de horário, pacote duplicado):
const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [BookingStatus.PENDING, BookingStatus.CONFIRMED];
const ACTIVE_CONSULTANCY_STATUSES: ConsultancyContractStatus[] = [
  ConsultancyContractStatus.PENDING_PAYMENT,
  ConsultancyContractStatus.ACTIVE,
  ConsultancyContractStatus.DELIVERED
];
const ACTIVE_PACKAGE_STATUSES: PresentialPackageStatus[] = [
  PresentialPackageStatus.PENDING_PAYMENT,
  PresentialPackageStatus.ACTIVE,
  PresentialPackageStatus.PAST_DUE
];

async function findActiveProviderIdForClient(
  clientId: string,
  excludeProviderId?: string
): Promise<string | null> {
  const [booking, contract, pkg] = await Promise.all([
    prisma.booking.findFirst({
      where: {
        clientId,
        status: { in: ACTIVE_BOOKING_STATUSES },
        ...(excludeProviderId ? { providerId: { not: excludeProviderId } } : {})
      },
      select: { providerId: true }
    }),
    prisma.consultancyContract.findFirst({
      where: {
        clientId,
        status: { in: ACTIVE_CONSULTANCY_STATUSES },
        ...(excludeProviderId ? { providerId: { not: excludeProviderId } } : {})
      },
      select: { providerId: true }
    }),
    prisma.presentialPackage.findFirst({
      where: {
        clientId,
        status: { in: ACTIVE_PACKAGE_STATUSES },
        ...(excludeProviderId ? { providerId: { not: excludeProviderId } } : {})
      },
      select: { providerId: true }
    })
  ]);

  return booking?.providerId ?? contract?.providerId ?? pkg?.providerId ?? null;
}

// Chamado antes de criar qualquer novo vínculo (Booking avulso,
// ConsultancyContract, PresentialPackage) — bloqueia se o cliente já tem um
// vínculo ativo com um profissional DIFERENTE do que está tentando contratar
// agora. Contratar mais um serviço do MESMO profissional nunca é bloqueado.
export async function assertNoActiveEngagementWithOtherProvider(
  clientId: string,
  targetProviderId: string
): Promise<void> {
  const otherProviderId = await findActiveProviderIdForClient(clientId, targetProviderId);
  if (otherProviderId) {
    throw new AppError(
      "Você já tem um profissional ativo no Muvify. Cancele o vínculo atual antes de contratar outro.",
      StatusCodes.CONFLICT
    );
  }
}

export type ActiveEngagementSummary =
  | { hasActive: false }
  | {
      hasActive: true;
      providerId: string;
      providerName: string;
      providerPhotoUrl: string | null;
      crefApproved: boolean;
      kind: ActiveEngagementKind;
      priceCents: number;
      billingCycle: string;
      contractId: string | null;
      packageId: string | null;
      // Raio-X pós-épico: vínculo puramente avulso (Booking sem
      // ConsultancyContract/PresentialPackage) — presente só quando os dois
      // acima são null, pra mobile saber qual API de cancelamento chamar.
      bookingId: string | null;
      // Raio-X pós-épico (achado alto): sem isso, ProviderServicesUpgradeScreen
      // tinha que ADIVINHAR qual oferta do catálogo é a atual comparando só
      // por `kind` — com duas ofertas do mesmo kind (ex: dois planos de
      // consultoria online com preços diferentes), marcava a errada como
      // "SEU PLANO ATUAL" e liberava trocar pra ela mesma sem cobrar nada.
      // null só quando o vínculo é booking avulso (sem oferta de catálogo).
      offerId: string | null;
      // Raio-X pós-épico (achado baixo): sem isso, o card de plano mostrava
      // "R$ 0,00/mês" pro aluno externo (Bloco 1) sem nenhum contexto — só
      // ConsultancyContract tem esse conceito, então é null pra vínculo via
      // pacote presencial ou booking avulso.
      origin: "MARKETPLACE" | "EXTERNAL" | null;
      upcomingSessions: Array<{ bookingId: string; scheduledAt: Date; sessionLocation: string | null; status: BookingStatus }>;
    };

type ActiveEngagementKind = "PRESENTIAL" | "ONLINE_CONSULTANCY" | "ONLINE_CONSULTANCY_SPECIALIZED" | "COMBO";

// Fonte única pra "meu vínculo ativo" — alimenta o endpoint GET
// /users/me/active-engagement, que por sua vez alimenta tanto o gate de
// Home/navegação quanto o card de plano da aba "Meu Personal" no app. Como a
// regra acima garante no máximo um profissional ativo por vez, não há
// ambiguidade em "qual profissional mostrar".
const PROVIDER_SUMMARY_SELECT = {
  id: true,
  displayName: true,
  photoUrl: true,
  updatedAt: true,
  crefValidationStatus: true
} as const;

export async function getActiveEngagementSummary(clientId: string): Promise<ActiveEngagementSummary> {
  const [contract, pkg] = await Promise.all([
    prisma.consultancyContract.findFirst({
      where: { clientId, status: { in: ACTIVE_CONSULTANCY_STATUSES } },
      orderBy: { createdAt: "desc" },
      include: { provider: { select: PROVIDER_SUMMARY_SELECT } }
    }),
    prisma.presentialPackage.findFirst({
      where: { clientId, status: { in: ACTIVE_PACKAGE_STATUSES } },
      orderBy: { createdAt: "desc" },
      include: { provider: { select: PROVIDER_SUMMARY_SELECT } }
    })
  ]);

  const anchor = contract ?? pkg;

  // Raio-X pós-épico (achado crítico): vínculo puramente avulso (Booking
  // sem ConsultancyContract/PresentialPackage) nunca era considerado aqui,
  // apesar de já contar pra exclusividade em
  // assertNoActiveEngagementWithOtherProvider (findActiveProviderIdForClient
  // acima já checa Booking) — a Home nunca travava, o bloqueio de navegação
  // nunca ativava, e o cliente só descobria o vínculo ao esbarrar no erro 409
  // na hora de tentar contratar outro profissional.
  const standaloneBooking = !anchor
    ? await prisma.booking.findFirst({
        where: { clientId, status: { in: ACTIVE_BOOKING_STATUSES }, packageId: null },
        orderBy: { createdAt: "desc" },
        include: { provider: { select: PROVIDER_SUMMARY_SELECT } }
      })
    : null;

  if (!anchor && !standaloneBooking) {
    return { hasActive: false };
  }

  const providerId = anchor ? anchor.provider.id : standaloneBooking!.provider.id;
  const upcomingBookings = await prisma.booking.findMany({
    where: {
      clientId,
      providerId,
      status: { in: ACTIVE_BOOKING_STATUSES },
      scheduledAt: { gte: new Date() }
    },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, scheduledAt: true, sessionLocation: true, status: true },
    take: 50
  });

  const kind: ActiveEngagementKind = contract ? contract.kind : "PRESENTIAL";

  // Combo é dois registros ligados (contract.kind === "COMBO" e um pkg com o
  // mesmo consultancyContractId) — cada um guarda só a fatia do preço que lhe
  // cabe (comboConsultancyShareCents/comboPresentialShareCents), então o
  // valor total do plano soma os dois quando ambos existem pro mesmo vínculo.
  const isSameComboPair = contract && pkg && pkg.consultancyContractId === contract.id;
  const priceCents = contract && pkg
    ? isSameComboPair
      ? contract.paymentAmountCents + pkg.cycleAmountCents
      : contract.paymentAmountCents // não deveria acontecer (regra de exclusividade garante um só profissional), defensivo
    : contract
      ? contract.paymentAmountCents
      : pkg
        ? pkg.cycleAmountCents
        : standaloneBooking!.priceCents;

  const providerRef = anchor ? anchor.provider : standaloneBooking!.provider;

  return {
    hasActive: true,
    providerId,
    providerName: providerRef.displayName,
    providerPhotoUrl: providerRef.photoUrl,
    crefApproved: providerRef.crefValidationStatus === "APPROVED",
    kind,
    priceCents,
    billingCycle: contract ? contract.billingCycle : pkg ? pkg.billingCycle : "AVULSO",
    contractId: contract?.id ?? null,
    packageId: pkg?.id ?? null,
    bookingId: !contract && !pkg ? standaloneBooking!.id : null,
    offerId: contract?.offerId ?? pkg?.offerId ?? null,
    origin: contract?.origin ?? null,
    upcomingSessions: upcomingBookings.map((b) => ({
      bookingId: b.id,
      scheduledAt: b.scheduledAt,
      sessionLocation: b.sessionLocation,
      status: b.status
    }))
  };
}
