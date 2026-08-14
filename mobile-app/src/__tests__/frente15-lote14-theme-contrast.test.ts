/**
 * Frente 15 (segunda camada, acessibilidade), Lote 14: theme.text3/
 * labelColor (usado como placeholderTextColor em MvInput, entre outros
 * usos de texto secundário) dava ~4.17-4.41:1 contra o fundo e caía pra
 * ~3.5:1 contra o fundo de campo de formulário — abaixo do mínimo WCAG AA
 * (4.5:1) pra texto normal. Este teste calcula o contraste real (fórmula
 * WCAG 2.x) em vez de só comparar o hex, pra pegar qualquer regressão
 * futura de verdade, não só uma mudança de string.
 */
import { darkTheme, lightTheme } from "../theme/MvColors";

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

const WCAG_AA_NORMAL_TEXT = 4.5;

describe("Frente 15, Lote 14 — theme.text3/labelColor atinge contraste mínimo WCAG AA", () => {
  it("tema escuro: text3 contra bg e contra inputBg passam de 4.5:1", () => {
    expect(contrastRatio(darkTheme.text3, darkTheme.bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(contrastRatio(darkTheme.text3, darkTheme.inputBg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it("tema claro: text3 contra bg e contra inputBg passam de 4.5:1", () => {
    expect(contrastRatio(lightTheme.text3, lightTheme.bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(contrastRatio(lightTheme.text3, lightTheme.inputBg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it("labelColor continua igual a text3 nos dois temas (mesmo token, sem duplicar drift)", () => {
    expect(darkTheme.labelColor).toBe(darkTheme.text3);
    expect(lightTheme.labelColor).toBe(lightTheme.text3);
  });
});
