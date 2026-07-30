// Remove acentuação e normaliza espaços/caixa pra comparação "solta" de
// texto (ex: "Pilates" e "Pilátes" devem contar como o mesmo valor).
// \p{Diacritic} (com a flag u) cobre as marcas diacríticas combinantes
// deixadas pela normalização NFD, sem precisar de uma faixa de código
// hardcoded.
export function normalizeLoose(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
