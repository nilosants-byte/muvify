import React from "react";
import { ActivityIndicator, Keyboard, StyleProp, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../../theme/MvThemeContext";
import { shadows } from "../../theme/tokens";
import { radius } from "../../theme/MvTypography";
import { PressableScale } from "../polish/PressableScale";
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
  // Frente 10 (segunda camada), Lote 14: MvButton não tinha slot de ícone —
  // telas que precisavam de um ícone junto do texto recorriam a emoji
  // dentro da própria label (ex: "💬  Chat") em vez de um Ionicons de verdade.
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: "left" | "right";
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
  icon,
  iconPosition = "left",
}: MvButtonProps) {
  const { theme } = useMvTheme();

  const containerStyle: ViewStyle = (() => {
    const base: ViewStyle = {
      borderRadius: radius.xl,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      opacity: disabled ? 0.45 : 1,
    };
    switch (variant) {
      case "primary":
        return {
          ...base,
          backgroundColor: disabled ? theme.border : theme.primary,
          borderColor: disabled ? theme.border : theme.primary,
          ...(!disabled ? shadows.button : {}),
        };
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
      case "primary": return disabled ? theme.text3 : theme.textOnPrimary;
      case "outline": return theme.text1;
      case "ghost": return theme.text2;
      case "danger": return theme.danger;
    }
  })();

  const handlePress = () => {
    Keyboard.dismiss();
    onPress?.();
  };

  return (
    <PressableScale
      disabled={disabled || loading}
      onPress={handlePress}
      scale={0.97}
      style={[containerStyle, style as ViewStyle]}
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : icon ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {iconPosition === "left" ? <Ionicons name={icon} size={16} color={textColor} /> : null}
          <MvText variant="semi2" numberOfLines={1} style={{ color: textColor }}>
            {label}
          </MvText>
          {iconPosition === "right" ? <Ionicons name={icon} size={16} color={textColor} /> : null}
        </View>
      ) : (
        <MvText variant="semi2" numberOfLines={1} style={{ color: textColor }}>
          {label}
        </MvText>
      )}
    </PressableScale>
  );
}
