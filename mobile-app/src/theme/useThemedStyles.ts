import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { useTheme } from "./useTheme";

type StyleFactory<T extends StyleSheet.NamedStyles<T>> = (colors: ReturnType<typeof useTheme>["colors"]) => T;

export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: StyleFactory<T>) {
  const { colors } = useTheme();
  return useMemo(() => StyleSheet.create(factory(colors)), [colors, factory]);
}
