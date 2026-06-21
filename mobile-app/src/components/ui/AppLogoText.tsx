import React from "react";
import { StyleProp, TextStyle, View } from "react-native";
import { AppText } from "./AppText";
import { useMvTheme } from "../../theme/MvThemeContext";

interface AppLogoTextProps {
  size?: number;
  style?: StyleProp<TextStyle>;
}

export function AppLogoText({ size = 18, style }: AppLogoTextProps) {
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
      <AppText style={[baseStyle, { color: muviColor }, style]}>muvi</AppText>
      <AppText style={[baseStyle, { color: fyColor }, style]}>fy</AppText>
    </View>
  );
}
