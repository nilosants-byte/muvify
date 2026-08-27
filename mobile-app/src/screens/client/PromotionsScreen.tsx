import React, { useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientTabParamList } from "../../navigation/route-types";
import { consultancyApi, PromotionFeedItem } from "../../services/api/client";
import { MvAvatar } from "../../components/mv";
import { formatCurrencyBRL, getInitials } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { useAppState } from "../../state/AppState";
import { useBlockedWhileLocked } from "../../hooks/useBlockedWhileLocked";
import { useMvTheme } from "../../theme/MvThemeContext";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { hapticCta } from "../../utils/haptics";
import { ClientBottomNavV2 } from "../../components/navigation/ClientBottomNavV2";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { SkeletonCard } from "../../components/polish/SkeletonCard";

type Props = BottomTabScreenProps<ClientTabParamList, "Promotions">;
type PromotionTab = "highlights" | "promotions" | "combos";

function offerTypeLabel(item: PromotionFeedItem): string {
  if (item.kind === "COMBO") return "Combo";
  if (item.kind === "PRESENTIAL") return "Presencial";
  if (item.kind === "ONLINE_CONSULTANCY" || item.kind === "ONLINE_CONSULTANCY_SPECIALIZED") return "Consultoria";
  return "Oferta";
}

function isConsultancy(item: PromotionFeedItem): boolean {
  return item.kind === "ONLINE_CONSULTANCY" || item.kind === "ONLINE_CONSULTANCY_SPECIALIZED";
}

