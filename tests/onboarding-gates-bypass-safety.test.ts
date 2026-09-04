import { describe, it, expect } from "vitest";
import { env, assertNoOnboardingGatesBypassInProduction } from "../src/config/env";
import { isOnboardingGatesBypassActive } from "../src/shared/utils/onboarding-gates-bypass";

// Garantia permanente contra o interruptor de bypass de testes (CREF,
// e-mail verificado, anamnese, reconsentimento de termos, assinatura do
// profissional) ficar ligado em produção por engano. Se alguém enfraquecer
// essa proteção no futuro, este teste quebra antes de qualquer deploy.
describe("onboarding gates bypass — trava de produção", () => {
  it("recusa (lança erro) quando NODE_ENV=production e a flag vem true", () => {
    expect(() => assertNoOnboardingGatesBypassInProduction("production", true)).toThrow(
      /nao pode ser true quando NODE_ENV=production/i
    );
  });

  it("nao lança erro quando NODE_ENV=production e a flag vem false", () => {
    expect(() => assertNoOnboardingGatesBypassInProduction("production", false)).not.toThrow();
  });

  it("nao lança erro fora de produção, mesmo com a flag true", () => {
    expect(() => assertNoOnboardingGatesBypassInProduction("development", true)).not.toThrow();
    expect(() => assertNoOnboardingGatesBypassInProduction("test", true)).not.toThrow();
  });

  it("o ambiente de teste atual nao é produção (pré-requisito das checagens abaixo)", () => {
    expect(env.NODE_ENV).not.toBe("production");
  });

  it("por padrão (sem E2E_BYPASS_ONBOARDING_GATES setada), o bypass fica inativo", () => {
    expect(env.E2E_BYPASS_ONBOARDING_GATES).toBe(false);
    expect(isOnboardingGatesBypassActive()).toBe(false);
  });

  it("quando ligado explicitamente (fora de produção), o interruptor realmente ativa", () => {
    // Prova que o "interruptor" funciona nos dois sentidos, não só que fica
    // desligado — sem isso, o teste anterior sozinho não provaria que ligar
    // de propósito realmente teria efeito quando o checklist precisar usar.
    (env as { E2E_BYPASS_ONBOARDING_GATES: boolean }).E2E_BYPASS_ONBOARDING_GATES = true;
    try {
      expect(isOnboardingGatesBypassActive()).toBe(true);
    } finally {
      // Restaura o estado padrão (desligado) pra não vazar pros outros testes
      // deste arquivo nem de qualquer outro que rode no mesmo processo.
      (env as { E2E_BYPASS_ONBOARDING_GATES: boolean }).E2E_BYPASS_ONBOARDING_GATES = false;
    }
    expect(isOnboardingGatesBypassActive()).toBe(false);
  });
});
