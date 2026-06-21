import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { ApiError, authApi, providersApi } from "../api/client";

const TASK_NAME = "muvify.provider.background-location";
const PREF_ENABLED_KEY = "@personalapp/provider/background-location-enabled";
const LAST_SENT_KEY = "@personalapp/provider/background-location-last-sent";

const ACCESS_TOKEN_KEY = "personalapp.accessToken";
const REFRESH_TOKEN_KEY = "personalapp.refreshToken";

const MIN_SEND_INTERVAL_MS = 45_000;
const MIN_SEND_DISTANCE_METERS = 25;

type LastSentState = {
  lat: number;
  lng: number;
  at: number;
};

type BackgroundLocationStatus = {
  enabledPreference: boolean;
  running: boolean;
};

type StartResult = {
  enabled: boolean;
  message?: string;
};

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const earthRadius = 6_371_000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

async function isBackgroundTaskAvailable() {
  if (Platform.OS === "web") return false;
  try {
    return await TaskManager.isAvailableAsync();
  } catch {
    return false;
  }
}

async function readLastSentState(): Promise<LastSentState | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastSentState;
    if (
      typeof parsed.lat !== "number" ||
      typeof parsed.lng !== "number" ||
      typeof parsed.at !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeLastSentState(state: LastSentState) {
  try {
    await AsyncStorage.setItem(LAST_SENT_KEY, JSON.stringify(state));
  } catch {
    // noop
  }
}

async function shouldSendLocation(lat: number, lng: number) {
  const previous = await readLastSentState();
  if (!previous) return true;

  const elapsed = Date.now() - previous.at;
  if (elapsed >= MIN_SEND_INTERVAL_MS) return true;

  const moved = distanceMeters(previous.lat, previous.lng, lat, lng);
  return moved >= MIN_SEND_DISTANCE_METERS;
}

async function readSecureToken(key: string) {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function saveSecureToken(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // noop
  }
}

async function stopTaskSilently() {
  const available = await isBackgroundTaskAvailable();
  if (!available) return;

  try {
    const started = await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
    if (started) {
      await Location.stopLocationUpdatesAsync(TASK_NAME);
    }
  } catch {
    // noop
  }
}

async function sendProviderLocation(lat: number, lng: number) {
  const accessToken = await readSecureToken(ACCESS_TOKEN_KEY);
  if (!accessToken) {
    await stopTaskSilently();
    return;
  }

  try {
    await providersApi.updateProfile(accessToken, { latitude: lat, longitude: lng });
    await writeLastSentState({ lat, lng, at: Date.now() });
    return;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      return;
    }
  }

  const refreshToken = await readSecureToken(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    await stopTaskSilently();
    return;
  }

  try {
    const refreshed = await authApi.refresh(refreshToken);
    await Promise.all([
      saveSecureToken(ACCESS_TOKEN_KEY, refreshed.accessToken),
      saveSecureToken(REFRESH_TOKEN_KEY, refreshed.refreshToken),
    ]);
    await providersApi.updateProfile(refreshed.accessToken, { latitude: lat, longitude: lng });
    await writeLastSentState({ lat, lng, at: Date.now() });
  } catch (refreshError) {
    // Sessão inválida em background — para a task para evitar retries desnecessários
    console.warn("[BgLocation] Refresh falhou, parando task:", refreshError);
    await stopTaskSilently();
  }
}

if (Platform.OS !== "web" && !TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
    if (error) return;

    const enabledPreference = await isProviderBackgroundLocationEnabled();
    if (!enabledPreference) {
      await stopTaskSilently();
      return;
    }

    const payload = data as { locations?: Location.LocationObject[] } | undefined;
    const locations = payload?.locations ?? [];
    if (locations.length === 0) return;

    const latest = locations[locations.length - 1];
    const lat = latest.coords.latitude;
    const lng = latest.coords.longitude;

    const canSend = await shouldSendLocation(lat, lng);
    if (!canSend) return;

    await sendProviderLocation(lat, lng);
  });
}

export async function isProviderBackgroundLocationEnabled() {
  try {
    return (await AsyncStorage.getItem(PREF_ENABLED_KEY)) === "1";
  } catch {
    return false;
  }
}

async function setProviderBackgroundLocationEnabled(enabled: boolean) {
  try {
    if (enabled) {
      await AsyncStorage.setItem(PREF_ENABLED_KEY, "1");
    } else {
      await AsyncStorage.setItem(PREF_ENABLED_KEY, "0");
    }
  } catch {
    // noop
  }
}

export async function getProviderBackgroundLocationStatus(): Promise<BackgroundLocationStatus> {
  const enabledPreference = await isProviderBackgroundLocationEnabled();
  const available = await isBackgroundTaskAvailable();
  if (!available) {
    return { enabledPreference, running: false };
  }

  try {
    const running = await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
    return { enabledPreference, running };
  } catch {
    return { enabledPreference, running: false };
  }
}

export async function startProviderBackgroundLocation(): Promise<StartResult> {
  const available = await isBackgroundTaskAvailable();
  if (!available) {
    return {
      enabled: false,
      message:
        "Localização em background indisponível neste ambiente. Use build de desenvolvimento ou app instalado.",
    };
  }

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") {
    return {
      enabled: false,
      message: "Permissão de localização em uso negada.",
    };
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== "granted") {
    return {
      enabled: false,
      message: "Permissão de localização em segundo plano negada.",
    };
  }

  try {
    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
    if (!alreadyStarted) {
      await Location.startLocationUpdatesAsync(TASK_NAME, {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 25,
        timeInterval: 60_000,
        deferredUpdatesDistance: 30,
        deferredUpdatesInterval: 60_000,
        pausesUpdatesAutomatically: false,
        activityType: Location.ActivityType.Fitness,
        showsBackgroundLocationIndicator: false,
        foregroundService: {
          notificationTitle: "Muvify: localização ativa",
          notificationBody: "Atualizando sua localização para exibição no mapa de alunos.",
          notificationColor: "#4CAF50",
        },
      });
    }

    await setProviderBackgroundLocationEnabled(true);

    // Send initial position immediately after enabling.
    try {
      const initial = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      await sendProviderLocation(initial.coords.latitude, initial.coords.longitude);
    } catch {
      // noop
    }

    return { enabled: true };
  } catch {
    return {
      enabled: false,
      message: "Não foi possível iniciar a localização em background.",
    };
  }
}

export async function stopProviderBackgroundLocation(options?: { preservePreference?: boolean }) {
  await stopTaskSilently();
  if (!options?.preservePreference) {
    await setProviderBackgroundLocationEnabled(false);
  }
}
