import React, { useEffect, useMemo, useState } from "react";
import { FlatList, ScrollView, StatusBar, Text, TextInput, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import {
  categoriesApi,
  Category,
  PROFESSIONAL_SPECIALTIES,
  ProviderServiceMode,
  providersApi,
  ProviderSummary,
  TrainingObjective
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { averageToFive, handleScreenError } from "../shared/api-helpers";
import { useMvTheme } from "../../theme/MvThemeContext";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";

type Props = NativeStackScreenProps<ClientStackParamList, "SearchProfessionals">;

const ratingFilters = [
  { key: "any", label: "Qualquer nota", value: undefined },
  { key: "4", label: "4.0+", value: 4 },
  { key: "45", label: "4.5+", value: 4.5 },
] as const;


const serviceModeFilters: { key: "all" | ProviderServiceMode; label: string }[] = [
  { key: "all", label: "Qualquer modalidade" },
  { key: "PRESENTIAL_ONLY", label: "Só academia" },
  { key: "HOME_VISIT_ONLY", label: "Vai ao cliente" },
  { key: "BOTH", label: "Ambas" },
];

// Cleanup pós-épico segunda camada, 14/08/2026: objetivo de treino da
// anamnese (obrigatório no cadastro, Frente 8/Lote 12) passa a filtrar a
// busca — versão simples aprovada pelo usuário, cruza com as
// especialidades que o profissional cadastrou (sem recomendação "esperta").
const objectiveFilters: { key: "all" | TrainingObjective; label: string }[] = [
  { key: "all", label: "Qualquer objetivo" },
  { key: "EMAGRECIMENTO", label: "Emagrecimento" },
  { key: "HIPERTROFIA", label: "Hipertrofia" },
  { key: "CONDICIONAMENTO_FISICO", label: "Condicionamento físico" },
  { key: "REABILITACAO", label: "Reabilitação" },
  { key: "PERFORMANCE_ESPORTIVA", label: "Performance esportiva" },
  { key: "SAUDE_GERAL", label: "Saúde geral" },
];

function normalizeLoose(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function SearchProfessionalsScreen({ route, navigation }: Props) {
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  // Categorias da API têm UUIDs válidos. Se o param recebido não for UUID,
  // tratamos como query de texto para evitar erro 400 no backend.
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawCategoryParam = route.params?.categoryId;
  const isValidUuid = rawCategoryParam ? UUID_REGEX.test(rawCategoryParam) : false;

  const [query, setQuery] = useState(
    route.params?.query ?? (!isValidUuid && rawCategoryParam ? rawCategoryParam : "")
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(
    isValidUuid ? rawCategoryParam : undefined
  );
  const [ratingKey, setRatingKey] = useState<(typeof ratingFilters)[number]["key"]>("any");
  const [serviceModeKey, setServiceModeKey] = useState<"all" | ProviderServiceMode>("all");
  const [objectiveKey, setObjectiveKey] = useState<"all" | TrainingObjective>("all");
  const [clientLat, setClientLat] = useState<number | null>(null);
  const [clientLng, setClientLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [suggestions, setSuggestions] = useState<ProviderSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const selectedRating = useMemo(() => ratingFilters.find((item) => item.key === ratingKey)?.value, [ratingKey]);

  useEffect(() => {
    let mounted = true;
    async function loadCategories() {
      try {
        const response = await categoriesApi.list();
        if (!mounted) return;
        const allowed = new Set(PROFESSIONAL_SPECIALTIES.map(normalizeLoose));
        const byName = new Map<string, Category>();
        response.forEach((category) => {
          const key = normalizeLoose(category.name);
          if (!allowed.has(key)) return;
          byName.set(key, category);
        });
        const ordered = PROFESSIONAL_SPECIALTIES
          .map((specialty) => byName.get(normalizeLoose(specialty)))
          .filter((category): category is Category => Boolean(category));
        setCategories(ordered);
      } catch (error) {
        if (!mounted) return;
        handleScreenError({ error, showToast, fallbackMessage: "Não foi possível carregar categorias para busca." });
      }
    }
    void loadCategories();
    return () => { mounted = false; };
  }, [showToast]);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function loadSuggestions() {
      const normalizedQuery = query.trim();
      const shouldSearch = Boolean(selectedCategoryId) || normalizedQuery.length >= 2;
      if (!shouldSearch) {
        setLoading(false);
        setSuggestions([]);
        return;
      }
      try {
        setLoading(true);
        const response = await providersApi.list({
          q: normalizedQuery || undefined,
          categoryId: selectedCategoryId,
          objective: objectiveKey === "all" ? undefined : objectiveKey,
          minRating: selectedRating,
          serviceMode: serviceModeKey === "all" ? undefined : serviceModeKey,
          take: 8,
          offset: 0
        });
        if (!mounted) return;
        setSuggestions(response);
      } catch (error) {
        if (!mounted) return;
        handleScreenError({ error, showToast, fallbackMessage: "Falha ao buscar profissionais." });
      } finally {
        if (mounted) setLoading(false);
      }
    }
    timer = setTimeout(() => {
      void loadSuggestions();
    }, 250);
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [query, selectedCategoryId, objectiveKey, selectedRating, serviceModeKey, clientLat, clientLng, showToast]);

  async function requestGps() {
    try {
      setLocating(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { showToast("Permissão de localização negada.", "error"); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setClientLat(loc.coords.latitude);
      setClientLng(loc.coords.longitude);
      showToast("Localização obtida. A busca agora prioriza profissionais mais próximos.", "success");
    } catch {
      showToast("Não foi possível obter localização.", "error");
    } finally {
      setLocating(false);
    }
  }

  function clearGps() {
    setClientLat(null);
    setClientLng(null);
  }

  const goToList = (customQuery?: string) => {
    const nextQuery = customQuery ?? (query.trim() || undefined);
    navigation.navigate("ProfessionalsList", {
      query: nextQuery,
      categoryId: selectedCategoryId,
      objective: objectiveKey === "all" ? undefined : objectiveKey,
      minRating: selectedRating,
      lat: clientLat ?? undefined,
      lng: clientLng ?? undefined,
      serviceMode: serviceModeKey === "all" ? undefined : serviceModeKey,
    } as never);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Buscar profissionais</Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>nome, especialidade ou nota</Text>
        </View>
      </View>

      <ScreenEntrance>
      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 40, gap: 14, paddingTop: 16 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        {/* Campo de busca */}
        <TextInput
          autoFocus
          placeholder="Ex.: personal, nutrição, pilates..."
          placeholderTextColor={theme.text3}
          returnKeyType="search"
          onChangeText={setQuery}
          onSubmitEditing={() => goToList()}
          value={query}
          selectionColor={theme.primary}
          style={{ height: S.btnH, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.borderMid, backgroundColor: theme.inputBg, paddingHorizontal: 16, color: theme.text1, fontFamily: "DMSans_400Regular", fontSize: 14 }}
        />

        {/* GPS */}
        <TouchableOpacity
          onPress={clientLat ? clearGps : () => void requestGps()}
          disabled={locating}
          accessibilityRole="button"
          accessibilityLabel={clientLat ? "Remover localização" : "Usar minha localização"}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: clientLat ? theme.primarySubtleBorder : theme.border, backgroundColor: clientLat ? theme.primarySubtle : theme.cardBg }}
        >
          <Ionicons name="location-outline" size={16} color={clientLat ? theme.primary : theme.text2} />
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: clientLat ? theme.primary : theme.text2, flex: 1 }} numberOfLines={2}>
            {locating ? "Obtendo localização..." : clientLat ? "Localização ativa — ordenado por proximidade. Toque para remover." : "Usar minha localização para ordenar por proximidade"}
          </Text>
          {clientLat ? <Ionicons name="close-circle" size={16} color={theme.text3} /> : null}
        </TouchableOpacity>

        {/* Filtros */}
        {[
          { label: "Especialidade", chips: [{ label: "Todas", selected: !selectedCategoryId, onPress: () => setSelectedCategoryId(undefined) }, ...categories.map((cat) => ({ label: cat.name, selected: selectedCategoryId === cat.id, onPress: () => setSelectedCategoryId(cat.id) }))] },
          { label: "Objetivo", chips: objectiveFilters.map((f) => ({ label: f.label, selected: f.key === objectiveKey, onPress: () => setObjectiveKey(f.key) })) },
          { label: "Nota mínima", chips: ratingFilters.map((f) => ({ label: f.label, selected: f.key === ratingKey, onPress: () => setRatingKey(f.key) })) },
          { label: "Modalidade", chips: serviceModeFilters.map((f) => ({ label: f.label, selected: f.key === serviceModeKey, onPress: () => setServiceModeKey(f.key) })) },
        ].map(({ label, chips }) => (
          <View key={label} style={{ gap: 8 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>{label}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {chips.map((chip) => (
                <TouchableOpacity
                  key={chip.label}
                  onPress={chip.onPress}
                  style={{ height: 36, paddingHorizontal: 12, borderRadius: S.chipR, backgroundColor: chip.selected ? theme.primarySubtle : "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: chip.selected ? theme.primarySubtleBorder : theme.border }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: chip.selected ? theme.primary : theme.text2, lineHeight: 36 }}>{chip.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Botão de busca */}
        <TouchableOpacity
          onPress={() => goToList()}
          accessibilityRole="button"
          accessibilityLabel="Ver resultados da busca"
          style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
        >
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>Ver resultados</Text>
        </TouchableOpacity>

        {/* Sugestões */}
        <FlatList
          scrollEnabled={false}
          contentContainerStyle={{ gap: 8 }}
          data={suggestions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              // Frente 8 (segunda camada), Lote 15: tocar numa sugestão
              // reabria a lista de resultados buscando pelo NOME do
              // profissional (goToList(item.displayName)) em vez de abrir o
              // perfil direto - se o nome tiver homônimo ou não bater
              // exatamente com a tokenização da busca, o toque podia levar
              // pra outro profissional ou pra uma lista vazia. A sugestão já
              // é o profissional certo (tem o id), então navega direto.
              onPress={() => navigation.navigate("ProfessionalDetail", { professionalId: item.id })}
              style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 4 }}
            >
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }} numberOfLines={1}>{item.displayName}</Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }} numberOfLines={1}>{item.bio}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.primary }}>★ {averageToFive(item.avgRating ?? item.averageRating).toFixed(1)}</Text>
                {typeof item.distanceKm === "number" ? (
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>{item.distanceKm.toFixed(1)} km</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>
              {loading ? "Buscando..." : "Nenhuma sugestão. Digite para buscar."}
            </Text>
          }
        />
      </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
