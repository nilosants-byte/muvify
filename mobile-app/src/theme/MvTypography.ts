import { Platform, TextStyle } from "react-native";

// Títulos e destaques: Outfit — moderna, com personalidade, mais tech que SpaceGrotesk
const titleBold: TextStyle["fontFamily"] = Platform.select({
  ios: "Outfit-Bold",
  android: "Outfit-Bold",
  default: "Outfit-Bold",
});
const titleXBold: TextStyle["fontFamily"] = Platform.select({
  ios: "Outfit-ExtraBold",
  android: "Outfit-ExtraBold",
  default: "Outfit-ExtraBold",
});

// Corpo e UI: DM Sans — humanista, quente, legível — próxima ao Inter usado no conceito
const bold: TextStyle["fontFamily"] = Platform.select({
  ios: "DMSans-Bold",
  android: "DMSans-Bold",
  default: "DMSans-Bold",
});
const semibold: TextStyle["fontFamily"] = Platform.select({
  ios: "DMSans-SemiBold",
  android: "DMSans-SemiBold",
  default: "DMSans-SemiBold",
});
const medium: TextStyle["fontFamily"] = Platform.select({
  ios: "DMSans-Medium",
  android: "DMSans-Medium",
  default: "DMSans-Medium",
});
const regular: TextStyle["fontFamily"] = Platform.select({
  ios: "DMSans-Regular",
  android: "DMSans-Regular",
  default: "DMSans-Regular",
});

export const typography = {
  // Títulos de tela e seção — Outfit dá mais personalidade e impacto
  hero:    { fontFamily: titleXBold, fontSize: 32, fontWeight: "800" as const, letterSpacing: -0.8 },
  display: { fontFamily: titleXBold, fontSize: 28, fontWeight: "800" as const, letterSpacing: -0.6 },
  h1:      { fontFamily: titleBold,  fontSize: 24, fontWeight: "700" as const, letterSpacing: -0.4 },
  h2:      { fontFamily: titleBold,  fontSize: 22, fontWeight: "700" as const, letterSpacing: -0.3 },
  h3:      { fontFamily: titleBold,  fontSize: 19, fontWeight: "700" as const, letterSpacing: -0.2 },
  h4:      { fontFamily: titleBold,  fontSize: 17, fontWeight: "700" as const },

  // Corpo — DM Sans lê mais fácil e soa mais humano que SpaceGrotesk
  body1: { fontFamily: regular, fontSize: 16, fontWeight: "400" as const, lineHeight: 24 },
  body2: { fontFamily: regular, fontSize: 15, fontWeight: "400" as const, lineHeight: 23 },
  body3: { fontFamily: regular, fontSize: 14, fontWeight: "400" as const, lineHeight: 21 },
  body4: { fontFamily: regular, fontSize: 13, fontWeight: "400" as const, lineHeight: 20 },

  // Semi-bold — uso em labels e nomes em cards
  semi1: { fontFamily: semibold, fontSize: 16, fontWeight: "600" as const },
  semi2: { fontFamily: semibold, fontSize: 15, fontWeight: "600" as const },
  semi3: { fontFamily: semibold, fontSize: 14, fontWeight: "600" as const },

  // Utilitários
  caption: { fontFamily: medium, fontSize: 10, fontWeight: "500" as const, letterSpacing: 0.5, textTransform: "uppercase" as const },
  label:   { fontFamily: medium, fontSize: 13, fontWeight: "500" as const },
  badge:   { fontFamily: bold,   fontSize: 11, fontWeight: "700" as const, letterSpacing: 0.2 },
  navLabel:{ fontFamily: medium, fontSize: 10, fontWeight: "500" as const },
};

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
