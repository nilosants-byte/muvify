import React from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";

interface MvProgressBarProps {
  progress: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export function MvProgressBar({ progress, height = 3, style }: MvProgressBarProps) {
  const { theme } = useMvTheme();
  const safeProgress = Number.isFinite(progress) ? progress : 0;
  const safeHeight = Math.max(1, height);
  const clamped = Math.min(1, Math.max(0, safeProgress));

  return (
    <View
      style={[
        {
          height: safeHeight,
          borderRadius: safeHeight,
          backgroundColor: theme.mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)",
          marginTop: 6,
          overflow: "hidden",
        },
        style,
      ]}
    >
      <View
        style={{
          height: safeHeight,
          borderRadius: safeHeight,
          backgroundColor: theme.primary,
          width: `${clamped * 100}%`,
        }}
      />
    </View>
  );
}
