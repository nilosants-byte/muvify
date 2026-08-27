import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { Platform } from "react-native";
import { useFonts } from "expo-font";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./src/lib/queryClient";
import { initSentry } from "./src/observability/sentry";
import { RootNavigator } from "./src/navigation/root-stack";
import { AppStateProvider } from "./src/state/AppState";
import { ToastProvider } from "./src/state/ToastState";
import { SubscriptionGateProvider } from "./src/state/SubscriptionGateState";
import { PostHogProvider } from "posthog-react-native";
import { posthog } from "./src/services/analytics";
import { useTheme } from "./src/theme/useTheme";
import "./src/services/location/providerBackgroundLocation";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import { PlusJakartaSans_700Bold } from "@expo-google-fonts/plus-jakarta-sans/700Bold";
import { PlusJakartaSans_800ExtraBold } from "@expo-google-fonts/plus-jakarta-sans/800ExtraBold";
import { Nunito_800ExtraBold } from "@expo-google-fonts/nunito/800ExtraBold";
import { Nunito_400Regular } from "@expo-google-fonts/nunito/400Regular";
import { MvThemeProvider } from "./src/theme/MvThemeContext";
import { ErrorBoundary } from "./src/components/ErrorBoundary";

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
  const skipFontLoading = Platform.OS === "web" || process.env.EXPO_PUBLIC_SKIP_FONT_LOADING === "true";
  const [fontsLoaded, fontsError] = useFonts(skipFontLoading ? {} : {
    "PlusJakartaSans_800ExtraBold": PlusJakartaSans_800ExtraBold,
    "PlusJakartaSans_700Bold": PlusJakartaSans_700Bold,
    "DMSans_400Regular": DMSans_400Regular,
    "DMSans_500Medium": DMSans_500Medium,
    "DMSans_700Bold": DMSans_700Bold,
    "Nunito_800ExtraBold": Nunito_800ExtraBold,
    "Nunito_400Regular": Nunito_400Regular,
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

  const content = (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <MvThemeProvider>
            <ToastProvider>
              <SubscriptionGateProvider>
                <AppStateProvider>
                  <AppContent />
                </AppStateProvider>
              </SubscriptionGateProvider>
            </ToastProvider>
          </MvThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {posthog ? (
        <PostHogProvider client={posthog} autocapture={{ captureScreens: false }}>
          {content}
        </PostHogProvider>
      ) : (
        content
      )}
    </GestureHandlerRootView>
  );
}
