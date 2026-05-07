import React from "react";
import {
  ActivityIndicator,
  StyleProp,
  TouchableOpacity,
  ViewStyle,
} from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";
import { shadows } from "../../theme/tokens";
import { MvText } from "./MvText";

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

interface MvButtonProps {
  variant?: ButtonVariant;
  label: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

export function MvButton({
  variant = "primary",
  label,
  onPress,
  loading = false,
  disabled = false,
  style,
  testID,
  accessibilityLabel,
}: MvButtonProps) {
  const { theme } = useMvTheme();

  const containerStyle: ViewStyle = (() => {
    const base: ViewStyle = {
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      opacity: disabled ? 0.4 : 1,
    };
    switch (variant) {
      case "primary":
        return { ...base, backgroundColor: "#22C55E", borderColor: "#22C55E", ...shadows.button };
      case "outline":
        return { ...base, backgroundColor: "transparent", borderColor: theme.border };
      case "ghost":
        return { ...base, backgroundColor: "transparent", borderColor: "transparent" };
      case "danger":
        return {
          ...base,
          backgroundColor: "transparent",
          borderColor: theme.mode === "dark" ? "rgba(239,68,68,0.30)" : "rgba(220,38,38,0.25)",
        };
    }
  })();

  const textColor = (() => {
    switch (variant) {
      case "primary": return "#FFFFFF";
      case "outline": return theme.text1;
      case "ghost": return theme.text2;
      case "danger": return theme.mode === "dark" ? "#EF4444" : "#DC2626";
    }
  })();

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled || loading}
      onPress={onPress}
      style={[containerStyle, style]}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <MvText variant="semi2" style={{ color: textColor, fontSize: 14 }}>
          {label}
        </MvText>
      )}
    </TouchableOpacity>
  );
}
