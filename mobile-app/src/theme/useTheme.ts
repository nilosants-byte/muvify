import { useAppState } from "../state/AppState";
import { darkColors, getThemeMode, lightColors, ThemeMode } from "./tokens";

export function useTheme(): { colors: typeof lightColors | typeof darkColors; themeMode: ThemeMode } {
  let themeMode: ThemeMode = getThemeMode();
  try {
    themeMode = useAppState().themeMode;
  } catch {
    // Fallback for isolated renders (tests/storybook) without AppStateProvider.
    themeMode = getThemeMode();
  }
  const colors = themeMode === "light" ? lightColors : darkColors;
  return { colors, themeMode };
}

export type { ThemeMode };
