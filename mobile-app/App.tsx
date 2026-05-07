import "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { Platform } from "react-native";
import { useFonts } from "expo-font";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { initSentry } from "./src/observability/sentry";
import { RootNavigator } from "./src/navigation/root-stack";
import { AppStateProvider } from "./src/state/AppState";
import { StripeAppProvider } from "./src/providers/StripeAppProvider";
import { useTheme } from "./src/theme/useTheme";
import "./src/services/location/providerBackgroundLocation";
import {
  Syne_400Regular,
  Syne_600SemiBold,
  Syne_700Bold,
  Syne_800ExtraBold,
} from "@expo-google-fonts/syne";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import {
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
} from "@expo-google-fonts/outfit";
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import { MvThemeProvider } from "./src/theme/MvThemeContext";

initSentry();

function AppContent() {
  const { themeMode } = useTheme();
  const statusBarStyle = themeMode === "light" ? "dark" : "light";

  return (
    <>
      <StatusBar style={statusBarStyle} />
      <RootNavigator />
    </>
  );
}

export default function App() {
  const [fontsLoaded, fontsError] = useFonts({
    "Syne-Regular": Syne_400Regular,
    "Syne-SemiBold": Syne_600SemiBold,
    "Syne-Bold": Syne_700Bold,
    "Syne-ExtraBold": Syne_800ExtraBold,
    "DMSans-Light": DMSans_400Regular,
    "DMSans-Regular": DMSans_400Regular,
    "DMSans-Medium": DMSans_500Medium,
    "DMSans-SemiBold": DMSans_500Medium,
    "DMSans-Bold": DMSans_700Bold,
    "Outfit-SemiBold": Outfit_600SemiBold,
    "Outfit-Bold": Outfit_700Bold,
    "Outfit-ExtraBold": Outfit_800ExtraBold,
    "SpaceGrotesk-Regular": SpaceGrotesk_400Regular,
    "SpaceGrotesk-Medium": SpaceGrotesk_500Medium,
    "SpaceGrotesk-SemiBold": SpaceGrotesk_600SemiBold,
    "SpaceGrotesk-Bold": SpaceGrotesk_700Bold,
  });

  const [fontGateTimedOut, setFontGateTimedOut] = React.useState(false);

  React.useEffect(() => {
    if (fontsLoaded || fontsError) {
      setFontGateTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setFontGateTimedOut(true), 4000);
    return () => clearTimeout(timer);
  }, [fontsLoaded, fontsError]);

  const skipFontGate = Platform.OS === "web" || process.env.CI === "1" || __DEV__;
  const canRender = skipFontGate || fontsLoaded || Boolean(fontsError) || fontGateTimedOut;

  if (!canRender) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <MvThemeProvider>
        <StripeAppProvider>
          <AppStateProvider>
            <AppContent />
          </AppStateProvider>
        </StripeAppProvider>
      </MvThemeProvider>
    </SafeAreaProvider>
  );
}
