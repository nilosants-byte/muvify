import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ClientNotificationsDrawer } from "./components/ClientNotificationsDrawer";
import {
  countUnreadNotifications,
  loadDismissedNotificationIds,
  loadSeenNotificationIds,
} from "../../utils/notificationsReadState";
import { usePlaceSuggestions } from "../../hooks/usePlaceSuggestions";
import { fetchGooglePlaceCoords, useGooglePlacesSearch } from "../../hooks/useGooglePlacesSearch";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Keyboard,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Circle, Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { ClientTabParamList } from "../../navigation/route-types";
import {
  bookingsApi,
  Booking,
  chatApi,
  ClientAnamnesisProfile,
  notificationsApi,
  PROFESSIONAL_SPECIALTIES,
  providersApi,
  ProviderDetail,
  ProviderSchedulePreview,
  ProviderServiceMode,
  ProviderSummary,
  userApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { BlurView } from "expo-blur";
import { MvAvatar, MvBadge, MvBottomNav, MvButton, MvCard, MvText, MvToggle } from "../../components/mv";
import { MvVideoPlayer } from "../../components/mv/MvVideoPlayer";
import { handleScreenError } from "../shared/api-helpers";
import { resolveMediaUrl } from "../../utils/media";

type Props = BottomTabScreenProps<ClientTabParamList, "ClientHome">;
type ProviderWithExtras = ProviderSummary & {
  specialties?: string[] | null;
  age?: number | null;
};
type SideMenuItem = {
  key: string;
  label: string;
  subtitle?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
};
type MapSearchModal = "location" | "provider" | "academy" | null;

const { height: SCREEN_H } = Dimensions.get("window");
const MAP_H = Math.round(SCREEN_H * 0.50);
const MAP_RADIUS_MIN_KM = 1;
const MAP_RADIUS_MAX_KM = 10;

const DEFAULT_LAT = -23.5505;
const DEFAULT_LNG = -46.6333;

// Module-level cache: persists between screen navigations so stale data shows immediately
// while a fresh fetch runs in the background.
const _providersCache: { data: ProviderWithExtras[]; lat: number; lng: number; distanceKm: number } | null =
  (globalThis as any).__mvProvidersCache ?? null;
function setProvidersCache(value: typeof _providersCache) {
  (globalThis as any).__mvProvidersCache = value;
}

const CLIENT_SEARCH_RADIUS_KEY = "@personalapp/clientSearchRadiusKm";
const CLIENT_SEARCH_CENTER_KEY = "@personalapp/clientSearchCenter";
const CLIENT_PUSH_ENABLED_KEY = "@personalapp/clientPushEnabled";
const BRAZIL_STATE_CODES: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  "distrito federal": "DF",
  "espirito santo": "ES",
  goias: "GO",
  maranhao: "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

const SPECIALTY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  "Hipertrofia": "barbell-outline",
  "Emagrecimento": "flame-outline",
  "Corrida": "walk-outline",
  "Alongamento": "body-outline",
  "Reabilita\u00e7\u00e3o e Les\u00e3o": "medical-outline",
  "LPO (Levantamento de Peso Ol\u00edmpico)": "trophy-outline",
  "Fisiculturismo": "fitness-outline",
  "Grupos Especiais": "people-outline",
  "Sa\u00fade da Mulher": "flower-outline",
  "Treino Intervalado (HIIT)": "flash-outline",
};

// Nomes curtos para a grade 4 colunas da home \u2014 evita quebra de palavras longas
const SPECIALTY_SHORT_NAMES: Record<string, string> = {
  "Hipertrofia": "Hipertrofia",
  "Emagrecimento": "Emagrecer",
  "Corrida": "Corrida",
  "Alongamento": "Alongamento",
  "Reabilita\u00e7\u00e3o e Les\u00e3o": "Reabilita\u00e7\u00e3o",
  "LPO (Levantamento de Peso Ol\u00edmpico)": "LPO",
  "Fisiculturismo": "Fisicultur.",
  "Grupos Especiais": "Grupos Esp.",
  "Sa\u00fade da Mulher": "Sa\u00fade Mulher",
  "Treino Intervalado (HIIT)": "HIIT",
};

function formatBookingDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

