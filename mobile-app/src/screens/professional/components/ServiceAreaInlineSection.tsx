import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Keyboard,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import MapView, { Circle, Marker, PROVIDER_DEFAULT } from "react-native-maps";
import {
  ProviderFixedLocation,
  ProviderServiceMode,
  ProviderSummary,
  providersApi,
  userApi,
} from "../../../services/api/client";
import { usePlaceSuggestions } from "../../../hooks/usePlaceSuggestions";
import { useNearbyPlaceNameSuggestions } from "../../../hooks/useNearbyPlaceNameSuggestions";
import { useAreaFitnessVenues } from "../../../hooks/useAreaFitnessVenues";
import { fetchGooglePlaceCoords, useGooglePlacesSearch } from "../../../hooks/useGooglePlacesSearch";
import {
  getProviderBackgroundLocationStatus,
  startProviderBackgroundLocation,
  stopProviderBackgroundLocation,
} from "../../../services/location/providerBackgroundLocation";
import { useAppState } from "../../../state/AppState";
import { useMvTheme } from "../../../theme/MvThemeContext";
import { MvCard, MvText } from "../../../components/mv";
import { handleScreenError } from "../../shared/api-helpers";

const { height: SCREEN_H } = Dimensions.get("window");
const MAP_HEIGHT = Math.round(SCREEN_H * 0.34);
const MAP_HEIGHT_WHEN_TYPING = Math.round(SCREEN_H * 0.24);

const RADIUS_PRESETS = [1, 3, 5, 10] as const;

const SERVICE_MODE_OPTIONS: Array<{ key: ProviderServiceMode; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "PRESENTIAL_ONLY", label: "Academia", icon: "fitness-outline" },
  { key: "HOME_VISIT_ONLY", label: "Domicílio", icon: "home-outline" },
  { key: "BOTH", label: "Ambos", icon: "swap-horizontal-outline" },
];

const MODE_COLOR: Record<ProviderServiceMode, string> = {
  PRESENTIAL_ONLY: "#22C55E",
  HOME_VISIT_ONLY: "#2196F3",
  BOTH: "#FF9800",
};

type NavigationLike = {
  navigate?: (screen: string, params?: unknown) => void;
};

