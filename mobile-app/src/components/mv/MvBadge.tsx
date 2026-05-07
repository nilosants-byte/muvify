import React from "react";
import { StyleProp, Text, View, ViewStyle } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";
import { typography } from "../../theme/MvTypography";

type BadgeVariant = "green" | "orange" | "blue" | "red" | "gray" | "greenDark";

interface MvBadgeProps {
  variant?: BadgeVariant;
  label: string;
  style?: StyleProp<ViewStyle>;
}

export function MvBadge({ variant = "green", label, style }: MvBadgeProps) {
  const { theme } = useMvTheme();
  const isLight = theme.mode === "light";

  const { bg, textColor } = (() => {
    switch (variant) {
      case "green":
        return {
          bg: isLight ? "rgba(34,197,94,0.10)" : "rgba(34,197,94,0.13)",
          textColor: isLight ? "#16A34A" : "#22C55E",
        };
      case "greenDark":
        return {
          bg: "rgba(34,197,94,0.13)",
          textColor: "#22C55E",
        };
      case "orange":
        return {
          bg: isLight ? "rgba(217,119,6,0.10)" : "rgba(245,158,11,0.14)",
          textColor: isLight ? "#D97706" : "#F59E0B",
        };
      case "blue":
        return {
          bg: isLight ? "rgba(37,99,235,0.10)" : "rgba(59,130,246,0.14)",
          textColor: isLight ? "#2563EB" : "#3B82F6",
        };
      case "red":
        return {
          bg: isLight ? "rgba(220,38,38,0.10)" : "rgba(239,68,68,0.14)",
          textColor: isLight ? "#DC2626" : "#EF4444",
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
      <Text style={[typography.badge, { color: textColor }]}>{label}</Text>
    </View>
  );
}
