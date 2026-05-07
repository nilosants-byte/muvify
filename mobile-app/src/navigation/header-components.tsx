import React from "react";
import { Pressable } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { NativeStackHeaderLeftProps } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { theme } from "../theme";
import { useTheme } from "../theme/useTheme";
import { useThemedStyles } from "../theme/useThemedStyles";

export function HeaderBackButton({ canGoBack }: NativeStackHeaderLeftProps) {
  const navigation = useNavigation();
  if (!canGoBack) return null;
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    button: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surfaceElevated,
      borderWidth: 1,
      borderColor: palette.border,
    },
    pressed: {
      opacity: 0.85,
      transform: [{ scale: 0.97 }],
    },
  }));

  return (
    <Pressable
      accessibilityLabel="Voltar"
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => navigation.goBack()}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <MaterialIcons
        accessibilityElementsHidden
        color={colors.text}
        importantForAccessibility="no"
        name="chevron-left"
        size={18}
      />
    </Pressable>
  );
}
