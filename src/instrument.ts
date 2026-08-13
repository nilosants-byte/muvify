// Frente 13 (segunda camada), Lote 1: precisa ser o PRIMEIRO import do
// processo, antes de "./app" (e portanto antes do Express e de qualquer
// módulo que ele carregue). A auto-instrumentação do Sentry (integrações
// Http/Express, que capturam erro de rota automaticamente) só consegue
// interceptar módulos que ainda não foram carregados quando Sentry.init()
// roda — se "./app" carregar primeiro, a instrumentação chega tarde demais
// e vira um no-op silencioso, sem log nem aviso nenhum sobre isso.
import { initSentry } from "./config/sentry";

initSentry();