function daysUntil(dateIso?: string | null): number | null {
  if (!dateIso) return null;
  const target = new Date(dateIso).getTime();
  const now = Date.now();
  if (!Number.isFinite(target)) return null;
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

function discountPercent(item: PromotionFeedItem): number {
  if (!item.basePriceCents || item.basePriceCents <= item.promotionalPriceCents) return 0;
  return Math.round(((item.basePriceCents - item.promotionalPriceCents) / item.basePriceCents) * 100);
}

export function PromotionsScreen({ navigation }: Props) {
  useBlockedWhileLocked();
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<PromotionTab>("highlights");

  const promotionsQuery = useAuthQuery(
    queryKeys.consultancy.promotions(),
    () => consultancyApi.promotions()
  );

  const loading = promotionsQuery.isLoading;
  const feed = promotionsQuery.data ?? [];
  const promotions = useMemo(() => feed.filter((item) => item.kind !== "COMBO"), [feed]);
  const combos = useMemo(
    () => feed.filter((item) => item.kind === "COMBO").sort((a, b) => a.providerName.localeCompare(b.providerName, "pt-BR")),
    [feed]
  );

  useEffect(() => {
    if (promotionsQuery.error) {
      handleScreenError({ error: promotionsQuery.error, showToast, fallbackMessage: "Falha ao carregar ofertas.", navigation });
    }
  }, [promotionsQuery.error, showToast, navigation]);

  const goToDetail = (providerId: string) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate("ProfessionalDetail", { professionalId: providerId });
  };

  const goToBooking = (item: PromotionFeedItem) => {
    const days = daysUntil(item.promotionEndsAt);
    if (days !== null && days < 0) {
      showToast("Esta promoção já expirou.", "info");
      return;
    }
    const parent = navigation.getParent<any>();
    if (!parent) return;
    // Consultoria: abre briefing antes do agendamento
    if (isConsultancy(item)) {
      parent.navigate("ConsultancyRequest", { professionalId: item.providerId });
      return;
    }
    parent.navigate("CreateBooking", {
      professionalId: item.providerId,
      offerId: item.offerId,
      offerTitle: item.itemInPromotion,
      offerPriceCents: item.promotionalPriceCents,
      offerKind: item.kind,
      isPromotionalOffer: item.kind !== "COMBO" || Boolean(item.promotionEndsAt),
    });
  };

  const highlightFeed = useMemo(() => {
    const top = [...promotions].sort((a, b) => discountPercent(b) - discountPercent(a)).slice(0, 6);
    return [...top, ...combos.slice(0, 4)];
  }, [combos, promotions]);

  const selectedFeed = useMemo(() => {
    if (activeTab === "promotions") return promotions;
    if (activeTab === "combos") return combos;
    return highlightFeed;
  }, [activeTab, combos, highlightFeed, promotions]);

  const tabItems: Array<{ key: PromotionTab; label: string; count: number }> = useMemo(() => [
    { key: "highlights", label: "Destaques", count: highlightFeed.length },
    { key: "promotions", label: "Promoções", count: promotions.length },
    { key: "combos", label: "Combos", count: combos.length },
  ], [combos.length, highlightFeed.length, promotions.length]);

  const averageDiscount = useMemo(() => {
    const values = promotions.map(discountPercent).filter((v) => v > 0);
    if (!values.length) return 0;
    return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
  }, [promotions]);

  const expiringSoonCount = useMemo(() =>
    promotions.filter((item) => { const r = daysUntil(item.promotionEndsAt); return r !== null && r >= 0 && r <= 3; }).length,
    [promotions]
  );

  function OfferCard({ item }: { item: PromotionFeedItem }) {
    const saving = discountPercent(item);
    const endingIn = daysUntil(item.promotionEndsAt);
    const urgent = typeof endingIn === "number" && endingIn >= 0 && endingIn <= 3;
    const hasBase = Boolean(item.basePriceCents && item.basePriceCents > item.promotionalPriceCents);
    const consultancy = isConsultancy(item);
    const accent = consultancy ? C.amber : theme.primary;
    const accentDim = consultancy ? C.amberDim : theme.primarySubtle;
    const accentBorder = consultancy ? C.amberBorder : theme.primarySubtleBorder;

    return (
      <PressableScale
        // Segunda camada, Frente 1, Lote 3 (fechamento): o card inteiro já
        // animava ao toque sem nenhum onPress - avatar, nome, preço etc.
        // pareciam clicáveis e não faziam nada, só os 2 botões internos
        // funcionavam. Toque no card (fora dos botões) agora abre o perfil,
        // igual ao botão "Ver perfil" logo abaixo.
        onPress={() => goToDetail(item.providerId)}
        style={{
          borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border,
          backgroundColor: theme.cardBg, padding: S.cardPad, gap: 12,
        }}
      >
        {/* Discount ribbon */}
        {saving > 0 && (
          <View style={{ backgroundColor: accent, borderRadius: S.cardR, paddingVertical: 3, paddingHorizontal: 10, alignSelf: "flex-start", flexDirection: "row", gap: 6, alignItems: "center" }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.textOnPrimary, letterSpacing: 0.04 * 10 }}>
              {saving}% OFF · {offerTypeLabel(item)}
            </Text>
            {urgent && <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.textOnPrimary }}>· {endingIn}d restantes</Text>}
          </View>
        )}

        {/* Provider row */}
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <MvAvatar
            initials={getInitials(item.providerName)}
            tone={consultancy ? "amber" : "green"}
            size="md"
            photoUri={item.providerPhotoUrl ?? null}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }} numberOfLines={1}>
              {item.providerName}
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, marginTop: 2 }} numberOfLines={1}>
              {item.specialty}
            </Text>
          </View>
          <View style={{ backgroundColor: accentDim, borderWidth: 1, borderColor: accentBorder, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: accent }}>{offerTypeLabel(item)}</Text>
          </View>
        </View>

        {/* Offer title + price */}
        <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 16, backgroundColor: theme.inputBg, padding: 12, gap: 4 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }} numberOfLines={2}>
            {item.itemInPromotion}
          </Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>
            {item.kind === "COMBO"
              ? `Combo: ${item.comboPresentialDaysPerWeek ?? 0}x presencial + ${item.comboOnlineDaysPerWeek ?? 0}x online/semana`
              : consultancy ? "Plano online com acompanhamento" : "Oferta especial para aula presencial"}
          </Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 4 }}>
            <View>
              {hasBase && (
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.labelColor, textDecorationLine: "line-through" }}>
                  de {formatCurrencyBRL((item.basePriceCents ?? 0) / 100)}
                </Text>
              )}
              <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: accent, letterSpacing: -0.013 * 20 }}>
                {formatCurrencyBRL(item.promotionalPriceCents / 100)}
              </Text>
            </View>
          </View>
        </View>

        {/* Actions */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <PressableScale
            onPress={() => goToDetail(item.providerId)}
            scale={0.96}
            style={{
              flex: 1, height: S.btnH, borderRadius: S.btnR,
              backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>Ver perfil</Text>
          </PressableScale>
          <PressableScale
            onPress={() => { hapticCta(); goToBooking(item); }}
            scale={0.96}
            style={{
              flex: 1.4, height: S.btnH, borderRadius: S.btnR,
              backgroundColor: accent,
              alignItems: "center", justifyContent: "center",
              shadowColor: accent, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4,
            }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>
              {consultancy ? "Solicitar" : "Agendar"}
            </Text>
          </PressableScale>
        </View>
      </PressableScale>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.promotions">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.primary, letterSpacing: 0.1 * 10, textTransform: "uppercase", fontWeight: "700" }}>
          Destaques do dia
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3, marginTop: 6 }}>
          Ofertas e promoções
        </Text>
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, marginTop: 4 }}>
          Presenciais e consultorias online
        </Text>
      </View>

      <ScreenEntrance>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 120, gap: 10, paddingTop: 16 }}
        refreshControl={<RefreshControl refreshing={promotionsQuery.isRefetching} onRefresh={() => void promotionsQuery.refetch()} tintColor={theme.primary} colors={[theme.primary]} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero card panorama */}
        <View style={{
          borderRadius: S.cardR, padding: 16, borderWidth: 1,
          borderColor: theme.primarySubtleBorder, backgroundColor: theme.primaryHighlight,
        }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[
              { value: String(promotions.length + combos.length), label: "Ativas" },
              { value: averageDiscount ? `${averageDiscount}%` : "0%", label: "Média OFF" },
              { value: String(expiringSoonCount), label: "Terminando" },
            ].map((s) => (
              <View key={s.label} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.24)", borderRadius: 16, padding: 10, alignItems: "center", gap: 2 }}>
                <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 18, color: theme.text1, letterSpacing: -0.013 * 18 }}>{s.value}</Text>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.text3 }}>{s.label}</Text>
              </View>
            ))}
          </View>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, marginTop: 10 }}>
            Compare valores, avalie o personal e agende com segurança.
          </Text>
        </View>

        {/* Tabs V2 */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {tabItems.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={{
                  height: 36, paddingHorizontal: 14, borderRadius: S.chipR,
                  flexDirection: "row", alignItems: "center", gap: 6,
                  borderWidth: 1,
                  borderColor: active ? theme.primarySubtleBorder : theme.border,
                  backgroundColor: active ? theme.primarySubtle : "rgba(255,255,255,0.04)",
                }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: active ? theme.primary : theme.text2 }}>
                  {tab.label}
                </Text>
                <View style={{ backgroundColor: active ? "rgba(36,230,109,0.22)" : "rgba(255,255,255,0.08)", borderRadius: 99, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: active ? theme.primary : theme.text3 }}>{tab.count}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Skeleton loaders enquanto carrega */}
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : null}

        {selectedFeed.length === 0 && !loading ? (
          <View style={{ paddingTop: 60, alignItems: "center", gap: 10 }}>
            <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="pricetags-outline" size={28} color={theme.primary} />
            </View>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, textAlign: "center" }}>
              Nenhuma oferta ativa no momento. Volte em breve.
            </Text>
          </View>
        ) : null}

        {!loading && selectedFeed.map((item) => (
          <OfferCard key={`${activeTab}-${item.providerId}-${item.offerId}`} item={item} />
        ))}
      </ScrollView>
      </ScreenEntrance>

      <ClientBottomNavV2
        activeTab="home"
        onNavigate={(tab) => {
          if (tab === "home") navigation.navigate("ClientHome");
          if (tab === "meuPersonal") navigation.navigate("ClientBookings");
          if (tab === "trainings") navigation.navigate("MyTraining");
          if (tab === "community") navigation.navigate("Community");
          if (tab === "profile") navigation.navigate("ClientProfile");
        }}
      />
    </View>
  );
}
