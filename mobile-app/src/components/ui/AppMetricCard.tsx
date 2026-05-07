import React from "react";
import { View } from "react-native";
import { AppText } from "./AppText";
import { theme } from "../../theme";
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

interface AppMetricCardProps {
  value: string | number;
  label: string;
  delta?: string;
  deltaPositive?: boolean;
  style?: import("react-native").ViewStyle;
}

export function AppMetricCard({
  value,
  label,
  delta,
  deltaPositive = true,
  style,
}: AppMetricCardProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    container: {
      flex: 1,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: theme.radius.md,
      padding: 14,
      paddingHorizontal: 12,
    },
    label: {
      marginTop: 2,
    },
    delta: {
      marginTop: 4,
    },
  }));
  return (
    <View style={[styles.container, style]}>
      <AppText variant="title">{value}</AppText>
      <AppText style={styles.label} variant="caption">
        {label}
      </AppText>
      {delta ? (
        <AppText
          color={deltaPositive ? colors.primarySoft : colors.danger}
          style={styles.delta}
          variant="caption"
        >
          {delta}
        </AppText>
      ) : null}
    </View>
  );
}
