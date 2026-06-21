export type ThemeMode = "dark" | "light";

export const darkColors = {
  black: "#000000",
  white: "#FFFFFF",
  background: "#030806",
  surface: "#07120C",
  surfaceStrong: "#07120C",
  surfaceElevated: "#0D1F14",
  surfaceHighest: "#0D1F14",
  inputBg: "#0D1F14",
  border: "rgba(255,255,255,0.07)",
  borderMedium: "rgba(255,255,255,0.11)",
  borderStrong: "rgba(255,255,255,0.16)",
  navBg: "rgba(3,8,6,0.95)",
  primary: "#24E66D",
  primaryDark: "#16A34A",
  primarySoft: "#5BFFAA",
  primaryGradientStart: "#24E66D",
  primaryGradientEnd: "#5BFFAA",
  primaryMuted: "rgba(36,230,109,0.10)",
  softWhite: "#E4E4E7",
  textSecondary: "#A1A1AA",
  textTertiary: "#71717A",
  textInverse: "#030806",
  danger: "#EF4444",
  dangerStrong: "#DC2626",
  warning: "#F59E0B",
  success: "#24E66D",
  info: "#3B82F6",
  disabledBg: "#0D1F14",
  disabledText: "#71717A",
  overlay: "rgba(0,0,0,0.72)",
  overlaySoft: "rgba(0,0,0,0.45)",
  inputPlaceholder: "#71717A",
  divider: "rgba(255,255,255,0.07)",
  chipBg: "rgba(255,255,255,0.04)",
  chipBorder: "rgba(255,255,255,0.09)",
  cardGlow: "rgba(36,230,109,0.22)",
  offline: "#A1A1AA",
  // Backward compatibility with the previous mobile frontend.
  bg: "#030806",
  surfaceAlt: "#07120C",
  text: "#FFFFFF",
  textMuted: "#A1A1AA",
} as const;

export const lightColors = {
  black: "#000000",
  white: "#FFFFFF",
  background: "#F6F8F6",
  surface: "#FFFFFF",
  surfaceStrong: "#FFFFFF",
  surfaceElevated: "#EEF7F1",
  surfaceHighest: "#FFFFFF",
  inputBg: "#FFFFFF",
  border: "rgba(15, 23, 42, 0.08)",
  borderMedium: "rgba(15, 23, 42, 0.12)",
  borderStrong: "rgba(15, 23, 42, 0.20)",
  navBg: "rgba(246, 248, 246, 0.96)",
  primary: "#24E66D",
  primaryDark: "#16A34A",
  primarySoft: "#4ADE80",
  primaryGradientStart: "#24E66D",
  primaryGradientEnd: "#4ADE80",
  primaryMuted: "rgba(34, 197, 94, 0.10)",
  softWhite: "#111827",
  textSecondary: "#4B5563",
  textTertiary: "#9CA3AF",
  textInverse: "#F6F8F6",
  danger: "#DC2626",
  dangerStrong: "#B91C1C",
  warning: "#D97706",
  success: "#16A34A",
  info: "#2563EB",
  disabledBg: "#EEF7F1",
  disabledText: "#9CA3AF",
  overlay: "rgba(0, 0, 0, 0.18)",
  overlaySoft: "rgba(0, 0, 0, 0.10)",
  inputPlaceholder: "#9CA3AF",
  divider: "rgba(15, 23, 42, 0.08)",
  chipBg: "rgba(34, 197, 94, 0.10)",
  chipBorder: "rgba(15, 23, 42, 0.10)",
  cardGlow: "rgba(34, 197, 94, 0.18)",
  offline: "#4B5563",
  // Backward compatibility with the previous mobile frontend.
  bg: "#F6F8F6",
  surfaceAlt: "#FFFFFF",
  text: "#111827",
  textMuted: "#4B5563",
} as const;

export const isLightModeEnabled =
  typeof process !== "undefined" && process.env.EXPO_PUBLIC_ENABLE_LIGHT_MODE === "true";

const requestedThemeMode =
  typeof process !== "undefined" ? process.env.EXPO_PUBLIC_THEME_MODE : undefined;

let runtimeThemeMode: ThemeMode =
  isLightModeEnabled && requestedThemeMode?.toLowerCase() === "light" ? "light" : "dark";

// Mutable color reference for legacy imports that still pull `colors` directly.
export const colors = { ...getColors() } as typeof darkColors;

export function setThemeMode(mode: ThemeMode) {
  runtimeThemeMode = mode;
  Object.assign(colors, getColors());
}

export function getThemeMode() {
  return runtimeThemeMode;
}

export function getColors() {
  return runtimeThemeMode === "light" ? lightColors : darkColors;
}

// ─── DEPRECATED ──────────────────────────────────────────────────────────────
// Os objetos abaixo conflitam com MvTypography.ts, que é a fonte da verdade
// para spacing, radius e tipografia. Mantidos apenas para retrocompatibilidade.
// Novos usos: importe de ../../theme/MvTypography.
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use `spacing` de MvTypography */
export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 48,
  "3xl": 64,
} as const;

/** @deprecated Use `radius` de MvTypography (radius.xl = 16 para cards) */
export const radius = {
  sm: 8,
  md: 12,
  card: 16,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** @deprecated Use `typography` de MvTypography (TextStyle completo) */
export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  "2xl": 28,
  "3xl": 38,
} as const;

/** @deprecated Use fontFamily constants de MvTypography */
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
} as const;

/** @deprecated Use `typography` (TextStyle) de MvTypography */
export const typography = {
  h1: 38,
  h2: 28,
  h3: 22,
  body: 15,
  caption: 13,
} as const;

export const shadows = {
  card: {
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  cardGreen: {
    shadowColor: "#24E66D",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  bottomNav: {
    shadowColor: "#000000",
    shadowOpacity: 0.50,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  button: {
    shadowColor: "#24E66D",
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
} as const;

export const layout = {
  screenHorizontalPadding: 20,
  screenTopSpacing: 16,
  sectionGap: 24,
  inputHeight: 52,
  buttonHeight: 52,
  tabHeight: 40,
  listGap: 12,
  iconSize: 20,
} as const;

export const zIndex = {
  base: 1,
  header: 10,
  modal: 100,
  toast: 200,
} as const;

export const timing = {
  fast: 140,
  normal: 220,
  slow: 320,
} as const;

export type AppColor = keyof typeof colors;
