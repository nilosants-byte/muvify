import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { ProviderServiceMode, providersApi, ProviderSummary } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { averageToFive, formatPriceFromCents, handleScreenError } from "../shared/api-helpers";
import { formatCurrencyBRL } from "../../utils/formatters";
import { S } from "../../theme/v2tokens";
import { PressableScale } from "../../components/polish/PressableScale";
import { MvAvatar, MvEmptyState, MvText } from "../../components/mv";
import { resolveMediaUrl } from "../../utils/media";

type Props = NativeStackScreenProps<ClientStackParamList, "ProfessionalsList">;
const PAGE_SIZE = 24;

function getInitials(name?: string | null) {
  const parts = (name ?? "?").trim().split(/\s+/);
  if (parts.length <= 1) return (parts[0] ?? "?").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function serviceModeLabel(mode?: ProviderServiceMode | null): string {
  if (mode === "PRESENTIAL_ONLY") return "So academia";
  if (mode === "HOME_VISIT_ONLY") return "Vai ao cliente";
  if (mode === "BOTH") return "Academia e domiciliar";
  return "";
}

export function ProfessionalsListScreen({ navigation, route }: Props) {
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ProviderSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const params = route.params ?? {};
  const query = params.query ?? "";
  const categoryId = params.categoryId;
  const minRating = params.minRating;
  const lat = params.lat;
  const lng = params.lng;
  const serviceMode = params.serviceMode;

  const hasGeo = typeof lat === "number" && typeof lng === "number";

  const fetchPage = useCallback(async (requestedOffset: number) => {
    return providersApi.list({
      q: query || undefined,
      categoryId,
      minRating,
      lat,
      lng,
      serviceMode,
      take: PAGE_SIZE,
      offset: requestedOffset,
    });
  }, [categoryId, lat, lng, minRating, query, serviceMode]);

  useEffect(() => {
    let mounted = true;
    async function loadInitial() {
      try {
        setInitialLoading(true);
        setLoadingMore(false);
        const response = await fetchPage(0);
        if (!mounted) return;
        setItems(response);
        setHasMore(response.length === PAGE_SIZE);
        setOffset(response.length);
      } catch (error) {
        if (!mounted) return;
        handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar profissionais.", navigation });
      } finally {
        if (mounted) setInitialLoading(false);
      }
    }
    void loadInitial();
    return () => {
      mounted = false;
    };
  }, [fetchPage, navigation, showToast]);

  const loadMore = useCallback(async () => {
    if (initialLoading || loadingMore || !hasMore) return;
    try {
      setLoadingMore(true);
      const response = await fetchPage(offset);
      setItems((current) => {
        const existing = new Set(current.map((item) => item.id));
        const nextItems = response.filter((item) => !existing.has(item.id));
        return [...current, ...nextItems];
      });
      setHasMore(response.length === PAGE_SIZE);
      setOffset((current) => current + response.length);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar mais profissionais.", navigation });
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, hasMore, initialLoading, loadingMore, navigation, offset, showToast]);

  const title = useMemo(() => {
    if (query) return query;
    if (categoryId) return "Categoria selecionada";
    return "Profissionais";
  }, [categoryId, query]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button" accessibilityLabel="Voltar" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <MvText variant="h1" numberOfLines={1}>{title}</MvText>
          {hasGeo && <MvText variant="caption" color="tertiary" style={{ marginTop: 2 }}>ordenado por distância</MvText>}
        </View>
      </View>

      <FlatList
        contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 40, gap: 10, paddingTop: 12 }}
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <MvText variant="caption" color="tertiary" style={{ marginBottom: 4 }}>
            {initialLoading ? "Carregando resultados..." : `${items.length} profissiona${items.length === 1 ? "l" : "is"} encontrado${items.length === 1 ? "" : "s"}`}
          </MvText>
        }
        onEndReachedThreshold={0.35}
        onEndReached={() => { void loadMore(); }}
        renderItem={({ item }) => {
          const rating = averageToFive(item.avgRating ?? item.averageRating);
          const modeLabel = serviceModeLabel(item.serviceMode);
          return (
            <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 10 }}>
              {/* Linha superior: avatar + nome/bio + rating */}
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                <MvAvatar
                  initials={getInitials(item.displayName)}
                  photoUri={resolveMediaUrl(item.photoUrl)}
                  tone="green"
                  size={52 as any}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }} numberOfLines={1}>{item.displayName}</Text>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, marginTop: 2 }} numberOfLines={2}>{item.bio}</Text>
                </View>
                <View style={{ backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary }}>★ {rating.toFixed(1)}</Text>
                </View>
              </View>

              {/* Preço + distância + modo */}
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>
                  A partir de {formatCurrencyBRL(formatPriceFromCents(item.priceCents))}
                </Text>
                {typeof item.distanceKm === "number" && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                    <Ionicons name="location-outline" size={12} color={theme.text3} />
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>{item.distanceKm.toFixed(1)} km</Text>
                  </View>
                )}
                {modeLabel && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                    <Ionicons name={item.serviceMode === "HOME_VISIT_ONLY" ? "car-outline" : "barbell-outline"} size={12} color={theme.text3} />
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>{modeLabel}</Text>
                  </View>
                )}
              </View>

              {/* Ações */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <PressableScale
                  onPress={() => navigation.navigate("ProfessionalDetail", { professionalId: item.id })}
                  style={{ flex: 1, height: 38, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primarySubtle, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }}
                >
                  <Ionicons name="person-outline" size={14} color={theme.textGreen} />
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textGreen }}>Ver perfil</Text>
                </PressableScale>
                <PressableScale
                  onPress={() => navigation.navigate("CreateBooking", { professionalId: item.id })}
                  style={{ flex: 1, height: 38, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }}
                >
                  <Ionicons name="calendar-outline" size={14} color={theme.textOnPrimary} />
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>Agendar</Text>
                </PressableScale>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          !initialLoading ? (
            <MvEmptyState
              icon="search-outline"
              style={{ paddingTop: 60 }}
              description={
                hasGeo
                  ? "Nenhum profissional encontrado.\nTente remover filtros ou buscar por outro termo."
                  : "Nenhum profissional encontrado."
              }
            />
          ) : null
        }
        ListFooterComponent={
          loadingMore
            ? <MvText variant="caption" color="tertiary" style={{ textAlign: "center", paddingVertical: 12 }}>Carregando mais...</MvText>
            : !hasMore && items.length > 0
            ? <MvText variant="caption" color="tertiary" style={{ textAlign: "center", paddingVertical: 16 }}>Você viu todos os profissionais disponíveis.</MvText>
            : null
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
