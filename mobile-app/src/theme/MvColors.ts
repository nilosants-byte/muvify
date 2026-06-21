export interface MvTheme {
  mode: "dark" | "light";
  bg: string;
  bgSurface: string;
  border: string;
  borderSub: string;
  borderMid: string;
  cardBg: string;
  navBg: string;
  headerBg: string;
  primarySubtle: string;
  primarySubtleBorder: string;
  primary: string;
  primaryDark: string;
  text1: string;
  text2: string;
  text3: string;
  textGreen: string;
  labelColor: string;
  inputBg: string;
  inputBorder: string;
  inputText: string;
  toggleOff: string;
  backBtn: string;
  chipBg: string;
  chipText: string;
  textOnPrimary: string;
  danger: string;
}

export const darkTheme: MvTheme = {
  mode: "dark",
  bg: "#030806",
  bgSurface: "#07120C",
  border: "rgba(255,255,255,0.07)",
  borderSub: "rgba(255,255,255,0.05)",
  borderMid: "rgba(255,255,255,0.11)",
  cardBg: "#07120C",
  navBg: "rgba(3,8,6,0.95)",
  headerBg: "rgba(3,8,6,0.85)",
  primarySubtle: "rgba(36,230,109,0.12)",
  primarySubtleBorder: "rgba(36,230,109,0.20)",
  primary: "#24E66D",
  primaryDark: "#16A34A",
  text1: "#FFFFFF",
  text2: "#A1A1AA",
  text3: "#71717A",
  textGreen: "#24E66D",
  labelColor: "#71717A",
  inputBg: "#0D1F14",
  inputBorder: "rgba(255,255,255,0.10)",
  inputText: "#FFFFFF",
  toggleOff: "rgba(255,255,255,0.14)",
  backBtn: "rgba(255,255,255,0.06)",
  chipBg: "rgba(255,255,255,0.04)",
  chipText: "#A1A1AA",
  textOnPrimary: "#000000",
  danger: "#EF4444",
};

export const lightTheme: MvTheme = {
  mode: "light",
  bg: "#FAFFFE",
  bgSurface: "#F0FAF4",
  border: "rgba(0,0,0,0.07)",
  borderSub: "rgba(0,0,0,0.05)",
  borderMid: "rgba(0,0,0,0.11)",
  cardBg: "#F0FAF4",
  navBg: "rgba(250,255,254,0.95)",
  headerBg: "rgba(250,255,254,0.85)",
  primarySubtle: "rgba(22,163,74,0.10)",
  primarySubtleBorder: "rgba(22,163,74,0.18)",
  primary: "#16A34A",
  primaryDark: "#15803D",
  text1: "#0A0F0A",
  text2: "#3D4D3D",
  text3: "#6B7C6B",
  textGreen: "#16A34A",
  labelColor: "#6B7C6B",
  inputBg: "#E6F7ED",
  inputBorder: "rgba(0,0,0,0.11)",
  inputText: "#0A0F0A",
  toggleOff: "rgba(0,0,0,0.13)",
  backBtn: "rgba(0,0,0,0.06)",
  chipBg: "rgba(22,163,74,0.11)",
  chipText: "#3D4D3D",
  textOnPrimary: "#FFFFFF",
  danger: "#DC2626",
};

export const cardShadowLight = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 4,
  elevation: 2,
};
