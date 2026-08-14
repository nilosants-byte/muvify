import React, { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, Share, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import {
  chatApi,
  consultancyApi,
  consultancyChatApi,
  favoritesApi,
  ProviderConsultancyCatalog,
  ProviderServiceOffer,
  ProviderSummary,
  providersApi,
  userApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { MvAvatar } from "../../components/mv";
import { MvVideoPlayer } from "../../components/mv/MvVideoPlayer";
import { averageToFive, extractApiMessage, formatPriceFromCents, handleScreenError } from "../shared/api-helpers";
import { formatCurrencyBRL } from "../../utils/formatters";
import { resolveMediaUrl } from "../../utils/media";
import { useMvTheme } from "../../theme/MvThemeContext";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { hapticCta } from "../../utils/haptics";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { SkeletonCard } from "../../components/polish/SkeletonCard";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { findChatWithProvider } from "../../utils/findChatWithProvider";

type Props = NativeStackScreenProps<ClientStackParamList, "ProfessionalDetail">;
type ProviderDetail = ProviderSummary & {
  categoryLinks?: Array<{ category?: { name: string } }>;
  reviews?: Array<{ id: string; rating: number; comment?: string | null; providerResponse?: string | null; user?: { name?: string } }>;
  fixedLocations?: Array<{ id: string; name: string; latitude?: number | null; longitude?: number | null }>;
  presentationVideoUrl?: string | null;
};

function getInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function StarRow({ rating }: { rating: number }) {
  const { theme } = useMvTheme();
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Text key={star} style={{ fontSize: 14, color: star <= Math.round(rating) ? C.amber : theme.labelColor }}>★</Text>
      ))}
    </View>
  );
}

