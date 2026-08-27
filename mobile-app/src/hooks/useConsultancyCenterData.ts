import { useEffect, useMemo, useState } from "react";
import * as Haptics from "expo-haptics";
import {
  ApiError,
  consultancyApi,
  ConsultancyRequest,
  ProviderServiceOffer,
  providerSubscriptionApi,
} from "../services/api/client";
import { providersApi } from "../services/api/client";
import { useAuthQuery } from "./useAuthQuery";
import { queryKeys } from "../lib/queryKeys";

type CenterData = {
  settings: { enabled: boolean } | null;
  offers: ProviderServiceOffer[];
  requests: ConsultancyRequest[];
  crefValidated: boolean;
  // Bloco 6 (bloqueio por assinatura inativa): selinho de cadeado nos
  // botões de ação desta área (mesmo padrão já usado pro crefValidated).
  subscriptionActive: boolean;
  prebuiltPlanCount: number;
  profileMissing: boolean;
};

function offerEffectivePriceCents(offer: ProviderServiceOffer) {
  if (offer.isPromotionActive && offer.promotionPriceCents) return offer.promotionPriceCents;
  return offer.priceCents;
}

// Dados e derivações compartilhadas pelas 3 telas da área de Consultoria
// (Painel / Vitrine / Pedidos) — todas usam a mesma queryKey, então o
// React Query serve do cache ao trocar de tela, sem refetch duplicado.
export function useConsultancyCenterData() {
  const [settingsEnabled, setSettingsEnabled] = useState(false);
  const [offers, setOffers] = useState<ProviderServiceOffer[]>([]);
  const [requests, setRequests] = useState<ConsultancyRequest[]>([]);
  const [selectedOfferByRequest, setSelectedOfferByRequest] = useState<Record<string, string>>({});

  const centerQuery = useAuthQuery(
    queryKeys.consultancy.providerCenter(),
    async (token) => {
      const [providerSettings, providerOffers, providerRequests, credentialsResult, providerPlans, subscriptionResult] = await Promise.all([
        consultancyApi.providerSettings(token).catch((err) => {
          const msg = err instanceof Error ? err.message : "";
          const isMissing =
            (err instanceof ApiError && err.status === 404) ||
            msg.toLowerCase().includes("perfil profissional") ||
            msg.toLowerCase().includes("provider profile");
          if (isMissing) return null;
          throw err;
        }),
        consultancyApi.providerOffers(token).catch(() => [] as ProviderServiceOffer[]),
        consultancyApi.providerRequests(token).catch(() => [] as ConsultancyRequest[]),
        providersApi.myCredentials(token).catch(() => null),
        consultancyApi.providerPlans(token).catch(() => [] as unknown[]),
        providerSubscriptionApi.myStatus(token).catch(() => null),
      ]);
      const credentials = credentialsResult as { crefValidationStatus?: string } | null;
      const planList = providerPlans as Array<{ isPrebuilt?: boolean }>;
      return {
        settings: providerSettings ? (providerSettings as { enabled: boolean }) : null,
        offers: providerOffers,
        requests: providerRequests,
        crefValidated: credentials?.crefValidationStatus === "APPROVED",
        subscriptionActive: subscriptionResult?.status === "TRIALING" || subscriptionResult?.status === "ACTIVE",
        prebuiltPlanCount: planList.filter((item) => item.isPrebuilt !== false).length,
        profileMissing: providerSettings === null,
      } as CenterData;
    },
  );

  const needsProfileSetup = centerQuery.data?.profileMissing ?? false;
  const crefValidated = centerQuery.data?.crefValidated ?? false;
  const subscriptionActive = centerQuery.data?.subscriptionActive ?? false;
  const prebuiltPlanCount = centerQuery.data?.prebuiltPlanCount ?? 0;
  const loading = centerQuery.isLoading;

  useEffect(() => {
    const data = centerQuery.data;
    if (!data) return;
    setOffers(data.offers);
    setRequests(data.requests);
    if (!data.profileMissing && data.settings) {
      setSettingsEnabled(data.settings.enabled);
    }
    const availableOnlineOffers = data.offers.filter(
      (item) => item.isActive !== false &&
        (item.kind === "ONLINE_CONSULTANCY" || item.kind === "ONLINE_CONSULTANCY_SPECIALIZED" || item.kind === "COMBO")
    );
    setSelectedOfferByRequest((current) => {
      const next = { ...current };
      data.requests.forEach((item) => {
        if (!next[item.id] && availableOnlineOffers[0]) next[item.id] = availableOnlineOffers[0].id;
      });
      return next;
    });
  }, [centerQuery.data]);

  const onlineOffers = useMemo(
    () =>
      offers.filter(
        (item) =>
          item.isActive !== false &&
          (item.kind === "ONLINE_CONSULTANCY" || item.kind === "ONLINE_CONSULTANCY_SPECIALIZED" || item.kind === "COMBO")
      ),
    [offers]
  );

  const activeRequests = useMemo(
    () => requests.filter((item) => item.status === "OPEN" || item.status === "RESPONDED" || item.status === "ACCEPTED"),
    [requests]
  );

  const openRequests = useMemo(() => activeRequests.filter((item) => item.status === "OPEN"), [activeRequests]);
  const respondedRequests = useMemo(() => activeRequests.filter((item) => item.status === "RESPONDED"), [activeRequests]);
  const acceptedRequests = useMemo(() => activeRequests.filter((item) => item.status === "ACCEPTED"), [activeRequests]);
  const promotionCount = useMemo(() => offers.filter((item) => item.isPromotionActive).length, [offers]);

  const averageTicket = useMemo(() => {
    if (!onlineOffers.length) return 0;
    const total = onlineOffers.reduce((sum, item) => sum + offerEffectivePriceCents(item), 0);
    return Math.round(total / onlineOffers.length);
  }, [onlineOffers]);

  const readinessChecklist = useMemo(
    () => [
      {
        key: "profile",
        title: "Perfil profissional completo",
        detail: "Necessario para publicar ofertas e responder alunos.",
        done: !needsProfileSetup,
      },
      {
        key: "cref",
        title: "CREF validado",
        detail: "Sem validação, os lancamentos ficam bloqueados.",
        done: crefValidated,
      },
      {
        key: "plan",
        title: "Treino pré-pronto cadastrado",
        detail: "Garante entrega rapida da consultoria.",
        done: prebuiltPlanCount > 0,
      },
      {
        key: "offer",
        title: "Oferta online ativa",
        detail: "Necessário para enviar proposta nas solicitações.",
        done: onlineOffers.length > 0,
      },
      {
        key: "settings",
        title: "Consultoria online habilitada",
        detail: "Permite aparecer como disponivel para novos alunos.",
        done: settingsEnabled,
      },
    ],
    [crefValidated, needsProfileSetup, onlineOffers.length, prebuiltPlanCount, settingsEnabled]
  );

  const readinessScore = useMemo(() => {
    const done = readinessChecklist.filter((item) => item.done).length;
    return readinessChecklist.length ? done / readinessChecklist.length : 0;
  }, [readinessChecklist]);

  const nextGuidedStep = useMemo(
    () => readinessChecklist.find((item) => !item.done),
    [readinessChecklist]
  );

  async function onRefresh() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void centerQuery.refetch();
  }

  return {
    centerQuery,
    loading,
    needsProfileSetup,
    crefValidated,
    subscriptionActive,
    prebuiltPlanCount,
    settingsEnabled,
    setSettingsEnabled,
    offers,
    setOffers,
    requests,
    setRequests,
    selectedOfferByRequest,
    setSelectedOfferByRequest,
    onlineOffers,
    activeRequests,
    openRequests,
    respondedRequests,
    acceptedRequests,
    promotionCount,
    averageTicket,
    readinessChecklist,
    readinessScore,
    nextGuidedStep,
    onRefresh,
  };
}

export { offerEffectivePriceCents };
