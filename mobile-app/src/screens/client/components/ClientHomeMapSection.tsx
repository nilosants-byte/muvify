import React from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Circle, Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { IconGymVenue } from "../../../components/icons/MuvifyIcons";
import { fetchGooglePlaceCoords } from "../../../hooks/useGooglePlacesSearch";
import { ProviderServiceMode, ProviderSummary } from "../../../services/api/client";
import { C, S, DISPLAY } from "../../../theme/v2tokens";
import { useMvTheme } from "../../../theme/MvThemeContext";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProviderWithExtras = ProviderSummary & {
  specialties?: string[] | null;
  age?: number | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type MapSearchModal = "location" | "provider" | "academy" | null;

type LocationSuggestion = {
  displayName: string;
  lat: number;
  lon: number;
  placeId?: string;
};

type AcademySuggestion = {
  name: string;
  lat: number;
  lon: number;
  placeId?: string;
  address?: string;
};

export type Props = {
  mapRef: React.RefObject<MapView>;
  userLat: number;
  userLng: number;
  hasLocation: boolean;
  filterDistanceCommitted: number;
  mapProviders: ProviderWithExtras[];
  activeMapSearchModal: MapSearchModal;
  mapSearchFeedback: "local" | "provider" | null;
  isDark: boolean;
  isLight: boolean;
  _themeHint?: { border: string; borderSub: string; text2: string; textGreen: string; inputText: string; text3: string };
  locationSearchQuery: string;
  providerNameQuery: string;
  providerNameSearch: string;
  locationSuggestions: LocationSuggestion[];
  locationSuggestionsLoading: boolean;
  providerSuggestions: ProviderWithExtras[];
  academySuggestions: AcademySuggestion[];
  academySuggestionsLoading: boolean;
  academySearchText: string;
  selectedAcademyFilter: { name: string; lat: number; lon: number } | null;
  safeRadiusKm: number;
  filterDistance: number;
  visibleProviderCount: number;
  visibleProviderLabel: string;
  loading: boolean;
  onSetActiveMapSearchModal: (modal: MapSearchModal) => void;
  onSearchByLocation: () => void;
  onApplyProviderNameSearch: () => void;
  onSelectLocationSuggestion: (lat: number, lon: number, name: string) => void;
  onSelectProviderSuggestion: (provider: ProviderWithExtras) => void;
  onSetLocationSearchQuery: (q: string) => void;
  onSetProviderNameQuery: (q: string) => void;
  onOpenProviderModal: (provider: ProviderWithExtras) => void;
  onRequestLocation: () => void;
  onSetAcademyFilter: (filter: { name: string; lat: number; lon: number } | null) => void;
  onSetAcademySearchText: (text: string) => void;
  onSetMapSearchFeedback: (fb: "local" | "provider" | null) => void;
  onClearProviderSelection: () => void;
  onClearProviderNameSearch: () => void;
  onSetFilterDistance: (km: number) => void;
  onSetFilterDistanceCommitted: (km: number) => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const { height: SCREEN_H } = Dimensions.get("window");
const MAP_H = Math.round(SCREEN_H * 0.50);
const MAP_RADIUS_MIN_KM = 1;
const MAP_RADIUS_MAX_KM = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name?: string | null) {
  const parts = (name ?? "?").trim().split(/\s+/);
  if (parts.length <= 1) return (parts[0] ?? "?").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function pinColor(mode?: ProviderServiceMode | null): string {
  if (mode === "PRESENTIAL_ONLY") return "#4CAF50";
  if (mode === "HOME_VISIT_ONLY") return "#2196F3";
  if (mode === "BOTH") return "#FF9800";
  return "#9E9E9E";
}

// ─── ProviderMapPin ───────────────────────────────────────────────────────────

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
        <Text numberOfLines={1} style={[pinStyles.name, { color: namColor }]}>{provider.displayName || "Personal"}</Text>
        <Text numberOfLines={1} style={[pinStyles.spec, { color: specColor }]}>{specialty}</Text>
        <Text numberOfLines={1} style={pinStyles.price}>{price}</Text>
      </View>
      <View style={[pinStyles.avatar, { borderColor: color }]}>
        {provider.photoUrl ? (
          <Image source={{ uri: provider.photoUrl }} style={pinStyles.photo} />
        ) : (
          <View style={[pinStyles.initials, { backgroundColor: color }]}>
            <Text style={pinStyles.initialsText}>{getInitials(provider.displayName)}</Text>
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
    maxWidth: 170, paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 5, elevation: 6,
    alignItems: "center",
  },
  name: { fontSize: 11, fontWeight: "700", lineHeight: 13 },
  spec: { fontSize: 9, lineHeight: 11 },
  price: { fontSize: 10, fontWeight: "700", lineHeight: 12, color: "#4CAF50" },
  avatar: {
    marginTop: 4, width: 34, height: 34, borderRadius: 17, borderWidth: 2.5,
    overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45, shadowRadius: 4, elevation: 5,
  },
  photo: { width: "100%", height: "100%" },
  initials: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  initialsText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  tail: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 7,
    borderLeftColor: "transparent", borderRightColor: "transparent",
    marginTop: -1,
  },
});

