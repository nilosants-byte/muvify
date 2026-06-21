import React from "react";
import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "../../theme";
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

interface AppProgressBarProps {
  progress: number;
}

export function AppProgressBar({ progress }: AppProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, Number.isNaN(progress) ? 0 : progress));
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    track: {
      width: "100%",
      height: 6,
      borderRadius: 999,
      backgroundColor: palette.surfaceElevated,
      borderWidth: 1,
      borderColor: palette.border,
      overflow: "hidden",
    },
    fill: {
      height: "100%",
      borderRadius: 999,
    },
  }));
  return (
    <View style={styles.track}>
      <LinearGradient
        colors={[colors.primaryDark, colors.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.fill, { width: `${clamped * 100}%` }]}
      />
    </View>
  );
}
