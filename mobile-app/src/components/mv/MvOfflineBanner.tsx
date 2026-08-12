import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../../theme/MvThemeContext";

// Frente 11 (engenharia mobile), Lote 1: substitui o bloqueio de tela cheia
// (que desmontava toda a navegação) por um aviso que fica por cima da tela
// atual, sem tirar o usuário de onde ele estava nem descartar formulário/
// upload em andamento.
export function MvOfflineBanner({ onRetry, checking }: { onRetry?: () => void; checking?: boolean }) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        position: "absolute",
        top: insets.top,
        left: 0,
        right: 0,
        zIndex: 9998,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        backgroundColor: theme.danger,
      }}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Ionicons name="cloud-offline-outline" size={16} color="#fff" />
      <Text style={{ flex: 1, fontFamily: "DMSans_700Bold", fontSize: 12, color: "#fff" }}>
        Sem conexão. Tentando reconectar...
      </Text>
      <TouchableOpacity onPress={() => onRetry?.()} disabled={checking} accessibilityRole="button" accessibilityLabel="Tentar reconectar agora">
        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: "#fff", textDecorationLine: "underline", opacity: checking ? 0.6 : 1 }}>
          {checking ? "..." : "Tentar agora"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
