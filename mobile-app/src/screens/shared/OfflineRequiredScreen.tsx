import React from "react";
import { StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MvButton } from "../../components/mv/MvButton";
import { MvText } from "../../components/mv/MvText";
import { C, S } from "../../theme/v2tokens";
import { useMvTheme } from "../../theme/MvThemeContext";

type OfflineRequiredScreenProps = {
  onRetry?: () => void;
};

export function OfflineRequiredScreen({ onRetry }: OfflineRequiredScreenProps) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{
      flex: 1, backgroundColor: theme.bg,
      alignItems: "center", justifyContent: "center",
      paddingHorizontal: S.px,
      paddingBottom: Math.max(insets.bottom + 16, 24),
      gap: 14,
    }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <View style={{
        width: 80, height: 80, borderRadius: 22,
        backgroundColor: C.skyDim, borderWidth: 1, borderColor: C.skyBorder,
        alignItems: "center", justifyContent: "center",
      }}>
        <Ionicons name="wifi-outline" size={40} color={C.sky} />
      </View>

      <MvText variant="h2" style={{ textAlign: "center" }}>Sem conexão</MvText>

      <MvText variant="body3" color="secondary" style={{ textAlign: "center", maxWidth: 220, lineHeight: 22 }}>
        Verifique sua conexão com a internet e tente novamente.
      </MvText>

      <MvButton
        label="Tentar novamente"
        onPress={() => onRetry?.()}
        style={{ maxWidth: 240, width: "100%" }}
      />
    </View>
  );
}
