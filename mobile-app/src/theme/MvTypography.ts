import { TextStyle } from "react-native";

// Display — Plus Jakarta Sans (V2 design system)
const display = "PlusJakartaSans_800ExtraBold";

// UI — DM Sans (V2 design system)
const bold    = "DMSans_700Bold";
const medium  = "DMSans_500Medium";
const regular = "DMSans_400Regular";

export const typography = {
  // Títulos — Plus Jakarta Sans ExtraBold
  hero:    { fontFamily: display, fontSize: 32, fontWeight: "800" as const, letterSpacing: -0.5, lineHeight: 38 },
  display: { fontFamily: display, fontSize: 28, fontWeight: "800" as const, letterSpacing: -0.4, lineHeight: 34 },
  h1:      { fontFamily: display, fontSize: 24, fontWeight: "800" as const, letterSpacing: -0.3, lineHeight: 30 },
  h2:      { fontFamily: display, fontSize: 22, fontWeight: "800" as const, letterSpacing: -0.2, lineHeight: 28 },
  h3:      { fontFamily: display, fontSize: 19, fontWeight: "800" as const, letterSpacing: -0.1, lineHeight: 25 },
  h4:      { fontFamily: display, fontSize: 17, fontWeight: "800" as const, letterSpacing: 0,    lineHeight: 23 },

  // Corpo — DM Sans Regular
  body1: { fontFamily: regular, fontSize: 16, fontWeight: "400" as const, lineHeight: 24 },
  body2: { fontFamily: regular, fontSize: 15, fontWeight: "400" as const, lineHeight: 23 },
  body3: { fontFamily: regular, fontSize: 14, fontWeight: "400" as const, lineHeight: 21 },
  body4: { fontFamily: regular, fontSize: 13, fontWeight: "400" as const, lineHeight: 20 },

  // Semi-bold — DM Sans Bold (700) para hierarquia clara
  semi1: { fontFamily: bold, fontSize: 16, fontWeight: "700" as const, letterSpacing: -0.3 },
  semi2: { fontFamily: bold, fontSize: 15, fontWeight: "700" as const, letterSpacing: -0.2 },
  semi3: { fontFamily: bold, fontSize: 14, fontWeight: "700" as const },

  // Utilitários
  eyebrow: { fontFamily: bold,   fontSize: 10, fontWeight: "700" as const, letterSpacing: 1.2, textTransform: "uppercase" as const },
  caption: { fontFamily: medium, fontSize: 11, fontWeight: "500" as const, letterSpacing: 0.2 },
  label:   { fontFamily: medium, fontSize: 13, fontWeight: "500" as const },
  badge:   { fontFamily: bold,   fontSize: 11, fontWeight: "700" as const, letterSpacing: 0.2 },
  navLabel:{ fontFamily: medium, fontSize: 10, fontWeight: "500" as const },
} satisfies Record<string, TextStyle>;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 16,
  xxl: 20,
  full: 999,
} as const;
