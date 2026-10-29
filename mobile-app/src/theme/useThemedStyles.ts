import { useMemo } from "react";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";
import { useTheme } from "./useTheme";

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

type StyleFactory<T extends NamedStyles<T>> = (colors: ReturnType<typeof useTheme>["colors"]) => T;

export function useThemedStyles<T extends NamedStyles<T>>(factory: StyleFactory<T>) {
  const { colors } = useTheme();
  return useMemo(() => StyleSheet.create(factory(colors)), [colors, factory]);
}
