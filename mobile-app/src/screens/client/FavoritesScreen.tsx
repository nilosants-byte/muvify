import React, { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientTabParamList } from "../../navigation/route-types";
import { favoritesApi, Favorite } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvBottomNav, MvButton, MvCard, MvText } from "../../components/mv";
import { averageToFive, handleScreenError } from "../shared/api-helpers";

type Props = BottomTabScreenProps<ClientTabParamList, "Favorites">;

export function FavoritesScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await runWithAuth((token) => favoritesApi.list(token));
      setItems(response);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar favoritos." });
    } finally {
      setLoading(false);
    }
  }, [runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

  const goToDetail = (providerId: string) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate("ProfessionalDetail", { professionalId: providerId });
  };

  async function removeFavorite(providerId: string) {
    try {
      setRemovingId(providerId);
      await runWithAuth((token) => favoritesApi.remove(token, providerId));
      setItems((prev) => prev.filter((item) => item.providerId !== providerId));
      showToast("Favorito removido.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível remover favorito." });
    } finally {
      setRemovingId(null);
    }
  }

  const navItems = [
    { key: "home", icon: "compass-outline", label: "Início" },
    { key: "bookings", icon: "calendar-clear-outline", label: "Agenda" },
    { key: "promotions", icon: "flash-outline", label: "Promoções" },
    { key: "training", icon: "barbell-outline", label: "Treino" },
    { key: "profile", icon: "person-circle-outline", label: "Perfil" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        <TouchableOpacity
          onPress={() => navigation.navigate("ClientProfile")}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <MvText variant="semi1">Favoritos</MvText>
          <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
            Seus profissionais salvos para agendar mais rápido.
          </MvText>
        </View>
      </View>

      <FlatList
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80, gap: 8 }}
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#4CAF50" colors={["#4CAF50"]} />}
        renderItem={({ item }) => {
          const provider = item.provider;
          const rating = averageToFive(provider?.avgRating ?? provider?.averageRating);
          return (
            <TouchableOpacity activeOpacity={0.85} onPress={() => goToDetail(item.providerId)}>
              <MvCard>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi2">{provider?.displayName ?? "Profissional"}</MvText>
                    <MvText variant="body4" color="secondary" numberOfLines={2}>{provider?.bio ?? "Sem descrição."}</MvText>
                  </View>
                  <MvBadge label={`${rating.toFixed(1)} ★`} variant="green" />
                </View>
                <MvButton
                  variant="ghost"
                  label="Remover"
                  loading={removingId === item.providerId}
                  onPress={() => void removeFavorite(item.providerId)}
                  style={{ marginTop: 8 }}
                />
              </MvCard>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={{ paddingTop: 60, alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 36, lineHeight: 46 }}>❤️</Text>
              <MvText variant="body3" color="secondary">Você ainda não favoritou nenhum profissional.</MvText>
            </View>
          ) : null
        }
        showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}
      />

      <MvBottomNav
        items={navItems}
        activeKey="profile"
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
