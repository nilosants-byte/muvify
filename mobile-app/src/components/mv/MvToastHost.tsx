import React from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMvTheme } from "../../theme/MvThemeContext";
import { C } from "../../theme/v2tokens";

// Frente 10 (segunda camada), Lote 11: migrado de components/primitives.tsx
// (sistema de design legado, removido) — único componente de lá com uso
// real, em root-stack.tsx.
export function MvToastHost({
  message,
  type = "info",
}: {
  message: string;
  type?: "info" | "success" | "error";
}) {
  const insets = useSafeAreaInsets();
  const { theme: mvTheme } = useMvTheme();

  const bg =
    type === "success" ? mvTheme.primary
    : type === "error"  ? mvTheme.danger
    : C.surface1;
  const textColor = type === "success" ? mvTheme.textOnPrimary : C.white;
  const hasBorder = type === "info";

  return (
    <View
      style={{
        position: "absolute",
        alignSelf: "center",
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 999,
        zIndex: 9999,
        maxWidth: 480,
        bottom: Math.max(24, insets.bottom + 16),
        backgroundColor: bg,
        borderWidth: hasBorder ? 1 : 0,
        borderColor: "rgba(255,255,255,0.14)",
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8,
      }}
      accessibilityLiveRegion="polite"
      accessibilityRole={type === "error" ? "alert" : "text"}
    >
      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: textColor, textAlign: "center" }}>
        {message}
      </Text>
    </View>
  );
}