// ─── Main component ───────────────────────────────────────────────────────────

export function ClientHomeMapSection({
  mapRef, userLat, userLng, hasLocation, filterDistanceCommitted,
  mapProviders, activeMapSearchModal, mapSearchFeedback,
  isDark, isLight,
  locationSearchQuery, providerNameQuery, providerNameSearch,
  locationSuggestions, locationSuggestionsLoading,
  providerSuggestions, academySuggestions, academySuggestionsLoading,
  academySearchText, selectedAcademyFilter,
  safeRadiusKm, filterDistance, visibleProviderCount, visibleProviderLabel, loading,
  onSetActiveMapSearchModal, onSearchByLocation, onApplyProviderNameSearch,
  onSelectLocationSuggestion, onSelectProviderSuggestion,
  onSetLocationSearchQuery, onSetProviderNameQuery,
  onOpenProviderModal, onRequestLocation,
  onSetAcademyFilter, onSetAcademySearchText, onSetMapSearchFeedback,
  onClearProviderSelection, onClearProviderNameSearch,
  onSetFilterDistance, onSetFilterDistanceCommitted,
}: Props) {
  const { theme } = useMvTheme();
  return (
    <>
      {/* Map */}
      <View style={{ height: MAP_H, overflow: "hidden", position: "relative" }}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={{ flex: 1 }}
          initialRegion={{
            latitude: userLat, longitude: userLng,
            latitudeDelta: 0.05, longitudeDelta: 0.05,
          }}
          showsUserLocation={hasLocation}
          showsMyLocationButton={false}
          showsCompass={false}
          rotateEnabled={false}
          onPress={() => onClearProviderSelection()}
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
                onPress={() => onOpenProviderModal(provider)}
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
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.color, ...(item.userDot ? { borderWidth: 1.5, borderColor: "#fff" } : {}) }} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 9, color: theme.text2, letterSpacing: 0.2 }}>{item.label}</Text>
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
          <Ionicons name="people-outline" size={12} color={theme.primary} />
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.primary }}>
            {visibleProviderCount} {visibleProviderLabel}
          </Text>
        </View>

        {/* Map action buttons */}
        <View style={{ position: "absolute", top: 44, left: 8, gap: 8, zIndex: 7 }}>
          <TouchableOpacity
            onPress={() => onSetActiveMapSearchModal("location")}
            style={{ width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: isLight ? "rgba(255,255,255,0.95)" : "rgba(11,18,11,0.93)", alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="location-outline" size={17} color={theme.text2} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onSetActiveMapSearchModal("provider")}
            style={{ width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: isLight ? "rgba(255,255,255,0.95)" : "rgba(11,18,11,0.93)", alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="person-outline" size={17} color={theme.text2} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { onSetActiveMapSearchModal("academy"); onSetAcademySearchText(""); }}
            style={{
              width: 34, height: 34, borderRadius: 10, borderWidth: 1,
              borderColor: selectedAcademyFilter !== null ? "rgba(76,175,80,0.55)" : theme.border,
              backgroundColor: selectedAcademyFilter !== null ? "rgba(76,175,80,0.15)" : isLight ? "rgba(255,255,255,0.95)" : "rgba(11,18,11,0.93)",
              alignItems: "center", justifyContent: "center",
            }}
          >
            <IconGymVenue size={17} color={selectedAcademyFilter !== null ? theme.textGreen : theme.text2} />
          </TouchableOpacity>
        </View>

        {/* Map search feedback */}
        {mapSearchFeedback ? (
          <View style={{
            position: "absolute", top: "50%", left: 14, right: 14,
            alignItems: "center", justifyContent: "center",
            borderRadius: 10, borderWidth: 1, borderColor: theme.border,
            backgroundColor: isLight ? "rgba(255,255,255,0.92)" : "rgba(14,22,14,0.9)",
            paddingHorizontal: 10, paddingVertical: 8,
            transform: [{ translateY: -16 }], zIndex: 11,
          }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text3, textAlign: "center" }}>
              {mapSearchFeedback === "local" ? "local não encontrado" : "personal não encontrado"}
            </Text>
          </View>
        ) : null}

        {/* Location / Provider search modal */}
        {activeMapSearchModal === "location" || activeMapSearchModal === "provider" ? (
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => onSetActiveMapSearchModal(null)}
            style={{
              position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
              backgroundColor: "rgba(0,0,0,0.22)",
              alignItems: "flex-start", justifyContent: "flex-start",
              paddingTop: 44, paddingLeft: 48, zIndex: 20,
            }}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => {}}
              style={{
                width: "72%", minWidth: 210, maxWidth: 290,
                borderRadius: 12, borderWidth: 1, borderColor: theme.border,
                backgroundColor: isLight ? "rgba(255,255,255,0.98)" : "rgba(11,18,11,0.96)",
                paddingHorizontal: 10, paddingVertical: 9, gap: 8,
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
                  onChangeText={activeMapSearchModal === "location" ? onSetLocationSearchQuery : onSetProviderNameQuery}
                  onSubmitEditing={() => {
                    if (activeMapSearchModal === "location") {
                      onSearchByLocation();
                    } else {
                      onApplyProviderNameSearch();
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
                      onSearchByLocation();
                    } else {
                      onApplyProviderNameSearch();
                    }
                  }}
                >
                  <Ionicons name="arrow-forward-circle-outline" size={18} color={theme.textGreen} />
                </TouchableOpacity>
              </View>

              {/* Location suggestions */}
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
                            onSetLocationSearchQuery(s.displayName.split(",").slice(0, 2).join(", "));
                            onSetActiveMapSearchModal(null);
                            Keyboard.dismiss();
                            fetchGooglePlaceCoords(s.placeId).then((coords) => {
                              if (coords) onSelectLocationSuggestion(coords.lat, coords.lon, s.displayName);
                            });
                          } else {
                            onSelectLocationSuggestion(s.lat, s.lon, s.displayName);
                          }
                        }}
                        style={{
                          flexDirection: "row", alignItems: "center", gap: 7,
                          paddingHorizontal: 10, paddingVertical: 9,
                          borderTopWidth: idx > 0 ? 1 : 0, borderColor: theme.borderSub,
                          backgroundColor: isLight ? "#ffffff" : "#0b120b",
                        }}
                      >
                        <Ionicons name="location-outline" size={13} color={theme.primary} />
                        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text2, flex: 1 }} numberOfLines={2}>
                          {s.displayName}
                        </Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              ) : null}

              {/* Provider suggestions */}
              {activeMapSearchModal === "provider" && providerSuggestions.length > 0 ? (
                <View style={{ marginTop: 4, gap: 0, borderWidth: 1, borderColor: theme.border, borderRadius: 9, overflow: "hidden" }}>
                  {providerSuggestions.map((p, idx) => (
                    <TouchableOpacity
                      key={`prov-${p.id}`}
                      onPress={() => onSelectProviderSuggestion(p)}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: 7,
                        paddingHorizontal: 10, paddingVertical: 8,
                        borderTopWidth: idx > 0 ? 1 : 0, borderColor: theme.borderSub,
                        backgroundColor: isLight ? "#ffffff" : "#0b120b",
                      }}
                    >
                      <Ionicons name="person-outline" size={13} color={theme.primary} />
                      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text1, flex: 1 }} numberOfLines={1}>
                        {p.displayName}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              {activeMapSearchModal === "provider" && providerNameSearch ? (
                <TouchableOpacity
                  style={{ alignSelf: "flex-end", paddingHorizontal: 2 }}
                  onPress={() => { onClearProviderNameSearch(); onSetActiveMapSearchModal(null); onClearProviderSelection(); }}
                >
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>Limpar</Text>
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
          </TouchableOpacity>
        ) : null}

        {/* Empty state overlay */}
        {visibleProviderCount === 0 && !loading && activeMapSearchModal === null ? (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(3,8,6,0.88)" }}>
            <View style={{
              backgroundColor: theme.cardBg, borderRadius: S.cardR, padding: 24,
              alignItems: "center", borderWidth: 1,
              borderColor: !hasLocation ? theme.primarySubtleBorder : theme.border,
              maxWidth: 290,
              shadowColor: !hasLocation ? theme.primary : "transparent",
              shadowOpacity: !hasLocation ? 0.25 : 0,
              shadowRadius: 20, elevation: !hasLocation ? 8 : 0,
            }}>
              {!hasLocation ? (
                <>
                  <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="location-outline" size={32} color={theme.primary} />
                  </View>
                  <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.02 * 20, marginTop: 14, textAlign: "center" }}>
                    Encontre seu personal
                  </Text>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, marginTop: 8, textAlign: "center", lineHeight: 20 }}>
                    Ative sua localização para ver personais disponíveis perto de você.
                  </Text>
                  <TouchableOpacity
                    onPress={() => void onRequestLocation()}
                    accessibilityRole="button"
                    accessibilityLabel="Ativar localização"
                    style={{ marginTop: 16, backgroundColor: theme.primary, borderRadius: S.btnR, paddingHorizontal: 24, paddingVertical: 12, shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
                  >
                    <Text style={{ color: theme.textOnPrimary, fontFamily: "DMSans_700Bold", fontSize: 14 }}>Ativar localização</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onSetActiveMapSearchModal("location")} style={{ marginTop: 10, paddingVertical: 8 }}>
                    <Text style={{ color: theme.text3, fontFamily: "DMSans_400Regular", fontSize: 12 }}>Ou buscar por cidade/bairro</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={{ fontSize: 32 }}>🔍</Text>
                  <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.02 * 20, marginTop: 12, textAlign: "center" }}>
                    Nenhum personal aqui
                  </Text>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, marginTop: 8, textAlign: "center", lineHeight: 20 }}>
                    Aumente o raio de busca para encontrar profissionais disponíveis.
                  </Text>
                  <TouchableOpacity
                    onPress={() => { onSetFilterDistance(10); onSetFilterDistanceCommitted(10); onClearProviderSelection(); }}
                    style={{ marginTop: 16, backgroundColor: theme.primarySubtle, borderRadius: S.chipR, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: theme.primarySubtleBorder }}
                  >
                    <Text style={{ color: theme.primary, fontFamily: "DMSans_700Bold", fontSize: 13 }}>Ampliar para 10 km</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        ) : null}

        {/* GPS re-center button */}
        <TouchableOpacity
          onPress={() => void onRequestLocation()}
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

        {/* Academy filter */}
        {activeMapSearchModal === "academy" ? (
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => { onSetActiveMapSearchModal(null); onSetAcademySearchText(""); }}
            style={{
              position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
              backgroundColor: "rgba(0,0,0,0.22)",
              alignItems: "flex-start", justifyContent: "flex-start",
              paddingTop: 44, paddingLeft: 48, zIndex: 20,
            }}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => {}}
              style={{
                width: "72%", minWidth: 210, maxWidth: 290,
                borderRadius: 12, borderWidth: 1, borderColor: theme.border,
                backgroundColor: isLight ? "rgba(255,255,255,0.98)" : "rgba(11,18,11,0.96)",
                paddingHorizontal: 10, paddingVertical: 9, gap: 6, maxHeight: 300,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="fitness-outline" size={15} color={theme.text2} />
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.text1 }}>Buscar academia</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {selectedAcademyFilter ? (
                    <TouchableOpacity onPress={() => { onSetAcademyFilter(null); onSetAcademySearchText(""); }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary }}>Limpar</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity onPress={() => { onSetActiveMapSearchModal(null); onSetAcademySearchText(""); }}>
                    <Ionicons name="close" size={16} color={theme.text3} />
                  </TouchableOpacity>
                </View>
              </View>

              {selectedAcademyFilter ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(76,175,80,0.12)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: "rgba(76,175,80,0.30)" }}>
                  <Ionicons name="checkmark-circle" size={14} color={theme.primary} />
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.primary, flex: 1 }} numberOfLines={2}>
                    {selectedAcademyFilter.name}
                  </Text>
                </View>
              ) : null}

              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme.border, borderRadius: 10, backgroundColor: theme.inputBg, paddingHorizontal: 8, paddingVertical: 5 }}>
                <Ionicons name="search-outline" size={13} color={theme.text3} />
                <TextInput
                  autoFocus
                  value={academySearchText}
                  onChangeText={onSetAcademySearchText}
                  placeholder="Ex.: Smart Fit, Bodytech..."
                  placeholderTextColor={theme.text3}
                  selectionColor={theme.primary}
                  style={{ flex: 1, color: theme.text1, fontSize: 11, fontFamily: "DMSans_400Regular", padding: 0 }}
                />
                {academySearchText ? (
                  <TouchableOpacity onPress={() => onSetAcademySearchText("")}>
                    <Ionicons name="close-circle" size={13} color={theme.text3} />
                  </TouchableOpacity>
                ) : null}
              </View>

              {academySuggestionsLoading && academySuggestions.length === 0 ? (
                <ActivityIndicator color="#4CAF50" style={{ paddingVertical: 8 }} />
              ) : academySuggestions.length > 0 ? (
                <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 9, overflow: "hidden" }}>
                  {academySuggestions.map((s, idx) => (
                    <TouchableOpacity
                      key={s.placeId ?? `academy-${s.lat}-${s.lon}-${idx}`}
                      onPress={() => {
                        const apply = (lat: number, lon: number) => {
                          onSetAcademyFilter({ name: s.name, lat, lon });
                          onSetAcademySearchText("");
                          onSetActiveMapSearchModal(null);
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
                        borderTopWidth: idx > 0 ? 1 : 0, borderColor: theme.borderSub,
                        backgroundColor: isLight ? "#ffffff" : "#0b120b",
                      }}
                    >
                      <Ionicons name="fitness-outline" size={13} color={theme.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text1 }} numberOfLines={1}>{s.name}</Text>
                        {s.address ? (
                          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.text3 }} numberOfLines={1}>
                            {s.address.replace(/, Brasil$/, "").replace(/, Brazil$/, "")}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : !selectedAcademyFilter ? (
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>
                  Digite o nome da academia para encontrar personais que atendem lá.
                </Text>
              ) : null}
            </TouchableOpacity>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Raio de busca — botões preset */}
      <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14, borderTopWidth: 1, borderTopColor: theme.border }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.text1 }}>
            Raio de busca · {visibleProviderCount} prof.
          </Text>
          <View style={{ backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary }}>{safeRadiusKm} km</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {[1, 3, 5, 10].map((km) => {
            const active = safeRadiusKm === km;
            return (
              <TouchableOpacity
                key={km}
                onPress={() => { onSetFilterDistance(km); onSetFilterDistanceCommitted(km); onClearProviderSelection(); }}
                style={{
                  flex: 1, height: 36, borderRadius: 10, borderWidth: 1,
                  borderColor: active ? theme.primary : theme.border,
                  backgroundColor: active ? theme.primary : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"),
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: active ? theme.textOnPrimary : theme.text2 }}>
                  {km} km
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </>
  );
}
