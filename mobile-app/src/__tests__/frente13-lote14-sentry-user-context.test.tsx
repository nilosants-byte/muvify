/**
 * Frente 13 (segunda camada), Lote 14: eventos do Sentry no mobile só
 * traziam o id do usuário (sem role) e nenhum breadcrumb de navegação —
 * cada evento chegava praticamente "pelado" além do stack trace.
 */
import * as Sentry from "@sentry/react-native";
import { addNavigationBreadcrumb, initSentry, setSentryUser } from "../observability/sentry";

describe("Frente 13, Lote 14 — contexto de usuário e breadcrumb de navegação", () => {
  const originalDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

  beforeAll(() => {
    // initSentry só faz algo de verdade se a DSN estiver setada — mesmo
    // guard usado em produção (no-op silencioso sem SENTRY_DSN). Precisa
    // ser setado ANTES de chamar initSentry(), e initSentry/setSentryUser/
    // addNavigationBreadcrumb precisam ser importados no topo do arquivo
    // (não via require() dentro do teste + jest.resetModules(), que criaria
    // uma instância do mock de @sentry/react-native diferente da importada
    // aqui em cima).
    process.env.EXPO_PUBLIC_SENTRY_DSN = "https://fake@o0.ingest.sentry.io/0";
    initSentry();
  });

  afterAll(() => {
    // process.env é global ao worker do Jest (não por arquivo) — sem
    // restaurar, outro arquivo de teste rodando no mesmo worker depois
    // deste herdaria uma DSN "configurada" sem querer.
    process.env.EXPO_PUBLIC_SENTRY_DSN = originalDsn;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("setSentryUser envia id e role, sem e-mail nem outro dado pessoal", () => {
    setSentryUser({
      id: "user-123",
      role: "PROVIDER",
      name: "Fulano",
      email: "fulano@test.com"
    } as any);

    expect(Sentry.setUser).toHaveBeenCalledWith({ id: "user-123", role: "PROVIDER" });
    const sentUser = (Sentry.setUser as jest.Mock).mock.calls[0][0];
    expect(sentUser.email).toBeUndefined();
    expect(sentUser.name).toBeUndefined();
  });

  it("addNavigationBreadcrumb registra a tela atual como breadcrumb de categoria navigation", () => {
    addNavigationBreadcrumb("ClientHome");

    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: "navigation",
      message: "ClientHome",
      level: "info"
    });
  });
});
