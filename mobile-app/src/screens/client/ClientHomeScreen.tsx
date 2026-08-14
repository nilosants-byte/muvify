import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { useFocusEffect } from "@react-navigation/native";
import { ClientNotificationsDrawer } from "./components/ClientNotificationsDrawer";
import { ClientHomeDrawer, SideMenuItem } from "./components/ClientHomeDrawer";
import { ClientHomeFilters } from "./components/ClientHomeFilters";
import { ClientHomeMapSection, ProviderWithExtras, MapSearchModal } from "./components/ClientHomeMapSection";
import { ClientProviderCard } from "./components/ClientProviderCard";
import {
  countUnreadNotifications,
  loadDismissedNotificationIds,
} from "../../utils/notificationsReadState";
import { usePlaceSuggestions } from "../../hooks/usePlaceSuggestions";
import { useGooglePlacesSearch } from "../../hooks/useGooglePlacesSearch";
import {
  Keyboard,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { ClientTabParamList } from "../../navigation/route-types";
import {
  authApi,
  bookingsApi,
  Booking,
  chatApi,
  ClientAnamnesisProfile,
  communityApi as communityApiImport,
  gamificationApi,
  notificationsApi,
  PROFESSIONAL_SPECIALTIES,
  providersApi,
  ProviderDetail,
  ProviderSchedulePreview,
  ProviderServiceMode,
  userApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvToggle } from "../../components/mv";
import { SkeletonClientHomeScreen } from "../../components/polish/SkeletonCard";
import { handleScreenError } from "../shared/api-helpers";
import { resolveMediaUrl } from "../../utils/media";
import { ClientBottomNavV2 } from "../../components/navigation/ClientBottomNavV2";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { hapticRefresh, hapticCta } from "../../utils/haptics";
import { computeUserProgress, computeAchievements } from "../../utils/gamification";

type Props = BottomTabScreenProps<ClientTabParamList, "ClientHome">;

type WeatherIconData = { name: keyof typeof Ionicons.glyphMap; color: string };

function getWeatherIcon(code: number, isNight: boolean): WeatherIconData {
  if (code === 0)  return isNight ? { name: "moon",         color: "#94A3B8" } : { name: "sunny",        color: "#F5A623" };
  if (code === 1)  return isNight ? { name: "moon-outline", color: "#94A3B8" } : { name: "partly-sunny", color: "#F5A623" };
  if (code === 2)  return isNight ? { name: "cloudy-night-outline", color: "#9CA3AF" } : { name: "partly-sunny", color: "#9CA3AF" };
  if (code === 3)  return { name: "cloudy",       color: "#9CA3AF" };
  if (code >= 45 && code <= 48) return { name: "cloudy",       color: "#9CA3AF" };
  if (code >= 51 && code <= 67) return { name: "rainy",        color: "#60A5FA" };
  if (code >= 71 && code <= 77) return { name: "snow-outline", color: "#BAE6FD" };
  if (code >= 80 && code <= 82) return { name: "rainy",        color: "#60A5FA" };
  if (code >= 95 && code <= 99) return { name: "thunderstorm", color: "#818CF8" };
  return isNight ? { name: "moon", color: "#94A3B8" } : { name: "sunny", color: "#F5A623" };
}

function clientTimeBasedWeatherIcon(): WeatherIconData {
  const h = new Date().getHours();
  return h < 6 || h >= 19 ? { name: "moon", color: "#94A3B8" } : { name: "sunny", color: "#F5A623" };
}

function clientIsNightTime() {
  const h = new Date().getHours();
  return h < 6 || h >= 19;
}

const DEFAULT_LAT = -23.5505;
const DEFAULT_LNG = -46.6333;

// Module-level cache: persists between screen navigations so stale data shows immediately
// while a fresh fetch runs in the background.
const _providersCache: { data: ProviderWithExtras[]; lat: number; lng: number; distanceKm: number } | null =
  (globalThis as any).__mvProvidersCache ?? null;
function setProvidersCache(value: typeof _providersCache) {
  (globalThis as any).__mvProvidersCache = value;
}

// Radius cache: same pattern — prevents the 3 km default from firing a useless first fetch
// every time the user navigates back to this screen.
function getCachedRadiusKm(): number {
  const cached = (globalThis as any).__mvLastSearchRadiusKm;
  return typeof cached === "number" && cached >= 1 && cached <= 10 ? cached : 3;
}

const CLIENT_SEARCH_RADIUS_KEY = "@personalapp/clientSearchRadiusKm";
const CLIENT_SEARCH_CENTER_KEY = "@personalapp/clientSearchCenter";
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
  const completed = new Date(completedAt);
  const threshold = new Date(completed);
  threshold.setMonth(threshold.getMonth() + 6);
  return new Date() >= threshold;
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



export function ClientHomeScreen({ navigation }: Props) {
  const {
    runWithAuth, showToast, signOut, user, setCurrentUser, role,
    pushNotificationsEnabled, setPushNotificationsPreference
  } = useAppState();
  const { theme, isDark, toggleTheme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const isLight = theme.mode === "light";
  const mapRef = useRef<import("react-native-maps").default>(null);

  // Raio-X de pagamentos, Rodada 4, Lote 11: o único aviso de e-mail não
  // verificado ficava dentro de Configurações — quem não entrasse lá por
  // conta própria nunca via o aviso. Banner replicado aqui, no topo da home.
  const [resendingVerificationHome, setResendingVerificationHome] = useState(false);
  async function handleResendVerificationHome() {
    setResendingVerificationHome(true);
    try {
      await runWithAuth((token) => authApi.resendVerificationEmail(token));
      showToast("E-mail de verificação reenviado. Confira sua caixa de entrada.", "success");
    } catch {
      showToast("Não foi possível reenviar o e-mail agora. Tente novamente mais tarde.", "error");
    } finally {
      setResendingVerificationHome(false);
    }
  }

  const bookingsQuery = useAuthQuery(
    queryKeys.bookings.me(),
    (token) => bookingsApi.me(token),
  );
  const bookings = bookingsQuery.data ?? ([] as Booking[]);
  // Frente 10 (segunda camada), Lote 1: sem isso, todo cold start (ou volta
  // de background) mostrava "Nenhum treino agendado" por um instante -
  // bookingsQuery.data começa undefined, e o "?? []" acima escondia a
  // diferença entre "ainda carregando" e "de fato não tem nada". Mesmo
  // padrão já usado em ProfessionalHomeScreen.tsx (loading/loadError).
  const homeLoading = bookingsQuery.isLoading;
  const homeLoadError = bookingsQuery.isError;
  // Initialize from module-level cache so re-entering the screen shows data immediately
  const [providers, setProviders] = useState<ProviderWithExtras[]>(
    () => (globalThis as any).__mvProvidersCache?.data ?? []
  );
  const [userLat, setUserLat] = useState(DEFAULT_LAT);
  const [userLng, setUserLng] = useState(DEFAULT_LNG);
  const [hasLocation, setHasLocation] = useState(false);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
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
  const [filterDistance, setFilterDistance] = useState<number>(getCachedRadiusKm);
  const [filterDistanceCommitted, setFilterDistanceCommitted] = useState<number>(getCachedRadiusKm);
  // True once the persisted radius has been read from AsyncStorage (or confirmed absent).
  // Prevents: (a) the provider fetch starting with a stale/default radius, and
  //           (b) the save effect overwriting the stored value on mount.
  const [radiusReady, setRadiusReady] = useState<boolean>(
    () => typeof (globalThis as any).__mvLastSearchRadiusKm === "number"
  );
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [anamnesisPopup, setAnamnesisPopup] = useState<"incomplete" | "outdated" | null>(null);
  const [anamnesisStatus, setAnamnesisStatus] = useState<"incomplete" | "outdated" | null>(null);
  const anamnesisPopupShownRef = useRef(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [notificationsDrawerOpen, setNotificationsDrawerOpen] = useState(false);
  const [apelidoModalVisible, setApelidoModalVisible] = useState(false);
  const [apelidoDraft, setApelidoDraft] = useState("");
  const [apelidoSaving, setApelidoSaving] = useState(false);
  // Seguidores que ainda não seguimos de volta
  const [newFollowers, setNewFollowers] = useState<import("../../services/api/client").CommunityUser[]>([]);
  const [followBackIds, setFollowBackIds] = useState<Set<string>>(new Set());
  const [weatherIcon, setWeatherIcon] = useState<WeatherIconData>(clientTimeBasedWeatherIcon);
  const lightModeEnabled = !isDark;
  const safeRadiusKm = Math.max(1, Math.min(10, Math.round(filterDistance)));

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
  const nextBooking = useMemo(
    () => bookings
      .filter((b) => b.status === "PENDING" || b.status === "CONFIRMED")
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0],
    [bookings]
  );
  const greetingSubtitle = useMemo(() => {
    if (!nextBooking) return userCity ?? "Explore personais na sua região";
    const date = new Date(nextBooking.scheduledAt);
    const today = new Date();
    const isToday =
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
    const timeStr = date.toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
    });
    if (isToday) {
      const aulasHoje = bookings.filter((b) => {
        if (b.status !== "PENDING" && b.status !== "CONFIRMED") return false;
        const d = new Date(b.scheduledAt);
        return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
      }).length;
      return aulasHoje > 1
        ? `Você tem ${aulasHoje} aulas hoje — próxima às ${timeStr}`
        : `Você tem 1 aula hoje às ${timeStr}`;
    }
    return `Próxima aula: ${nextBooking.provider?.displayName ?? "seu personal"}`;
  }, [nextBooking, userCity, bookings]);
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
        if (!active) return;
        if (savedRadius) {
          const parsed = Number(savedRadius);
          if (Number.isFinite(parsed)) {
            const nextRadius = Math.max(1, Math.min(10, Math.round(parsed)));
            setFilterDistance(nextRadius);
            setFilterDistanceCommitted(nextRadius);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setRadiusReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const requestLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { setLocationPermissionDenied(true); return; }
      setLocationPermissionDenied(false);

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

      // Fetch real-time weather with 5s timeout
      try {
        const controller = new AbortController();
        const weatherTimeout = setTimeout(() => controller.abort(), 5000);
        const weatherRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${loc.coords.latitude}&longitude=${loc.coords.longitude}&current=weather_code&timezone=auto`,
          { signal: controller.signal }
        );
        clearTimeout(weatherTimeout);
        if (weatherRes.ok) {
          const weatherData = await weatherRes.json() as { current?: { weather_code?: number } };
          const code = weatherData.current?.weather_code;
          if (code != null) setWeatherIcon(getWeatherIcon(code, clientIsNightTime()));
        }
      } catch {
        // mantém o fallback por hora do dia
      }
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

  // Fire location request on mount
  useEffect(() => {
    void requestLocation().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload providers when location or filters change — but only after the persisted
  // radius has been read, so the first fetch always uses the correct stored value.
  // Also skip if coordinates are still the app-level default AND we don't have a real
  // location yet: fetching São Paulo centre for a user elsewhere always returns 0
  // results and causes the "no providers" empty state to flash on cold start.
  useEffect(() => {
    if (!radiusReady) return;
    if (!hasLocation && userLat === DEFAULT_LAT && userLng === DEFAULT_LNG) return;
    void loadProviders(userLat, userLng, hasLocation);
  }, [loadProviders, userLat, userLng, hasLocation, radiusReady]);

  // Épico de Frentes, Frente 9, Lote 3 (fechamento pós-verificação): a
  // invalidação de queryKeys.notifications.all num push recebido em primeiro
  // plano (root-stack.tsx) não tinha nenhum efeito aqui - a contagem era só
  // useState recalculado no focus, nunca passava pelo cache do react-query.
  // Usar useAuthQuery com a mesma chave (notifications.inbox) faz essa
  // invalidação de fato disparar um refetch, mesmo com a tela já montada.
  const notifInboxQuery = useAuthQuery(
    queryKeys.notifications.inbox(120),
    (token) => notificationsApi.inbox(token, 120)
  );

  useEffect(() => {
    if (!notifInboxQuery.data) return;
    loadDismissedNotificationIds(user?.id ?? "anonymous")
      .then((dismissed) => setUnreadNotifCount(countUnreadNotifications(notifInboxQuery.data!, dismissed)))
      .catch(() => {});
  }, [notifInboxQuery.data, user?.id]);

  // Contagens de não lidos — atualiza toda vez que a tela ganha foco
  useFocusEffect(
    useCallback(() => {
      runWithAuth((token) => chatApi.myChats(token))
        .then((chats) => {
          const total = chats.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
          setUnreadChatCount(total);
        })
        .catch(() => {});
      notifInboxQuery.refetch().catch(() => {});
    }, [runWithAuth])
  );

  // Modal de personalização de @apelido — mostra uma vez para usuários CLIENT sem apelido customizado
  useEffect(() => {
    if (!user?.id || role !== "CLIENT") return;
    const storageKey = `@muvify/apelidoPromptShown_${user.id}`;
    AsyncStorage.getItem(storageKey).then((shown) => {
      if (shown === "1") return;
      // Mostra apenas se o usuário não tem apelido ou tem um apelido auto-gerado (contém _)
      if (!user.apelido || user.apelido.includes("_")) {
        setApelidoModalVisible(true);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function handleSaveApelido() {
    const trimmed = apelidoDraft.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(trimmed)) {
      showToast("Apelido inválido. Use letras minúsculas, números e _.", "error");
      return;
    }
    try {
      setApelidoSaving(true);
      const updated = await runWithAuth((token) => userApi.updateMe(token, { apelido: trimmed }));
      setCurrentUser(updated);
      showToast(`@${trimmed} definido com sucesso!`, "success");
      await AsyncStorage.setItem(`@muvify/apelidoPromptShown_${user?.id}`, "1").catch(() => {});
      setApelidoModalVisible(false);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar apelido.", navigation });
    } finally {
      setApelidoSaving(false);
    }
  }

  async function handleDismissApelidoModal() {
    await AsyncStorage.setItem(`@muvify/apelidoPromptShown_${user?.id}`, "1").catch(() => {});
    setApelidoModalVisible(false);
  }

  // Carrega seguidores que ainda não seguimos de volta (atualiza no focus)
  useFocusEffect(
    useCallback(() => {
      if (role !== "CLIENT") return;
      Promise.all([
        runWithAuth((token) => communityApiImport.getFollowers(token, 1, 50)),
        runWithAuth((token) => communityApiImport.getFollowing(token, 1, 200)),
      ]).then(([followersRes, followingRes]) => {
        const followingSet = new Set(followingRes.items.map((u) => u.id));
        setFollowBackIds(followingSet);
        // Apenas quem nos segue mas não seguimos de volta
        const pending = followersRes.items.filter((u) => !followingSet.has(u.id));
        setNewFollowers(pending.slice(0, 5));
      }).catch(() => {});
    }, [runWithAuth, role])
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
          setAnamnesisStatus("incomplete");
        } else if (profile.completedAt && isAnamnesisOutdated(profile.completedAt)) {
          setAnamnesisPopup("outdated");
          setAnamnesisStatus("outdated");
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


  // Treinos concluídos na semana atual (para o card de sequência V2)
  const weeklyCompleted = useMemo(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);
    return bookings.filter((b) => {
      if (b.status !== "COMPLETED") return false;
      return new Date(b.completedAt ?? b.scheduledAt) >= startOfWeek;
    }).length;
  }, [bookings]);

  // Épico de Frentes, Frente 8, Lote 5: nível/streak exibidos aqui vinham só
  // do cálculo local (fórmula própria de nível, streak com hora local do
  // device, conta só booking presencial) - divergia do valor real já
  // calculado pelo backend (mesma fonte que a aba Comunidade já usa
  // corretamente). computeUserProgress vira só fallback enquanto a query
  // não carrega ou falha.
  const gamificationQuery = useAuthQuery(
    queryKeys.gamification.myProfile(),
    (token) => gamificationApi.getMyProfile(token),
  );
  const gamificationData = gamificationQuery.data ?? null;

  const gamifProgress = useMemo(() => computeUserProgress(bookings as any), [bookings]);
  const displayStreak = gamificationData?.currentStreak ?? gamifProgress.streak;
  const displayLevel = gamificationData?.currentLevel ?? gamifProgress.level;

  const nextAchievement = useMemo(() => {
    const prog = { ...gamifProgress, streak: displayStreak, level: displayLevel };
    const achievs = computeAchievements(prog);
    const locked = achievs.find((a) => !a.unlocked);
    if (!locked) return null;
    let current = 0;
    let total = 1;
    if (locked.id === "iniciante") { current = prog.totalWorkouts; total = 10; }
    else if (locked.id === "mente_focada") { current = prog.streak; total = 7; }
    else if (locked.id === "consistente") { current = prog.streak; total = 30; }
    else if (locked.id === "elite") { current = prog.totalWorkouts; total = 100; }
    return { ...locked, current, total, fraction: Math.min(1, current / total) };
  }, [gamifProgress, displayStreak, displayLevel]);

  const visibleProviderCount = mapProviders.filter(
    (p) => typeof p.latitude === "number" && typeof p.longitude === "number"
  ).length;
  const visibleProviderLabel = visibleProviderCount === 1 ? "personal" : "personais";
  useEffect(() => {
    if (!radiusReady) return;
    (globalThis as any).__mvLastSearchRadiusKm = safeRadiusKm;
    void AsyncStorage.setItem(CLIENT_SEARCH_RADIUS_KEY, String(safeRadiusKm)).catch(() => {});
  }, [safeRadiusKm, radiusReady]);
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
      subtitle: lightModeEnabled ? "Modo light" : "Modo dark",
      icon: lightModeEnabled ? "sunny-outline" : "moon-outline",
      right: <MvToggle value={lightModeEnabled} onValueChange={handleLightModeToggle} accessibilityLabel="Aparência" />,
      sectionHeader: "AJUSTES",
    },
    {
      key: "notifications",
      label: "Notificações",
      subtitle: pushNotificationsEnabled ? "Push ativado" : "Push desativado",
      icon: "notifications-outline",
      right: <MvToggle value={pushNotificationsEnabled} onValueChange={(v) => void setPushNotificationsPreference(v)} accessibilityLabel="Notificações" />,
    },
    {
      key: "security",
      label: "Segurança",
      icon: "shield-checkmark-outline",
      onPress: () => { setMenuOpen(false); goToStack("Security"); },
      sectionHeader: "MAIS",
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
        {/* Esquerda: avatar + logo (abre menu lateral) */}
        <TouchableOpacity onPress={() => setMenuOpen((open) => !open)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Abrir menu" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <MvAvatar
            initials={clientInitials}
            size={34}
            borderRadius={11}
            color="green"
            photoUri={profilePhotoUri}
          />
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ fontFamily: "Nunito_800ExtraBold", fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.03 * 22 }}>
              muvi
            </Text>
            <Text style={{ fontFamily: "Nunito_800ExtraBold", fontWeight: "800", fontSize: 22, color: theme.primary, letterSpacing: -0.03 * 22 }}>
              fy
            </Text>
          </View>
        </TouchableOpacity>

        {/* Spacer */}
        <View style={{ flex: 1 }} />

        {/* Direita: botões de favoritos, chat e notificações */}
        <View style={{ flexDirection: "row", gap: 6, width: 114, justifyContent: "flex-end" }}>
          {/* Frente 10 (segunda camada), Lote 17: Favoritos só era alcançável
              pelo menu do perfil (ClientProfileScreen) - nenhum atalho
              visível na Home, a tela mais visitada do app. */}
          <TouchableOpacity
            onPress={() => navigation.navigate("Favorites")}
            accessibilityRole="button"
            accessibilityLabel="Favoritos"
            style={{
              width: 34, height: 34, borderRadius: 11,
              backgroundColor: isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)",
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Ionicons name="heart-outline" size={18} color={isLight ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.6)"} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { setUnreadChatCount(0); goToStack("ClientChatList"); }}
            accessibilityRole="button"
            accessibilityLabel="Chat"
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
            accessibilityRole="button"
            accessibilityLabel="Notificações"
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

      {/* Saudação V2 */}
      <View style={{ paddingHorizontal: S.px, paddingTop: 20, paddingBottom: 16, flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: DISPLAY,
              fontWeight: "800",
              fontSize: 28,
              letterSpacing: -0.4,
              lineHeight: 34,
            }}
          >
            <Text style={{ color: theme.text1 }}>Olá, </Text>
            <Text style={{ color: theme.primary }}>{firstName}!</Text>
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
            <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 13, color: theme.text2 }} numberOfLines={1}>
              {greetingSubtitle}
            </Text>
            <Ionicons name={weatherIcon.name} size={16} color={weatherIcon.color} />
          </View>
        </View>

        {anamnesisStatus !== null && (
          <TouchableOpacity
            onPress={() => goToStack("ClientAnamnesis")}
            activeOpacity={0.78}
            accessibilityRole="button"
            accessibilityLabel={anamnesisStatus === "outdated" ? "Atualizar ficha de saúde" : "Preencher ficha de saúde"}
            style={{
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 9,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: theme.warningSubtle,
              borderWidth: 1,
              borderColor: theme.warningSubtleBorder,
              gap: 5,
              marginLeft: 10,
            }}
          >
            <Ionicons
              name="clipboard-outline"
              size={17}
              color={theme.warning}
            />
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.warning, textAlign: "center", lineHeight: 14 }}>
              {anamnesisStatus === "outdated" ? "Atualize sua\nficha de saúde ›" : "Preencha sua\nficha de saúde ›"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <ClientHomeDrawer
        visible={menuOpen}
        items={sideMenuItems}
        onDismiss={() => setMenuOpen(false)}
        insetTop={insets.top}
        isLight={isLight}
        displayName={user?.name ?? "Aluno"}
        initials={clientInitials}
        photoUri={profilePhotoUri}
      />

      {/* Banner: localização negada */}
      {locationPermissionDenied && !hasLocation && (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => void requestLocation()}
          style={{ marginHorizontal: S.px, marginTop: 12, borderRadius: S.cardR, borderWidth: 1, borderColor: C.amberBorder, backgroundColor: C.amberDim, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}
        >
          <Ionicons name="location-outline" size={20} color={C.amber} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>Localização desativada</Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, marginTop: 2 }}>
              Ative para ver profissionais perto de você. Toque para permitir.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.amber} />
        </TouchableOpacity>
      )}

      {/* Seção de novos seguidores — visível apenas quando há alguém que nos seguiu mas não seguimos de volta */}
      {newFollowers.length > 0 && (
        <View style={{ paddingHorizontal: S.px, paddingTop: 16, paddingBottom: 4 }}>
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: C.skyBorder, backgroundColor: C.skyDim, padding: 14, gap: 10 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>
              {newFollowers.length === 1 ? "1 pessoa começou a te seguir" : `${newFollowers.length} pessoas começaram a te seguir`}
            </Text>
            <View style={{ gap: 8 }}>
              {newFollowers.map((follower) => {
                const isFollowingBack = followBackIds.has(follower.id);
                return (
                  <View key={follower.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <MvAvatar initials={(follower.name ?? "?").slice(0, 2).toUpperCase()} photoUri={follower.photoUrl ?? null} tone="blue" size="sm" />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }} numberOfLines={1}>{follower.name}</Text>
                      {follower.apelido && <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>@{follower.apelido}</Text>}
                    </View>
                    {!isFollowingBack && (
                      <TouchableOpacity
                        onPress={async () => {
                          try {
                            await runWithAuth((token) => communityApiImport.follow(token, follower.id));
                            setFollowBackIds((prev) => new Set([...prev, follower.id]));
                            setNewFollowers((prev) => prev.filter((f) => f.id !== follower.id));
                          } catch { /* best effort */ }
                        }}
                        // Frente 15 (segunda camada, acessibilidade), Lote
                        // 18: 32pt de altura fica abaixo do mínimo
                        // recomendado (44x44pt, iOS HIG/Material) — hitSlop
                        // compensa sem precisar redesenhar o chip.
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        style={{ height: 32, paddingHorizontal: 12, borderRadius: S.chipR, backgroundColor: C.sky, alignItems: "center", justifyContent: "center" }}
                      >
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.textOnPrimary }}>Seguir de volta</Text>
                      </TouchableOpacity>
                    )}
                    {isFollowingBack && (
                      <View style={{ height: 32, paddingHorizontal: 12, borderRadius: S.chipR, backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>Seguindo</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      )}

      {homeLoading ? (
        <SkeletonClientHomeScreen />
      ) : homeLoadError ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 16 }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: theme.dangerSubtle, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="cloud-offline-outline" size={30} color={theme.danger} />
          </View>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1, textAlign: "center" }}>Não foi possível carregar</Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center", lineHeight: 20 }}>
            Verifique sua conexão e tente novamente.
          </Text>
          <TouchableOpacity
            onPress={() => void bookingsQuery.refetch()}
            activeOpacity={0.85}
            style={{ paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.primary }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <ScrollView automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={bookingsQuery.isRefetching}
            onRefresh={() => { hapticRefresh(); void bookingsQuery.refetch(); void requestLocation().catch(() => {}); }}
            tintColor={theme.primary}
            colors={[theme.primary]}
            progressBackgroundColor={theme.cardBg}
          />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ paddingTop: 4, gap: 8 }}>
          {!user?.emailVerifiedAt ? (
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={resendingVerificationHome}
              onPress={() => void handleResendVerificationHome()}
              accessibilityRole="button"
              accessibilityLabel="Confirmar e-mail"
              style={{
                flexDirection: "row", alignItems: "center", gap: 10,
                marginHorizontal: S.px,
                borderRadius: 12, borderWidth: 1, borderColor: C.amberBorder,
                backgroundColor: C.amberDim,
                paddingHorizontal: 13, paddingVertical: 10,
              }}
            >
              <Ionicons name="mail-unread-outline" size={16} color={C.amber} />
              <Text style={{ flex: 1, fontFamily: "DMSans_700Bold", fontSize: 12, color: C.amber }}>
                {resendingVerificationHome ? "Enviando..." : "Confirme seu e-mail — toque para reenviar o link"}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={C.amber} />
            </TouchableOpacity>
          ) : null}

          {/* Progress strip — compact single row */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => navigation.navigate("Community")}
            accessibilityRole="button"
            accessibilityLabel={`Nível ${displayLevel}, sequência de ${displayStreak} dias`}
            style={{
              flexDirection: "row", alignItems: "center",
              marginHorizontal: S.px,
              borderRadius: 12, borderWidth: 1, borderColor: theme.border,
              backgroundColor: theme.cardBg,
              paddingHorizontal: 13, paddingVertical: 9,
            }}
          >
            <Ionicons name="flame" size={13} color={C.amber} />
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.text1, marginLeft: 4 }}>
              {displayStreak}
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, marginLeft: 3 }}>
              {displayStreak === 1 ? "dia" : "dias"}
            </Text>

            <View style={{ width: 1, height: 13, backgroundColor: theme.border, marginHorizontal: 10 }} />

            <Ionicons name="star" size={12} color={theme.primary} />
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.text1, marginLeft: 4 }}>
              Nível {displayLevel}
            </Text>

            <View style={{ width: 1, height: 13, backgroundColor: theme.border, marginHorizontal: 10 }} />

            <Ionicons name="barbell-outline" size={12} color={theme.primary} />
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, marginLeft: 4 }}>
              <Text style={{ fontFamily: "DMSans_700Bold", color: theme.primary }}>{monthlyCompleted}</Text>/18
            </Text>

            {nextAchievement ? (
              <>
                <View style={{ width: 1, height: 13, backgroundColor: theme.border, marginHorizontal: 10 }} />
                <Ionicons name={nextAchievement.icon as any} size={12} color={theme.primary} />
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, marginLeft: 4, flexShrink: 1 }} numberOfLines={1}>
                  {nextAchievement.label}
                </Text>
              </>
            ) : null}

            <View style={{ flex: 1 }} />
            <Ionicons name="chevron-forward" size={12} color={theme.text3} />
          </TouchableOpacity>

          <ClientHomeFilters
            filterMode={filterMode}
            onToggleMode={(m) => { setMapSearchFeedback(null); setFilterMode((c) => (c === m ? undefined : m)); clearProviderSelection(); }}
            selectedSpecialties={selectedSpecialties}
            onToggleSpecialty={(s) => { setMapSearchFeedback(null); setSelectedSpecialties((p) => p.includes(s) ? p.filter((i) => i !== s) : [...p, s]); clearProviderSelection(); }}
          />

          <ClientHomeMapSection
            mapRef={mapRef}
            userLat={userLat}
            userLng={userLng}
            hasLocation={hasLocation}
            filterDistanceCommitted={filterDistanceCommitted}
            mapProviders={mapProviders}
            activeMapSearchModal={activeMapSearchModal}
            mapSearchFeedback={mapSearchFeedback}
            isDark={isDark}
            isLight={isLight}
            locationSearchQuery={locationSearchQuery}
            providerNameQuery={providerNameQuery}
            providerNameSearch={providerNameSearch}
            locationSuggestions={locationSuggestions}
            locationSuggestionsLoading={locationSuggestionsLoading}
            providerSuggestions={providerSuggestions}
            academySuggestions={academySuggestions}
            academySuggestionsLoading={academySuggestionsLoading}
            academySearchText={academySearchText}
            selectedAcademyFilter={selectedAcademyFilter}
            safeRadiusKm={safeRadiusKm}
            filterDistance={filterDistance}
            visibleProviderCount={visibleProviderCount}
            visibleProviderLabel={visibleProviderLabel}
            loading={false}
            onSetActiveMapSearchModal={setActiveMapSearchModal}
            onSearchByLocation={() => void searchByLocation()}
            onApplyProviderNameSearch={applyProviderNameSearch}
            onSelectLocationSuggestion={selectLocationSuggestion}
            onSelectProviderSuggestion={selectProviderSuggestion}
            onSetLocationSearchQuery={setLocationSearchQuery}
            onSetProviderNameQuery={setProviderNameQuery}
            onOpenProviderModal={(p) => void openProviderModal(p)}
            onRequestLocation={() => void requestLocation()}
            onSetAcademyFilter={setSelectedAcademyFilter}
            onSetAcademySearchText={setAcademySearchText}
            onSetMapSearchFeedback={setMapSearchFeedback}
            onClearProviderSelection={clearProviderSelection}
            onClearProviderNameSearch={() => { setProviderNameQuery(""); setProviderNameSearch(""); setMapSearchFeedback(null); }}
            onSetFilterDistance={setFilterDistance}
            onSetFilterDistanceCommitted={setFilterDistanceCommitted}
          />
      </View>

      <View style={{ paddingHorizontal: S.px, paddingTop: 14 }}>
        {/* Banner - próximo treino V2 */}
        <View style={{
          borderRadius: S.cardR, padding: 16, marginBottom: 14, borderWidth: 1,
          backgroundColor: theme.primaryHighlight,
          borderColor: theme.primarySubtleBorder,
        }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.primary, letterSpacing: 0.1 * 10, textTransform: "uppercase" }}>PRÓXIMO TREINO</Text>
            {nextBooking ? (
              <View style={{
                backgroundColor: nextBooking.status === "CONFIRMED" ? theme.primarySubtle : C.amberDim,
                borderWidth: 1, borderColor: nextBooking.status === "CONFIRMED" ? theme.primarySubtleBorder : C.amberBorder,
                borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 2,
              }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: nextBooking.status === "CONFIRMED" ? theme.primary : C.amber }}>
                  {nextBooking.status === "CONFIRMED" ? "Confirmado" : "Pendente"}
                </Text>
              </View>
            ) : null}
          </View>
          {nextBooking ? (
            <>
              <Text numberOfLines={1} style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.02 * 20 }}>{nextBooking.provider?.displayName ?? "Seu personal"}</Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, marginTop: 4 }}>
                {formatBookingDate(nextBooking.scheduledAt)}
              </Text>
              {nextBooking.status === "PENDING" && (
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: C.amber, marginTop: 6 }}>
                  Aguardando confirmação do profissional
                </Text>
              )}
            </>
          ) : (
            <>
              <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.02 * 20 }}>Nenhum treino agendado</Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, marginTop: 4 }}>
                Encontre um personal e agende sua sessão.
              </Text>
            </>
          )}
        </View>

        {/* Explorar por especialidade V2 */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 18, color: theme.text1, letterSpacing: -0.03 * 18 }}>
            Explorar por especialidade
          </Text>
          <TouchableOpacity onPress={() => navigation.navigate("Categories")}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>Ver todas ›</Text>
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 }}>
          {categories.slice(0, 8).map((cat) => (
            <View key={cat.id} style={{ width: "25%", paddingHorizontal: 4, marginBottom: 8 }}>
              <TouchableOpacity
                testID={`button.home.category.${cat.id}`}
                activeOpacity={0.85}
                onPress={() => goToStack("ProfessionalsList", { query: cat.name })}
                style={{
                  borderRadius: 18, borderWidth: 1, borderColor: theme.border,
                  backgroundColor: theme.cardBg,
                  paddingVertical: 12, paddingHorizontal: 4,
                  alignItems: "center", justifyContent: "center",
                  minHeight: S.touchMin + 36,
                }}
              >
                <View style={{
                  width: 36, height: 36, borderRadius: 12,
                  backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder,
                  alignItems: "center", justifyContent: "center", marginBottom: 6,
                }}>
                  <Ionicons name={cat.icon} size={18} color={theme.primary} />
                </View>
                <Text style={{ fontFamily: "DMSans_500Medium", textAlign: "center", fontSize: 10, lineHeight: 13, color: C.zinc300 }} numberOfLines={2}>
                  {SPECIALTY_SHORT_NAMES[cat.name] ?? cat.name}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Teaser de ofertas e promoções V2 */}
        <View style={{ marginTop: 6, marginBottom: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 18, color: theme.text1, letterSpacing: -0.03 * 18 }}>
              Ofertas e promoções
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate("Promotions")}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>Ver todas ›</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate("Promotions")}
            style={{
              borderRadius: S.cardR, padding: 16, borderWidth: 1,
              borderColor: theme.primarySubtleBorder,
              backgroundColor: "rgba(36,230,109,0.07)",
            }}
          >
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.primary, letterSpacing: 0.1 * 10, textTransform: "uppercase", fontWeight: "700" }}>
              Destaques do dia
            </Text>
            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.02 * 20, marginTop: 8 }}>
              Economize treinando do seu jeito
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, lineHeight: 20, marginTop: 6 }}>
              Compare ofertas presenciais e consultorias online.
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      </ScrollView>
      )}

      <ClientProviderCard
        visible={Boolean(providerModal)}
        provider={providerModal ? {
          id: providerModal.id,
          displayName: providerModal.displayName,
          age: (providerModal as { age?: number | null }).age ?? null,
          priceCents: providerModal.priceCents,
          photoUrl: providerModal.photoUrl ?? null,
          presentationVideoUrl: selectedProviderDetail?.presentationVideoUrl ?? null,
        } : null}
        detailLoading={providerDetailLoading}
        specialties={providerModalSpecialties}
        scheduleLoading={providerScheduleLoading}
        scheduleDays={providerScheduleDays}
        selectedDay={selectedScheduleDay}
        selectedDayPayload={selectedSchedulePayload}
        onSelectDay={setSelectedScheduleDay}
        onClose={clearProviderSelection}
        onBook={(providerId) => { clearProviderSelection(); goToStack("CreateBooking", { professionalId: providerId }); }}
        onViewProfile={(providerId) => { clearProviderSelection(); goToStack("ProfessionalDetail", { professionalId: providerId }); }}
        onChat={(_providerId) => { clearProviderSelection(); goToStack("ClientChatList"); }}
      />


      <ClientBottomNavV2
        activeTab="home"
        onNavigate={(tab) => {
          if (tab === "agenda") navigation.navigate("ClientBookings");
          if (tab === "trainings") navigation.navigate("MyTraining");
          if (tab === "community") navigation.navigate("Community");
          if (tab === "profile") navigation.navigate("ClientProfile");
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
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 24 }}
          onPress={() => setAnamnesisPopup(null)}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{
            width: "100%",
            maxWidth: 340,
            borderRadius: 20,
            backgroundColor: theme.cardBg,
            borderWidth: 1,
            borderColor: theme.border,
            padding: 24,
            gap: 16,
          }}>
            {/* Ícone */}
            <View style={{ alignItems: "center" }}>
              <View style={{
                width: 52, height: 52, borderRadius: 16,
                backgroundColor: theme.warningSubtle,
                borderWidth: 1,
                borderColor: theme.warningSubtleBorder,
                alignItems: "center", justifyContent: "center",
              }}>
                <Ionicons
                  name={anamnesisPopup === "outdated" ? "refresh-circle-outline" : "clipboard-outline"}
                  size={24}
                  color={theme.warning}
                />
              </View>
            </View>

            {/* Título e descrição */}
            <View style={{ gap: 6, alignItems: "center" }}>
              <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 18, color: theme.text1, letterSpacing: -0.02 * 18, textAlign: "center", lineHeight: 24 }}>
                {anamnesisPopup === "outdated" ? "Atualize sua ficha de saúde" : "Preencha sua ficha de saúde"}
              </Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center", lineHeight: 20 }}>
                {anamnesisPopup === "outdated"
                  ? "Manter a ficha em dia ajuda seu personal a adaptar os treinos com mais segurança e precisão."
                  : "É rápido e garante um atendimento totalmente personalizado para o seu perfil!"}
              </Text>
            </View>

            {/* Ações */}
            <View style={{ gap: 8 }}>
              <TouchableOpacity
                onPress={() => { setAnamnesisPopup(null); goToStack("ClientAnamnesis"); }}
                style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>
                  {anamnesisPopup === "outdated" ? "Atualizar ficha agora" : "Preencher ficha agora"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setAnamnesisPopup(null)} style={{ paddingVertical: 10, alignItems: "center" }}>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>
                  {anamnesisPopup === "outdated" ? "Lembrar depois" : "Agora não"}
                </Text>
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

      {/* Modal de personalização de @apelido — exibido uma vez para clientes sem apelido customizado */}
      <Modal
        visible={apelidoModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => void handleDismissApelidoModal()}
        statusBarTranslucent
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 24 }}
          onPress={() => void handleDismissApelidoModal()}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, backgroundColor: theme.inputBg, borderRadius: S.cardR, padding: 24, gap: 14, borderWidth: 1, borderColor: theme.primarySubtleBorder, shadowColor: theme.primary, shadowOpacity: 0.25, shadowRadius: 30, elevation: 10 }}>
            {/* Ícone */}
            <View style={{ alignSelf: "center", width: 64, height: 64, borderRadius: 20, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="people-outline" size={32} color={theme.primary} />
            </View>

            {/* Título e descrição */}
            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.02 * 22, textAlign: "center" }}>
                Defina seu @apelido
              </Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center", lineHeight: 20 }}>
                Apareça no ranking, seja encontrado por amigos e faça parte da Comunidade Muvify.
              </Text>
            </View>

            {/* Campo */}
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", height: S.btnH, borderRadius: S.btnR, borderWidth: 1, borderColor: apelidoDraft.length > 0 && !/^[a-z0-9_]{3,30}$/.test(apelidoDraft) ? theme.danger : theme.borderMid, backgroundColor: theme.cardBg, paddingHorizontal: 16, gap: 6 }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.primary }}>@</Text>
                <TextInput
                  value={apelidoDraft}
                  onChangeText={(t) => setApelidoDraft(t.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30))}
                  placeholder="seu apelido aqui"
                  placeholderTextColor={theme.text3}
                  selectionColor={theme.primary}
                  autoCapitalize="none"
                  autoFocus
                  style={{ flex: 1, fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.text1 }}
                />
              </View>
              {apelidoDraft.length > 0 && !/^[a-z0-9_]{3,30}$/.test(apelidoDraft) ? (
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.danger, paddingLeft: 4 }}>
                  Mínimo 3 caracteres · apenas letras minúsculas, números e _
                </Text>
              ) : apelidoDraft.length >= 3 ? (
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.primary, paddingLeft: 4 }}>
                  @{apelidoDraft} ✓
                </Text>
              ) : null}
            </View>

            {/* Botões */}
            <View style={{ gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                disabled={apelidoSaving || apelidoDraft.length < 3}
                onPress={() => void handleSaveApelido()}
                style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: apelidoDraft.length < 3 ? theme.primaryDisabled : theme.primary, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: apelidoDraft.length >= 3 ? 0.28 : 0, shadowRadius: 10, elevation: apelidoDraft.length >= 3 ? 4 : 0 }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>
                  {apelidoSaving ? "Salvando..." : "Salvar apelido"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => void handleDismissApelidoModal()} style={{ height: S.touchMin, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>Definir depois</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
