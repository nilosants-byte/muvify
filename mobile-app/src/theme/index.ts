import {
  darkColors,
  fontSize,
  fontWeight,
  getColors,
  getThemeMode,
  layout,
  lightColors,
  radius,
  shadows,
  spacing,
  timing,
  ThemeMode,
  zIndex
} from "./tokens";

export function createTheme(mode: ThemeMode) {
  return {
    mode,
    colors: mode === "light" ? lightColors : darkColors,
    spacing,
    radius,
    fontSize,
    fontWeight,
    shadows,
    layout,
    timing,
    zIndex
  } as const;
}

export const darkTheme = createTheme("dark");
export const lightTheme = createTheme("light");

// Backward compatibility: existing screens currently consume the default theme directly.
export const theme = {
  get mode() {
    return getThemeMode();
  },
  get colors() {
    return getColors();
  },
  spacing,
  radius,
  fontSize,
  fontWeight,
  shadows,
  layout,
  timing,
  zIndex
} as const;

export type AppTheme = ReturnType<typeof createTheme>;
