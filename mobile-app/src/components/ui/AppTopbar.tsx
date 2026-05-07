import React from "react";
import { Pressable, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "./AppText";
import { theme } from "../../theme";
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";
import { IconChevronLeft } from "../icons/MuvifyIcons";

interface AppTopbarProps {
  title?: string;
  onBack?: () => void;
  fallbackRoute?: string;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  transparent?: boolean;
}

export function AppTopbar({
  title,
  onBack,
  fallbackRoute,
  leftSlot,
  rightSlot,
  transparent = false,
}: AppTopbarProps) {
  const insets = (() => {
    try {
      return useSafeAreaInsets();
    } catch {
      return { top: 0, bottom: 0, left: 0, right: 0 };
    }
  })();
  const navigation = (() => {
    try {
      return useNavigation<any>();
    } catch {
      return null;
    }
  })();
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    container: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingBottom: 14,
      paddingHorizontal: theme.spacing.md,
    },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.md,
      backgroundColor: palette.surfaceElevated,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
    },
    spacer: {
      width: 36,
      height: 36,
    },
    title: {
      flex: 1,
      textAlign: "center",
      letterSpacing: -0.3,
    },
    titleSpacer: {
      flex: 1,
    },
  }));

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    if (fallbackRoute) {
      navigation?.navigate?.(fallbackRoute);
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 8,
          backgroundColor: transparent ? "transparent" : colors.background,
        },
      ]}
    >
      {onBack || fallbackRoute ? (
        <Pressable
          accessibilityLabel="Voltar"
          accessibilityRole="button"
          hitSlop={8}
          style={styles.iconButton}
          onPress={handleBack}
        >
          <IconChevronLeft color={colors.text} size={16} />
        </Pressable>
      ) : (
        leftSlot ?? <View style={styles.spacer} />
      )}

      {title ? (
        <AppText style={styles.title} variant="title" numberOfLines={1}>
          {title}
        </AppText>
      ) : (
        <View style={styles.titleSpacer} />
      )}

      {rightSlot ?? <View style={styles.spacer} />}
    </View>
  );
}
