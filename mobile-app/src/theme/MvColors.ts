export interface MvTheme {
  mode: "dark" | "light";
  bg: string;
  bgSurface: string;
  border: string;
  borderSub: string;
  cardBg: string;
  navBg: string;
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
}

export const darkTheme: MvTheme = {
  mode: "dark",
  bg: "#060c08",
  bgSurface: "#0b1510",
  border: "rgba(255,255,255,0.08)",
  borderSub: "rgba(255,255,255,0.06)",
  cardBg: "#0e1a11",
  navBg: "#060c08",
  primary: "#22C55E",
  primaryDark: "#16A34A",
  text1: "#ddeae0",
  text2: "#9CA3AF",
  text3: "#6B7280",
  textGreen: "#22C55E",
  labelColor: "#6B7280",
  inputBg: "#0b1510",
  inputBorder: "rgba(255,255,255,0.10)",
  inputText: "#ddeae0",
  toggleOff: "rgba(255,255,255,0.14)",
  backBtn: "rgba(255,255,255,0.09)",
  chipBg: "rgba(34,197,94,0.13)",
  chipText: "#9CA3AF",
};

export const lightTheme: MvTheme = {
  mode: "light",
  bg: "#EEF5EF",
  bgSurface: "#FFFFFF",
  border: "rgba(15,23,42,0.09)",
  borderSub: "rgba(15,23,42,0.06)",
  cardBg: "#FFFFFF",
  navBg: "#EEF5EF",
  primary: "#22C55E",
  primaryDark: "#16A34A",
  text1: "#111827",
  text2: "#374151",
  text3: "#6B7280",
  textGreen: "#16A34A",
  labelColor: "#6B7280",
  inputBg: "#FFFFFF",
  inputBorder: "rgba(15,23,42,0.11)",
  inputText: "#111827",
  toggleOff: "rgba(15,23,42,0.13)",
  backBtn: "rgba(15,23,42,0.09)",
  chipBg: "rgba(34,197,94,0.11)",
  chipText: "#374151",
};

export const cardShadowLight = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 4,
  elevation: 2,
};
