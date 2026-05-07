import React, { useMemo, useState } from "react";
import { FlatList, StatusBar, TextInput, TouchableOpacity, View } from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientTabParamList } from "../../navigation/route-types";
import { PROFESSIONAL_SPECIALTIES } from "../../services/api/client";
import { useMvTheme } from "../../theme/MvThemeContext";
import { typography } from "../../theme/MvTypography";
import { MvBottomNav, MvText } from "../../components/mv";

type Props = BottomTabScreenProps<ClientTabParamList, "Categories">;

// Ícones Ionicons específicos para cada especialidade — sem emojis de teclado
const SPECIALTY_ICONS: Record<string, string> = {
  "Hipertrofia":                            "barbell-outline",
  "Emagrecimento":                          "flame-outline",
  "Corrida":                                "walk-outline",
  "Alongamento":                            "body-outline",
  "Reabilitação e Lesão":                   "medical-outline",
  "LPO (Levantamento de Peso Olímpico)":    "trophy-outline",
  "Fisiculturismo":                         "fitness-outline",
  "Grupos Especiais":                       "people-outline",
  "Saúde da Mulher":                        "flower-outline",
  "Treino Intervalado (HIIT)":              "flash-outline",
};

const ALL_CATEGORIES = PROFESSIONAL_SPECIALTIES.map((name) => ({
  id: name,
  name,
  icon: (SPECIALTY_ICONS[name] ?? "barbell-outline") as any,
}));

export function CategoriesScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const isLight = theme.mode === "light";
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return ALL_CATEGORIES;
    return ALL_CATEGORIES.filter((item) => item.name.toLowerCase().includes(term));
  }, [search]);

  // Navega para a lista de profissionais usando 'query' (text search) em vez de 'categoryId'
  // porque 'categoryId' exige UUID válido no backend; especialidades são strings, não UUIDs.
  const goToResults = (name: string) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate("ProfessionalsList", { query: name });
  };

  const navItems = [
    { key: "home", icon: "compass-outline", label: "Início" },
    { key: "bookings", icon: "calendar-clear-outline", label: "Agenda" },
    { key: "promotions", icon: "flash-outline", label: "Promoções" },
    { key: "training", icon: "barbell-outline", label: "Treino" },
    { key: "profile", icon: "person-circle-outline", label: "Perfil" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.categories">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        <MvText variant="semi1">Especialidades</MvText>
        <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
          Encontre a categoria ideal para seu objetivo.
        </MvText>
      </View>

      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            borderWidth: 1,
            borderRadius: 11,
            paddingHorizontal: 12,
            paddingVertical: 11,
            gap: 8,
            backgroundColor: theme.inputBg,
            borderColor: theme.inputBorder,
          }}
        >
          <Ionicons name="search-outline" size={18} color={theme.text3} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar especialidade..."
            placeholderTextColor={theme.text3}
            selectionColor="#4CAF50"
            returnKeyType="search"
            style={[typography.body2, { flex: 1, color: theme.inputText, padding: 0, margin: 0 }]}
          />
        </View>
      </View>

      <FlatList
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80, gap: 8 }}
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => goToResults(item.name)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              backgroundColor: theme.cardBg,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 13,
              padding: 12,
              ...(isLight ? { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 } : {}),
            }}
          >
            <View style={{
              width: 44, height: 44, borderRadius: 12,
              backgroundColor: isLight ? "rgba(34,197,94,0.10)" : "rgba(34,197,94,0.12)",
              borderWidth: 1, borderColor: isLight ? "rgba(34,197,94,0.18)" : "rgba(34,197,94,0.20)",
              alignItems: "center", justifyContent: "center",
            }}>
              <Ionicons name={item.icon} size={22} color={theme.textGreen} />
            </View>
            <View style={{ flex: 1 }}>
              <MvText variant="semi2">{item.name}</MvText>
              <MvText variant="body4" color="secondary">Ver profissionais</MvText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.text3} style={{ opacity: 0.4 }} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <MvText variant="body4" color="secondary" style={{ marginTop: 20 }}>
            Nenhuma especialidade encontrada.
          </MvText>
        }
        showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}
      />

      <MvBottomNav
        items={navItems}
        activeKey="home"
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
