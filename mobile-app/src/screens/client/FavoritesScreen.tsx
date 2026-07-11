import React, { useState } from "react";
import { Alert, FlatList, RefreshControl, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientTabParamList } from "../../navigation/route-types";
import { favoritesApi, Favorite } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { averageToFive, handleScreenError } from "../shared/api-helpers";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { MvAvatar } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { SkeletonCard } from "../../components/polish/SkeletonCard";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

type Props = BottomTabScreenProps<ClientTabParamList, "Favorites">;

export function FavoritesScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Favorite[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const favQuery = useAuthQuery(
    queryKeys.favorites.list(),
    (token) => favoritesApi.list(token),
  );

  // Sync local items when fresh data arrives (not during active optimistic remove)
  React.useEffect(() => {
    if (favQuery.data && !removingId) {
      setItems(favQuery.data as Favorite[]);
    }
  }, [favQuery.data, removingId]);

  const goToDetail = (providerId: string) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate("ProfessionalDetail", { professionalId: providerId });
  };

  function confirmRemoveFavorite(providerId: string, displayName: string) {
    Alert.alert(
      "Remover favorito",
      `Deseja remover ${displayName} dos seus favoritos?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Remover",
          style: "destructive",
          onPress: () => void removeFavorite(providerId),
        },
      ]
    );
  }

  async function removeFavorite(providerId: string) {
    const snapshot = items.find((i) => i.providerId === providerId);
    try {
      setRemovingId(providerId);
      setItems((prev) => prev.filter((item) => item.providerId !== providerId));
      await runWithAuth((token) => favoritesApi.remove(token, providerId));
      showToast("Favorito removido.", "success");
    } catch (error) {
      if (snapshot) setItems((prev) => [...prev, snapshot].sort((a, b) => a.providerId.localeCompare(b.providerId)));
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível remover favorito." });
    } finally {
      setRemovingId(null);
    }
  }


  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity
          onPress={() => navigation.navigate("ClientProfile")}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Favoritos</Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, marginTop: 2 }}>
            Profissionais salvos para agendar mais rápido.
          </Text>
        </View>
      </View>

      {favQuery.isLoading && items.length === 0 ? (
        <View style={{ paddingHorizontal: S.px, paddingTop: 16, gap: 10 }}>
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </View>
      ) : null}
      <FlatList
        contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 40, gap: 10, paddingTop: 16 }}
        data={favQuery.isLoading && items.length === 0 ? [] : items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={favQuery.isRefetching} onRefresh={() => void favQuery.refetch()} tintColor={theme.primary} colors={[theme.primary]} />}
        renderItem={({ item }) => {
          const provider = item.provider;
          const rating = averageToFive(provider?.avgRating ?? provider?.averageRating);
          return (
            <PressableScale
              onPress={() => goToDetail(item.providerId)}
              style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 12 }}
            >
              <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                <MvAvatar
                  initials={(provider?.displayName ?? "P").slice(0, 2).toUpperCase()}
                  photoUri={provider?.photoUrl ?? null}
                  tone="green"
                  size="md"
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }} numberOfLines={1}>
                    {provider?.displayName ?? "Profissional"}
                  </Text>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, marginTop: 2 }} numberOfLines={2}>
                    {provider?.bio ?? "Sem descrição."}
                  </Text>
                </View>
                <View style={{ backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary }}>★ {rating.toFixed(1)}</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => confirmRemoveFavorite(item.providerId, provider?.displayName ?? "este profissional")}
                disabled={removingId === item.providerId}
                accessibilityRole="button"
                accessibilityLabel={`Remover ${provider?.displayName ?? "profissional"} dos favoritos`}
                style={{ height: S.touchMin, borderRadius: 12, borderWidth: 1, borderColor: "rgba(239,68,68,0.20)", backgroundColor: "rgba(239,68,68,0.08)", alignItems: "center", justifyContent: "center", opacity: removingId === item.providerId ? 0.5 : 1 }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.danger }}>
                  {removingId === item.providerId ? "Removendo..." : "Remover dos favoritos"}
                </Text>
              </TouchableOpacity>
            </PressableScale>
          );
        }}
        ListEmptyComponent={
          !favQuery.isLoading ? (
            <View style={{ paddingTop: 60, alignItems: "center", gap: 10 }}>
              <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="heart-outline" size={30} color={theme.primary} />
              </View>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, textAlign: "center" }}>
                Você ainda não favoritou nenhum profissional.{"\n"}Explore o mapa para encontrar um!
              </Text>
            </View>
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />

    </View>
  );
}
