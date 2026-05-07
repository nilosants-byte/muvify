import React from "react";
import { Pressable, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { AppText } from "../ui/AppText";
import { theme } from "../../theme";
import { IconChevronLeft } from "../icons/MuvifyIcons";
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

type Props = {
  title?: string;
  fallbackRoute?: string;
};

export function AppBackHeader({ title, fallbackRoute }: Props) {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    backButton: {
      width: 44,
      height: 44,
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceElevated,
    },
    backButtonPressed: {
      opacity: 0.8,
      transform: [{ scale: 0.98 }],
    },
    title: {
      flex: 1,
    },
  }));

  const goBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    if (fallbackRoute) {
      navigation.navigate(fallbackRoute);
    }
  };

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel="Voltar"
        accessibilityRole="button"
        hitSlop={8}
        style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
        onPress={goBack}
      >
        <IconChevronLeft color={colors.text} size={18} />
      </Pressable>
      {title ? (
        <AppText style={styles.title} variant="bodyStrong">
          {title}
        </AppText>
      ) : null}
    </View>
  );
}
