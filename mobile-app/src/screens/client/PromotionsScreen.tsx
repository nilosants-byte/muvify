import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientTabParamList } from "../../navigation/route-types";
import { consultancyApi, PromotionFeedItem } from "../../services/api/client";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvBadge, MvBottomNav, MvButton, MvCard, MvText } from "../../components/mv";
import { formatCurrencyBRL, getInitials } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAppState } from "../../state/AppState";

type Props = BottomTabScreenProps<ClientTabParamList, "Promotions">;
type PromotionTab = "highlights" | "promotions" | "combos";

function offerSectionLabel(item: PromotionFeedItem) {
  if (item.kind === "COMBO") return "Combo";
  if (item.kind === "PRESENTIAL") return "Promocao";
  if (item.kind === "ONLINE_CONSULTANCY") return "Consultoria";
  if (item.kind === "ONLINE_CONSULTANCY_SPECIALIZED") return "Consultoria";
  return "Oferta";
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
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const iconColor = theme.mode === "dark" ? "#D8E0D8" : "#394239";

  const [promotions, setPromotions] = useState<PromotionFeedItem[]>([]);
  const [combos, setCombos] = useState<PromotionFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PromotionTab>("highlights");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const promotionFeed = await consultancyApi.promotions();
      const nextPromotions = promotionFeed.filter((item) => item.kind !== "COMBO");
      const nextCombos = promotionFeed
        .filter((item) => item.kind === "COMBO")
        .sort((a, b) => a.providerName.localeCompare(b.providerName, "pt-BR"));

      setPromotions(nextPromotions);
      setCombos(nextCombos);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar ofertas.",
        navigation,
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const goBackOrHome = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("ClientHome");
  };

  const goToDetail = (providerId: string) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate("ProfessionalDetail", { professionalId: providerId });
  };

  const goToBooking = (item: PromotionFeedItem) => {
    const parent = navigation.getParent<any>();
    if (!parent) return;

    parent.navigate("CreateBooking", {
      professionalId: item.providerId,
      offerId: item.offerId,
      offerTitle: item.itemInPromotion,
      offerPriceCents: item.promotionalPriceCents,
      offerKind: item.kind,
      isPromotionalOffer: item.kind !== "COMBO" || Boolean(item.promotionEndsAt),
    });
  };

  const navItems = [
    { key: "home", icon: "compass-outline", label: "Início" },
    { key: "bookings", icon: "calendar-clear-outline", label: "Agenda" },
    { key: "promotions", icon: "flash-outline", label: "Promoções" },
    { key: "training", icon: "barbell-outline", label: "Treino" },
    { key: "profile", icon: "person-circle-outline", label: "Perfil" },
  ];

  const hasAnyOffer = useMemo(
    () => promotions.length > 0 || combos.length > 0,
    [combos.length, promotions.length]
  );

  const expiringSoonCount = useMemo(
    () =>
      promotions.filter((item) => {
        const remaining = daysUntil(item.promotionEndsAt);
        return remaining !== null && remaining >= 0 && remaining <= 3;
      }).length,
    [promotions]
  );

  const averageDiscount = useMemo(() => {
    const values = promotions.map(discountPercent).filter((value) => value > 0);
    if (!values.length) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }, [promotions]);

  const highlightFeed = useMemo(() => {
    const topPromotions = [...promotions]
      .sort((a, b) => discountPercent(b) - discountPercent(a))
      .slice(0, 6);
    const topCombos = combos.slice(0, 4);
    return [...topPromotions, ...topCombos];
  }, [combos, promotions]);

  const selectedFeed = useMemo(() => {
    if (activeTab === "promotions") return promotions;
    if (activeTab === "combos") return combos;
    return highlightFeed;
  }, [activeTab, combos, highlightFeed, promotions]);

  const tabItems: Array<{ key: PromotionTab; label: string; count: number }> = useMemo(
    () => [
      { key: "highlights", label: "Destaques", count: highlightFeed.length },
      { key: "promotions", label: "Promoções", count: promotions.length },
      { key: "combos", label: "Combos", count: combos.length },
    ],
    [combos.length, highlightFeed.length, promotions.length]
  );

  function OfferCard({ item, section }: { item: PromotionFeedItem; section: "promotion" | "combo" }) {
    const saving = discountPercent(item);
    const endingIn = daysUntil(item.promotionEndsAt);
    const hasUrgency = typeof endingIn === "number" && endingIn >= 0 && endingIn <= 3;
    const hasBasePrice = Boolean(item.basePriceCents && item.basePriceCents > item.promotionalPriceCents);

    return (
      <MvCard style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <MvAvatar
            initials={getInitials(item.providerName)}
            size={38}
            borderRadius={11}
            color="green"
            photoUri={item.providerPhotoUrl ?? null}
          />
          <View style={{ flex: 1 }}>
            <MvText variant="semi2" numberOfLines={1}>
              {item.providerName}
            </MvText>
            <MvText variant="caption" color="secondary" numberOfLines={1}>
              {item.specialty}
            </MvText>
          </View>
          <MvBadge label={section === "combo" ? "Combo" : offerSectionLabel(item)} variant="green" />
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 10,
            backgroundColor: theme.inputBg,
            padding: 10,
            gap: 4,
          }}
        >
          <MvText variant="semi3" numberOfLines={2}>
            {item.itemInPromotion}
          </MvText>
          <MvText variant="body4" color="secondary">
            {item.kind === "COMBO"
              ? `Pacote combinado ${item.comboPresentialDaysPerWeek ?? 0}p/${item.comboOnlineDaysPerWeek ?? 0}o por semana`
              : "Oferta especial para avancar com acompanhamento personalizado"}
          </MvText>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
            <View>
              <MvText variant="h4" style={{ color: theme.textGreen }}>
                {formatCurrencyBRL(item.promotionalPriceCents / 100)}
              </MvText>
              {hasBasePrice ? (
                <MvText variant="body4" color="tertiary" style={{ textDecorationLine: "line-through" }}>
                  de {formatCurrencyBRL((item.basePriceCents ?? 0) / 100)}
                </MvText>
              ) : null}
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              {saving > 0 ? <MvBadge label={`${saving}% OFF`} variant="green" /> : null}
              {hasUrgency ? <MvBadge label={`Termina em ${endingIn}d`} variant="orange" /> : null}
            </View>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <MvButton
            style={{ flex: 1 }}
            label="Agendar agora"
            onPress={() => goToBooking(item)}
          />
          <MvButton
            style={{ flex: 1 }}
            variant="outline"
            label="Ver profissional"
            onPress={() => goToDetail(item.providerId)}
          />
        </View>
      </MvCard>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.promotions">
      <StatusBar
        barStyle={theme.mode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={theme.bg}
      />

      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 14,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: theme.borderSub,
        }}
      >
        <TouchableOpacity
          onPress={goBackOrHome}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <MvText variant="semi1">Promoções</MvText>
          <MvText variant="body4" color="secondary">
            Descubra ofertas especiais para contratar no melhor momento.
          </MvText>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 84, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor="#4CAF50"
            colors={["#4CAF50"]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <MvCard style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <MvText variant="semi2">Panorama de ofertas</MvText>
            <Ionicons name="flash-outline" size={16} color={iconColor} />
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 8, backgroundColor: theme.inputBg }}>
              <MvText variant="h3" style={{ color: theme.textGreen }}>
                {promotions.length + combos.length}
              </MvText>
              <MvText variant="caption" color="secondary">
                Ativas
              </MvText>
            </View>
            <View style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 8, backgroundColor: theme.inputBg }}>
              <MvText variant="h3" style={{ color: theme.textGreen }}>
                {averageDiscount ? `${averageDiscount}%` : "0%"}
              </MvText>
              <MvText variant="caption" color="secondary">
                Media OFF
              </MvText>
            </View>
            <View style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 8, backgroundColor: theme.inputBg }}>
              <MvText variant="h3" style={{ color: theme.textGreen }}>
                {expiringSoonCount}
              </MvText>
              <MvText variant="caption" color="secondary">
                Terminando
              </MvText>
            </View>
          </View>
          <MvText variant="body4" color="secondary">
            Compare valores, avalie o perfil do profissional e agende com seguranca.
          </MvText>
        </MvCard>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {tabItems.map((tab) => {
            const selected = tab.key === activeTab;
            return (
              <TouchableOpacity
                key={tab.key}
                activeOpacity={0.85}
                onPress={() => setActiveTab(tab.key)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: selected ? "rgba(76,175,80,0.35)" : theme.border,
                  backgroundColor: selected ? "rgba(76,175,80,0.12)" : theme.inputBg,
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                }}
              >
                <MvText variant="body4" style={{ color: selected ? theme.textGreen : theme.text2 }}>
                  {tab.label}
                </MvText>
                <View
                  style={{
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: selected ? "rgba(76,175,80,0.22)" : theme.backBtn,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 4,
                  }}
                >
                  <MvText variant="caption" style={{ color: selected ? theme.textGreen : theme.text2 }}>
                    {tab.count}
                  </MvText>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {!hasAnyOffer && !loading ? (
          <View style={{ paddingTop: 60, alignItems: "center", gap: 8 }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.cardBg,
              }}
            >
              <Ionicons name="pricetags-outline" size={28} color={theme.textGreen} />
            </View>
            <MvText variant="body3" color="secondary">
              No momento não há ofertas ativas. Volte em breve para novas oportunidades.
            </MvText>
          </View>
        ) : null}

        {selectedFeed.map((item) => (
          <OfferCard
            key={`${activeTab}-${item.providerId}-${item.offerId}`}
            item={item}
            section={item.kind === "COMBO" ? "combo" : "promotion"}
          />
        ))}
      </ScrollView>

      <MvBottomNav
        items={navItems}
        activeKey="promotions"
        onPress={(key) => {
          if (key === "home") navigation.navigate("ClientHome");
          if (key === "bookings") navigation.navigate("ClientBookings");
          if (key === "promotions") navigation.navigate("Promotions");
          if (key === "training") navigation.navigate("MyTraining");
          if (key === "profile") navigation.navigate("ClientProfile");
        }}
      />
    </View>
  );
}
