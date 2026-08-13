import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Alert, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { captureException } from "../../observability/sentry";

const PUSH_PRE_PROMPT_KEY = "@muvify/pushPrePromptShown";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false
  })
});

let androidChannelConfigured = false;

export type PushRegistrationPayload = {
  token: string;
  platform: "ios" | "android" | "web" | "unknown";
  appVersion?: string;
  deviceName?: string;
};

function resolveExpoProjectId() {
  if (process.env.EXPO_PUBLIC_EAS_PROJECT_ID) {
    return process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  }

  if (Constants.easConfig?.projectId) {
    return Constants.easConfig.projectId;
  }

  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;

  return extra?.eas?.projectId;
}

function mapPlatform(): PushRegistrationPayload["platform"] {
  if (Platform.OS === "ios") {
    return "ios";
  }
  if (Platform.OS === "android") {
    return "android";
  }
  if (Platform.OS === "web") {
    return "web";
  }
  return "unknown";
}

async function ensureAndroidChannel() {
  if (Platform.OS !== "android" || androidChannelConfigured) {
    return;
  }

  await Notifications.setNotificationChannelAsync("default", {
    name: "default",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#19B450"
  });

  androidChannelConfigured = true;
}

export async function getPushRegistrationPayload(): Promise<PushRegistrationPayload | null> {
  if (!Device.isDevice) {
    return null;
  }

  const current = await Notifications.getPermissionsAsync();
  let finalStatus = current.status;
  if (finalStatus !== "granted") {
    if (finalStatus === "undetermined") {
      const prePromptShown = await AsyncStorage.getItem(PUSH_PRE_PROMPT_KEY);
      if (!prePromptShown) {
        await AsyncStorage.setItem(PUSH_PRE_PROMPT_KEY, "1");
        const wantsToEnable = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "Ativar notificações",
            "Receba avisos de agendamentos, mensagens do personal e lembretes de treino diretamente no seu celular.",
            [
              { text: "Agora não", style: "cancel", onPress: () => resolve(false) },
              { text: "Ativar", onPress: () => resolve(true) },
            ]
          );
        });
        if (!wantsToEnable) return null;
      }
    }
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  await ensureAndroidChannel();

  try {
    const projectId = resolveExpoProjectId();
    const tokenResponse = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    return {
      token: tokenResponse.data,
      platform: mapPlatform(),
      appVersion: Constants.expoConfig?.version,
      deviceName: Device.deviceName ?? undefined
    };
  } catch (error) {
    // Push token is unavailable in this environment (e.g. Expo Go without EAS project ID,
    // or Expo push service temporarily unavailable). This is a graceful degradation —
    // the app works without push notifications.
    //
    // Frente 13 (segunda camada), Lote 13: essa falha era 100% silenciosa
    // (nem log, nem Sentry) — impossível distinguir "dispositivo sem
    // suporte" de "serviço do Expo fora do ar" em produção sem isso.
    captureException(error, { area: "push-token-registration" });
    return null;
  }
}
