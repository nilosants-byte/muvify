// Frente 10 (segunda camada), Lote 15: ErrorBoundary.tsx (fora do
// MvThemeProvider, cores fixas) e GenericErrorScreen.tsx (com tema,
// mensagem customizável) tinham o mesmo propósito ("algo deu errado") mas
// cada um com sua própria cópia hardcoded — risco real de as duas
// divergirem de novo silenciosamente a cada edição futura. Unificar o
// tema visual do ErrorBoundary não é viável (ele roda fora do provider,
// de propósito, pra sobreviver a um crash do próprio provider), mas o
// texto pode e deve vir de uma única fonte.
export const GENERIC_ERROR_TITLE = "Algo deu errado";
export const GENERIC_ERROR_DESCRIPTION = "Ocorreu um erro inesperado.";
