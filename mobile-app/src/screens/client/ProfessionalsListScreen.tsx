import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { ProviderServiceMode, providersApi, ProviderSummary } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useBlockedWhileLocked } from "../../hooks/useBlockedWhileLocked";
import { useMvTheme } from "../../theme/MvThemeContext";
import { averageToFive, formatPriceFromCents, handleScreenError } from "../shared/api-helpers";
import { formatCurrencyBRL } from "../../utils/formatters";
import { S } from "../../theme/v2tokens";
import { PressableScale } from "../../components/polish/PressableScale";
import { MvAvatar, MvEmptyState, MvText } from "../../components/mv";
import { FounderBadge } from "../../components/professional/FounderBadge";
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
  useBlockedWhileLocked();
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
  const objective = params.objective;
  const minRating = params.minRating;
  const serviceMode = params.serviceMode;

  // Achado em teste manual (2026-10-09): chegar aqui pela tela de
  // Especialidades não levava localização nenhuma — a busca virava nacional,
  // sem nenhum corte por distância. Em vez de forçar isso, o cliente ganha
  // controle de ordenação/filtro direto aqui. Quem já chega com lat/lng (ex:
  // Busca avançada) mantém o comportamento de antes: ordenado por distância.
  const [clientLat, setClientLat] = useState<number | undefined>(params.lat);
  const [clientLng, setClientLng] = useState<number | undefined>(params.lng);
  const [sortBy, setSortBy] = useState<"rating" | "distance">(
    typeof params.lat === "number" && typeof params.lng === "number" ? "distance" : "rating"
  );
  const [onlineConsultancyOnly, setOnlineConsultancyOnly] = useState(false);
  const [locating, setLocating] = useState(false);

  const hasGeo = typeof clientLat === "number" && typeof clientLng === "number";

  const fetchPage = useCallback(async (requestedOffset: number) => {
    return providersApi.list({
      q: query || undefined,
      categoryId,
      objective,
      minRating,
      lat: clientLat,
      lng: clientLng,
      serviceMode,
      onlineConsultancyOnly: onlineConsultancyOnly || undefined,
      sortBy: hasGeo ? sortBy : undefined,
      take: PAGE_SIZE,
      offset: requestedOffset,
    });
  }, [categoryId, objective, clientLat, clientLng, minRating, query, serviceMode, onlineConsultancyOnly, sortBy, hasGeo]);

  async function handleSelectProximitySort() {
    if (hasGeo) {
      setSortBy("distance");
      return;
    }
    try {
      setLocating(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        showToast("Permissão de localização negada.", "error");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setClientLat(loc.coords.latitude);
      setClientLng(loc.coords.longitude);
      setSortBy("distance");
    } catch {
      showToast("Não foi possível obter localização.", "error");
    } finally {
      setLocating(false);
    }
  }

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
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.professionals-list">
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
          <MvText variant="caption" color="tertiary" style={{ marginTop: 2 }}>
            {sortBy === "distance" && hasGeo ? "ordenado por proximidade" : "ordenado por avaliação"}
          </MvText>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: S.px, paddingVertical: 10, gap: 8, alignItems: "center" }}
        style={{ borderBottomWidth: 1, borderBottomColor: theme.border, flexGrow: 0 }}
      >
        {([
          { key: "rating" as const, label: "Avaliação", icon: "star-outline" as const },
          { key: "distance" as const, label: "Proximidade", icon: "navigate-outline" as const },
        ]).map((opt) => {
          const active = sortBy === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              onPress={() => (opt.key === "distance" ? handleSelectProximitySort() : setSortBy("rating"))}
              disabled={opt.key === "distance" && locating}
              style={{
                height: 40, paddingHorizontal: 14, borderRadius: S.chipR,
                backgroundColor: active ? theme.primarySubtle : "rgba(128,128,128,0.08)",
                borderWidth: 1, borderColor: active ? theme.primarySubtleBorder : theme.border,
                flexDirection: "row", alignItems: "center", gap: 7,
              }}
            >
              <Ionicons name={opt.icon} size={14} color={active ? theme.primary : theme.text2} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: active ? theme.primary : theme.text2 }}>
                {opt.key === "distance" && locating ? "Localizando..." : opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <View style={{ width: 1, alignSelf: "stretch", backgroundColor: theme.border, marginVertical: 4 }} />
        <TouchableOpacity
          onPress={() => setOnlineConsultancyOnly((current) => !current)}
          style={{
            height: 40, paddingHorizontal: 14, borderRadius: S.chipR,
            backgroundColor: onlineConsultancyOnly ? theme.primarySubtle : "rgba(128,128,128,0.08)",
            borderWidth: 1, borderColor: onlineConsultancyOnly ? theme.primarySubtleBorder : theme.border,
            flexDirection: "row", alignItems: "center", gap: 7,
          }}
        >
          <Ionicons name="laptop-outline" size={14} color={onlineConsultancyOnly ? theme.primary : theme.text2} />
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: onlineConsultancyOnly ? theme.primary : theme.text2 }}>
            Consultoria online
          </Text>
        </TouchableOpacity>
      </ScrollView>

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
            <PressableScale
              onPress={() => navigation.navigate("ProfessionalDetail", { professionalId: item.id })}
              accessibilityLabel={`Ver perfil de ${item.displayName}`}
              scale={0.985}
              style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 10 }}
            >
              {/* Linha superior: avatar + nome/bio + rating */}
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                <MvAvatar
                  initials={getInitials(item.displayName)}
                  photoUri={resolveMediaUrl(item.photoUrl)}
                  tone="green"
                  size={52 as any}
                />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, flexShrink: 1 }} numberOfLines={1}>{item.displayName}</Text>
                    {item.isFounder ? <FounderBadge compact /> : null}
                  </View>
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

              {/* Ação principal — o resto do card já leva pro perfil */}
              <PressableScale
                onPress={() => navigation.navigate("CreateBooking", { professionalId: item.id })}
                accessibilityLabel={`Agendar com ${item.displayName}`}
                style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
              >
                <Ionicons name="calendar-outline" size={15} color={theme.textOnPrimary} />
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>Agendar</Text>
              </PressableScale>
            </PressableScale>
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
