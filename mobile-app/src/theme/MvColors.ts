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
  // Cleanup pós-épico segunda camada (2026-08-14): dois usos recorrentes de
  // rgba(36,230,109,X) literal (o verde de marca do MODO ESCURO,
  // #24E66D — Frente 10 já tinha achado esse padrão, item remetido pra
  // Frente 18 e não pego lá) apareciam copiados em ~25 pontos do app,
  // sempre com o mesmo par de valores (fundo de card destacado / botão
  // primário desabilitado) mas escritos como hex fixo — ignorando o tema
  // claro, que usa #16A34A. Os dois valores mais repetidos viraram token
  // aqui; o resto (valores mais raros/decorativos) fica como gap
  // documentado, mesmo critério de risco×frequência já usado na Frente 10.
  primaryHighlight: string;
  primaryDisabled: string;
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
  dangerSubtle: string;
  dangerSubtleBorder: string;
  warning: string;
  warningSubtle: string;
  warningSubtleBorder: string;
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
  primaryHighlight: "rgba(36,230,109,0.09)",
  primaryDisabled: "rgba(36,230,109,0.4)",
  primary: "#24E66D",
  primaryDark: "#16A34A",
  text1: "#FFFFFF",
  text2: "#A1A1AA",
  // Frente 15 (segunda camada, acessibilidade), Lote 14: #71717A dava
  // ~4.17:1 contra o fundo (theme.bg) e ~3.5:1 contra o fundo de campo de
  // formulário (theme.inputBg, onde esta cor é usada como
  // placeholderTextColor em MvInput) — abaixo do mínimo WCAG AA (4.5:1)
  // pra texto normal. #86868F mantém o mesmo tom (cinza neutro) só um
  // pouco mais claro: ~5.59:1 contra bg, ~4.76:1 contra inputBg.
  text3: "#86868F",
  textGreen: "#24E66D",
  labelColor: "#86868F",
  inputBg: "#0D1F14",
  inputBorder: "rgba(255,255,255,0.10)",
  inputText: "#FFFFFF",
  toggleOff: "rgba(255,255,255,0.14)",
  backBtn: "rgba(255,255,255,0.06)",
  chipBg: "rgba(255,255,255,0.04)",
  chipText: "#A1A1AA",
  textOnPrimary: "#000000",
  danger: "#EF4444",
  dangerSubtle: "rgba(239,68,68,0.12)",
  dangerSubtleBorder: "rgba(239,68,68,0.20)",
  warning: "#F59E0B",
  warningSubtle: "rgba(245,158,11,0.12)",
  warningSubtleBorder: "rgba(245,158,11,0.20)",
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
  primaryHighlight: "rgba(22,163,74,0.09)",
  primaryDisabled: "rgba(22,163,74,0.4)",
  primary: "#16A34A",
  primaryDark: "#15803D",
  text1: "#0A0F0A",
  text2: "#3D4D3D",
  // Frente 15 (segunda camada, acessibilidade), Lote 14: #6B7C6B dava
  // ~4.41:1 contra o fundo (theme.bg) e menos ainda contra o fundo de
  // campo de formulário (theme.inputBg) — abaixo do mínimo WCAG AA
  // (4.5:1). #526152 mantém o mesmo tom, só um pouco mais escuro: ~6.5:1
  // contra bg, ~5.9:1 contra inputBg.
  text3: "#526152",
  textGreen: "#16A34A",
  labelColor: "#526152",
  inputBg: "#E6F7ED",
  inputBorder: "rgba(0,0,0,0.11)",
  inputText: "#0A0F0A",
  toggleOff: "rgba(0,0,0,0.13)",
  backBtn: "rgba(0,0,0,0.06)",
  chipBg: "rgba(22,163,74,0.11)",
  chipText: "#3D4D3D",
  textOnPrimary: "#FFFFFF",
  danger: "#DC2626",
  dangerSubtle: "rgba(220,38,38,0.10)",
  dangerSubtleBorder: "rgba(220,38,38,0.18)",
  warning: "#D97706",
  warningSubtle: "rgba(217,119,6,0.10)",
  warningSubtleBorder: "rgba(217,119,6,0.18)",
};

export const cardShadowLight = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 4,
  elevation: 2,
};
