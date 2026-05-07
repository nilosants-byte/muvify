import React, { useEffect, useMemo, useState } from "react";
import { FlatList, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
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
  ProviderSummary
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { averageToFive, handleScreenError } from "../shared/api-helpers";

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
  }, [query, selectedCategoryId, selectedRating, serviceModeKey, clientLat, clientLng, showToast]);

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
      minRating: selectedRating,
      lat: clientLat ?? undefined,
      lng: clientLng ?? undefined,
      serviceMode: serviceModeKey === "all" ? undefined : serviceModeKey,
    } as never);
  };

  const Chip = ({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) => (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
        backgroundColor: selected ? "rgba(76,175,80,0.12)" : theme.chipBg,
        borderWidth: 1, borderColor: selected ? "rgba(76,175,80,0.30)" : theme.border,
      }}
    >
      <MvText variant="body4" style={{ color: selected ? theme.textGreen : theme.chipText }}>{label}</MvText>
    </TouchableOpacity>
  );

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
        <MvText variant="h4">Buscar profissionais</MvText>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 14 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        <MvText variant="body4" color="secondary">Nome, especialidade ou nota.</MvText>

        <MvInput
          autoFocus
          placeholder="Ex.: personal, nutrição, pilates..."
          returnKeyType="search"
          onChangeText={setQuery}
          onSubmitEditing={() => goToList()}
          value={query}
        />

        {/* GPS */}
        <TouchableOpacity
          onPress={clientLat ? clearGps : () => void requestGps()}
          disabled={locating}
          style={{
            flexDirection: "row", alignItems: "center", gap: 8, padding: 12,
            borderRadius: 10, borderWidth: 1,
            borderColor: clientLat ? "rgba(76,175,80,0.40)" : theme.border,
            backgroundColor: clientLat ? "rgba(76,175,80,0.07)" : theme.inputBg,
          }}
        >
          <Ionicons name="location-outline" size={16} color={clientLat ? "#4CAF50" : theme.text2} />
          <MvText variant="body4" style={{ flex: 1, color: clientLat ? theme.textGreen : theme.text2 }}>
            {locating ? "Obtendo localização..." : clientLat ? "Localização ativa - resultados ordenados por proximidade (toque para remover)" : "Usar minha localização para ordenar por proximidade"}
          </MvText>
          {clientLat ? <Ionicons name="close-circle-outline" size={16} color={theme.text3} /> : null}
        </TouchableOpacity>


        <View style={{ gap: 8 }}>
          <MvText variant="semi3">Especialidade</MvText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Chip label="Todas" selected={!selectedCategoryId} onPress={() => setSelectedCategoryId(undefined)} />
            {categories.map((cat) => (
              <Chip key={cat.id} label={cat.name} selected={selectedCategoryId === cat.id} onPress={() => setSelectedCategoryId(cat.id)} />
            ))}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <MvText variant="semi3">Nota mínima</MvText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {ratingFilters.map((filter) => (
              <Chip key={filter.key} label={filter.label} selected={filter.key === ratingKey} onPress={() => setRatingKey(filter.key)} />
            ))}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <MvText variant="semi3">Modalidade de atendimento</MvText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {serviceModeFilters.map((filter) => (
              <Chip key={filter.key} label={filter.label} selected={filter.key === serviceModeKey} onPress={() => setServiceModeKey(filter.key)} />
            ))}
          </View>
        </View>

        <MvButton label="Ver resultados" onPress={() => goToList()} />

        <FlatList
          scrollEnabled={false}
          contentContainerStyle={{ gap: 8 }}
          data={suggestions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => goToList(item.displayName)}>
              <MvCard>
                <MvText variant="semi2">{item.displayName}</MvText>
                <MvText variant="body4" color="secondary" numberOfLines={1}>{item.bio}</MvText>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 }}>
                  <MvText variant="body4" style={{ color: theme.textGreen }}>
                    Nota {averageToFive(item.avgRating ?? item.averageRating).toFixed(1)}
                  </MvText>
                  {typeof item.distanceKm === "number" ? (
                    <MvText variant="body4" color="secondary">{item.distanceKm.toFixed(1)} km</MvText>
                  ) : null}
                </View>
              </MvCard>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            loading ? (
              <MvText variant="body4" color="secondary">Buscando...</MvText>
            ) : (
              <MvText variant="body4" color="secondary">Nenhuma sugestão encontrada.</MvText>
            )
          }
        />
      </ScrollView>
    </View>
  );
}
