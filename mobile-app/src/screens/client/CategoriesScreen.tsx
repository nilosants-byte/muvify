import React, { useMemo, useState } from "react";
import { FlatList, StatusBar, TextInput, TouchableOpacity, View } from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientTabParamList } from "../../navigation/route-types";
import { PROFESSIONAL_SPECIALTIES } from "../../services/api/client";
import { S } from "../../theme/v2tokens";
import { ClientBottomNavV2 } from "../../components/navigation/ClientBottomNavV2";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvText } from "../../components/mv";

type Props = BottomTabScreenProps<ClientTabParamList, "Categories">;

const SPECIALTY_ICONS: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
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
  icon: (SPECIALTY_ICONS[name] ?? "barbell-outline") as React.ComponentProps<typeof Ionicons>["name"],
}));

export function CategoriesScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return ALL_CATEGORIES;
    return ALL_CATEGORIES.filter((item) => item.name.toLowerCase().includes(term));
  }, [search]);

  const goToResults = (name: string) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate("ProfessionalsList", { query: name });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.categories">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header V2 */}
      <View style={{
        paddingTop: insets.top + 14,
        paddingHorizontal: S.px,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}>
        <MvText variant="eyebrow" style={{ color: theme.primary }}>Muvify</MvText>
        <MvText variant="h1" style={{ marginTop: 6 }}>Especialidades</MvText>
        <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
          Encontre a categoria ideal para seu objetivo.
        </MvText>
      </View>

      {/* Campo de busca V2 */}
      <View style={{ paddingHorizontal: S.px, paddingTop: 16, paddingBottom: 8 }}>
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 8,
          height: S.btnH, borderRadius: S.btnR,
          paddingHorizontal: 16,
          backgroundColor: theme.cardBg,
          borderWidth: 1, borderColor: theme.borderMid,
        }}>
          <Ionicons name="search-outline" size={18} color={theme.text3} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar especialidade..."
            placeholderTextColor={theme.text3}
            selectionColor={theme.primary}
            returnKeyType="search"
            accessibilityLabel="Buscar especialidade"
            style={{ flex: 1, fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.text1, padding: 0, margin: 0 }}
          />
          {search.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearch("")}
              accessibilityRole="button"
              accessibilityLabel="Limpar busca"
            >
              <Ionicons name="close-circle" size={18} color={theme.text3} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 120, gap: 8 }}
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => goToResults(item.name)}
            accessibilityRole="button"
            accessibilityLabel={`Ver profissionais de ${item.name}`}
            style={{
              flexDirection: "row", alignItems: "center", gap: 14,
              backgroundColor: theme.cardBg,
              borderWidth: 1, borderColor: theme.border,
              borderRadius: S.cardR,
              padding: 14, minHeight: S.itemH,
            }}
          >
            <View style={{
              width: 44, height: 44, borderRadius: 14,
              backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder,
              alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Ionicons name={item.icon} size={22} color={theme.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <MvText variant="semi3" style={{ fontSize: 14 }}>{item.name}</MvText>
              <MvText variant="body4" color="tertiary" style={{ marginTop: 2, fontSize: 12 }}>Ver profissionais</MvText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.labelColor} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={{ paddingTop: 40, alignItems: "center", gap: 8 }}>
            <Ionicons name="search-outline" size={32} color={theme.labelColor} />
            <MvText variant="body4" color="tertiary">
              Nenhuma especialidade encontrada.
            </MvText>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />

      <ClientBottomNavV2
        activeTab="community"
        onNavigate={(tab) => {
          const parent = navigation.getParent<any>();
          if (tab === "home") parent?.navigate("ClientHome");
          if (tab === "agenda") parent?.navigate("ClientBookings");
          if (tab === "trainings") parent?.navigate("MyTraining");
          if (tab === "community") navigation.navigate("Community");
          if (tab === "profile") parent?.navigate("ClientProfile");
        }}
      />
    </View>
  );
}
