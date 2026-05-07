import React from "react";
import { StyleProp, TextStyle, View } from "react-native";
import { AppText } from "./AppText";
import { useMvTheme } from "../../theme/MvThemeContext";

interface AppLogoTextProps {
  size?: number;
  style?: StyleProp<TextStyle>;
}

export function AppLogoText({ size = 18, style }: AppLogoTextProps) {
  const lineHeight = Math.round(size * 1.18);
  const { theme } = useMvTheme();
  const muviColor = theme.mode === "light" ? "#111111" : "#F0F0F0";
  const fyColor = "#4CAF50";
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 1 }} accessibilityLabel="muvify">
      <AppText
        style={[
          {
            fontFamily: "Syne-Bold",
            fontSize: 18,
            lineHeight,
            includeFontPadding: false,
            letterSpacing: -0.8,
            color: muviColor,
            textTransform: "lowercase",
          },
          style,
          { fontSize: size, lineHeight },
        ]}
      >
        muvi
      </AppText>
      <AppText
        style={[
          {
            fontFamily: "Syne-Bold",
            fontSize: 18,
            lineHeight,
            includeFontPadding: false,
            letterSpacing: -0.8,
            color: fyColor,
            textTransform: "lowercase",
          },
          style,
          { fontSize: size, lineHeight },
        ]}
      >
        fy
      </AppText>
    </View>
  );
}