function formatPrice(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getInitials(name?: string | null) {
  const parts = (name ?? "?").trim().split(/\s+/);
  if (parts.length <= 1) return (parts[0] ?? "?").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function getProviderSpecialties(provider: ProviderWithExtras): string[] {
  if (Array.isArray(provider.specialties) && provider.specialties.length > 0) {
    return provider.specialties.filter((item) => typeof item === "string" && item.trim().length > 0);
  }
  return [];
}

function normalizeSpecialty(value: string) {
  return value.trim().toLowerCase();
}

function isAnamnesisOutdated(completedAt: string): boolean {
  const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(completedAt).getTime() > SIX_MONTHS_MS;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeLooseSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function toStateCode(region?: string | null): string | null {
  if (!region) return null;
  const raw = region.trim();
  if (/^[a-z]{2}$/i.test(raw)) {
    return raw.toUpperCase();
  }
  const normalized = normalizeLooseSearch(raw);
  return BRAZIL_STATE_CODES[normalized] ?? null;
}

function formatCityStateLabel(place?: Location.LocationGeocodedAddress | null): string | null {
  if (!place) return null;
  const city = place.city?.trim() || place.subregion?.trim() || place.district?.trim() || "";
  if (!city) return null;
  const stateCode = toStateCode(place.region);
  return stateCode ? `${city}-${stateCode}` : city;
}

function getGreetingData() {
  const h = new Date().getHours();
  if (h < 12) return { text: "Bom dia", icon: "sunny-outline" as const };
  if (h < 18) return { text: "Boa tarde", icon: "partly-sunny-outline" as const };
  return { text: "Boa noite", icon: "moon-outline" as const };
}

function getProviderMapCoordinates(provider: ProviderWithExtras): { latitude: number; longitude: number } | null {
  if (typeof provider.latitude === "number" && typeof provider.longitude === "number") {
    return {
      latitude: provider.latitude,
      longitude: provider.longitude,
    };
  }

  if (Array.isArray(provider.fixedLocations)) {
    const fallback = provider.fixedLocations.find(
      (loc) => typeof loc?.latitude === "number" && typeof loc?.longitude === "number"
    );
    if (fallback && typeof fallback.latitude === "number" && typeof fallback.longitude === "number") {
      return {
        latitude: fallback.latitude,
        longitude: fallback.longitude,
      };
    }
  }

  return null;
}

function pinColor(mode?: ProviderServiceMode | null): string {
  if (mode === "PRESENTIAL_ONLY") return "#4CAF50";
  if (mode === "HOME_VISIT_ONLY") return "#2196F3";
  if (mode === "BOTH") return "#FF9800";
  return "#9E9E9E";
}

function serviceModeLabel(mode?: ProviderServiceMode | null): string {
  if (mode === "PRESENTIAL_ONLY") return "Presencial";
  if (mode === "HOME_VISIT_ONLY") return "A domicílio";
  if (mode === "BOTH") return "Presencial + A domicílio";
  return "Presencial";
}

function providerMatchesServiceModeFilter(
  providerMode: ProviderServiceMode | null | undefined,
  selectedMode: ProviderServiceMode | undefined
): boolean {
  const normalizedMode = providerMode ?? "PRESENTIAL_ONLY";
  if (normalizedMode === "BOTH") return true;
  if (!selectedMode) return true;
  if (selectedMode === "BOTH") return false;
  if (selectedMode === "PRESENTIAL_ONLY") {
    return normalizedMode === "PRESENTIAL_ONLY";
  }
  return normalizedMode === "HOME_VISIT_ONLY";
}



function ProviderMapPin({ provider, isDark }: { provider: ProviderWithExtras; isDark: boolean }) {
  const color = pinColor(provider.serviceMode);
  const cardBg = isDark ? "rgba(11,18,11,0.96)" : "rgba(255,255,255,0.97)";
  const namColor = isDark ? "#F1F8E9" : "#152215";
  const specColor = isDark ? "#C9D8C9" : "#4D5F4D";
  const specialty = Array.isArray(provider.specialties) && provider.specialties.length > 0
    ? String(provider.specialties[0])
    : "Personal Trainer";
  const price = (() => {
    const val = Number(provider.priceCents || 0) / 100;
    try { return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
    catch { return `R$ ${val.toFixed(2)}`; }
  })();
  return (
    <View style={pinStyles.wrapper} pointerEvents="none">
      <View style={[pinStyles.card, { backgroundColor: cardBg, borderColor: isDark ? "rgba(120,150,120,0.35)" : "rgba(56,84,56,0.25)" }]}>
        <MvText numberOfLines={1} style={[pinStyles.name, { color: namColor }]}>{provider.displayName || "Personal"}</MvText>
        <MvText numberOfLines={1} style={[pinStyles.spec, { color: specColor }]}>{specialty}</MvText>
        <MvText numberOfLines={1} style={pinStyles.price}>{price}</MvText>
      </View>
      <View style={[pinStyles.avatar, { borderColor: color }]}>
        {provider.photoUrl ? (
          <Image source={{ uri: provider.photoUrl }} style={pinStyles.photo} />
        ) : (
          <View style={[pinStyles.initials, { backgroundColor: color }]}>
            <MvText style={pinStyles.initialsText}>{getInitials(provider.displayName)}</MvText>
          </View>
        )}
      </View>
      <View style={[pinStyles.tail, { borderTopColor: cardBg }]} />
    </View>
  );
}

const pinStyles = StyleSheet.create({
  wrapper: { alignItems: "center" },
  card: {
    maxWidth: 170,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 5,
    elevation: 6,
    alignItems: "center",
  },
  name: { fontSize: 11, fontWeight: "700", lineHeight: 13 },
  spec: { fontSize: 9, lineHeight: 11 },
  price: { fontSize: 10, fontWeight: "700", lineHeight: 12, color: "#4CAF50" },
  avatar: {
    marginTop: 4,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2.5,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 4,
    elevation: 5,
  },
  photo: { width: "100%", height: "100%" },
  initials: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  initialsText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -1,
  },
});


const MODE_OPTIONS: { label: string; value: ProviderServiceMode | undefined }[] = [
  { label: "Presencial", value: "PRESENTIAL_ONLY" },
  { label: "A domicílio", value: "HOME_VISIT_ONLY" },
  { label: "Ambos", value: "BOTH" },
];

export function ClientHomeScreen({ navigation }: Props) {
  const { runWithAuth, showToast, signOut, user } = useAppState();
  const { theme, isDark, toggleTheme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const isLight = theme.mode === "light";
  const mapRef = useRef<MapView>(null);

  const [loading, setLoading] = useState(true);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  // Initialize from module-level cache so re-entering the screen shows data immediately
  const [providers, setProviders] = useState<ProviderWithExtras[]>(
    () => (globalThis as any).__mvProvidersCache?.data ?? []
  );
  const [userLat, setUserLat] = useState(DEFAULT_LAT);
  const [userLng, setUserLng] = useState(DEFAULT_LNG);
  const [hasLocation, setHasLocation] = useState(false);
  const [userCity, setUserCity] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderWithExtras | null>(null);
  const [selectedProviderDetail, setSelectedProviderDetail] = useState<ProviderDetail | null>(null);
  const [providerDetailLoading, setProviderDetailLoading] = useState(false);
  const [providerScheduleLoading, setProviderScheduleLoading] = useState(false);
  const [providerSchedulePreview, setProviderSchedulePreview] = useState<ProviderSchedulePreview | null>(null);
  const [selectedScheduleDay, setSelectedScheduleDay] = useState<string | null>(null);
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(
    () => resolveMediaUrl(user?.photoUrl, true)
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [locationSearchQuery, setLocationSearchQuery] = useState("");
  const [providerNameQuery, setProviderNameQuery] = useState("");
  const [providerNameSearch, setProviderNameSearch] = useState("");
  const [academySearchText, setAcademySearchText] = useState("");
  const [selectedAcademyFilter, setSelectedAcademyFilter] = useState<{ name: string; lat: number; lon: number } | null>(null);
  const [activeMapSearchModal, setActiveMapSearchModal] = useState<MapSearchModal>(null);
  const [mapSearchFeedback, setMapSearchFeedback] = useState<"local" | "provider" | null>(null);
  const [filterMode, setFilterMode] = useState<ProviderServiceMode | undefined>(undefined);
  const [filterDistance, setFilterDistance] = useState<number>(3);
  // Debounced version: only updates after user stops dragging for 600ms to avoid flooding the API
  const [filterDistanceCommitted, setFilterDistanceCommitted] = useState<number>(3);
  const filterDistanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [radiusTrackWidth, setRadiusTrackWidth] = useState(0);
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [anamnesisPopup, setAnamnesisPopup] = useState<"incomplete" | "outdated" | null>(null);
  const anamnesisPopupShownRef = useRef(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [notificationsDrawerOpen, setNotificationsDrawerOpen] = useState(false);
  const lightModeEnabled = !isDark;
  const radiusSpan = MAP_RADIUS_MAX_KM - MAP_RADIUS_MIN_KM;
  const safeRadiusKm = Math.max(MAP_RADIUS_MIN_KM, Math.min(MAP_RADIUS_MAX_KM, Math.round(filterDistance)));

  const categories = useMemo(
    () => PROFESSIONAL_SPECIALTIES.map((name) => ({
      id: name, name, icon: SPECIALTY_ICONS[name] ?? "barbell-outline",
    })),
    []
  );
  const specialtyFilterOptions = useMemo(() => PROFESSIONAL_SPECIALTIES, []);

  // Autocomplete de localização — Google Places primary + Nominatim fallback
  const { suggestions: googleLocationSuggestions, loading: googleLocationLoading } = useGooglePlacesSearch(
    locationSearchQuery,
    userLat,
    userLng,
    filterDistanceCommitted,
    activeMapSearchModal === "location",
    ""
  );

  const { suggestions: nominatimLocationSuggestions, loading: nominatimLocationLoading } = usePlaceSuggestions(
    locationSearchQuery,
    userLat,
    userLng,
    activeMapSearchModal === "location"
  );

  const locationSuggestions = useMemo(() => {
    const seen = new Set(googleLocationSuggestions.map((g) => g.name.toLocaleLowerCase("pt-BR")));
    const fromGoogle = googleLocationSuggestions.map((g) => ({
      displayName: g.address
        ? `${g.name}, ${g.address.replace(/, Brasil$/, "").replace(/, Brazil$/, "")}`
        : g.name,
      lat: g.lat,
      lon: g.lon,
      placeId: g.placeId,
    }));
    const fromNominatim = nominatimLocationSuggestions
      .filter((s) => !seen.has(s.displayName.toLocaleLowerCase("pt-BR")))
      .map((s) => ({ displayName: s.displayName, lat: s.lat, lon: s.lon, placeId: undefined as string | undefined }));
    return [...fromGoogle, ...fromNominatim].slice(0, 6);
  }, [googleLocationSuggestions, nominatimLocationSuggestions]);

  const locationSuggestionsLoading = googleLocationLoading || nominatimLocationLoading;

  const { suggestions: academySuggestions, loading: academySuggestionsLoading } = useGooglePlacesSearch(
    academySearchText,
    userLat,
    userLng,
    filterDistanceCommitted,
    activeMapSearchModal === "academy",
    ""
  );

  // Sugestões de personal: filtra lista já carregada pelo texto digitado, ordena por proximidade
  const providerSuggestions = useMemo(() => {
    if (!providerNameQuery.trim()) return [];
    const normalized = normalizeLooseSearch(providerNameQuery);
    return providers
      .filter((p) => normalizeLooseSearch(p.displayName).includes(normalized) && typeof p.latitude === "number" && typeof p.longitude === "number")
      .sort((a, b) => {
        const dA = Math.abs((a.latitude ?? 0) - userLat) + Math.abs((a.longitude ?? 0) - userLng);
        const dB = Math.abs((b.latitude ?? 0) - userLat) + Math.abs((b.longitude ?? 0) - userLng);
        return dA - dB;
      })
      .slice(0, 5);
  }, [providerNameQuery, providers, userLat, userLng]);
  const firstName = useMemo(() => user?.name?.split(" ")[0] ?? "Aluno", [user?.name]);
  const clientInitials = useMemo(() => getInitials(user?.name), [user?.name]);
  const greetingData = useMemo(() => getGreetingData(), []);
  const nextBooking = useMemo(
    () => bookings
      .filter((b) => b.status === "PENDING" || b.status === "CONFIRMED")
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0],
    [bookings]
  );
  const monthlyCompleted = useMemo(
    () => bookings.filter((b) => {
      if (b.status !== "COMPLETED") return false;
      const d = new Date(b.completedAt ?? b.scheduledAt);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length,
    [bookings]
  );

  const goToStack = useCallback((screen: string, params?: object) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate(screen, params);
  }, [navigation]);
  const goHome = useCallback(() => {
    navigation.navigate("ClientHome");
    setMenuOpen(false);
  }, [navigation]);
  const clearProviderSelection = useCallback(() => {
    setSelectedProvider(null);
    setSelectedProviderDetail(null);
    setProviderSchedulePreview(null);
    setSelectedScheduleDay(null);
  }, []);
  const handleLightModeToggle = useCallback((enabled: boolean) => {
    if (enabled !== lightModeEnabled) {
      toggleTheme();
    }
  }, [lightModeEnabled, toggleTheme]);

  const flyToLocation = useCallback((lat: number, lng: number) => {
    mapRef.current?.animateToRegion({
      latitude: lat,
      longitude: lng,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    }, 900);
  }, []);

  const selectLocationSuggestion = useCallback((lat: number, lon: number, name: string) => {
    setUserLat(lat);
    setUserLng(lon);
    setHasLocation(true);
    setLocationSearchQuery(name.split(",").slice(0, 2).join(", "));
    clearProviderSelection();
    flyToLocation(lat, lon);
    Keyboard.dismiss();
    setActiveMapSearchModal(null);
  }, [clearProviderSelection, flyToLocation]);

  const selectProviderSuggestion = useCallback((provider: ProviderWithExtras) => {
    if (typeof provider.latitude === "number" && typeof provider.longitude === "number") {
      flyToLocation(provider.latitude, provider.longitude);
    }
    setProviderNameQuery(provider.displayName);
    setProviderNameSearch(provider.displayName);
    setActiveMapSearchModal(null);
    Keyboard.dismiss();
  }, [flyToLocation]);

  // Sync profile photo with user state (updated whenever user changes photo in profile screen)
  useEffect(() => {
    setProfilePhotoUri(resolveMediaUrl(user?.photoUrl, true));
  }, [user?.photoUrl]);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(CLIENT_SEARCH_RADIUS_KEY)
      .then((savedRadius) => {
        if (!active || !savedRadius) return;
        const parsed = Number(savedRadius);
        if (!Number.isFinite(parsed)) return;
        const nextRadius = Math.max(MAP_RADIUS_MIN_KM, Math.min(MAP_RADIUS_MAX_KM, Math.round(parsed)));
        setFilterDistance(nextRadius);
        setFilterDistanceCommitted(nextRadius);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(CLIENT_PUSH_ENABLED_KEY)
      .then((saved) => {
        if (!active || !saved) return;
        setPushEnabled(saved !== "0");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    void AsyncStorage.setItem(CLIENT_PUSH_ENABLED_KEY, pushEnabled ? "1" : "0").catch(() => {});
  }, [pushEnabled]);


  const requestLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      // Fast path: use last known position instantly so markers appear immediately
      const last = await Location.getLastKnownPositionAsync();
      if (last) {
        setLocationSearchQuery("");
        setProviderNameSearch("");
        setProviderNameQuery("");
        setMapSearchFeedback(null);
        setUserLat(last.coords.latitude);
        setUserLng(last.coords.longitude);
        setHasLocation(true);
        flyToLocation(last.coords.latitude, last.coords.longitude);
      }

      // Then fetch accurate position in background and update if meaningfully different
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const latDiff = Math.abs(loc.coords.latitude - (last?.coords.latitude ?? 0));
      const lngDiff = Math.abs(loc.coords.longitude - (last?.coords.longitude ?? 0));
      if (!last || latDiff > 0.001 || lngDiff > 0.001) {
        setLocationSearchQuery("");
        setProviderNameSearch("");
        setProviderNameQuery("");
        setMapSearchFeedback(null);
        setUserLat(loc.coords.latitude);
        setUserLng(loc.coords.longitude);
        setHasLocation(true);
        flyToLocation(loc.coords.latitude, loc.coords.longitude);
      }

      // Reverse geocode to show city in header
      const [place] = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      setUserCity(formatCityStateLabel(place));
    } catch {
      // fallback to default coordinates
    }
  }, []);

  const searchByLocation = useCallback(async () => {
    const query = locationSearchQuery.trim();
    if (!query) {
      showToast("Digite um endereço, bairro, cidade ou estado.", "info");
      return;
    }

    try {
      const normalizedQuery = normalizeLooseSearch(query);
      const prefix = normalizedQuery.slice(0, 5);
      const attempts = [query];
      if (prefix.length === 5 && prefix !== query) {
        attempts.push(prefix);
      }

      let point: Location.LocationGeocodedLocation | null = null;
      for (const term of attempts) {
        const points = await Location.geocodeAsync(term);
        if (points.length > 0) {
          point = points[0];
          break;
        }
      }

      if (!point) {
        setMapSearchFeedback("local");
        showToast("Local não encontrado.", "info");
        setActiveMapSearchModal(null);
        return;
      }

      setProviderNameSearch("");
      setProviderNameQuery("");
      setUserLat(point.latitude);
      setUserLng(point.longitude);
      setHasLocation(true);
      clearProviderSelection();
      setMapSearchFeedback(null);
      flyToLocation(point.latitude, point.longitude);
      Keyboard.dismiss();
      setActiveMapSearchModal(null);

    } catch {
      setMapSearchFeedback("local");
      showToast("Falha ao buscar o local informado.", "error");
    }
  }, [clearProviderSelection, flyToLocation, locationSearchQuery, showToast]);

  const applyProviderNameSearch = useCallback(() => {
    const query = providerNameQuery.trim();
    if (!query) {
      setProviderNameSearch("");
      setMapSearchFeedback(null);
      setActiveMapSearchModal(null);
      clearProviderSelection();
      Keyboard.dismiss();
      
      return;
    }

    setProviderNameSearch(query);
    setMapSearchFeedback(null);
    clearProviderSelection();
    Keyboard.dismiss();
    setActiveMapSearchModal(null);
    
  }, [clearProviderSelection, providerNameQuery]);

  const loadProviders = useCallback(async (lat: number, lng: number, locationKnown: boolean) => {
    try {
      const byNameSearch = providerNameSearch.trim();
      const results = await providersApi.list(
        byNameSearch
          ? {
              q: normalizeLooseSearch(byNameSearch),
              // Scope to the current location when GPS or a location search is active
              ...(locationKnown ? { lat, lng, maxDistanceKm: filterDistanceCommitted } : {}),
            }
          : {
              lat,
              lng,
              maxDistanceKm: filterDistanceCommitted,
            }
      );
      const normalized = results.map((provider) => {
        const raw = provider as ProviderWithExtras;
        const coords = getProviderMapCoordinates(raw);
        return {
          ...provider,
          // Resolve relative media paths → full URLs for WebView and Image components
          photoUrl: resolveMediaUrl(provider.photoUrl),
          specialties: Array.isArray(raw.specialties)
            ? raw.specialties.filter((item) => typeof item === "string")
            : [],
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
        } as ProviderWithExtras;
      });

      if (byNameSearch) {
        const normalizedSearch = normalizeLooseSearch(byNameSearch);
        const fuzzyMatched = normalizedSearch.length > 0
          ? normalized.filter((provider) => normalizeLooseSearch(provider.displayName).includes(normalizedSearch))
          : normalized;
        setProviders(fuzzyMatched);
        setMapSearchFeedback(fuzzyMatched.length === 0 ? "provider" : null);
        return;
      }

      setMapSearchFeedback(null);
      setProviders(normalized);
      // Update module-level cache for instant re-entry next time
      setProvidersCache({ data: normalized, lat, lng, distanceKm: filterDistanceCommitted });
    } catch {
      // silently fail; map stays with cached/empty data
    }
  }, [filterDistanceCommitted, providerNameSearch]);

  const mapProviders = useMemo(() => {
    return providers.filter((provider) => {
      if (!providerMatchesServiceModeFilter(provider.serviceMode, filterMode)) {
        return false;
      }
      if (selectedSpecialties.length > 0) {
        const normalizedSelected = selectedSpecialties.map(normalizeSpecialty);
        const specialties = getProviderSpecialties(provider).map(normalizeSpecialty);
        if (!normalizedSelected.every((selected) => specialties.includes(selected))) {
          return false;
        }
      }
      if (selectedAcademyFilter) {
        const matchesAcademy =
          Array.isArray(provider.fixedLocations) &&
          (provider.fixedLocations as Array<{ latitude?: number | null; longitude?: number | null }>).some(
            (loc) => {
              if (typeof loc.latitude !== "number" || typeof loc.longitude !== "number") return false;
              return haversineMeters(selectedAcademyFilter.lat, selectedAcademyFilter.lon, loc.latitude, loc.longitude) <= 150;
            }
          );
        if (!matchesAcademy) return false;
      }
      return true;
    });
  }, [providers, selectedSpecialties, filterMode, selectedAcademyFilter]);

  const load = useCallback(async () => {
    // Start location and bookings concurrently; don't block the UI on both
    setLoading(true);
    setBookingsLoading(true);

    // Location runs in parallel — providers will reload when location resolves
    void requestLocation().catch(() => {});

    // Bookings fetch independently
    runWithAuth((token) => bookingsApi.me(token))
      .then((bks) => setBookings(bks))
      .catch((error) => {
        handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar agenda." });
      })
      .finally(() => setBookingsLoading(false));

    setLoading(false);
  }, [runWithAuth, showToast, requestLocation]);

  useEffect(() => { void load(); }, [load]);

  // Reload providers when location or filters change
  useEffect(() => {
    void loadProviders(userLat, userLng, hasLocation);
  }, [loadProviders, userLat, userLng, hasLocation]);

  // Contagens de não lidos — atualiza toda vez que a tela ganha foco
  useFocusEffect(
    useCallback(() => {
      runWithAuth((token) => chatApi.myChats(token))
        .then((chats) => {
          const total = chats.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
          setUnreadChatCount(total);
        })
        .catch(() => {});
      Promise.all([
        runWithAuth((token) => notificationsApi.inbox(token, 120)),
        loadSeenNotificationIds(user?.id ?? "anonymous"),
        loadDismissedNotificationIds(user?.id ?? "anonymous"),
      ])
        .then(([inbox, seen, dismissed]) =>
          setUnreadNotifCount(countUnreadNotifications(inbox, seen, dismissed))
        )
        .catch(() => {});
    }, [runWithAuth])
  );

  // Anamnesis popup — mostra uma vez por sessão após o carregamento inicial
  useEffect(() => {
    if (anamnesisPopupShownRef.current) return;
    runWithAuth((token) => userApi.myAnamnesis(token))
      .then((profile: ClientAnamnesisProfile) => {
        if (anamnesisPopupShownRef.current) return;
        anamnesisPopupShownRef.current = true;
        if (profile.status !== "COMPLETED") {
          setAnamnesisPopup("incomplete");
        } else if (profile.completedAt && isAnamnesisOutdated(profile.completedAt)) {
          setAnamnesisPopup("outdated");
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runWithAuth]);


  const openProviderModal = useCallback(async (provider: ProviderWithExtras) => {
    setSelectedProvider(provider);
    setSelectedScheduleDay(null);
    setProviderSchedulePreview(null);
    setProviderDetailLoading(true);
    setProviderScheduleLoading(true);
    try {
      const [detail, schedulePreview] = await Promise.all([
        providersApi.detail(provider.id),
        providersApi.schedulePreview(provider.id, { days: 7 }),
      ]);
      setSelectedProviderDetail(detail);
      setProviderSchedulePreview(schedulePreview);
    } catch {
      setSelectedProviderDetail(null);
      setProviderSchedulePreview(null);
    } finally {
      setProviderDetailLoading(false);
      setProviderScheduleLoading(false);
    }
  }, []);


  const navItems = [
    { key: "home", icon: "compass-outline", label: "Início" },
    { key: "bookings", icon: "calendar-clear-outline", label: "Agenda" },
    { key: "promotions", icon: "flash-outline", label: "Promoções" },
    { key: "training", icon: "barbell-outline", label: "Treino" },
    { key: "profile", icon: "person-circle-outline", label: "Perfil" },
  ];

  const visibleProviderCount = mapProviders.filter(
    (p) => typeof p.latitude === "number" && typeof p.longitude === "number"
  ).length;
  const visibleProviderLabel = visibleProviderCount === 1 ? "personal" : "personais";
  const radiusProgress = radiusSpan <= 0 ? 0 : (safeRadiusKm - MAP_RADIUS_MIN_KM) / radiusSpan;
  const radiusKnobOffset = radiusTrackWidth * radiusProgress;
  const updateRadiusFromTrack = useCallback((x: number) => {
    if (radiusTrackWidth <= 0) return;
    const clampedX = Math.max(0, Math.min(x, radiusTrackWidth));
    const raw = MAP_RADIUS_MIN_KM + (clampedX / radiusTrackWidth) * radiusSpan;
    const nextRadius = Math.max(MAP_RADIUS_MIN_KM, Math.min(MAP_RADIUS_MAX_KM, Math.round(raw)));
    setFilterDistance((prev) => {
      if (prev === nextRadius) return prev;
      setMapSearchFeedback(null);
      clearProviderSelection();
      return nextRadius;
    });
    // Debounce the API call: only commit after 600ms of no dragging
    if (filterDistanceTimerRef.current) clearTimeout(filterDistanceTimerRef.current);
    filterDistanceTimerRef.current = setTimeout(() => {
      setFilterDistanceCommitted(nextRadius);
    }, 600);
  }, [clearProviderSelection, radiusSpan, radiusTrackWidth]);
  useEffect(() => {
    void AsyncStorage.setItem(CLIENT_SEARCH_RADIUS_KEY, String(safeRadiusKm)).catch(() => {});
  }, [safeRadiusKm]);
  useEffect(() => {
    if (!hasLocation) return;
    const payload = JSON.stringify({
      lat: userLat,
      lng: userLng,
      updatedAt: new Date().toISOString(),
    });
    void AsyncStorage.setItem(CLIENT_SEARCH_CENTER_KEY, payload).catch(() => {});
  }, [hasLocation, userLat, userLng]);
  const providerModal = selectedProviderDetail ?? selectedProvider;
  const providerModalSpecialties = useMemo(() => {
    if (!providerModal) return [] as string[];
    const fromSpecialties = getProviderSpecialties(providerModal as ProviderWithExtras);
    if (fromSpecialties.length > 0) return fromSpecialties;
    if ("categoryLinks" in providerModal && Array.isArray(providerModal.categoryLinks)) {
      const fromCategories = providerModal.categoryLinks
        .map((link) => link.category?.name)
        .filter((name): name is string => Boolean(name));
      if (fromCategories.length > 0) return fromCategories;
    }
    return [] as string[];
  }, [providerModal]);
  const providerScheduleDays = useMemo(
    () => providerSchedulePreview?.days ?? [],
    [providerSchedulePreview]
  );
  const selectedSchedulePayload = useMemo(() => {
    if (!selectedScheduleDay) return null;
    return providerScheduleDays.find((day) => day.date === selectedScheduleDay) ?? null;
  }, [providerScheduleDays, selectedScheduleDay]);
  const sideMenuItems: SideMenuItem[] = [
    {
      key: "appearance",
      label: "Aparência",
      subtitle: "modo light",
      icon: lightModeEnabled ? "sunny-outline" : "moon-outline",
      right: <MvToggle value={lightModeEnabled} onValueChange={handleLightModeToggle} />,
    },
    {
      key: "notifications",
      label: "Notificações",
      subtitle: pushEnabled ? "Push ativado" : "Push desativado",
      icon: "notifications-outline",
      right: <MvToggle value={pushEnabled} onValueChange={setPushEnabled} />,
    },
    {
      key: "security",
      label: "Segurança",
      icon: "shield-checkmark-outline",
      onPress: () => { setMenuOpen(false); goToStack("Security"); },
    },
    {
      key: "support",
      label: "Suporte",
      icon: "help-circle-outline",
      onPress: () => { setMenuOpen(false); goToStack("Support"); },
    },
    {
      key: "logout",
      label: "Sair da conta",
      icon: "log-out-outline",
      danger: true,
      onPress: () => { setMenuOpen(false); void signOut(); },
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.home">
      <StatusBar
        barStyle={theme.mode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={theme.bg}
      />

      {/* Header — 3 colunas: avatar | logo centralizada | ícones */}
      <View style={{
        paddingTop: insets.top + 10,
        paddingHorizontal: 14,
        paddingBottom: 10,
        backgroundColor: isLight ? "#f2f7f4" : "#070c09",
        borderBottomWidth: 1,
        borderBottomColor: theme.borderSub,
        flexDirection: "row",
        alignItems: "center",
      }}>
        {/* Esquerda: foto de perfil (abre menu lateral) */}
        <TouchableOpacity onPress={() => setMenuOpen((open) => !open)} activeOpacity={0.85} style={{ width: 44 }}>
          <MvAvatar
            initials={clientInitials}
            size={34}
            borderRadius={11}
            color="green"
            photoUri={profilePhotoUri}
          />
        </TouchableOpacity>

        {/* Centro: logo muvify centralizada */}
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }} pointerEvents="none">
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <MvText variant="h3" style={{ color: isLight ? "#111111" : "#ddeae0", fontWeight: "800", letterSpacing: 0.2 }}>
              muvi
            </MvText>
            <MvText variant="h3" style={{ color: theme.textGreen, fontWeight: "800", letterSpacing: 0.2 }}>
              fy
            </MvText>
          </View>
        </View>

        {/* Direita: botões de chat e notificações */}
        <View style={{ flexDirection: "row", gap: 6, width: 80, justifyContent: "flex-end" }}>
          <TouchableOpacity
            onPress={() => { setUnreadChatCount(0); goToStack("ClientChatList"); }}
            style={{
              width: 34, height: 34, borderRadius: 11,
              backgroundColor: isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)",
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Ionicons name="chatbubbles-outline" size={18} color={isLight ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.6)"} />
            {unreadChatCount > 0 ? (
              <View style={{
                position: "absolute", top: -2, right: -2,
                minWidth: 16, height: 16, borderRadius: 8,
                backgroundColor: "#f44336",
                borderWidth: 1.5, borderColor: isLight ? "#f2f7f4" : "#070c09",
                alignItems: "center", justifyContent: "center",
                paddingHorizontal: 3,
              }}>
                <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700", lineHeight: 12 }}>
                  {unreadChatCount > 99 ? "99+" : String(unreadChatCount)}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setNotificationsDrawerOpen(true)}
            style={{
              width: 34, height: 34, borderRadius: 11,
              backgroundColor: isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)",
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Ionicons name="notifications-outline" size={18} color={isLight ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.6)"} />
            {unreadNotifCount > 0 ? (
              <View style={{
                position: "absolute", top: -2, right: -2,
                minWidth: 16, height: 16, borderRadius: 8,
                backgroundColor: "#f44336",
                borderWidth: 1.5, borderColor: isLight ? "#f2f7f4" : "#070c09",
                alignItems: "center", justifyContent: "center",
                paddingHorizontal: 3,
              }}>
                <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700", lineHeight: 12 }}>
                  {unreadNotifCount > 99 ? "99+" : String(unreadNotifCount)}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>
      </View>

      {/* Saudação — abaixo do header */}
      <View style={{
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 4,
        backgroundColor: isLight ? "#f2f7f4" : "#070c09",
      }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <MvText variant="h2">{greetingData.text}, {firstName}</MvText>
          <Ionicons name={greetingData.icon} size={20} color={theme.textGreen} />
        </View>
        {userCity ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 1 }}>
            <Ionicons name="location-sharp" size={11} color={theme.textGreen} />
            <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>{userCity}</MvText>
          </View>
        ) : null}
      </View>

      {menuOpen ? (
        <>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setMenuOpen(false)}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 }}
          />
          <BlurView
            intensity={isLight ? 55 : 70}
            tint={isLight ? "light" : "dark"}
            style={{
              position: "absolute",
              top: insets.top + 58,
              left: 12,
              width: 240,
              borderRadius: 16,
              overflow: "hidden",
              zIndex: 30,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.22,
              shadowRadius: 20,
              elevation: 14,
            }}
          >
            <View style={{
              borderRadius: 16,
              borderWidth: 1,
              borderColor: isLight ? "rgba(15,23,42,0.09)" : "rgba(34,197,94,0.12)",
              overflow: "hidden",
            }}>
              {sideMenuItems.map((item, index) => (
                <TouchableOpacity
                  key={item.key}
                  onPress={item.onPress}
                  disabled={Boolean(item.right)}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderTopWidth: index > 0 ? 1 : 0,
                    borderColor: isLight ? "rgba(15,23,42,0.06)" : "rgba(255,255,255,0.06)",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View style={{
                    width: 30, height: 30, borderRadius: 9,
                    backgroundColor: item.danger
                      ? "rgba(239,68,68,0.10)"
                      : isLight ? "rgba(21,128,61,0.10)" : "rgba(34,197,94,0.12)",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <Ionicons
                      name={item.icon}
                      size={16}
                      color={item.danger ? "#EF4444" : (isLight ? "#15803D" : "#22C55E")}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi2" color={item.danger ? "danger" : "primary"}>
                      {item.label}
                    </MvText>
                    {item.subtitle ? (
                      <MvText variant="body4" color="secondary">
                        {item.subtitle}
                      </MvText>
                    ) : null}
                  </View>
                  {item.right ?? null}
                </TouchableOpacity>
              ))}
            </View>
          </BlurView>
        </>
      ) : null}

      <ScrollView automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingBottom: 80 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor="#4CAF50" colors={["#4CAF50"]} />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ paddingTop: 4, gap: 8 }}>
        {/* Filter chips */}
        <ScrollView automaticallyAdjustKeyboardInsets={true}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 4, gap: 8, alignItems: "center" }}
        >
          {MODE_OPTIONS.map((opt) => {
            const active = filterMode === opt.value;
            return (
              <TouchableOpacity
                key={opt.label}
                onPress={() => {
                  
                  setMapSearchFeedback(null);
                  setFilterMode((current) => (current === opt.value ? undefined : opt.value));
                  clearProviderSelection();
                }}
                style={{
                  paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20,
                  backgroundColor: active ? "rgba(76,175,80,0.15)" : theme.chipBg,
                  borderWidth: 1, borderColor: active ? "rgba(76,175,80,0.40)" : theme.border,
                  flexDirection: "row", alignItems: "center", gap: 5,
                }}
              >
                {opt.value ? (
                  <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: pinColor(opt.value) }} />
                ) : null}
                <MvText variant="body4" style={{ color: active ? theme.textGreen : theme.text2 }}>
                  {opt.label}
                </MvText>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <ScrollView automaticallyAdjustKeyboardInsets={true}
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingVertical: 2,
            gap: 8,
            alignItems: "center",
          }}
        >
          {specialtyFilterOptions.map((specialty) => {
            const active = selectedSpecialties.includes(specialty);
            return (
              <TouchableOpacity
                key={specialty}
                onPress={() => {
                  
                  setMapSearchFeedback(null);
                  setSelectedSpecialties((prev) =>
                    prev.includes(specialty)
                      ? prev.filter((item) => item !== specialty)
                      : [...prev, specialty]
                  );
                  clearProviderSelection();
                }}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 16,
                  backgroundColor: active ? "rgba(76,175,80,0.18)" : theme.chipBg,
                  borderWidth: 1,
                  borderColor: active ? "rgba(76,175,80,0.44)" : theme.border,
                }}
              >
                <MvText variant="body4" style={{ color: active ? theme.textGreen : theme.text2 }}>
                  {specialty}
                </MvText>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Map */}
        <View style={{ height: MAP_H, overflow: "hidden", position: "relative" }}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_DEFAULT}
            style={{ flex: 1 }}
            initialRegion={{
              latitude: userLat,
              longitude: userLng,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
            showsUserLocation={hasLocation}
            showsMyLocationButton={false}
            showsCompass={false}
            rotateEnabled={false}
            onPress={() => clearProviderSelection()}
          >
            <Circle
              center={{ latitude: userLat, longitude: userLng }}
              radius={filterDistanceCommitted * 1000}
              strokeColor="#4CAF50"
              strokeWidth={1.5}
              fillColor="rgba(76,175,80,0.09)"
            />
            {mapProviders.map((provider) =>
              typeof provider.latitude === "number" && typeof provider.longitude === "number" ? (
                <Marker
                  key={provider.id}
                  coordinate={{ latitude: provider.latitude, longitude: provider.longitude }}
                  onPress={() => void openProviderModal(provider)}
                  tracksViewChanges={false}
                >
                  <ProviderMapPin provider={provider} isDark={isDark} />
                </Marker>
              ) : null
            )}
          </MapView>

          {/* Legend overlay - top right */}
          <View style={{
            position: "absolute", top: 8, right: 8,
            backgroundColor: isLight ? "rgba(255,255,255,0.92)" : "rgba(14,22,14,0.88)",
            borderRadius: 10, padding: 8, gap: 4,
            borderWidth: 1, borderColor: theme.border,
          }}>
            {[
              { color: "#4CAF50", label: "Presencial" },
              { color: "#2196F3", label: "A domicílio" },
              { color: "#FF9800", label: "Ambos" },
              { color: "#2196F3", label: "Você", userDot: true },
            ].map((item) => (
              <View key={item.label} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <View style={{
                  width: 8, height: 8, borderRadius: 4,
                  backgroundColor: item.color,
                  ...(item.userDot ? { borderWidth: 1.5, borderColor: "#fff" } : {}),
                }} />
                <MvText variant="badge" style={{ color: theme.text2, fontSize: 9 }}>{item.label}</MvText>
              </View>
            ))}
          </View>

          {/* Provider count - top left */}
          <View style={{
            position: "absolute", top: 8, left: 8,
            backgroundColor: isLight ? "rgba(255,255,255,0.92)" : "rgba(14,22,14,0.88)",
            borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5,
            borderWidth: 1, borderColor: theme.border,
            flexDirection: "row", alignItems: "center", gap: 5,
          }}>
            <Ionicons name="people-outline" size={12} color={theme.textGreen} />
            <MvText variant="badge" style={{ color: theme.textGreen, fontSize: 10 }}>
              {visibleProviderCount} {visibleProviderLabel}
            </MvText>
          </View>

          <View
            style={{
              position: "absolute",
              top: 44,
              left: 8,
              gap: 8,
              zIndex: 7,
            }}
          >
            <TouchableOpacity
              onPress={() => {
                
                setActiveMapSearchModal("location");
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
              <Ionicons name="location-outline" size={17} color={theme.text2} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                
                setActiveMapSearchModal("provider");
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
              <Ionicons name="person-outline" size={17} color={theme.text2} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setActiveMapSearchModal("academy");
                setAcademySearchText("");
              }}
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: selectedAcademyFilter !== null
                  ? "rgba(76,175,80,0.55)"
                  : theme.border,
                backgroundColor: selectedAcademyFilter !== null
                  ? "rgba(76,175,80,0.15)"
                  : isLight ? "rgba(255,255,255,0.95)" : "rgba(11,18,11,0.93)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name="fitness-outline"
                size={17}
                color={selectedAcademyFilter !== null ? theme.textGreen : theme.text2}
              />
            </TouchableOpacity>
          </View>

          {mapSearchFeedback ? (
            <View
              style={{
                position: "absolute",
                top: "50%",
                left: 14,
                right: 14,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: isLight ? "rgba(255,255,255,0.92)" : "rgba(14,22,14,0.9)",
                paddingHorizontal: 10,
                paddingVertical: 8,
                transform: [{ translateY: -16 }],
                zIndex: 11,
              }}
            >
              <MvText variant="semi3" style={{ color: theme.text3, textAlign: "center" }}>
                {mapSearchFeedback === "local" ? "local não encontrado" : "personal não encontrado"}
              </MvText>
            </View>
          ) : null}

          {activeMapSearchModal === "location" || activeMapSearchModal === "provider" ? (
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setActiveMapSearchModal(null)}
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                backgroundColor: "rgba(0,0,0,0.22)",
                alignItems: "flex-start",
                justifyContent: "flex-start",
                paddingTop: 44,
                paddingLeft: 48,
                zIndex: 20,
              }}
            >
              <TouchableOpacity
                activeOpacity={1}
                onPress={() => {}}
                style={{
                  width: "72%",
                  minWidth: 210,
                  maxWidth: 290,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: isLight ? "rgba(255,255,255,0.98)" : "rgba(11,18,11,0.96)",
                  paddingHorizontal: 10,
                  paddingVertical: 9,
                  gap: 8,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons
                    name={activeMapSearchModal === "location" ? "location-outline" : "person-outline"}
                    size={16}
                    color={theme.text2}
                  />
                  <TextInput
                    autoFocus
                    value={activeMapSearchModal === "location" ? locationSearchQuery : providerNameQuery}
                    onChangeText={activeMapSearchModal === "location" ? setLocationSearchQuery : setProviderNameQuery}
                    onSubmitEditing={() => {
                      if (activeMapSearchModal === "location") {
                        void searchByLocation();
                      } else {
                        applyProviderNameSearch();
                      }
                    }}
                    placeholder={activeMapSearchModal === "location" ? "Buscar local" : "Buscar personal"}
                    placeholderTextColor={theme.text3}
                    returnKeyType="search"
                    style={{ flex: 1, color: theme.inputText, fontSize: 12, padding: 0 }}
                  />
                  <TouchableOpacity
                    onPress={() => {
                      if (activeMapSearchModal === "location") {
                        void searchByLocation();
                      } else {
                        applyProviderNameSearch();
                      }
                    }}
                  >
                    <Ionicons name="arrow-forward-circle-outline" size={18} color={theme.textGreen} />
                  </TouchableOpacity>
                </View>

                {/* Sugestões de localização — Nominatim autocomplete */}
                {activeMapSearchModal === "location" && (locationSuggestions.length > 0 || locationSuggestionsLoading) ? (
                  <View style={{ marginTop: 4, gap: 0, borderWidth: 1, borderColor: theme.border, borderRadius: 9, overflow: "hidden" }}>
                    {locationSuggestionsLoading && locationSuggestions.length === 0 ? (
                      <ActivityIndicator color="#4CAF50" style={{ paddingVertical: 8 }} />
                    ) : (
                      locationSuggestions.map((s, idx) => (
                        <TouchableOpacity
                          key={s.placeId ?? `loc-${s.lat}-${s.lon}-${idx}`}
                          onPress={() => {
                            if (s.placeId && s.lat === 0) {
                              setLocationSearchQuery(s.displayName.split(",").slice(0, 2).join(", "));
                              setActiveMapSearchModal(null);
                              Keyboard.dismiss();
                              fetchGooglePlaceCoords(s.placeId).then((coords) => {
                                if (coords) selectLocationSuggestion(coords.lat, coords.lon, s.displayName);
                              });
                            } else {
                              selectLocationSuggestion(s.lat, s.lon, s.displayName);
                            }
                          }}
                          style={{
                            flexDirection: "row", alignItems: "center", gap: 7,
                            paddingHorizontal: 10, paddingVertical: 9,
                            borderTopWidth: idx > 0 ? 1 : 0,
                            borderColor: theme.borderSub,
                            backgroundColor: isLight ? "#ffffff" : "#0b120b",
                          }}
                        >
                          <Ionicons name="location-outline" size={13} color={theme.textGreen} />
                          <MvText variant="body4" color="secondary" numberOfLines={2} style={{ flex: 1, fontSize: 11 }}>
                            {s.displayName}
                          </MvText>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                ) : null}

                {/* Sugestões de personal — filtra a lista carregada */}
                {activeMapSearchModal === "provider" && providerSuggestions.length > 0 ? (
                  <View style={{ marginTop: 4, gap: 0, borderWidth: 1, borderColor: theme.border, borderRadius: 9, overflow: "hidden" }}>
                    {providerSuggestions.map((p, idx) => (
                      <TouchableOpacity
                        key={`prov-${p.id}`}
                        onPress={() => selectProviderSuggestion(p)}
                        style={{
                          flexDirection: "row", alignItems: "center", gap: 7,
                          paddingHorizontal: 10, paddingVertical: 8,
                          borderTopWidth: idx > 0 ? 1 : 0,
                          borderColor: theme.borderSub,
                          backgroundColor: isLight ? "#ffffff" : "#0b120b",
                        }}
                      >
                        <Ionicons name="person-outline" size={13} color={theme.textGreen} />
                        <MvText variant="body4" numberOfLines={1} style={{ flex: 1, fontSize: 11 }}>
                          {p.displayName}
                        </MvText>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}

                {activeMapSearchModal === "provider" && providerNameSearch ? (
                  <TouchableOpacity
                    style={{ alignSelf: "flex-end", paddingHorizontal: 2 }}
                    onPress={() => {
                      setProviderNameQuery("");
                      setProviderNameSearch("");
                      setMapSearchFeedback(null);
                      setActiveMapSearchModal(null);
                      clearProviderSelection();
                    }}
                  >
                    <MvText variant="body4" style={{ color: theme.text3 }}>
                      Limpar
                    </MvText>
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            </TouchableOpacity>
          ) : null}

          {/* Academy filter — moved to RN Modal below to avoid VirtualizedList-in-ScrollView warning */}

          {!hasLocation ? (
            <View style={{
              position: "absolute", bottom: 8, left: 8,
              backgroundColor: isLight ? "rgba(255,255,255,0.92)" : "rgba(14,22,14,0.88)",
              borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5,
              borderWidth: 1, borderColor: theme.border,
              flexDirection: "row", alignItems: "center", gap: 5,
            }}>
              <Ionicons name="locate-outline" size={11} color={theme.text3} />
              <MvText variant="badge" style={{ color: theme.text3, fontSize: 9 }}>Localização padrão</MvText>
            </View>
          ) : null}

          {/* GPS re-center button - bottom right */}
          <TouchableOpacity
            onPress={() => void requestLocation()}
            style={{
              position: "absolute", bottom: 8, right: 8,
              width: 36, height: 36, borderRadius: 10,
              backgroundColor: isLight ? "rgba(255,255,255,0.92)" : "rgba(14,22,14,0.88)",
              borderWidth: 1, borderColor: hasLocation ? "rgba(76,175,80,0.40)" : theme.border,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Ionicons name="locate" size={18} color={hasLocation ? "#4CAF50" : theme.text2} />
          </TouchableOpacity>

          {/* Academy filter — Google Places autocomplete */}
          {activeMapSearchModal === "academy" ? (
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => { setActiveMapSearchModal(null); setAcademySearchText(""); }}
              style={{
                position: "absolute",
                top: 0, right: 0, bottom: 0, left: 0,
                backgroundColor: "rgba(0,0,0,0.22)",
                alignItems: "flex-start",
                justifyContent: "flex-start",
                paddingTop: 44,
                paddingLeft: 48,
                zIndex: 20,
              }}
            >
              <TouchableOpacity
                activeOpacity={1}
                onPress={() => {}}
                style={{
                  width: "72%",
                  minWidth: 210,
                  maxWidth: 290,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: isLight ? "rgba(255,255,255,0.98)" : "rgba(11,18,11,0.96)",
                  paddingHorizontal: 10,
                  paddingVertical: 9,
                  gap: 6,
                  maxHeight: 300,
                }}
              >
                {/* Header */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="fitness-outline" size={15} color={theme.text2} />
                    <MvText variant="semi3" style={{ fontSize: 12 }}>Buscar academia</MvText>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {selectedAcademyFilter ? (
                      <TouchableOpacity onPress={() => { setSelectedAcademyFilter(null); setAcademySearchText(""); }}>
                        <MvText variant="body4" style={{ color: theme.textGreen, fontSize: 11 }}>
                          Limpar
                        </MvText>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity onPress={() => { setActiveMapSearchModal(null); setAcademySearchText(""); }}>
                      <Ionicons name="close" size={16} color={theme.text3} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Academia selecionada atual */}
                {selectedAcademyFilter ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(76,175,80,0.12)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: "rgba(76,175,80,0.30)" }}>
                    <Ionicons name="checkmark-circle" size={14} color={theme.textGreen} />
                    <MvText variant="body4" style={{ color: theme.textGreen, flex: 1, fontSize: 11 }} numberOfLines={2}>
                      {selectedAcademyFilter.name}
                    </MvText>
                  </View>
                ) : null}

                {/* Campo de busca */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme.border, borderRadius: 8, backgroundColor: theme.inputBg, paddingHorizontal: 8, paddingVertical: 5 }}>
                  <Ionicons name="search-outline" size={13} color={theme.text3} />
                  <TextInput
                    autoFocus
                    value={academySearchText}
                    onChangeText={setAcademySearchText}
                    placeholder="Ex.: Smart Fit, Bodytech..."
                    placeholderTextColor={theme.text3}
                    style={{ flex: 1, color: theme.inputText, fontSize: 11, padding: 0 }}
                  />
                  {academySearchText ? (
                    <TouchableOpacity onPress={() => setAcademySearchText("")}>
                      <Ionicons name="close-circle" size={13} color={theme.text3} />
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Sugestões do Google Places */}
                {academySuggestionsLoading && academySuggestions.length === 0 ? (
                  <ActivityIndicator color="#4CAF50" style={{ paddingVertical: 8 }} />
                ) : academySuggestions.length > 0 ? (
                  <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 9, overflow: "hidden" }}>
                    {academySuggestions.map((s, idx) => (
                      <TouchableOpacity
                        key={s.placeId ?? `academy-${s.lat}-${s.lon}-${idx}`}
                        onPress={() => {
                          const apply = (lat: number, lon: number) => {
                            setSelectedAcademyFilter({ name: s.name, lat, lon });
                            setAcademySearchText("");
                            setActiveMapSearchModal(null);
                          };
                          if (s.placeId && s.lat === 0) {
                            fetchGooglePlaceCoords(s.placeId).then((coords) => {
                              if (coords) apply(coords.lat, coords.lon);
                            });
                          } else {
                            apply(s.lat, s.lon);
                          }
                        }}
                        style={{
                          flexDirection: "row", alignItems: "center", gap: 7,
                          paddingHorizontal: 10, paddingVertical: 9,
                          borderTopWidth: idx > 0 ? 1 : 0,
                          borderColor: theme.borderSub,
                          backgroundColor: isLight ? "#ffffff" : "#0b120b",
                        }}
                      >
                        <Ionicons name="fitness-outline" size={13} color={theme.textGreen} />
                        <View style={{ flex: 1 }}>
                          <MvText variant="body4" numberOfLines={1} style={{ fontSize: 11 }}>{s.name}</MvText>
                          {s.address ? (
                            <MvText variant="body4" color="secondary" numberOfLines={1} style={{ fontSize: 10 }}>
                              {s.address.replace(/, Brasil$/, "").replace(/, Brazil$/, "")}
                            </MvText>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : academySearchText.trim().length >= 2 && !academySuggestionsLoading ? (
                  <MvText variant="body4" color="secondary" style={{ textAlign: "center", paddingVertical: 8, fontSize: 11 }}>
                    Nenhuma academia encontrada. Tente um nome diferente.
                  </MvText>
                ) : !selectedAcademyFilter ? (
                  <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>
                    Digite o nome da academia para encontrar personais que atendem lá.
                  </MvText>
                ) : null}
              </TouchableOpacity>
            </TouchableOpacity>
          ) : null}

        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <MvText variant="semi3">Raio de busca</MvText>
            <MvText variant="semi3" style={{ color: theme.textGreen }}>{safeRadiusKm} km</MvText>
          </View>
          <View
            onLayout={(event) => setRadiusTrackWidth(event.nativeEvent.layout.width)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(event) => updateRadiusFromTrack(event.nativeEvent.locationX)}
            onResponderMove={(event) => updateRadiusFromTrack(event.nativeEvent.locationX)}
            style={{ height: 34, justifyContent: "center" }}
          >
            <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.border }} />
            <View
              style={{
                position: "absolute",
                left: 0,
                width: radiusKnobOffset,
                height: 4,
                borderRadius: 2,
                backgroundColor: "#4CAF50",
              }}
            />
            <View
              style={{
                position: "absolute",
                left: Math.max(0, Math.min(radiusTrackWidth, radiusKnobOffset)) - 10,
                width: 20,
                height: 20,
                borderRadius: 10,
                backgroundColor: "#4CAF50",
                borderWidth: 2,
                borderColor: "#FFFFFF",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.22,
                shadowRadius: 5,
                elevation: 4,
              }}
            />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: -3 }}>
            <MvText variant="body4" color="secondary">1 km</MvText>
            <MvText variant="body4" color="secondary">5 km</MvText>
            <MvText variant="body4" color="secondary">10 km</MvText>
          </View>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        {/* Banner - próximo treino */}
        <View style={{
          borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1,
          backgroundColor: isLight ? "rgba(46,125,50,0.05)" : "rgba(46,125,50,0.22)",
          borderColor: isLight ? "rgba(76,175,80,0.22)" : "rgba(76,175,80,0.32)",
        }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <MvText variant="caption" color="secondary">PRÓXIMO TREINO</MvText>
            {nextBooking ? (
              <MvBadge
                label={nextBooking.status === "CONFIRMED" ? "Confirmado" : "Pendente"}
                variant={nextBooking.status === "CONFIRMED" ? "green" : "orange"}
              />
            ) : null}
          </View>
          {nextBooking ? (
            <>
              <MvText variant="h2">{nextBooking.provider?.displayName ?? "Seu personal"}</MvText>
              <MvText variant="body3" color="secondary" style={{ marginTop: 4 }}>
                {formatBookingDate(nextBooking.scheduledAt)}
              </MvText>
            </>
          ) : (
            <>
              <MvText variant="semi1">Nenhum treino agendado</MvText>
              <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
                Encontre um personal e agende sua sessão.
              </MvText>
            </>
          )}
        </View>

        {/* Stats */}
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
          {[
            { value: String(monthlyCompleted), label: "Treinos no mês" },
            { value: String(bookings.filter((b) => b.status === "CONFIRMED").length), label: "Confirmados" },
          ].map((s) => (
            <MvCard key={s.label} style={{ flex: 1, alignItems: "center", gap: 2, paddingVertical: 14 }}>
              <MvText variant="h1" color="green">{s.value}</MvText>
              <MvText variant="body4" color="tertiary" style={{ textAlign: "center" }}>{s.label}</MvText>
            </MvCard>
          ))}
        </View>

        {/* Categories */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <MvText variant="semi1">Categorias</MvText>
          <TouchableOpacity onPress={() => navigation.navigate("Categories")}>
            <MvText variant="semi3" color="green">Ver todas</MvText>
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -3 }}>
          {categories.map((cat) => (
            <View key={cat.id} style={{ width: "25%", paddingHorizontal: 3, marginBottom: 6 }}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => goToStack("ProfessionalsList", { query: cat.name })}
                style={{
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.cardBg,
                  paddingVertical: 10,
                  paddingHorizontal: 4,
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 76,
                }}
              >
                <View style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  backgroundColor: isLight ? "rgba(34,197,94,0.10)" : "rgba(34,197,94,0.12)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 5,
                }}>
                  <Ionicons name={cat.icon} size={15} color={theme.textGreen} />
                </View>
                <MvText
                  variant="body4"
                  style={{ textAlign: "center", fontSize: 9.5, lineHeight: 12 }}
                  numberOfLines={2}
                >
                  {SPECIALTY_SHORT_NAMES[cat.name] ?? cat.name}
                </MvText>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </View>
      </ScrollView>

      <Modal
        visible={Boolean(providerModal)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          clearProviderSelection();
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
          }}
        >
          <Pressable
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
            onPress={() => {
              clearProviderSelection();
            }}
          />
          <View
            style={{
              width: "100%",
              maxWidth: 430,
              maxHeight: "86%",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.bg,
              padding: 14,
              gap: 10,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <MvText variant="semi2">Resumo do personal</MvText>
              <TouchableOpacity
                onPress={() => {
                  clearProviderSelection();
                }}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.chipBg,
                  borderWidth: 1,
                  borderColor: theme.border,
                }}
              >
                <Ionicons name="close" size={15} color={theme.text2} />
              </TouchableOpacity>
            </View>

            {providerDetailLoading ? (
              <MvText variant="body4" color="secondary">Carregando dados do personal...</MvText>
            ) : providerModal ? (
              <ScrollView automaticallyAdjustKeyboardInsets={true}
                showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}
                contentContainerStyle={{ gap: 10, paddingBottom: 4 }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <MvAvatar
                    initials={getInitials(providerModal.displayName)}
                    photoUri={resolveMediaUrl(providerModal.photoUrl)}
                    size={68}
                    borderRadius={34}
                    color="green"
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <MvText variant="h3">{providerModal.displayName}</MvText>
                    <MvText variant="body4" color="secondary">
                      Idade: {typeof providerModal.age === "number" && providerModal.age > 0 ? `${providerModal.age} anos` : "Não informada"}
                    </MvText>
                    <MvText variant="semi3" style={{ color: theme.textGreen }}>
                      Aula presencial: {formatPrice(providerModal.priceCents)}
                    </MvText>
                  </View>
                </View>

                {selectedProviderDetail?.presentationVideoUrl ? (
                  <View style={{ gap: 6 }}>
                    <MvText variant="semi3">Vídeo de apresentação</MvText>
                    <MvVideoPlayer
                      url={resolveMediaUrl(selectedProviderDetail.presentationVideoUrl) ?? ""}
                      height={170}
                      borderRadius={10}
                    />
                  </View>
                ) : null}

                <View
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 12,
                    backgroundColor: theme.cardBg,
                    padding: 10,
                    gap: 8,
                  }}
                >
                  <MvText variant="semi3">Especialidades</MvText>
                  {providerModalSpecialties.length > 0 ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {providerModalSpecialties.slice(0, 8).map((item) => (
                        <View
                          key={item}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: "rgba(76,175,80,0.28)",
                            backgroundColor: "rgba(76,175,80,0.12)",
                          }}
                        >
                          <MvText variant="body4" style={{ color: theme.textGreen, fontSize: 11 }}>
                            {item}
                          </MvText>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <MvText variant="body4" color="secondary">Especialidades não informadas.</MvText>
                  )}
                </View>

                <View
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 12,
                    backgroundColor: theme.cardBg,
                    padding: 10,
                    gap: 8,
                  }}
                >
                  <MvText variant="semi3">Disponibilidade dos próximos 7 dias</MvText>
                  {providerScheduleLoading ? (
                    <MvText variant="body4" color="secondary">Carregando disponibilidade...</MvText>
                  ) : providerScheduleDays.length > 0 ? (
                    <>
                      <ScrollView automaticallyAdjustKeyboardInsets={true}
                        horizontal
                        showsHorizontalScrollIndicator
                        contentContainerStyle={{ gap: 6, paddingVertical: 2 }}
                      >
                        {providerScheduleDays.map((day) => {
                          const active = selectedScheduleDay === day.date;
                          const statusColor =
                            day.occupiedSlots.length > 0
                              ? "#f44336"
                              : day.availableSlots.length > 0
                                ? "#4CAF50"
                                : theme.text3;
                          return (
                            <TouchableOpacity
                              key={day.date}
                              onPress={() => setSelectedScheduleDay(day.date)}
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                borderRadius: 14,
                                borderWidth: 1,
                                borderColor: active ? "rgba(76,175,80,0.45)" : theme.border,
                                backgroundColor: active ? "rgba(76,175,80,0.15)" : theme.inputBg,
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <View
                                style={{
                                  width: 7,
                                  height: 7,
                                  borderRadius: 3.5,
                                  backgroundColor: statusColor,
                                }}
                              />
                              <MvText
                                variant="body4"
                                style={{ color: active ? theme.textGreen : theme.text2, fontSize: 11 }}
                              >
                                {day.label}
                              </MvText>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>

                      {selectedSchedulePayload ? (
                        <View
                          style={{
                            borderWidth: 1,
                            borderColor: theme.border,
                            borderRadius: 10,
                            backgroundColor: theme.bg,
                            padding: 10,
                            gap: 8,
                          }}
                        >
                          <TouchableOpacity
                            onPress={() => setSelectedScheduleDay(null)}
                            style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                          >
                            <Ionicons name="arrow-back-outline" size={14} color={theme.text2} />
                            <MvText variant="body4" color="secondary">
                              Voltar para escolher outro dia
                            </MvText>
                          </TouchableOpacity>

                          <MvText variant="semi3">{selectedSchedulePayload.label}</MvText>

                          <MvText variant="body4" style={{ color: "#4CAF50" }}>
                            Horários disponíveis
                          </MvText>
                          {selectedSchedulePayload.availableSlots.length > 0 ? (
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                              {selectedSchedulePayload.availableSlots.map((slot) => (
                                <View
                                  key={`free-${slot}`}
                                  style={{
                                    borderRadius: 12,
                                    borderWidth: 1,
                                    borderColor: "rgba(76,175,80,0.35)",
                                    backgroundColor: "rgba(76,175,80,0.12)",
                                    paddingHorizontal: 8,
                                    paddingVertical: 4,
                                  }}
                                >
                                  <MvText variant="badge" style={{ color: "#4CAF50", fontSize: 10 }}>
                                    {slot}
                                  </MvText>
                                </View>
                              ))}
                            </View>
                          ) : (
                            <MvText variant="body4" color="secondary">Nenhum horário livre nesse dia.</MvText>
                          )}

                          <MvText variant="body4" style={{ color: "#f44336" }}>
                            Horários ocupados
                          </MvText>
                          {selectedSchedulePayload.occupiedSlots.length > 0 ? (
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                              {selectedSchedulePayload.occupiedSlots.map((slot) => (
                                <View
                                  key={`busy-${slot}`}
                                  style={{
                                    borderRadius: 12,
                                    borderWidth: 1,
                                    borderColor: "rgba(244,67,54,0.35)",
                                    backgroundColor: "rgba(244,67,54,0.12)",
                                    paddingHorizontal: 8,
                                    paddingVertical: 4,
                                  }}
                                >
                                  <MvText variant="badge" style={{ color: "#f44336", fontSize: 10 }}>
                                    {slot}
                                  </MvText>
                                </View>
                              ))}
                            </View>
                          ) : (
                            <MvText variant="body4" color="secondary">Nenhum horário ocupado nesse dia.</MvText>
                          )}
                        </View>
                      ) : (
                        <MvText variant="body4" color="secondary">
                          Toque em um dia para ver horários disponíveis (verde) e ocupados (vermelho).
                        </MvText>
                      )}
                    </>
                  ) : (
                    <MvText variant="body4" color="secondary">
                      Horários não informados.
                    </MvText>
                  )}
                </View>
              </ScrollView>
            ) : null}

            {providerModal ? (
              <MvButton
                label="Agendar"
                onPress={() => {
                  const providerId = providerModal.id;
                  clearProviderSelection();
                  goToStack("CreateBooking", { professionalId: providerId });
                }}
              />
            ) : null}
          </View>
        </View>
      </Modal>

      <MvBottomNav
        items={navItems}
        activeKey="home"
        onPress={(key) => {
          if (key === "bookings") navigation.navigate("ClientBookings");
          if (key === "promotions") navigation.navigate("Promotions");
          if (key === "training") navigation.navigate("MyTraining");
          if (key === "profile") navigation.navigate("ClientProfile");
        }}
      />

      {/* Popup de anamnese — incompleta ou desatualizada */}
      <Modal
        visible={anamnesisPopup !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAnamnesisPopup(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.62)", justifyContent: "center", alignItems: "center", padding: 24 }}
          onPress={() => setAnamnesisPopup(null)}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{
            width: "100%",
            maxWidth: 360,
            borderRadius: 20,
            overflow: "hidden",
            backgroundColor: isDark ? "#0c1a0e" : "#ffffff",
            borderWidth: 1,
            borderColor: isDark ? "rgba(34,197,94,0.22)" : "rgba(34,197,94,0.15)",
          }}>
            {/* Header com ícone e título */}
            <View style={{
              backgroundColor: isDark ? "rgba(34,197,94,0.09)" : "rgba(34,197,94,0.07)",
              borderBottomWidth: 1,
              borderBottomColor: isDark ? "rgba(34,197,94,0.16)" : "rgba(34,197,94,0.10)",
              padding: 24,
              alignItems: "center",
              gap: 10,
            }}>
              <View style={{
                width: 56, height: 56, borderRadius: 16,
                backgroundColor: isDark ? "rgba(34,197,94,0.14)" : "rgba(34,197,94,0.11)",
                alignItems: "center", justifyContent: "center",
              }}>
                <Ionicons
                  name={anamnesisPopup === "outdated" ? "clipboard-outline" : "pulse-outline"}
                  size={28}
                  color="#22C55E"
                />
              </View>
              <MvText variant="h3" style={{ textAlign: "center" }}>
                {anamnesisPopup === "outdated" ? "Atualize sua ficha de saúde" : "Preencha sua ficha de saúde"}
              </MvText>
              <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
                {anamnesisPopup === "outdated"
                  ? "Última atualização há mais de 6 meses"
                  : "Necessário para agendar com personais"}
              </MvText>
            </View>

            {/* Corpo com descrição e ações */}
            <View style={{ padding: 20, gap: 10 }}>
              <MvText variant="body3" color="secondary" style={{ textAlign: "center", lineHeight: 22 }}>
                {anamnesisPopup === "outdated"
                  ? "Manter a ficha em dia ajuda seu personal a adaptar os treinos com mais segurança e precisão."
                  : "É rápido e garante um atendimento totalmente personalizado para o seu perfil!"}
              </MvText>

              <TouchableOpacity
                onPress={() => {
                  setAnamnesisPopup(null);
                  goToStack("ClientAnamnesis");
                }}
                style={{
                  marginTop: 4,
                  paddingVertical: 14,
                  borderRadius: 12,
                  backgroundColor: "#22C55E",
                  alignItems: "center",
                }}
              >
                <MvText variant="semi2" style={{ color: "#fff" }}>
                  {anamnesisPopup === "outdated" ? "Atualizar ficha agora" : "Preencher ficha agora"}
                </MvText>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setAnamnesisPopup(null)}
                style={{ paddingVertical: 10, alignItems: "center" }}
              >
                <MvText variant="body4" color="tertiary">
                  {anamnesisPopup === "outdated" ? "Lembrar depois" : "Agora não"}
                </MvText>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <ClientNotificationsDrawer
        visible={notificationsDrawerOpen}
        navigation={navigation.getParent<any>() ?? navigation}
        onClose={() => setNotificationsDrawerOpen(false)}
        onUnreadCountChange={setUnreadNotifCount}
      />
    </View>
  );
}