export function ProfessionalDetailScreen({ route, navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const providerId = route.params.professionalId;

  const detailQuery = useAuthQuery(
    queryKeys.providers.detail(providerId),
    async (token) => {
      let catalogLoadError = false;
      const [detail, catalog, currentFavorites, anamnesisProfile] = await Promise.all([
        providersApi.detail(providerId) as Promise<ProviderDetail>,
        consultancyApi.providerCatalog(providerId).catch(() => { catalogLoadError = true; return null; }),
        favoritesApi.list(token),
        userApi.myAnamnesis(token).catch(() => null),
      ]);
      return {
        provider: detail,
        consultancyCatalog: catalog,
        catalogLoadError,
        anamnesisCompleted: anamnesisProfile ? anamnesisProfile.status === "COMPLETED" : null,
        isFavorite: currentFavorites.some((item) => item.providerId === providerId),
      };
    }
  );

  const loading = detailQuery.isLoading;
  const provider = detailQuery.data?.provider ?? null;
  const consultancyCatalog = detailQuery.data?.consultancyCatalog ?? null;
  const catalogLoadError = detailQuery.data?.catalogLoadError ?? false;
  const anamnesisCompleted = detailQuery.data?.anamnesisCompleted ?? null;

  const [favorite, setFavorite] = useState(false);
  const [savingFavorite, setSavingFavorite] = useState(false);

  useEffect(() => {
    if (detailQuery.data) setFavorite(detailQuery.data.isFavorite);
  }, [detailQuery.data]);

  useEffect(() => {
    if (detailQuery.error) {
      handleScreenError({ error: detailQuery.error, showToast, fallbackMessage: "Falha ao carregar detalhes do profissional.", navigation });
    }
  }, [detailQuery.error, showToast, navigation]);

  const categoryLabel = useMemo(() => {
    const names = provider?.categoryLinks?.map((l) => l.category?.name).filter(Boolean) as string[] | undefined;
    return names?.length ? names.join(" · ") : "Personal Trainer";
  }, [provider?.categoryLinks]);

  // Promoções de consultoria online — devem ir para ConsultancyRequest, não CreateBooking
  const consultancyPromotionOffers = useMemo(
    () =>
      (consultancyCatalog?.offers ?? []).filter(
        (o) => o.isActive && o.isPromotionActive && o.kind !== "PRESENTIAL"
      ),
    [consultancyCatalog?.offers]
  );

  // Promoções presenciais (agendamento) — mantém fluxo de CreateBooking
  const presentialPromotionOffers = useMemo(
    () =>
      (consultancyCatalog?.offers ?? []).filter(
        (o) => o.isActive && o.isPromotionActive && o.kind === "PRESENTIAL"
      ),
    [consultancyCatalog?.offers]
  );

  // Ofertas de consultoria sem promoção (as em promoção aparecem na seção de promoções)
  const onlineOffers = useMemo(
    () =>
      (consultancyCatalog?.offers ?? [])
        .filter((o) => o.kind !== "PRESENTIAL" && !o.isPromotionActive)
        .slice(0, 3),
    [consultancyCatalog?.offers]
  );

  // Pacotes presenciais (assinatura por ciclo) - promocionais ou nao, ja que
  // sem essa secao um pacote sem promocao nao apareceria em lugar nenhum.
  // Exclui as que ja aparecem nas secoes de promocao, pra nao duplicar o card.
  const presentialPackageOffers = useMemo(
    () =>
      (consultancyCatalog?.offers ?? []).filter(
        (o) => o.isActive && Boolean(o.presentialPackageMode) && !o.isPromotionActive
      ),
    [consultancyCatalog?.offers]
  );

  async function toggleFavorite() {
    try {
      setSavingFavorite(true);
      if (favorite) {
        await runWithAuth((token) => favoritesApi.remove(token, providerId));
        setFavorite(false);
        showToast("Profissional removido dos favoritos.", "success");
      } else {
        await runWithAuth((token) => favoritesApi.add(token, providerId));
        setFavorite(true);
        showToast("Profissional adicionado aos favoritos.", "success");
      }
    } catch (error) {
      const msg = extractApiMessage(error, "");
      if (msg.toLowerCase().includes("disponiv")) {
        showToast("Este profissional não está disponível para favoritos.", "info");
        return;
      }
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível atualizar favoritos.", navigation });
    } finally { setSavingFavorite(false); }
  }

  function handleShare() {
    const name = provider?.displayName ?? "Personal Trainer";
    void Share.share({
      title: `Conheça ${name} no Muvify`,
      message: `Conheça ${name} no Muvify!\nmuvify://professional/${providerId}`,
    });
  }

  // Segunda camada, Frente 1, Lote 3 (fechamento): o botão de mensagem
  // sempre abria a lista geral de conversas, sem nenhuma relação com o
  // profissional cujo perfil o usuário estava vendo. O chat só existe depois
  // de um agendamento ou consultoria contratada - busca se já existe uma
  // conversa com este profissional e abre ela direto; se não existir ainda,
  // explica o motivo em vez de cair numa lista genérica sem contexto.
  async function handleOpenChat() {
    try {
      const [bookingChats, consultancyChats] = await Promise.all([
        runWithAuth((token) => chatApi.myChats(token)),
        runWithAuth((token) => consultancyChatApi.myChats(token)),
      ]);
      const match = findChatWithProvider(bookingChats, consultancyChats, providerId);
      if (match?.kind === "booking") {
        navigation.navigate("ClientChatList", { openBookingId: match.bookingId });
      } else if (match?.kind === "consultancy") {
        navigation.navigate("ClientChatList", { openContractId: match.contractId });
      } else {
        showToast("Você poderá conversar com este profissional após agendar uma aula ou contratar uma consultoria.", "info");
      }
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível abrir a conversa.", navigation });
    }
  }

  function goToPresentialPackagePurchase(offer: ProviderServiceOffer) {
    if (!offer.presentialPackageMode) return;
    navigation.navigate("BuyPresentialPackage", {
      professionalId: providerId,
      offerId: offer.id,
      offerTitle: offer.title,
      offerKind: offer.kind,
      billingCycle: offer.billingCycle,
      cycleAmountCents: offer.effectivePriceCents ?? offer.priceCents,
      presentialPackageMode: offer.presentialPackageMode,
      presentialSessionsPerCycle: offer.presentialSessionsPerCycle ?? 0,
      presentialHasFixedTerm: Boolean(offer.presentialHasFixedTerm),
      presentialTotalCycles: offer.presentialTotalCycles ?? null,
      comboPresentialShareCents: offer.comboPresentialShareCents ?? null,
      comboConsultancyShareCents: offer.comboConsultancyShareCents ?? null,
      acceptsPix: offer.acceptsPix ?? true,
      acceptsCreditCard: offer.acceptsCreditCard ?? true,
      offerServiceMode: offer.offerServiceMode ?? null,
    });
  }

  function goToBookingWithOffer(offer: ProviderServiceOffer) {
    // Oferta presencial vendida como pacote (assinatura por ciclo) - vai
    // pro fluxo de compra do pacote, nao pro agendamento avulso.
    if (offer.presentialPackageMode) {
      goToPresentialPackagePurchase(offer);
      return;
    }
    navigation.navigate("CreateBooking", {
      professionalId: providerId,
      offerId: offer.id,
      offerTitle: offer.title,
      offerPriceCents: offer.effectivePriceCents ?? offer.priceCents,
      offerKind: offer.kind,
      isPromotionalOffer: Boolean(offer.isPromotionActive),
    });
  }

  // Verifica ficha de saúde ANTES de entrar no fluxo de agendamento.
  // Mostra aviso se incompleta — o usuário pode continuar ou preencher agora.
  function handleGoToBooking() {
    hapticCta();
    if (anamnesisCompleted === false) {
      // Frente 8 (segunda camada), Lote 1: o texto antigo prometia "continuar
      // e preencher depois", mas CreateBookingScreen trava o botão final de
      // confirmação até a ficha estar completa (backend exige isso pra
      // criar o agendamento) — o cliente preenchia todo o formulário de
      // agendamento pra só então descobrir que não dava pra concluir.
      // Mantém a navegação (a tela de agendamento já mostra um banner com
      // atalho "Preencher" no topo), mas o texto agora não promete algo que
      // o app não cumpre.
      Alert.alert(
        "Ficha de saúde incompleta",
        "Preencha sua ficha de saúde para que o personal personalize seu atendimento com mais segurança. Você pode ir escolhendo os dados do agendamento, mas vai precisar completar a ficha antes de confirmar.",
        [
          {
            text: "Preencher agora",
            onPress: () => navigation.navigate("ClientAnamnesis"),
          },
          {
            text: "Continuar mesmo assim",
            onPress: () => navigation.navigate("CreateBooking", { professionalId: providerId }),
          },
          { text: "Cancelar", style: "cancel" },
        ]
      );
      return;
    }
    navigation.navigate("CreateBooking", { professionalId: providerId });
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, height: 70, borderBottomWidth: 1, borderBottomColor: theme.border }} />
        <View style={{ paddingHorizontal: S.px, paddingTop: 16, gap: 12 }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  if (!provider) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.text2 }}>Profissional não encontrado.</Text>
      </View>
    );
  }

  const rating = averageToFive(provider.avgRating ?? provider.averageRating);
  const reviewCount = provider.reviews?.length ?? 0;
  const hasFixedLocations = (provider.fixedLocations ?? []).length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header V2 — sticky */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button" accessibilityLabel="Voltar" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.02 * 22 }} numberOfLines={1}>{provider.displayName}</Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>
            personal trainer · {consultancyCatalog?.onlineConsultancyEnabled ? "CREF validado" : "profissional"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            onPress={handleShare}
            accessibilityRole="button" accessibilityLabel="Compartilhar perfil"
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="share-outline" size={18} color={theme.text1} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void handleOpenChat()}
            accessibilityRole="button" accessibilityLabel="Conversar com o profissional"
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="send" size={16} color={theme.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScreenEntrance>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 120, paddingTop: 16, gap: 14 }}
        showsVerticalScrollIndicator={false}
        pinchGestureEnabled
        maximumZoomScale={3}
      >
        {/* Hero card V2 */}
        <View style={{
          borderRadius: S.cardR, borderWidth: 1, borderColor: theme.primarySubtleBorder,
          backgroundColor: theme.primaryHighlight, padding: 16,
        }}>
          <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
            <MvAvatar
              initials={getInitials(provider.displayName)}
              photoUri={provider.photoUrl ?? null}
              tone="green"
              size="lg"
            />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.02 * 22 }}>{provider.displayName}</Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, marginTop: 4 }}>{categoryLabel}</Text>
              <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {consultancyCatalog?.onlineConsultancyEnabled && (
                  <View style={{ backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.primary }}>CREF VALIDADO</Text>
                  </View>
                )}
                {favorite && (
                  <View style={{ backgroundColor: theme.dangerSubtle, borderWidth: 1, borderColor: theme.dangerSubtleBorder, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.danger }}>Favorito</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Stats grid */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
            {[
              { label: "Avaliação", value: rating > 0 ? `${rating.toFixed(1)} ★` : "—" },
              { label: "Avaliações", value: String(reviewCount) },
              { label: "A partir de", value: formatCurrencyBRL(formatPriceFromCents(provider.priceCents)) },
            ].map((stat) => (
              <View key={stat.label} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.24)", borderRadius: 16, padding: "10px 8px" as any, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", gap: 2 }}>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.text3 }}>{stat.label}</Text>
                <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 14, color: theme.text1, letterSpacing: -0.013 * 14, textAlign: "center" }}>{stat.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Vídeo de apresentação */}
        {provider.presentationVideoUrl ? (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 14 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1, marginBottom: 10 }}>Vídeo de apresentação</Text>
            <MvVideoPlayer url={resolveMediaUrl(provider.presentationVideoUrl) ?? provider.presentationVideoUrl} height={200} borderRadius={10} />
          </View>
        ) : null}

        {/* Por que contratar (bio) */}
        {provider.bio ? (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 14 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1, marginBottom: 10 }}>Por que contratar</Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, lineHeight: 20 }}>{provider.bio}</Text>
          </View>
        ) : null}

        {/* Locais de atendimento */}
        {hasFixedLocations ? (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 14 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1, marginBottom: 10 }}>Locais de atendimento</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {(provider.fixedLocations ?? []).map((loc) => (
                <View key={loc.id} style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, padding: "10px 12px" as any, paddingVertical: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="barbell-outline" size={13} color={theme.primary} />
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>{loc.name}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* Promoções de consultoria online */}
        {consultancyPromotionOffers.length > 0 ? (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: C.amberBorder, backgroundColor: "rgba(245,166,35,0.08)", padding: 14 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1, marginBottom: 10 }}>Consultoria em promoção</Text>
            <View style={{ gap: 10 }}>
              {consultancyPromotionOffers.map((offer) => {
                const hasDiscount = (offer.effectivePriceCents ?? offer.priceCents) < offer.priceCents;
                const kindLabel = offer.kindDescription
                  ?? (offer.kind === "ONLINE_CONSULTANCY" ? "Consultoria online"
                    : offer.kind === "ONLINE_CONSULTANCY_SPECIALIZED" ? "Consultoria especializada"
                    : offer.kind === "COMBO" ? "Combo online + presencial"
                    : "Consultoria");
                return (
                  <View key={offer.id} style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, padding: 12, gap: 6 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1, flex: 1, marginRight: 8 }}>{offer.title}</Text>
                      <View style={{ backgroundColor: C.amber, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.textOnPrimary }}>PROMO</Text>
                      </View>
                    </View>
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>{kindLabel}</Text>
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                      <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 18, color: C.amber, letterSpacing: -0.013 * 18 }}>
                        {formatCurrencyBRL((offer.effectivePriceCents ?? offer.priceCents) / 100)}
                      </Text>
                      {hasDiscount && (
                        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.labelColor, textDecorationLine: "line-through" }}>
                          {formatCurrencyBRL(offer.priceCents / 100)}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() =>
                        offer.kind === "COMBO" && offer.presentialPackageMode
                          ? goToPresentialPackagePurchase(offer)
                          : navigation.navigate("ConsultancyRequest", { professionalId: providerId })
                      }
                      style={{ height: S.touchMin, borderRadius: S.btnR, backgroundColor: C.amber, alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>
                        {offer.kind === "COMBO" && offer.presentialPackageMode ? "Contratar combo" : "Solicitar consultoria"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Promoções de agendamento presencial */}
        {presentialPromotionOffers.length > 0 ? (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: C.amberBorder, backgroundColor: "rgba(245,166,35,0.08)", padding: 14 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1, marginBottom: 10 }}>Aulas em promoção</Text>
            <View style={{ gap: 10 }}>
              {presentialPromotionOffers.map((offer) => {
                const hasDiscount = (offer.effectivePriceCents ?? offer.priceCents) < offer.priceCents;
                return (
                  <View key={offer.id} style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, padding: 12, gap: 6 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1, flex: 1, marginRight: 8 }}>{offer.title}</Text>
                      <View style={{ backgroundColor: C.amber, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.textOnPrimary }}>PROMO</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                      <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 18, color: C.amber, letterSpacing: -0.013 * 18 }}>
                        {formatCurrencyBRL((offer.effectivePriceCents ?? offer.priceCents) / 100)}
                      </Text>
                      {hasDiscount && (
                        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.labelColor, textDecorationLine: "line-through" }}>
                          {formatCurrencyBRL(offer.priceCents / 100)}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() => goToBookingWithOffer(offer)}
                      style={{ height: S.touchMin, borderRadius: S.btnR, backgroundColor: C.amber, alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>Escolher dias</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Pacotes presenciais (assinatura por ciclo) */}
        {presentialPackageOffers.length > 0 ? (
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 14 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1, marginBottom: 4 }}>Pacotes presenciais</Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, marginBottom: 10 }}>
              Assinaturas cobradas por ciclo - cancele quando quiser, sem afetar o que já foi pago.
            </Text>
            <View style={{ gap: 10 }}>
              {presentialPackageOffers.map((offer) => {
                const unitLabel = offer.presentialPackageMode === "FLEXIBLE_CREDITS" ? "créditos" : "sessões";
                return (
                  <View key={offer.id} style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, padding: 12, gap: 6 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>{offer.title}</Text>
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>
                      {offer.presentialSessionsPerCycle ?? 0} {unitLabel} por ciclo
                    </Text>
                    <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 18, color: theme.primary, letterSpacing: -0.013 * 18 }}>
                      {formatCurrencyBRL((offer.effectivePriceCents ?? offer.priceCents) / 100)}
                    </Text>
                    <TouchableOpacity
                      onPress={() => goToPresentialPackagePurchase(offer)}
                      style={{ height: S.touchMin, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>
                        {offer.kind === "COMBO" ? "Contratar combo" : "Contratar pacote"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Consultoria online */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 14 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1 }}>Consultoria online</Text>
            <View style={{
              backgroundColor: catalogLoadError ? theme.dangerSubtle : consultancyCatalog?.onlineConsultancyEnabled ? theme.primarySubtle : "rgba(255,255,255,0.06)",
              borderWidth: 1, borderColor: catalogLoadError ? theme.dangerSubtleBorder : consultancyCatalog?.onlineConsultancyEnabled ? theme.primarySubtleBorder : theme.border,
              borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3,
            }}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: catalogLoadError ? theme.danger : consultancyCatalog?.onlineConsultancyEnabled ? theme.primary : theme.text3 }}>
                {catalogLoadError ? "Erro ao carregar" : consultancyCatalog?.onlineConsultancyEnabled ? "Disponível" : "Indisponível"}
              </Text>
            </View>
          </View>
          {catalogLoadError ? (
            <TouchableOpacity onPress={() => void detailQuery.refetch()} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <Ionicons name="refresh-outline" size={14} color={theme.primary} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>Tentar novamente</Text>
            </TouchableOpacity>
          ) : (
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, marginBottom: 10 }}>
              Planos mensais, trimestrais, semestrais ou anuais.
            </Text>
          )}
          {onlineOffers.map((offer) => {
            const kindLabel = offer.kindDescription
              ?? (offer.kind === "ONLINE_CONSULTANCY" ? "Consultoria online"
                : offer.kind === "ONLINE_CONSULTANCY_SPECIALIZED" ? "Consultoria especializada"
                : offer.kind === "COMBO" ? "Combo online + presencial"
                : "Consultoria");
            return (
              <View key={offer.id} style={{ marginBottom: 8 }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>{offer.title}</Text>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, marginTop: 2 }}>
                  {kindLabel} · {formatCurrencyBRL((offer.effectivePriceCents ?? offer.priceCents) / 100)}
                </Text>
                {offer.fichaValidityDays ? (
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, marginTop: 2 }}>
                    Cada ficha vale {offer.fichaValidityDays} dias — a renovação cobra o mesmo valor de novo, automaticamente.
                  </Text>
                ) : null}
              </View>
            );
          })}
          <TouchableOpacity
            disabled={catalogLoadError}
            onPress={() => navigation.navigate("ConsultancyRequest", { professionalId: providerId })}
            style={{ height: S.touchMin, borderRadius: S.btnR, borderWidth: 1, borderColor: catalogLoadError ? theme.border : theme.primarySubtleBorder, backgroundColor: catalogLoadError ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.04)", alignItems: "center", justifyContent: "center", marginTop: 4, opacity: catalogLoadError ? 0.45 : 1 }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: catalogLoadError ? theme.text3 : theme.text1 }}>
              {catalogLoadError ? "Consultoria indisponível no momento" : "Solicitar consultoria online"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Avaliações recentes */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 14 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1, marginBottom: 10 }}>Avaliações recentes</Text>
          {provider.reviews && provider.reviews.length > 0 ? (
            <View style={{ gap: 12 }}>
              {provider.reviews.slice(0, 3).map((review) => (
                <View key={review.id} style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>
                      {review.user?.name ?? "Cliente"}
                    </Text>
                    <StarRow rating={review.rating} />
                  </View>
                  {review.comment ? (
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
                      {review.comment}
                    </Text>
                  ) : null}
                  {review.providerResponse ? (
                    <View style={{ backgroundColor: theme.chipBg, borderRadius: 10, padding: 10, marginTop: 8 }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.text3, marginBottom: 2 }}>
                        Resposta do profissional
                      </Text>
                      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
                        {review.providerResponse}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : (
            <View style={{ alignItems: "center", paddingVertical: 16, gap: 6 }}>
              <Ionicons name="star-outline" size={28} color={theme.labelColor} />
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>Ainda sem avaliações registradas.</Text>
            </View>
          )}
        </View>
      </ScrollView>
      </ScreenEntrance>

      {/* Botões fixos no rodapé V2 — safe area */}
      <View style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        paddingHorizontal: S.px, paddingBottom: Math.max(12, insets.bottom + 12), paddingTop: 12,
        backgroundColor: `${theme.bg}f0`, borderTopWidth: 1, borderTopColor: theme.border,
        flexDirection: "row", gap: 10,
      }}>
        {/* Favorito — secundário */}
        <TouchableOpacity
          onPress={toggleFavorite}
          disabled={savingFavorite}
          style={{
            flex: 1, height: S.btnH, borderRadius: S.btnR,
            backgroundColor: favorite ? theme.dangerSubtle : "rgba(255,255,255,0.06)",
            borderWidth: 1, borderColor: favorite ? theme.dangerSubtleBorder : theme.border,
            alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6,
            opacity: savingFavorite ? 0.6 : 1,
          }}
        >
          <Ionicons name={favorite ? "heart" : "heart-outline"} size={16} color={favorite ? theme.danger : theme.text1} />
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: favorite ? theme.danger : theme.text1 }}>
            {savingFavorite ? "..." : favorite ? "Salvo" : "Salvar"}
          </Text>
        </TouchableOpacity>

        {/* Agendar aula — primário */}
        <TouchableOpacity
          onPress={handleGoToBooking}
          style={{
            flex: 1.4, height: S.btnH, borderRadius: S.btnR,
            backgroundColor: theme.primary,
            alignItems: "center", justifyContent: "center",
            shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4,
          }}
        >
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>Agendar aula</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