type Props = {
  navigation?: NavigationLike;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

function buildAreaSnapshot(
  latitude: number,
  longitude: number,
  radiusKm: number,
  serviceMode: ProviderServiceMode,
  extraLocations: ProviderFixedLocation[]
) {
  return JSON.stringify({ latitude, longitude, radiusKm, serviceMode, extraLocations });
}

export function ServiceAreaInlineSection({ navigation, onSaved, onDirtyChange }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const isLight = theme.mode === "light";
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);
  // Frente 5 (segunda camada), Lote 4: mover o pino, mudar o raio, trocar
  // a modalidade ou cadastrar um local extra só persistia mesmo quando o
  // profissional apertava "Salvar" — sair da tela antes disso perdia tudo
  // em silêncio. Guarda um retrato do último estado salvo pra comparar
  // contra o atual e avisar o profissional antes de descartar.
  const savedSnapshotRef = useRef<string>("");

  const [latitude, setLatitude] = useState(-23.5505);
  const [longitude, setLongitude] = useState(-46.6333);
  const [radiusKm, setRadiusKm] = useState(5);
  const [customRadius, setCustomRadius] = useState("5");
  const [serviceMode, setServiceMode] = useState<ProviderServiceMode>("BOTH");

  const [extraLocations, setExtraLocations] = useState<ProviderFixedLocation[]>([]);
  const [newLocName, setNewLocName] = useState("");
  const [newLocAddress, setNewLocAddress] = useState("");
  const [newLocCoords, setNewLocCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [addingExtra, setAddingExtra] = useState(false);

  const [addressQuery, setAddressQuery] = useState("");
  // Legacy state — kept for backward compat but suggestions now come from the hook
  const [addressSuggestions, setAddressSuggestions] = useState<
    Array<{ display_name: string; lat: string; lon: string }>
  >([]);
  const [newLocAddressQuery, setNewLocAddressQuery] = useState("");
  const [competingProviders, setCompetingProviders] = useState<ProviderSummary[]>([]);
  const [addressFocused, setAddressFocused] = useState(false);
  const [newLocNameFocused, setNewLocNameFocused] = useState(false);
  const [newLocAddressFocused, setNewLocAddressFocused] = useState(false);
  const [mainSuggestionOpen, setMainSuggestionOpen] = useState(false);
  const [extraAddressSuggestionOpen, setExtraAddressSuggestionOpen] = useState(false);
  const [nameSuggestionOpen, setNameSuggestionOpen] = useState(false);
  const mainBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newLocAddressBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newLocNameBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resolvingCoords, setResolvingCoords] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [backgroundLocationEnabled, setBackgroundLocationEnabled] = useState(false);
  const [backgroundLocationBusy, setBackgroundLocationBusy] = useState(false);
  const [backgroundLocationRunning, setBackgroundLocationRunning] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // Campo 1 — Google Places primary (all types: addresses, neighborhoods, cities, establishments)
  const { suggestions: googleMainSuggestions, loading: googleMainLoading } = useGooglePlacesSearch(
    addressQuery,
    latitude,
    longitude,
    radiusKm,
    mainSuggestionOpen,
    ""
  );

  // Campo 1 — Nominatim fallback to fill remaining slots
  const { suggestions: nominatimMainSuggestions, loading: nominatimMainLoading } = usePlaceSuggestions(
    addressQuery,
    latitude,
    longitude,
    mainSuggestionOpen
  );

  const mainAddrSuggestions = useMemo(() => {
    const seen = new Set(googleMainSuggestions.map((g) => g.name.toLocaleLowerCase("pt-BR")));
    const fromGoogle = googleMainSuggestions.map((g) => ({
      displayName: g.address
        ? `${g.name}, ${g.address.replace(/, Brasil$/, "").replace(/, Brazil$/, "")}`
        : g.name,
      lat: g.lat,
      lon: g.lon,
      placeId: g.placeId,
    }));
    const fromNominatim = nominatimMainSuggestions
      .filter((s) => !seen.has(s.displayName.toLocaleLowerCase("pt-BR")))
      .map((s) => ({ displayName: s.displayName, lat: s.lat, lon: s.lon, placeId: undefined as string | undefined }));
    return [...fromGoogle, ...fromNominatim].slice(0, 6);
  }, [googleMainSuggestions, nominatimMainSuggestions]);

  const mainAddrLoading = googleMainLoading || nominatimMainLoading;

  // Overpass area scan — carrega TODOS os locais fitness no raio configurado.
  // Alimenta Campo 2 (filtro client-side instantâneo) e é mesclado com Campo 3.
  const { venues: areaVenues, loading: areaLoading } = useAreaFitnessVenues(
    latitude,
    longitude,
    radiusKm,
    addingExtra
  );

  // Campo 2 — Google Places (primary, same DB as map) + Overpass client-side + Overpass fallback
  const { suggestions: googleNameSuggestions, loading: googleNameLoading } = useGooglePlacesSearch(
    newLocName,
    latitude,
    longitude,
    radiusKm,
    addingExtra && nameSuggestionOpen
  );

  const { suggestions: overpassNameSuggestions, loading: overpassNameLoading } = useNearbyPlaceNameSuggestions(
    newLocName,
    areaVenues,
    addingExtra && nameSuggestionOpen,
    latitude,
    longitude,
    radiusKm
  );

  const newLocNameSuggestions = useMemo(() => {
    if (googleNameSuggestions.length > 0) {
      // Google Places has data → use it, append non-duplicate Overpass results
      const googleKeys = new Set(googleNameSuggestions.map((g) => g.name.toLocaleLowerCase("pt-BR")));
      const extra = overpassNameSuggestions
        .filter((o) => !googleKeys.has(o.name.toLocaleLowerCase("pt-BR")))
        .map((o) => ({ name: o.name, address: o.address, lat: o.lat, lon: o.lon }));
      return [...googleNameSuggestions, ...extra].slice(0, 6);
    }
    // No API key or no results → fall back to Overpass
    return overpassNameSuggestions.map((o) => ({ name: o.name, address: o.address, lat: o.lat, lon: o.lon }));
  }, [googleNameSuggestions, overpassNameSuggestions]);

  const newLocNameLoading = googleNameLoading || overpassNameLoading;

  // Campo 3 — Google Places (primary) + Overpass text filter + Nominatim fitness
  const { suggestions: googleAddrSuggestions, loading: googleAddrLoading } = useGooglePlacesSearch(
    newLocAddressQuery,
    latitude,
    longitude,
    radiusKm,
    extraAddressSuggestionOpen && addingExtra
  );

  const { suggestions: nominatimAddrSuggestions, loading: nominatimAddrLoading } = usePlaceSuggestions(
    newLocAddressQuery,
    latitude,
    longitude,
    extraAddressSuggestionOpen && addingExtra,
    400,
    true,
    5
  );

  // Mescla Google (primary) + Overpass (texto) + Nominatim
  const extraAddrSuggestions = useMemo(() => {
    const needle = newLocAddressQuery.trim().toLocaleLowerCase("pt-BR");
    if (needle.length < 2) return [];

    const seen = new Set<string>();

    const fromGoogle = googleAddrSuggestions.map((g) => ({
      displayName: g.address,
      venueName: g.name,
      lat: g.lat,
      lon: g.lon,
      placeId: g.placeId,
    }));
    fromGoogle.forEach((g) => seen.add(g.venueName?.toLocaleLowerCase("pt-BR") ?? g.displayName.toLocaleLowerCase("pt-BR")));

    const fromOverpass = areaVenues
      .filter(
        (v) =>
          v.name.toLocaleLowerCase("pt-BR").includes(needle) ||
          v.address.toLocaleLowerCase("pt-BR").includes(needle)
      )
      .filter((v) => !seen.has(v.name.toLocaleLowerCase("pt-BR")))
      .slice(0, 3)
      .map((v) => {
        seen.add(v.name.toLocaleLowerCase("pt-BR"));
        return { displayName: v.address, venueName: v.name, lat: v.lat, lon: v.lon };
      });

    const fromNominatim = nominatimAddrSuggestions.filter(
      (s) => !s.venueName || !seen.has(s.venueName.toLocaleLowerCase("pt-BR"))
    );

    return [...fromGoogle, ...fromOverpass, ...fromNominatim].slice(0, 6);
  }, [newLocAddressQuery, googleAddrSuggestions, areaVenues, nominatimAddrSuggestions]);

  const extraAddrLoading = areaLoading || googleAddrLoading || nominatimAddrLoading || resolvingCoords;

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      if (mainBlurTimeoutRef.current) clearTimeout(mainBlurTimeoutRef.current);
      if (newLocAddressBlurTimeoutRef.current) clearTimeout(newLocAddressBlurTimeoutRef.current);
      if (newLocNameBlurTimeoutRef.current) clearTimeout(newLocNameBlurTimeoutRef.current);
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const refreshBackgroundLocationStatus = useCallback(async () => {
    try {
      const status = await getProviderBackgroundLocationStatus();
      setBackgroundLocationEnabled(status.enabledPreference);
      setBackgroundLocationRunning(status.running);
    } catch {
      setBackgroundLocationEnabled(false);
      setBackgroundLocationRunning(false);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const me = await runWithAuth((token) => userApi.me(token));
      const profile = me.providerProfile;

      if (profile) {
        const nextLat = profile.latitude ?? -23.5505;
        const nextLng = profile.longitude ?? -46.6333;
        const nextRadius = profile.serviceRadiusKm ?? 5;

        setLatitude(nextLat);
        setLongitude(nextLng);
        setRadiusKm(nextRadius);
        setCustomRadius(String(nextRadius));
        setServiceMode(profile.serviceMode ?? "BOTH");
        const nextExtraLocations = Array.isArray(profile.fixedLocations)
          ? (profile.fixedLocations as ProviderFixedLocation[])
          : [];
        setExtraLocations(nextExtraLocations);
        savedSnapshotRef.current = buildAreaSnapshot(
          nextLat,
          nextLng,
          nextRadius,
          profile.serviceMode ?? "BOTH",
          nextExtraLocations
        );
      }

      await refreshBackgroundLocationStatus();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar área de atendimento.",
        navigation,
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, refreshBackgroundLocationStatus, runWithAuth, showToast]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (loading) return;
    const dirty = buildAreaSnapshot(latitude, longitude, radiusKm, serviceMode, extraLocations) !== savedSnapshotRef.current;
    onDirtyChange?.(dirty);
  }, [loading, latitude, longitude, radiusKm, serviceMode, extraLocations, onDirtyChange]);

  // Carrega outros personais no raio para exibir como pins não clicáveis (visão de concorrência)
  useEffect(() => {
    if (loading) return;
    providersApi
      .list({ lat: latitude, lng: longitude, maxDistanceKm: Math.max(radiusKm, 5) })
      .then((results) => setCompetingProviders(results))
      .catch(() => {});
  }, [latitude, longitude, radiusKm, loading]);

  const mapDelta = useMemo(() => {
    const base = Math.max(0.02, Math.min(0.34, radiusKm / 40));
    return { latitudeDelta: base, longitudeDelta: base };
  }, [radiusKm]);

  const mapHeight = keyboardVisible ? MAP_HEIGHT_WHEN_TYPING : MAP_HEIGHT;

  // Controlled region — React Native Maps animates automatically when this changes
  const mapRegion = useMemo(
    () => ({
      latitude,
      longitude,
      latitudeDelta: mapDelta.latitudeDelta,
      longitudeDelta: mapDelta.longitudeDelta,
    }),
    [latitude, longitude, mapDelta.latitudeDelta, mapDelta.longitudeDelta]
  );

  const updatePosition = useCallback((lat: number, lng: number) => {
    setLatitude(lat);
    setLongitude(lng);
  }, []);

  async function useCurrentLocation() {
    try {
      setLocating(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        showToast("Permissão de localização negada.", "error");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      updatePosition(loc.coords.latitude, loc.coords.longitude);
      showToast("Localização atual definida.", "success");
    } catch {
      showToast("Não foi possível obter a localização.", "error");
    } finally {
      setLocating(false);
    }
  }

  const enableBackgroundLocation = useCallback(async () => {
    setBackgroundLocationBusy(true);
    try {
      const started = await startProviderBackgroundLocation();
      if (!started.enabled) {
        showToast(started.message ?? "Não foi possível ativar localização em background.", "error");
        await refreshBackgroundLocationStatus();
        return;
      }
      await refreshBackgroundLocationStatus();
      showToast("Localização automática ativada.", "success");
    } catch {
      showToast("Falha ao atualizar configuração de localização.", "error");
      await refreshBackgroundLocationStatus();
    } finally {
      setBackgroundLocationBusy(false);
    }
  }, [refreshBackgroundLocationStatus, showToast]);

  const toggleBackgroundLocation = useCallback((nextValue: boolean) => {
    if (nextValue) {
      // The OS permission dialog gives no context — explain what this does and
      // why (battery/privacy implications) before asking for it.
      Alert.alert(
        "Ativar localização automática?",
        "O Muvify vai atualizar sua posição no mapa periodicamente, mesmo com o app fechado, para que alunos vejam sua localização em tempo real. Isso consome mais bateria. Você pode desativar quando quiser.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Ativar", onPress: () => void enableBackgroundLocation() },
        ]
      );
      return;
    }

    setBackgroundLocationBusy(true);
    stopProviderBackgroundLocation()
      .then(() => refreshBackgroundLocationStatus())
      .then(() => showToast("Localização automática desativada.", "info"))
      .catch(() => showToast("Falha ao atualizar configuração de localização.", "error"))
      .finally(() => setBackgroundLocationBusy(false));
  }, [enableBackgroundLocation, refreshBackgroundLocationStatus, showToast]);

  async function searchAddress() {
    const query = addressQuery.trim();
    if (!query) return;

    const firstAutoSuggestion = mainAddrSuggestions[0];
    if (firstAutoSuggestion) {
      updatePosition(firstAutoSuggestion.lat, firstAutoSuggestion.lon);
      setAddressQuery(firstAutoSuggestion.displayName);
      setAddressFocused(false);
      Keyboard.dismiss();
      return;
    }

    try {
      setSearchingAddress(true);
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=br`;
      const resp = await fetch(url, {
        headers: { "Accept-Language": "pt-BR", "User-Agent": "Muvify-App/1.0" },
      });
      const results = (await resp.json()) as Array<{ display_name: string; lat: string; lon: string }>;
      setAddressSuggestions(results);
      if (results[0]) {
        selectAddressSuggestion(results[0]);
      } else {
        showToast("Endereço não encontrado.", "info");
      }
    } catch {
      showToast("Falha ao buscar endereço.", "error");
    } finally {
      setSearchingAddress(false);
    }
  }

  function selectAddressSuggestion(item: { display_name: string; lat: string; lon: string }) {
    const parsedLat = parseFloat(item.lat);
    const parsedLon = parseFloat(item.lon);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) {
      showToast("Endereço inválido para o mapa.", "error");
      return;
    }

    setLatitude(parsedLat);
    setLongitude(parsedLon);
    setAddressQuery(item.display_name);
    setAddressFocused(false);
    setMainSuggestionOpen(false);
    setAddressSuggestions([]);
    Keyboard.dismiss();
  }

  function applyRadius(nextRadiusKm: number) {
    const safe = Math.max(1, Math.min(200, Math.round(nextRadiusKm)));
    setRadiusKm(safe);
    setCustomRadius(String(safe));
  }

  function applyCustomRadius() {
    const value = parseInt(customRadius, 10);
    if (!Number.isFinite(value) || value < 1) {
      showToast("Raio mínimo: 1 km.", "error");
      return;
    }
    if (value > 200) {
      showToast("Raio máximo: 200 km.", "error");
      return;
    }
    applyRadius(value);
  }

  async function addExtraLocation() {
    if (!newLocName.trim()) {
      showToast("Informe o nome do local.", "error");
      return;
    }

    let locLat: number | null = newLocCoords?.lat ?? null;
    let locLng: number | null = newLocCoords?.lon ?? null;

    const resolvedAddress = newLocAddressQuery.trim() || newLocAddress.trim();
    if (!resolvedAddress) {
      showToast("Informe o endereço do local.", "error");
      return;
    }

    // Last-resort geocode if user typed address manually without selecting a suggestion
    if ((locLat === null || locLng === null) && resolvedAddress) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(resolvedAddress)}&format=json&limit=1&countrycodes=br`;
        const resp = await fetch(url, {
          headers: { "Accept-Language": "pt-BR", "User-Agent": "Muvify-App/1.0" },
        });
        const results = await resp.json();
        if (results[0]) {
          locLat = parseFloat(results[0].lat);
          locLng = parseFloat(results[0].lon);
        }
      } catch {
        // fall through to the null check below
      }
    }

    if (locLat === null || locLng === null) {
      showToast("Selecione um local nas sugestões para salvar.", "error");
      return;
    }

    setExtraLocations((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        name: newLocName.trim(),
        address: resolvedAddress || undefined,
        latitude: locLat,
        longitude: locLng,
        radiusKm,
      },
    ]);

    setNewLocName("");
    setNewLocAddress("");
    setNewLocAddressQuery("");
    setNewLocCoords(null);
    setNewLocNameFocused(false);
    setNameSuggestionOpen(false);
    setNewLocAddressFocused(false);
    setExtraAddressSuggestionOpen(false);
    setAddingExtra(false);
    showToast("Local adicionado à lista. Toque em \"Salvar\" para confirmar.", "success");
  }

  function removeExtraLocation(id: string) {
    setExtraLocations((prev) => prev.filter((loc) => loc.id !== id));
  }

  async function save() {
    try {
      setSaving(true);
      await runWithAuth((token) =>
        providersApi.updateProfile(token, {
          latitude,
          longitude,
          serviceRadiusKm: radiusKm,
          serviceMode,
          fixedLocations: extraLocations.map((loc) => ({
            id: loc.id,
            name: loc.name,
            address: loc.address ?? undefined,
            latitude: loc.latitude ?? undefined,
            longitude: loc.longitude ?? undefined,
            radiusKm: loc.radiusKm ?? undefined,
          })),
        })
      );
      savedSnapshotRef.current = buildAreaSnapshot(latitude, longitude, radiusKm, serviceMode, extraLocations);
      showToast("Área de atendimento salva.", "success");
      onSaved?.();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao salvar área de atendimento.",
        navigation,
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <MvCard style={{ alignItems: "center", justifyContent: "center", minHeight: 110 }}>
        <ActivityIndicator color={theme.textGreen} />
      </MvCard>
    );
  }

  const selectedModeColor = MODE_COLOR[serviceMode];

  return (
    <View style={{ gap: 8 }}>
      <View style={{ height: mapHeight, overflow: "hidden", position: "relative", borderRadius: 14 }}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={{ flex: 1 }}
          onMapReady={() => setMapReady(true)}
          region={mapRegion}
          showsUserLocation
          showsMyLocationButton={false}
          showsCompass={false}
          rotateEnabled={false}
          onPress={(event: any) => {
            const { latitude: nextLat, longitude: nextLng } = event.nativeEvent.coordinate;
            updatePosition(nextLat, nextLng);
          }}
        >
          <Circle
            center={{ latitude, longitude }}
            radius={radiusKm * 1000}
            strokeColor={theme.primary}
            strokeWidth={1.5}
            fillColor={theme.primarySubtle}
          />

          {/* Pins de outros personais — apenas visual, sem interação */}
          {competingProviders.map((p) => {
            const pLat = typeof p.latitude === "number" ? p.latitude : null;
            const pLng = typeof p.longitude === "number" ? p.longitude : null;
            if (!pLat || !pLng) return null;
            return (
              <Marker
                key={p.id}
                coordinate={{ latitude: pLat, longitude: pLng }}
                tracksViewChanges={false}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: "rgba(150,150,150,0.75)",
                    borderWidth: 1.5,
                    borderColor: "#fff",
                  }}
                />
              </Marker>
            );
          })}

          <Marker
            coordinate={{ latitude, longitude }}
            draggable
            onDragEnd={(event: any) => {
              const { latitude: nextLat, longitude: nextLng } = event.nativeEvent.coordinate;
              updatePosition(nextLat, nextLng);
            }}
            tracksViewChanges={false}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: selectedModeColor,
                borderWidth: 2,
                borderColor: "#fff",
              }}
            />
          </Marker>
        </MapView>

        <View
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            backgroundColor: isLight ? "rgba(255,255,255,0.92)" : "rgba(14,22,14,0.88)",
            borderRadius: 10,
            paddingHorizontal: 9,
            paddingVertical: 6,
            borderWidth: 1,
            borderColor: theme.border,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: selectedModeColor }} />
          <MvText variant="badge" style={{ color: theme.text2, fontSize: 10 }}>
            {serviceMode === "PRESENTIAL_ONLY" ? "Presencial" : serviceMode === "HOME_VISIT_ONLY" ? "Domicílio" : "Ambos"}
          </MvText>
        </View>

        <View
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            backgroundColor: isLight ? "rgba(255,255,255,0.92)" : "rgba(14,22,14,0.88)",
            borderRadius: 10,
            paddingHorizontal: 9,
            paddingVertical: 5,
            borderWidth: 1,
            borderColor: theme.border,
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Ionicons name="navigate-outline" size={12} color={theme.textGreen} />
          <MvText variant="badge" style={{ color: theme.textGreen, fontSize: 10 }}>
            Sua area ativa
          </MvText>
        </View>

        <View
          style={{
            position: "absolute",
            top: 44,
            left: 8,
            gap: 8,
          }}
        >
          <TouchableOpacity
            onPress={() => {
              void useCurrentLocation();
            }}
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: isLight ? "rgba(255,255,255,0.95)" : "rgba(11,18,11,0.93)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {locating ? (
              <ActivityIndicator size="small" color={theme.textGreen} />
            ) : (
              <Ionicons name="locate-outline" size={17} color={theme.text2} />
            )}
          </TouchableOpacity>
        </View>

        <View
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            backgroundColor: "rgba(0,0,0,0.60)",
            borderRadius: 8,
            paddingHorizontal: 9,
            paddingVertical: 4,
          }}
        >
          <MvText variant="badge" style={{ color: "#fff", fontSize: 10 }}>
            {latitude.toFixed(4)}, {longitude.toFixed(4)}
          </MvText>
        </View>

        <View
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            backgroundColor: "rgba(34,197,94,0.85)",
            borderRadius: 8,
            paddingHorizontal: 9,
            paddingVertical: 4,
          }}
        >
          <MvText variant="badge" style={{ color: "#fff", fontSize: 10 }}>
            {radiusKm} km
          </MvText>
        </View>
      </View>

      <MvCard>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <MvText variant="semi2">Configuração rápida</MvText>
          <TouchableOpacity
            onPress={() => {
              void save();
            }}
            disabled={saving}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "rgba(34,197,94,0.30)",
              backgroundColor: theme.primarySubtle,
              paddingHorizontal: 10,
              paddingVertical: 6,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <Ionicons name="checkmark-done-outline" size={14} color={theme.primary} />
            )}
            <MvText variant="badge" style={{ color: theme.textGreen, fontSize: 11 }}>Salvar</MvText>
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
          <TouchableOpacity
            onPress={() => {
              void useCurrentLocation();
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "rgba(34,197,94,0.30)",
              backgroundColor: theme.primarySubtle,
              paddingHorizontal: 10,
              paddingVertical: 6,
            }}
          >
            <Ionicons name="locate-outline" size={14} color={theme.primary} />
            <MvText variant="badge" style={{ color: theme.textGreen, fontSize: 11 }}>Base atual</MvText>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              toggleBackgroundLocation(!backgroundLocationEnabled);
            }}
            disabled={backgroundLocationBusy}
            accessibilityRole="switch"
            accessibilityState={{ checked: backgroundLocationEnabled }}
            accessibilityLabel="Localização automática em segundo plano"
            accessibilityHint="Atualiza sua posição no mapa periodicamente mesmo com o app fechado, usando mais bateria"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: backgroundLocationEnabled ? "rgba(34,197,94,0.30)" : theme.border,
              backgroundColor: backgroundLocationEnabled ? theme.primarySubtle : theme.inputBg,
              paddingHorizontal: 10,
              paddingVertical: 6,
              opacity: backgroundLocationBusy ? 0.7 : 1,
            }}
          >
            {backgroundLocationBusy ? (
              <ActivityIndicator size="small" color={theme.text2} />
            ) : (
              <Ionicons
                name={backgroundLocationEnabled ? "pause-circle-outline" : "play-circle-outline"}
                size={14}
                color={backgroundLocationEnabled ? theme.primary : theme.text2}
              />
            )}
            <MvText variant="badge" style={{ color: backgroundLocationEnabled ? theme.textGreen : theme.text2, fontSize: 11 }}>
              {backgroundLocationEnabled ? "Localização automática: ativada" : "Localização automática: desativada"}
            </MvText>
          </TouchableOpacity>
        </View>

        {/* Campo de busca de endereço principal com sugestões automáticas */}
        <View style={{ marginTop: 8 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderWidth: 1,
              borderColor: addressFocused ? "rgba(34,197,94,0.45)" : theme.border,
              borderRadius: 10,
              backgroundColor: theme.inputBg,
              paddingHorizontal: 10,
              paddingVertical: 7,
            }}
          >
            <Ionicons name="search-outline" size={14} color={mainAddrLoading ? theme.primary : theme.text3} />
            <TextInput
              value={addressQuery}
              onChangeText={setAddressQuery}
              onFocus={() => {
                if (mainBlurTimeoutRef.current) clearTimeout(mainBlurTimeoutRef.current);
                setAddressFocused(true);
                setMainSuggestionOpen(true);
              }}
              onBlur={() => {
                if (mainBlurTimeoutRef.current) clearTimeout(mainBlurTimeoutRef.current);
                mainBlurTimeoutRef.current = setTimeout(() => {
                  setAddressFocused(false);
                  setMainSuggestionOpen(false);
                }, 420);
              }}
              onSubmitEditing={() => { void searchAddress(); }}
              placeholder="Buscar endereço no mapa"
              placeholderTextColor={theme.text3}
              style={{ flex: 1, padding: 0, color: theme.text1, fontSize: 13 }}
              returnKeyType="search"
            />
            {mainAddrLoading ? <ActivityIndicator size="small" color={theme.primary} /> : null}
          </View>

          {mainAddrSuggestions.length > 0 && mainSuggestionOpen ? (
            <ScrollView
              style={{ maxHeight: 170, marginTop: 4, borderWidth: 1, borderColor: theme.border, borderRadius: 10 }}
              keyboardShouldPersistTaps="always"
            >
              {mainAddrSuggestions.map((s, index) => (
                <TouchableOpacity
                  key={s.placeId ?? `main-${s.lat}-${s.lon}-${index}`}
                  onPressIn={() => {
                    if (mainBlurTimeoutRef.current) clearTimeout(mainBlurTimeoutRef.current);
                    setMainSuggestionOpen(true);
                  }}
                  onPress={() => {
                    if (s.placeId && s.lat === 0) {
                      setAddressQuery(s.displayName);
                      setAddressFocused(false);
                      setMainSuggestionOpen(false);
                      Keyboard.dismiss();
                      setResolvingCoords(true);
                      fetchGooglePlaceCoords(s.placeId).then((coords) => {
                        if (coords) {
                          setLatitude(coords.lat);
                          setLongitude(coords.lon);
                        }
                        setResolvingCoords(false);
                      });
                    } else {
                      selectAddressSuggestion({
                        display_name: s.displayName,
                        lat: String(s.lat),
                        lon: String(s.lon),
                      });
                    }
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderTopWidth: index > 0 ? 1 : 0,
                    borderColor: theme.borderSub,
                    backgroundColor: theme.cardBg,
                  }}
                >
                  <Ionicons name="location-outline" size={13} color={theme.primary} />
                  <MvText variant="body4" color="secondary" numberOfLines={1} style={{ flex: 1, fontSize: 11 }}>
                    {s.displayName}
                  </MvText>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}
        </View>

        <View style={{ marginTop: 10, borderTopWidth: 1, borderColor: theme.borderSub, paddingTop: 10, gap: 8 }}>
          <View>
            <MvText variant="badge" style={{ color: theme.text3, fontSize: 10 }}>Raio de atendimento</MvText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
              {RADIUS_PRESETS.map((preset) => {
                const active = radiusKm === preset;
                return (
                  <TouchableOpacity
                    key={preset}
                    onPress={() => applyRadius(preset)}
                    style={{
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: active ? "rgba(34,197,94,0.40)" : theme.border,
                      backgroundColor: active ? theme.primarySubtle : theme.chipBg,
                      paddingHorizontal: 9,
                      paddingVertical: 5,
                    }}
                  >
                    <MvText variant="badge" style={{ color: active ? theme.textGreen : theme.text2, fontSize: 11 }}>
                      {preset} km
                    </MvText>
                  </TouchableOpacity>
                );
              })}

              <View
                style={{
                  minWidth: 98,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 16,
                  backgroundColor: theme.inputBg,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                }}
              >
                <TextInput
                  value={customRadius}
                  onChangeText={setCustomRadius}
                  keyboardType="number-pad"
                  style={{ flex: 1, padding: 0, color: theme.text1, fontSize: 11 }}
                  placeholder="km"
                  placeholderTextColor={theme.text3}
                />
                <TouchableOpacity onPress={applyCustomRadius}>
                  <Ionicons name="checkmark" size={14} color={theme.textGreen} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View>
            <MvText variant="badge" style={{ color: theme.text3, fontSize: 10 }}>Tipo de atendimento</MvText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
              {SERVICE_MODE_OPTIONS.map((option) => {
                const active = serviceMode === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    onPress={() => setServiceMode(option.key)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: active ? "rgba(34,197,94,0.40)" : theme.border,
                      backgroundColor: active ? theme.primarySubtle : theme.chipBg,
                      paddingHorizontal: 9,
                      paddingVertical: 5,
                    }}
                  >
                    <Ionicons name={option.icon} size={12} color={active ? theme.textGreen : theme.text2} />
                    <MvText variant="badge" style={{ color: active ? theme.textGreen : theme.text2, fontSize: 11 }}>
                      {option.label}
                    </MvText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <MvText variant="badge" style={{ color: theme.text3, fontSize: 10 }}>
                Locais adicionais ({extraLocations.length})
              </MvText>
              <TouchableOpacity
                onPress={() => {
                  setAddingExtra((prev) => {
                    const next = !prev;
                    if (!next) {
                      setNewLocNameFocused(false);
                      setNewLocAddressFocused(false);
                      setNameSuggestionOpen(false);
                      setExtraAddressSuggestionOpen(false);
                    }
                    return next;
                  });
                }}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: addingExtra ? "rgba(239,68,68,0.28)" : "rgba(34,197,94,0.30)",
                  backgroundColor: addingExtra ? theme.dangerSubtle : theme.primarySubtle,
                }}
              >
                <Ionicons name={addingExtra ? "close" : "add"} size={13} color={addingExtra ? "#f44336" : theme.primary} />
              </TouchableOpacity>
            </View>

            {extraLocations.slice(0, 4).map((loc) => (
              <View
                key={loc.id}
                style={{
                  marginTop: 6,
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 6,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 9,
                  backgroundColor: theme.inputBg,
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                }}
              >
                <Ionicons name="location-sharp" size={12} color="#FF9800" style={{ marginTop: 2 }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <MvText variant="body4" numberOfLines={1} style={{ fontSize: 11 }}>
                    {loc.name} ({loc.radiusKm ?? 5} km)
                  </MvText>
                  {loc.address ? (
                    <MvText variant="body4" color="secondary" numberOfLines={2} style={{ fontSize: 10, lineHeight: 13 }}>
                      {loc.address}
                    </MvText>
                  ) : null}
                </View>
                <TouchableOpacity onPress={() => removeExtraLocation(loc.id)} style={{ paddingTop: 1 }}>
                  <Ionicons name="trash-outline" size={13} color={theme.text3} />
                </TouchableOpacity>
              </View>
            ))}

            {extraLocations.length > 4 ? (
              <MvText variant="body4" color="secondary" style={{ marginTop: 4, fontSize: 11 }}>
                +{extraLocations.length - 4} locais cadastrados
              </MvText>
            ) : null}

            {addingExtra ? (
              <View style={{ marginTop: 8, gap: 6 }}>
                <View>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      borderWidth: 1,
                      borderColor: newLocNameFocused ? "rgba(34,197,94,0.45)" : theme.border,
                      borderRadius: 9,
                      backgroundColor: theme.inputBg,
                      paddingHorizontal: 10,
                      paddingVertical: 7,
                    }}
                  >
                    {areaLoading || newLocNameLoading ? (
                      <ActivityIndicator size="small" color={theme.primary} style={{ marginRight: 6 }} />
                    ) : (
                      <Ionicons name="business-outline" size={12} color={theme.text3} style={{ marginRight: 6 }} />
                    )}
                    <TextInput
                      value={newLocName}
                      onChangeText={setNewLocName}
                      onFocus={() => {
                        if (newLocNameBlurTimeoutRef.current) clearTimeout(newLocNameBlurTimeoutRef.current);
                        setNewLocNameFocused(true);
                        setNameSuggestionOpen(true);
                      }}
                      onBlur={() => {
                        if (newLocNameBlurTimeoutRef.current) clearTimeout(newLocNameBlurTimeoutRef.current);
                        newLocNameBlurTimeoutRef.current = setTimeout(() => {
                          setNewLocNameFocused(false);
                          setNameSuggestionOpen(false);
                        }, 420);
                      }}
                      placeholder="Nome do local (academia, parque, praça, praia...)"
                      placeholderTextColor={theme.text3}
                      style={{ flex: 1, padding: 0, color: theme.text1, fontSize: 12 }}
                    />
                  </View>

                  {newLocNameSuggestions.length > 0 && nameSuggestionOpen ? (
                    <ScrollView
                      style={{ maxHeight: 160, marginTop: 4, borderWidth: 1, borderColor: theme.border, borderRadius: 9 }}
                      keyboardShouldPersistTaps="always"
                    >
                      {newLocNameSuggestions.map((s, idx) => (
                        <TouchableOpacity
                          key={`name-${s.lat}-${s.lon}-${idx}`}
                          onPressIn={() => {
                            if (newLocNameBlurTimeoutRef.current) clearTimeout(newLocNameBlurTimeoutRef.current);
                            setNameSuggestionOpen(true);
                          }}
                          onPress={() => {
                            // Campo 2 selects name → fills Campo 3 with address; map doesn't move
                            setNewLocName(s.name);
                            setNewLocAddressQuery(s.address);
                            setNewLocAddress(s.address);
                            setNewLocNameFocused(false);
                            setNameSuggestionOpen(false);
                            Keyboard.dismiss();
                            const pid = (s as { placeId?: string }).placeId;
                            if (pid && s.lat === 0) {
                              setResolvingCoords(true);
                              fetchGooglePlaceCoords(pid).then((coords) => {
                                if (coords) {
                                  setNewLocCoords({ lat: coords.lat, lon: coords.lon });
                                  if (coords.address) {
                                    setNewLocAddressQuery(coords.address);
                                    setNewLocAddress(coords.address);
                                  }
                                }
                                setResolvingCoords(false);
                              });
                            } else {
                              setNewLocCoords({ lat: s.lat, lon: s.lon });
                            }
                          }}
                          style={{
                            flexDirection: "row",
                            alignItems: "flex-start",
                            gap: 6,
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                            borderTopWidth: idx > 0 ? 1 : 0,
                            borderColor: theme.borderSub,
                            backgroundColor: theme.cardBg,
                          }}
                        >
                          <Ionicons name="pin-outline" size={12} color={theme.primary} style={{ marginTop: 1 }} />
                          <View style={{ flex: 1, gap: 1 }}>
                            <MvText variant="body4" numberOfLines={1} style={{ fontSize: 11 }}>
                              {s.name}
                            </MvText>
                            <MvText variant="body4" color="secondary" numberOfLines={1} style={{ fontSize: 10 }}>
                              {s.address}
                            </MvText>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  ) : null}
                </View>
                {/* Campo 3 — endereço ou nome do lugar, com sugestões fitness */}
                <View>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <View style={{
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      borderWidth: 1,
                      borderColor: newLocAddressFocused ? "rgba(34,197,94,0.45)" : theme.border,
                      borderRadius: 9,
                      backgroundColor: theme.inputBg,
                      paddingHorizontal: 10,
                      paddingVertical: 7,
                    }}>
                      {extraAddrLoading ? (
                        <ActivityIndicator size="small" color={theme.primary} style={{ marginRight: 6 }} />
                      ) : (
                        <Ionicons name="location-outline" size={12} color={theme.text3} style={{ marginRight: 6 }} />
                      )}
                      <TextInput
                        value={newLocAddressQuery}
                        onChangeText={(t) => {
                          setNewLocAddressQuery(t);
                          setNewLocAddress(t);
                          setNewLocCoords(null);
                        }}
                        onFocus={() => {
                          if (newLocAddressBlurTimeoutRef.current) clearTimeout(newLocAddressBlurTimeoutRef.current);
                          setNewLocAddressFocused(true);
                          setExtraAddressSuggestionOpen(true);
                        }}
                        onBlur={() => {
                          if (newLocAddressBlurTimeoutRef.current) clearTimeout(newLocAddressBlurTimeoutRef.current);
                          newLocAddressBlurTimeoutRef.current = setTimeout(() => {
                            setNewLocAddressFocused(false);
                            setExtraAddressSuggestionOpen(false);
                          }, 420);
                        }}
                        placeholder="Endereço ou nome do lugar..."
                        placeholderTextColor={theme.text3}
                        style={{ flex: 1, padding: 0, color: theme.text1, fontSize: 12 }}
                      />
                    </View>
                    <TouchableOpacity
                      onPress={() => { void addExtraLocation(); }}
                      style={{
                        width: 36,
                        borderRadius: 9,
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: 1,
                        borderColor: "rgba(34,197,94,0.30)",
                        backgroundColor: theme.primarySubtle,
                      }}
                    >
                      <Ionicons name="add" size={18} color={theme.primary} />
                    </TouchableOpacity>
                  </View>
                  {extraAddrSuggestions.length > 0 && extraAddressSuggestionOpen ? (
                    <ScrollView
                      style={{ maxHeight: 160, marginTop: 4, borderWidth: 1, borderColor: theme.border, borderRadius: 9 }}
                      keyboardShouldPersistTaps="always"
                    >
                      {extraAddrSuggestions.map((s, idx) => (
                        <TouchableOpacity
                          key={`extra-${s.lat}-${s.lon}`}
                          onPressIn={() => {
                            if (newLocAddressBlurTimeoutRef.current) clearTimeout(newLocAddressBlurTimeoutRef.current);
                            setExtraAddressSuggestionOpen(true);
                          }}
                          onPress={() => {
                            // Campo 3 selects place → fills both Campo 2 (name) and Campo 3 (address); map doesn't move
                            if (s.venueName) setNewLocName(s.venueName);
                            setNewLocAddressQuery(s.displayName);
                            setNewLocAddress(s.displayName);
                            setNewLocAddressFocused(false);
                            setExtraAddressSuggestionOpen(false);
                            Keyboard.dismiss();
                            const pid = (s as { placeId?: string }).placeId;
                            if (pid && s.lat === 0) {
                              setResolvingCoords(true);
                              fetchGooglePlaceCoords(pid).then((coords) => {
                                if (coords) {
                                  setNewLocCoords({ lat: coords.lat, lon: coords.lon });
                                  if (coords.address) {
                                    setNewLocAddressQuery(coords.address);
                                    setNewLocAddress(coords.address);
                                  }
                                }
                                setResolvingCoords(false);
                              });
                            } else {
                              setNewLocCoords({ lat: s.lat, lon: s.lon });
                            }
                          }}
                          style={{
                            flexDirection: "row",
                            alignItems: "flex-start",
                            gap: 6,
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                            borderTopWidth: idx > 0 ? 1 : 0,
                            borderColor: theme.borderSub,
                            backgroundColor: theme.cardBg,
                          }}
                        >
                          <Ionicons name="location-outline" size={12} color={theme.primary} style={{ marginTop: 1 }} />
                          <View style={{ flex: 1, gap: 1 }}>
                            {s.venueName ? (
                              <MvText variant="body4" numberOfLines={1} style={{ fontSize: 11 }}>
                                {s.venueName}
                              </MvText>
                            ) : null}
                            <MvText variant="body4" color="secondary" numberOfLines={1} style={{ flex: 1, fontSize: 10 }}>
                              {s.displayName}
                            </MvText>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  ) : null}
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </MvCard>
    </View>
  );
}
