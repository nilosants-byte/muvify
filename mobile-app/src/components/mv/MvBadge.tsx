import React from "react";
import { StyleProp, Text, View, ViewStyle } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";
import { typography } from "../../theme/MvTypography";

type BadgeVariant = "green" | "orange" | "blue" | "red" | "gray" | "greenDark";

interface MvBadgeProps {
  variant?: BadgeVariant;
  label: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function MvBadge({ variant = "green", label, style, accessibilityLabel }: MvBadgeProps) {
  const { theme } = useMvTheme();
  const isLight = theme.mode === "light";

  const { bg, textColor } = (() => {
    switch (variant) {
      case "green":
        return {
          bg: theme.primarySubtle,
          textColor: theme.primary,
        };
      case "greenDark":
        return {
          bg: theme.primarySubtle,
          textColor: "#24E66D",
        };
      case "orange":
        return {
          bg: theme.warningSubtle,
          textColor: theme.warning,
        };
      case "blue":
        return {
          bg: isLight ? "rgba(37,99,235,0.10)" : "rgba(59,130,246,0.14)",
          textColor: isLight ? "#2563EB" : "#3B82F6",
        };
      case "red":
        return {
          bg: theme.dangerSubtle,
          textColor: theme.danger,
        };
      case "gray":
      default:
        return {
          bg: isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)",
          textColor: isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.45)",
        };
    }
  })();

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        {
          borderRadius: 999,
          paddingHorizontal: 8,
          paddingVertical: 2,
          backgroundColor: bg,
          alignSelf: "flex-start",
        },
        style,
      ]}
    >
      <Text style={[typography.badge, { color: textColor }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}
