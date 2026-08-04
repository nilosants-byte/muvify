// Épico de Frentes, Frente 11, Lote 1: recordConsent/register gravavam
// termsVersion ENVIADO PELO CLIENTE, sem nenhuma versão canônica conhecida
// pelo servidor pra comparar contra - dava pra gravar uma versão
// inexistente, e não havia como o backend saber se um usuário está sob
// uma versão desatualizada dos termos. Fonte única de verdade da versão
// vigente, usada tanto no registro quanto no re-consentimento.
export const CURRENT_TERMS_VERSION = "2026.05";
