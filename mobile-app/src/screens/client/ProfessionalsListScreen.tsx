import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { ProviderServiceMode, providersApi, ProviderSummary } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvCard, MvText } from "../../components/mv";
import { averageToFive, formatPriceFromCents, handleScreenError } from "../shared/api-helpers";
import { formatCurrencyBRL } from "../../utils/formatters";

type Props = NativeStackScreenProps<ClientStackParamList, "ProfessionalsList">;
const PAGE_SIZE = 24;

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
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <MvText variant="h4">{title}</MvText>
          {hasGeo ? <MvText variant="body4" color="secondary">ordenado por distância</MvText> : null}
        </View>
      </View>

      <FlatList
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <MvText variant="body4" color="secondary" style={{ marginBottom: 4 }}>
            {initialLoading ? "Carregando resultados..." : `${items.length} profissionais encontrados`}
          </MvText>
        }
        onEndReachedThreshold={0.35}
        onEndReached={() => {
          void loadMore();
        }}
        renderItem={({ item }) => {
          const rating = averageToFive(item.avgRating ?? item.averageRating);
          const modeLabel = serviceModeLabel(item.serviceMode);
          return (
            <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate("ProfessionalDetail", { professionalId: item.id })}>
              <MvCard>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi2">{item.displayName}</MvText>
                    <MvText variant="body4" color="secondary" numberOfLines={2}>{item.bio}</MvText>
                  </View>
                  <MvBadge label={`${rating.toFixed(1)} *`} variant="green" />
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                  <MvText variant="semi3" style={{ color: theme.textGreen }}>
                    A partir de {formatCurrencyBRL(formatPriceFromCents(item.priceCents))}
                  </MvText>

                  {typeof item.distanceKm === "number" ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                      <Ionicons name="location-outline" size={12} color={theme.text3} />
                      <MvText variant="body4" color="secondary">{item.distanceKm.toFixed(1)} km</MvText>
                    </View>
                  ) : null}

                  {modeLabel ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                      <Ionicons
                        name={item.serviceMode === "HOME_VISIT_ONLY" ? "car-outline" : "barbell-outline"}
                        size={12}
                        color={theme.text3}
                      />
                      <MvText variant="body4" color="secondary">{modeLabel}</MvText>
                    </View>
                  ) : null}
                </View>
              </MvCard>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          !initialLoading ? (
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
                <Ionicons name="search-outline" size={28} color={theme.textGreen} />
              </View>
              <MvText variant="body3" color="secondary">Nenhum profissional encontrado.</MvText>
              {hasGeo ? (
                <MvText variant="body4" color="secondary" style={{ textAlign: "center", paddingHorizontal: 24 }}>
                  Tente remover filtros ou buscar por outro termo.
                </MvText>
              ) : null}
            </View>
          ) : null
        }
        ListFooterComponent={
          loadingMore ? (
            <MvText variant="body4" color="secondary" style={{ textAlign: "center", paddingVertical: 12 }}>
              Carregando mais profissionais...
            </MvText>
          ) : null
        }
        showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}
      />
    </View>
  );
}
