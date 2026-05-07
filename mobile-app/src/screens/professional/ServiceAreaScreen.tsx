import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  LayoutChangeEvent,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import {
  ProviderFixedLocation,
  ProviderServiceMode,
  providersApi,
  userApi,
} from "../../services/api/client";
import {
  getProviderBackgroundLocationStatus,
  startProviderBackgroundLocation,
  stopProviderBackgroundLocation,
} from "../../services/location/providerBackgroundLocation";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ServiceArea">;

const { height: SCREEN_H } = Dimensions.get("window");
const MAP_HEIGHT = Math.round(SCREEN_H * 0.42);
const MAP_HEIGHT_WHEN_TYPING = Math.round(SCREEN_H * 0.2);

const RADIUS_PRESETS = [
  { label: "1 km", value: 1 },
  { label: "3 km", value: 3 },
  { label: "5 km", value: 5 },
  { label: "10 km", value: 10 },
  { label: "Personalizado", value: 0 },
] as const;

const SERVICE_MODE_OPTIONS: { key: ProviderServiceMode; label: string; icon: string }[] = [
  { key: "PRESENTIAL_ONLY", label: "Academia", icon: "fitness-outline" },
  { key: "HOME_VISIT_ONLY", label: "Casa do cliente", icon: "home-outline" },
  { key: "BOTH", label: "Ambos", icon: "swap-horizontal-outline" },
];

// Leaflet HTML
function buildLeafletHtml(
  lat: number,
  lng: number,
  radiusKm: number,
  darkMode: boolean
): string {
  const radiusMeters = radiusKm * 1000;
  const tile = darkMode
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    html,body,#map{width:100%;height:100%;overflow:hidden;}
    .leaflet-control-attribution{display:none!important;}
    .leaflet-control-zoom{margin:10px!important;}
  </style>
</head>
<body>
<div id="map"></div>
<script>
  var map = L.map('map',{zoomControl:true,attributionControl:false}).setView([${lat},${lng}],14);
  L.tileLayer('${tile}',{maxZoom:19}).addTo(map);

  var pinIcon = L.divIcon({
    className:'',
    html:'<div style="width:36px;height:36px;background:#22C55E;border:3px solid #fff;border-radius:50%;box-shadow:0 3px 14px rgba(34,197,94,0.45);display:flex;align-items:center;justify-content:center;"><div style="width:10px;height:10px;background:#fff;border-radius:50%;"></div></div>',
    iconSize:[36,36],iconAnchor:[18,18]
  });

  var marker = L.marker([${lat},${lng}],{draggable:true,icon:pinIcon}).addTo(map);
  var circle = L.circle([${lat},${lng}],{
    radius:${radiusMeters},
    color:'#22C55E',fillColor:'#22C55E',fillOpacity:0.12,
    weight:2,dashArray:'8,5'
  }).addTo(map);

  function emit(type,data){
    if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({type:type},data)));
  }

  marker.on('dragend',function(){
    var p=marker.getLatLng();
    circle.setLatLng(p);
    emit('position',{lat:p.lat,lng:p.lng});
  });

  map.on('click',function(e){
    marker.setLatLng(e.latlng);
    circle.setLatLng(e.latlng);
    emit('position',{lat:e.latlng.lat,lng:e.latlng.lng});
  });

  window.addEventListener('message',function(e){
    try{
      var d=JSON.parse(e.data);
      if(d.type==='setRadius'){
        circle.setRadius(d.r);
        map.fitBounds(circle.getBounds(),{padding:[30,30]});
      }
      if(d.type==='setPosition'){
        var ll=L.latLng(d.lat,d.lng);
        marker.setLatLng(ll); circle.setLatLng(ll);
        map.setView(ll,14);
      }
    }catch(ex){}
  });
