import React from "react";
import { StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvText } from "../../components/mv";

type OfflineRequiredScreenProps = {
  onRetry?: () => void;
};

export function OfflineRequiredScreen({ onRetry }: OfflineRequiredScreenProps) {
  const { theme } = useMvTheme();
  const isLight = theme.mode === "light";

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{
        width: 80, height: 80, borderRadius: 22,
        backgroundColor: isLight ? "rgba(2,132,199,0.07)" : "rgba(56,189,248,0.08)",
        borderWidth: 1,
        borderColor: isLight ? "rgba(2,132,199,0.14)" : "rgba(56,189,248,0.16)",
        alignItems: "center", justifyContent: "center",
      }}>
        <Ionicons name="wifi-outline" size={40} color={isLight ? "#0284C7" : "#38BDF8"} />
      </View>
      <MvText variant="h3">Sem conexão</MvText>
      <MvText variant="body3" color="secondary" style={{ textAlign: "center", maxWidth: 200 }}>
        Verifique sua conexão com a internet e tente novamente.
      </MvText>
      <MvButton
        label="Tentar novamente"
        onPress={() => {
          onRetry?.();
        }}
        style={{ maxWidth: 200, width: "100%" }}
      />
    </View>
  );
}
