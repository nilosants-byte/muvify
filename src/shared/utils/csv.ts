// Hardening preventivo contra injeção de fórmula em CSV (=, +, -, @ no
// início de uma célula viram fórmula executável ao abrir no Excel/Sheets).
export function escapeCsv(value: string) {
  const needsNeutralizing = /^[=+\-@]/.test(value);
  const safeValue = needsNeutralizing ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}
