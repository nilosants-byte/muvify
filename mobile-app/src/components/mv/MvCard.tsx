import React from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";
import { cardShadowLight } from "../../theme/MvColors";
import { shadows } from "../../theme/tokens";
import { radius } from "../../theme/MvTypography";

type CardVariant = "default" | "green" | "flat";

interface MvCardProps {
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function MvCard({ variant = "default", style, children }: MvCardProps) {
  const { theme } = useMvTheme();
  const isLight = theme.mode === "light";

  const baseStyle: ViewStyle = {
    borderRadius: radius.xl,
    padding: 14,
    borderWidth: 1,
  };

  const variantStyle: ViewStyle = (() => {
    switch (variant) {
      case "green":
        return {
          backgroundColor: isLight ? theme.primarySubtle : theme.primarySubtle,
          borderColor: isLight ? theme.primarySubtleBorder : theme.primarySubtleBorder,
          ...shadows.cardGreen,
        };
      case "flat":
        return {
          backgroundColor: "transparent",
          borderColor: "transparent",
        };
      default:
        return {
          backgroundColor: theme.cardBg,
          borderColor: isLight ? "rgba(15,23,42,0.07)" : "rgba(255,255,255,0.07)",
          ...(isLight ? cardShadowLight : {}),
        };
    }
  })();

  return (
    <View style={[baseStyle, variantStyle, style]}>
      {children}
    </View>
  );
}
