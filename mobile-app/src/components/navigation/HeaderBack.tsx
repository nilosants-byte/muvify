import React from "react";
import { Pressable, useWindowDimensions } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { AppText } from "../ui/AppText";
import { theme } from "../../theme";
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

const MIN_TOUCH_SIZE = 44;

type HeaderBackProps = {
  onPress: () => void;
  label?: string;
};

export function HeaderBack({ onPress, label = "Voltar" }: HeaderBackProps) {
  const { fontScale } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    wrap: {
      alignItems: "center",
      flexDirection: "row",
    },
    pressed: {
      opacity: 0.6,
      transform: [{ scale: 0.96 }],
    },
    label: {
      color: palette.softWhite,
    },
  }));

  const iconSize = Math.round(20 * Math.min(fontScale, 1.3));
  const paddingV = Math.max(8, Math.round((MIN_TOUCH_SIZE - iconSize) / 2));
  const paddingH = Math.max(8, Math.round(4 * Math.min(fontScale, 1.3)));
  const gap = Math.round(4 * Math.min(fontScale, 1.3));

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityHint="Retorna para a tela anterior"
      onPress={onPress}
      hitSlop={{
        top: Math.max(0, (MIN_TOUCH_SIZE - iconSize) / 2 - paddingV + 4),
        bottom: Math.max(0, (MIN_TOUCH_SIZE - iconSize) / 2 - paddingV + 4),
        left: 8,
        right: 8,
      }}
      style={({ pressed }) => [
        styles.wrap,
        {
          paddingHorizontal: paddingH,
          paddingVertical: paddingV,
          gap,
          minWidth: MIN_TOUCH_SIZE,
          minHeight: MIN_TOUCH_SIZE,
        },
        pressed && styles.pressed,
      ]}
    >
      <MaterialIcons
        color={colors.softWhite}
        name="arrow-back-ios-new"
        size={iconSize}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
      <AppText style={styles.label} variant="caption">
        {label}
      </AppText>
    </Pressable>
  );
}
