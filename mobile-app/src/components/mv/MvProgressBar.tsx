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
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <View
      style={[
        {
          height,
          borderRadius: height,
          backgroundColor: theme.mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)",
          marginTop: 6,
          overflow: "hidden",
        },
        style,
      ]}
    >
      <View
        style={{
          height,
          borderRadius: height,
          backgroundColor: "#4CAF50",
          width: `${clamped * 100}%`,
        }}
      />
    </View>
  );
}
