import { env } from "../../config/env";

// Interruptor central de testes manuais ponta a ponta (checklist de
// lançamento pré-produção): quando ativo, as travas de CREF, e-mail
// verificado, anamnese, reconsentimento de termos e assinatura do
// profissional passam a liberar automaticamente — nenhuma regra de negócio
// é apagada, só "adormecida" enquanto o app é testado pela perspectiva de
// cada tipo de usuário sem depender de credenciais reais (CREF de verdade,
// e-mail que receba de fato, etc). Mercado Pago fica de fora de propósito —
// aquele fluxo é testado com conta de sandbox real, não com bypass.
//
// Duas camadas independentes garantem que isso nunca vale em produção (ver
// src/config/env.ts): a checagem no boot derruba o processo se alguém setar
// as duas variáveis ao mesmo tempo, e o próprio valor de
// env.E2E_BYPASS_ONBOARDING_GATES já vem forçado como false quando
// NODE_ENV=production — esta função só lê esse valor já protegido, não
// reimplementa a checagem de ambiente.
export function isOnboardingGatesBypassActive(): boolean {
  if (env.E2E_BYPASS_ONBOARDING_GATES) {
    // eslint-disable-next-line no-console
    console.warn(
      "[onboarding-gates-bypass] Trava de validação liberada por E2E_BYPASS_ONBOARDING_GATES=true (uso exclusivo de teste manual)."
    );
    return true;
  }
  return false;
}
