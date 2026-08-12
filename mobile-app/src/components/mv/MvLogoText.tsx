import React from "react";
import { StyleProp, Text, TextStyle, View } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";

// Frente 10 (segunda camada), Lote 11: migrado de components/ui/AppLogoText.tsx
// (sistema de design legado, removido) — usado por AuthLoginScreen,
// AuthRegisterScreen e ProfessionalHomeScreen.
export function MvLogoText({ size = 18, style }: { size?: number; style?: StyleProp<TextStyle> }) {
  const lineHeight = Math.round(size * 1.15);
  const letterSpacing = -0.03 * size;
  const { theme } = useMvTheme();
  const muviColor = theme.text1;
  const fyColor = theme.primary;
  const baseStyle = {
    fontFamily: "Nunito_800ExtraBold",
    fontWeight: "800" as const,
    includeFontPadding: false,
    letterSpacing,
    lineHeight,
    fontSize: size,
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 1 }} accessibilityLabel="muvify">
      <Text style={[baseStyle, { color: muviColor }, style]}>muvi</Text>
      <Text style={[baseStyle, { color: fyColor }, style]}>fy</Text>
    </View>
  );
}