</script>
</body>
</html>`;
}

// Screen
export function ServiceAreaScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const controlsScrollRef = useRef<ScrollView>(null);
  const sectionOffsetsRef = useRef<Record<string, number>>({});

  // Estado primario
  const [latitude, setLatitude] = useState(-23.5505);
  const [longitude, setLongitude] = useState(-46.6333);
  const [radiusKm, setRadiusKm] = useState(5);
  const [radiusPreset, setRadiusPreset] = useState<number>(5);
  const [customRadius, setCustomRadius] = useState("5");
  const [serviceMode, setServiceMode] = useState<ProviderServiceMode>("BOTH");

  // Locais adicionais
  const [extraLocations, setExtraLocations] = useState<ProviderFixedLocation[]>([]);
  const [newLocName, setNewLocName] = useState("");
  const [newLocAddress, setNewLocAddress] = useState("");
  const [newLocRadius, setNewLocRadius] = useState("5");
  const [addingExtra, setAddingExtra] = useState(false);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<
    Array<{ display_name: string; lat: string; lon: string }>
  >([]);
  const [addressQuery, setAddressQuery] = useState("");

  // Estado da UI
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [backgroundLocationEnabled, setBackgroundLocationEnabled] = useState(false);
  const [backgroundLocationBusy, setBackgroundLocationBusy] = useState(false);
  const [backgroundLocationRunning, setBackgroundLocationRunning] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [mapInteractionEnabled, setMapInteractionEnabled] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => {
      setKeyboardVisible(true);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardVisible(false);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (keyboardVisible) {
      setMapInteractionEnabled(false);
    }
  }, [keyboardVisible]);

  const setSectionOffset = useCallback((key: string, event: LayoutChangeEvent) => {
    sectionOffsetsRef.current[key] = event.nativeEvent.layout.y;
  }, []);

  const focusSection = useCallback((key: string) => {
    setMapInteractionEnabled(false);
    requestAnimationFrame(() => {
      const y = sectionOffsetsRef.current[key];
      if (typeof y === "number") {
        controlsScrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
      }
    });
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

  const toggleBackgroundLocation = useCallback(async (nextValue: boolean) => {
    setBackgroundLocationBusy(true);
    try {
      if (nextValue) {
        const started = await startProviderBackgroundLocation();
        if (!started.enabled) {
          showToast(started.message ?? "Não foi possível ativar a localização em background.", "error");
          await refreshBackgroundLocationStatus();
          return;
        }
        await refreshBackgroundLocationStatus();
        showToast("Localização em background ativada.", "success");
        return;
      }

      await stopProviderBackgroundLocation();
      await refreshBackgroundLocationStatus();
      showToast("Localização em background desativada.", "info");
    } catch {
      showToast("Falha ao atualizar configuração de localização.", "error");
      await refreshBackgroundLocationStatus();
    } finally {
      setBackgroundLocationBusy(false);
    }
  }, [refreshBackgroundLocationStatus, showToast]);

  // Carregar perfil
  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const me = await runWithAuth((token) => userApi.me(token));
      const profile = me.providerProfile;
      if (profile) {
        if (profile.latitude != null) setLatitude(profile.latitude);
        if (profile.longitude != null) setLongitude(profile.longitude);
        const r = profile.serviceRadiusKm ?? 5;
        setRadiusKm(r);
        setRadiusPreset(RADIUS_PRESETS.find((p) => p.value === r) ? r : 0);
        setCustomRadius(String(r));
        setServiceMode(profile.serviceMode ?? "BOTH");
        setExtraLocations(
          Array.isArray(profile.fixedLocations)
            ? (profile.fixedLocations as ProviderFixedLocation[])
            : []
        );
      }
      await refreshBackgroundLocationStatus();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar perfil.", navigation });
    } finally {
      setLoading(false);
    }
  }, [navigation, refreshBackgroundLocationStatus, runWithAuth, showToast]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  // Sincronizar mapa quando pronto
  useEffect(() => {
    if (!mapReady) return;
    sendToMap("setPosition", { lat: latitude, lng: longitude });
    sendToMap("setRadius", { r: radiusKm * 1000 });
  }, [mapReady, latitude, longitude, radiusKm]);

  // Utilitarios de comunicacao com o mapa
  function sendToMap(type: string, data: Record<string, unknown>) {
    const payload = JSON.stringify({ type, ...data });
    webViewRef.current?.injectJavaScript(`
      window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(payload)}}));
      true;
    `);
  }

  // GPS
  async function useCurrentLocation() {
    try {
      setLocating(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { showToast("Permissão de localização negada.", "error"); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      updatePosition(loc.coords.latitude, loc.coords.longitude);
      showToast("Localização atual definida.", "success");
    } catch {
      showToast("Não foi possível obter a localização.", "error");
    } finally {
      setLocating(false);
    }
  }

  function updatePosition(lat: number, lng: number) {
    setLatitude(lat);
    setLongitude(lng);
    sendToMap("setPosition", { lat, lng });
  }

  // Busca de endereco (Nominatim / OpenStreetMap)
  async function searchAddress() {
    const q = addressQuery.trim();
    if (!q) return;
    try {
      setSearchingAddress(true);
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=br`;
      const resp = await fetch(url, {
        headers: { "Accept-Language": "pt-BR", "User-Agent": "Muvify-App/1.0" },
      });
      const results = (await resp.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
      }>;
      setAddressSuggestions(results);
    } catch {
      showToast("Falha ao buscar endereço.", "error");
    } finally {
      setSearchingAddress(false);
    }
  }

  function selectAddressSuggestion(item: { display_name: string; lat: string; lon: string }) {
    updatePosition(parseFloat(item.lat), parseFloat(item.lon));
    setAddressQuery(item.display_name.split(",").slice(0, 2).join(", "));
    setAddressSuggestions([]);
  }

  // Raio
  function applyRadius(km: number) {
    const safeKm = Math.max(1, Math.round(km));
    setRadiusKm(safeKm);
    sendToMap("setRadius", { r: safeKm * 1000 });
  }

  function selectPreset(value: number) {
    setRadiusPreset(value);
    if (value > 0) {
      setCustomRadius(String(value));
      applyRadius(value);
    }
  }

  function applyCustomRadius() {
    const v = parseInt(customRadius, 10);
    if (!isFinite(v) || v < 1) { showToast("Raio mínimo: 1 km.", "error"); return; }
    if (v > 200) { showToast("Raio máximo: 200 km.", "error"); return; }
    applyRadius(v);
  }

  // Locais adicionais
  async function addExtraLocation() {
    if (!newLocName.trim()) { showToast("Informe o nome do local.", "error"); return; }
    const r = parseInt(newLocRadius, 10);
    if (!isFinite(r) || r < 1) { showToast("Informe um raio válido (mín. 1 km).", "error"); return; }

    let locLat: number | null = null;
    let locLng: number | null = null;

    if (newLocAddress.trim()) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(newLocAddress)}&format=json&limit=1&countrycodes=br`;
        const resp = await fetch(url, {
          headers: { "Accept-Language": "pt-BR", "User-Agent": "Muvify-App/1.0" },
        });
        const results = await resp.json();
        if (results[0]) {
          locLat = parseFloat(results[0].lat);
          locLng = parseFloat(results[0].lon);
        }
      } catch { /* ignora - salva sem coordenadas */ }
    }

    const newLoc: ProviderFixedLocation = {
      id: String(Date.now()),
      name: newLocName.trim(),
      address: newLocAddress.trim() || undefined,
      latitude: locLat,
      longitude: locLng,
      radiusKm: r,
    };

    setExtraLocations((prev) => [...prev, newLoc]);
    setNewLocName("");
    setNewLocAddress("");
    setNewLocRadius("5");
    setAddingExtra(false);
    showToast("Local adicionado.", "success");
  }

  function removeExtraLocation(id: string) {
    setExtraLocations((prev) => prev.filter((l) => l.id !== id));
  }

  // Salvar
  async function save() {
    try {
      setSaving(true);
      await runWithAuth((token) =>
        providersApi.updateProfile(token, {
          latitude,
          longitude,
          serviceRadiusKm: radiusKm,
          serviceMode,
          fixedLocations: extraLocations.map(({ id, name, address, latitude: elat, longitude: elng, radiusKm: er }) => ({
            id,
            name,
            address: address ?? undefined,
            latitude: elat ?? undefined,
            longitude: elng ?? undefined,
            radiusKm: er ?? undefined,
          })),
        })
      );
      showToast("Área de atendimento salva com sucesso.", "success");
      navigation.goBack();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar área de atendimento.", navigation });
    } finally {
      setSaving(false);
    }
  }

  // Mensagens vindas do mapa
  function onMapMessage(event: { nativeEvent: { data: string } }) {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as { type: string; lat?: number; lng?: number };
      if (msg.type === "position" && msg.lat != null && msg.lng != null) {
        setLatitude(msg.lat);
        setLongitude(msg.lng);
      }
    } catch { /* ignora mensagens invalidas */ }
  }

  const leafletHtml = useMemo(
    () => buildLeafletHtml(latitude, longitude, radiusKm, theme.mode === "dark"),
    [theme.mode]
  );
  const mapContainerHeight = keyboardVisible ? MAP_HEIGHT_WHEN_TYPING : MAP_HEIGHT;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={theme.textGreen} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 14,
          paddingHorizontal: 16,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: theme.bg,
          zIndex: 10,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="semi1" style={{ flex: 1 }}>Localização</MvText>
      </View>

      {/* Mapa */}
      <View style={{ height: mapContainerHeight, position: "relative" }}>
        <View style={{ flex: 1 }} pointerEvents={mapInteractionEnabled ? "auto" : "none"}>
          <WebView
            ref={webViewRef}
            source={{ html: leafletHtml }}
            style={{ flex: 1 }}
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={mapInteractionEnabled}
            onMessage={onMapMessage}
            onLoad={() => setMapReady(true)}
            originWhitelist={["*"]}
            mixedContentMode="always"
          />
        </View>

        {!mapInteractionEnabled ? (
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {
              Keyboard.dismiss();
              setMapInteractionEnabled(true);
            }}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(4,12,4,0.18)",
            }}
          >
            <View
              style={{
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "rgba(34,197,94,0.30)",
                backgroundColor: "rgba(8,16,8,0.72)",
                paddingHorizontal: 12,
                paddingVertical: 9,
                alignItems: "center",
                gap: 4,
              }}
            >
              <MvText variant="semi3" style={{ color: "#fff" }}>
                Escolha onde atuar
              </MvText>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => setMapInteractionEnabled(false)}
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "rgba(34,197,94,0.30)",
              backgroundColor: "rgba(8,16,8,0.75)",
              paddingHorizontal: 10,
              paddingVertical: 6,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Ionicons name="lock-closed-outline" size={14} color="#fff" />
            <MvText variant="badge" style={{ color: "#fff", fontSize: 11 }}>
              Bloquear mapa
            </MvText>
          </TouchableOpacity>
        )}

        {/* Overlay: coordenadas atuais */}
        <View
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            backgroundColor: "rgba(0,0,0,0.60)",
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}
        >
          <MvText variant="badge" style={{ color: "#fff", fontSize: 11 }}>
            {latitude.toFixed(5)}, {longitude.toFixed(5)}
          </MvText>
        </View>

        {/* Overlay: raio */}
        <View
          style={{
            position: "absolute",
            bottom: 10,
            right: 10,
            backgroundColor: "rgba(34,197,94,0.90)",
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderWidth: 1,
            borderColor: "rgba(34,197,94,0.40)",
          }}
        >
          <MvText variant="semi3" style={{ color: "#fff", fontSize: 12 }}>
            {radiusKm} km
          </MvText>
        </View>
      </View>

      {/* Painel inferior - controles */}
      <ScrollView
        ref={controlsScrollRef}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: keyboardVisible ? 300 : 48,
          gap: 14,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        {/* Título da seção + botão salvar */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <MvText variant="semi2">Configuração rápida</MvText>
          <TouchableOpacity
            onPress={() => void save()}
            disabled={saving}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 20,
              backgroundColor: theme.textGreen,
              opacity: saving ? 0.6 : 1,
            }}
          >
            <MvText variant="semi3" style={{ color: "#fff" }}>
              {saving ? "Salvando..." : "Salvar"}
            </MvText>
          </TouchableOpacity>
        </View>

        {/* Localizacao base */}
        <View onLayout={(event) => setSectionOffset("base-location", event)}>
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 8 }}>Localização base</MvText>
          <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
            Escolha onde atuar.
          </MvText>

          {/* GPS */}
          <TouchableOpacity
            onPress={() => void useCurrentLocation()}
            disabled={locating}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              padding: 11,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "rgba(34,197,94,0.30)",
              backgroundColor: "rgba(34,197,94,0.07)",
              marginBottom: 10,
            }}
          >
            {locating ? (
              <ActivityIndicator size="small" color="#22C55E" />
            ) : (
              <Ionicons name="locate-outline" size={18} color="#22C55E" />
            )}
            <MvText variant="semi3" style={{ color: theme.textGreen }}>
              {locating ? "Obtendo localização..." : "Usar minha localização atual"}
            </MvText>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => void toggleBackgroundLocation(!backgroundLocationEnabled)}
            disabled={backgroundLocationBusy}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              padding: 11,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: backgroundLocationEnabled
                ? "rgba(34,197,94,0.35)"
                : theme.border,
              backgroundColor: backgroundLocationEnabled
                ? "rgba(34,197,94,0.08)"
                : theme.inputBg,
              marginBottom: 6,
              opacity: backgroundLocationBusy ? 0.7 : 1,
            }}
          >
            {backgroundLocationBusy ? (
              <ActivityIndicator size="small" color={backgroundLocationEnabled ? "#22C55E" : theme.text2} />
            ) : (
              <Ionicons
                name={backgroundLocationEnabled ? "pause-circle-outline" : "play-circle-outline"}
                size={18}
                color={backgroundLocationEnabled ? "#22C55E" : theme.text2}
              />
            )}
            <MvText
              variant="semi3"
              style={{ color: backgroundLocationEnabled ? theme.textGreen : theme.text2 }}
            >
              {backgroundLocationEnabled
                ? "Desativar localização em background"
                : "Ativar localização em background"}
            </MvText>
          </TouchableOpacity>
          <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
            {backgroundLocationEnabled
              ? (backgroundLocationRunning
                ? "Ativa mesmo com app fechado ou minimizado."
                : "Preferência ativa. Abra permissões de localização para execução em segundo plano.")
              : "Desativada. O app atualiza sua posição apenas durante uso manual."}
          </MvText>

          {/* Busca de endereço */}
          <View style={{ flexDirection: "row", gap: 6 }}>
            <View style={{ flex: 1 }}>
              <MvInput
                placeholder="Buscar endereço..."
                value={addressQuery}
                onChangeText={setAddressQuery}
                onFocus={() => focusSection("base-location")}
                onSubmitEditing={() => void searchAddress()}
                returnKeyType="search"
              />
            </View>
            <TouchableOpacity
              onPress={() => void searchAddress()}
              disabled={searchingAddress}
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                backgroundColor: theme.chipBg,
                borderWidth: 1,
                borderColor: theme.border,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {searchingAddress ? (
                <ActivityIndicator size="small" color={theme.text2} />
              ) : (
                <Ionicons name="search-outline" size={18} color={theme.text2} />
              )}
            </TouchableOpacity>
          </View>

          {/* Sugestões de endereço */}
          {addressSuggestions.length > 0 ? (
            <View
              style={{
                marginTop: 4,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.cardBg,
                overflow: "hidden",
              }}
            >
              {addressSuggestions.map((item, idx) => (
                <TouchableOpacity
                  key={`${item.lat}-${item.lon}`}
                  onPress={() => selectAddressSuggestion(item)}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderTopWidth: idx > 0 ? 1 : 0,
                    borderColor: theme.borderSub,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Ionicons name="location-outline" size={14} color={theme.text3} />
                  <MvText variant="body4" color="secondary" numberOfLines={2} style={{ flex: 1 }}>
                    {item.display_name}
                  </MvText>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={() => setAddressSuggestions([])}
                style={{ padding: 8, alignItems: "center" }}
              >
                <MvText variant="body4" style={{ color: "#f44336" }}>Fechar</MvText>
              </TouchableOpacity>
            </View>
          ) : null}
        </MvCard>
        </View>

        {/* Raio de atendimento */}
        <View onLayout={(event) => setSectionOffset("radius", event)}>
        <MvCard>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center", marginRight: 10 }}>
              <Ionicons name="resize-outline" size={16} color={theme.textGreen} />
            </View>
            <MvText variant="semi2">Raio de atendimento</MvText>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {RADIUS_PRESETS.map((preset) => {
              const active = radiusPreset === preset.value;
              return (
                <TouchableOpacity
                  key={preset.value}
                  onPress={() => selectPreset(preset.value)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 20,
                    backgroundColor: active ? "rgba(34,197,94,0.14)" : theme.chipBg,
                    borderWidth: 1,
                    borderColor: active ? "rgba(34,197,94,0.38)" : theme.border,
                  }}
                >
                  <MvText variant="semi3" style={{ color: active ? theme.textGreen : theme.text2 }}>
                    {preset.label}
                  </MvText>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Input personalizado - visivel sempre para transparencia */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <MvInput
                placeholder="Raio em km (ex: 12)"
                value={customRadius}
                onFocus={() => focusSection("radius")}
                onChangeText={(v) => { setCustomRadius(v); setRadiusPreset(0); }}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={applyCustomRadius}
              />
            </View>
            <TouchableOpacity
              onPress={applyCustomRadius}
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                backgroundColor: "rgba(34,197,94,0.12)",
                borderWidth: 1,
                borderColor: "rgba(34,197,94,0.28)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="checkmark" size={20} color="#22C55E" />
            </TouchableOpacity>
          </View>
        </MvCard>
        </View>

        {/* Tipo de atendimento */}
        <MvCard>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center", marginRight: 10 }}>
              <Ionicons name="location-outline" size={16} color={theme.textGreen} />
            </View>
            <MvText variant="semi2">Tipo de atendimento</MvText>
          </View>
          <View style={{ gap: 8 }}>
            {SERVICE_MODE_OPTIONS.map((opt) => {
              const active = serviceMode === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => setServiceMode(opt.key)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    padding: 12,
                    borderRadius: 12,
                    backgroundColor: active ? "rgba(34,197,94,0.10)" : theme.inputBg,
                    borderWidth: 1.5,
                    borderColor: active ? "rgba(34,197,94,0.38)" : theme.border,
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: active ? "rgba(34,197,94,0.14)" : theme.chipBg,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name={opt.icon as any} size={18} color={active ? "#22C55E" : theme.text2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi2" style={{ color: active ? theme.textGreen : theme.text1 }}>
                      {opt.label}
                    </MvText>
                  </View>
                  {active ? <Ionicons name="checkmark-circle" size={20} color="#22C55E" /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </MvCard>

        {/* Locais adicionais */}
        <View onLayout={(event) => setSectionOffset("extra-locations", event)}>
        <MvCard>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <MvText variant="semi2">Locais adicionais</MvText>
              <MvText variant="body4" color="secondary">
                Academia, estúdio, condomínio e atendimento outdoor.
              </MvText>
              <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
                Esses locais são usados pela lógica interna e não aparecem como pins.
              </MvText>
            </View>
            <TouchableOpacity
              onPress={() => setAddingExtra((v) => !v)}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: addingExtra ? "rgba(239,68,68,0.10)" : "rgba(34,197,94,0.10)",
                borderWidth: 1,
                borderColor: addingExtra ? "rgba(239,68,68,0.26)" : "rgba(34,197,94,0.26)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name={addingExtra ? "close" : "add"} size={18} color={addingExtra ? "#EF4444" : theme.textGreen} />
            </TouchableOpacity>
          </View>

          {/* Lista de locais */}
          {extraLocations.map((loc) => (
            <View
              key={loc.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.inputBg,
                marginBottom: 6,
              }}
            >
              <Ionicons name="location-outline" size={16} color={theme.textGreen} />
              <View style={{ flex: 1 }}>
                <MvText variant="semi3">{loc.name}</MvText>
                {loc.address ? (
                  <MvText variant="body4" color="secondary" numberOfLines={1}>
                    {loc.address}
                  </MvText>
                ) : null}
                <MvText variant="badge" style={{ color: theme.text3, fontSize: 11 }}>
                  Raio: {loc.radiusKm ?? 5} km
                  {loc.latitude ? ` • ${(loc.latitude).toFixed(4)}, ${(loc.longitude ?? 0).toFixed(4)}` : ""}
                </MvText>
              </View>
              <TouchableOpacity onPress={() => removeExtraLocation(loc.id)}>
                <Ionicons name="trash-outline" size={16} color={theme.text3} />
              </TouchableOpacity>
            </View>
          ))}

          {/* Formulário de novo local */}
          {addingExtra ? (
            <View style={{ gap: 8, marginTop: 6 }}>
              <MvInput
                placeholder="Nome do local (ex: Academia FitClub)"
                value={newLocName}
                onChangeText={setNewLocName}
                onFocus={() => focusSection("extra-locations")}
              />
              <MvInput
                placeholder="Endereço (será geocodificado)"
                value={newLocAddress}
                onChangeText={setNewLocAddress}
                onFocus={() => focusSection("extra-locations")}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <MvInput
                    placeholder="Raio (km)"
                    value={newLocRadius}
                    onChangeText={setNewLocRadius}
                    onFocus={() => focusSection("extra-locations")}
                    keyboardType="number-pad"
                  />
                </View>
                <TouchableOpacity
                  onPress={() => void addExtraLocation()}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    backgroundColor: "rgba(34,197,94,0.12)",
                    borderWidth: 1,
                    borderColor: "rgba(34,197,94,0.28)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="checkmark" size={20} color="#22C55E" />
                </TouchableOpacity>
              </View>
              <MvText variant="body4" color="secondary">
                O endereço será convertido em coordenadas automaticamente.
              </MvText>
            </View>
          ) : null}
        </MvCard>
        </View>

        <MvButton label="Salvar área de atendimento" loading={saving} onPress={() => void save()} />
      </ScrollView>
    </View>
  );
}


