/**
 * Frente 13 (segunda camada), Lote 18: initSentry() virava um no-op 100%
 * silencioso sem a DSN configurada — se o secret ficasse ausente ou
 * digitado errado no ambiente de build de produção (EAS), toda a
 * observabilidade do app sumia sem deixar nenhum rastro no código.
 */
import { initSentry } from "../observability/sentry";

describe("Frente 13, Lote 18 — aviso explícito quando a DSN do Sentry está ausente em produção", () => {
  const originalDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  const originalEnv = process.env.EXPO_PUBLIC_APP_ENV;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = originalDsn;
    process.env.EXPO_PUBLIC_APP_ENV = originalEnv;
    warnSpy.mockRestore();
  });

  it("DSN ausente em produção (EXPO_PUBLIC_APP_ENV=production) gera console.warn explícito", () => {
    process.env.EXPO_PUBLIC_APP_ENV = "production";

    initSentry();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("EXPO_PUBLIC_SENTRY_DSN nao configurado em producao")
    );
  });

  it("DSN ausente em desenvolvimento não gera warning (comportamento esperado, sem ruído)", () => {
    process.env.EXPO_PUBLIC_APP_ENV = "development";

    initSentry();

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
