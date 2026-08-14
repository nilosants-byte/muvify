import "dotenv/config";
import { defineConfig } from "vitest/config";

process.env.NODE_ENV = process.env.NODE_ENV || "test";

const normalizeDbUrl = (url?: string) =>
  url?.replace("@localhost:", "@127.0.0.1:");

const SAFE_TEST_DB_FALLBACK = "postgresql://postgres:postgres@127.0.0.1:5432/personal_app_test";

process.env.DATABASE_URL =
  normalizeDbUrl(process.env.TEST_DATABASE_URL) ||
  SAFE_TEST_DB_FALLBACK;

// Estes arquivos chamam DataRetentionService.run() (varredura de tabela
// inteira, sem escopo por teste) ou leem contagens globais de audit log —
// rodando em paralelo com outros arquivos que tocam as mesmas tabelas, uma
// corrida entre processos pode redigir/contar registros de um teste
// concorrente e derrubar o outro de forma intermitente. Isolados aqui pra
// rodar sem concorrência entre si, sem penalizar a paralelização do resto
// da suíte (só ~20s a mais no total).
const CROSS_CONTAMINATION_RISK_FILES = [
  "tests/data-retention-disputes.test.ts",
  "tests/frente11-lote7-retention-gaps.test.ts",
  "tests/frente10-lote5-audit-log-retention-noshow.test.ts",
  "tests/admin-legal-hold-and-export.test.ts"
];

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
    exclude: ["mobile-app/**", "node_modules/**", "dist/**"],
    // Frente 12 (segunda camada), Lote 6: paridade com o mobile, que já
    // roda test:coverage no CI — backend não tinha nenhuma visibilidade de
    // cobertura. O relatório final não saiu naquela tentativa — não era
    // bug de configuração: quando QUALQUER suíte falha (mesmo um erro de
    // conexão isolado num beforeAll), o coverage-v8 não escreve o
    // relatório, e aquela rodada tinha 1 arquivo falho por contenção de
    // recursos. Cleanup pós-épico segunda camada: medido numa rodada
    // limpa (172/172 arquivos, 804/804 testes, 0 falhas) — threshold
    // calibrado ~5-10pp abaixo do valor real medido (deixa margem pra
    // flutuação normal sem virar gate flaky, mas bloqueia regressão real):
    // Statements/Lines real 50.96% → piso 45%; Branches real 71.59% →
    // piso 65%; Functions real 65.76% → piso 60%.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov", "html"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "tests/**",
        "mobile-app/**",
        "prisma/**",
        "scripts/**",
        "*.config.ts",
        "*.config.mjs"
      ],
      thresholds: {
        branches: 65,
        functions: 60,
        lines: 45,
        statements: 45
      }
    },
    projects: [
      {
        test: {
          name: "isolated",
          environment: "node",
          setupFiles: ["./tests/setup.ts"],
          testTimeout: 120000,
          hookTimeout: 120000,
          include: CROSS_CONTAMINATION_RISK_FILES,
          fileParallelism: false,
          // Frente 12 (segunda camada), Lote 5: rede de segurança pro
          // residual de flakiness de timing (não mascara bug real — um erro
          // de asserção genuíno falha igual nas 2 tentativas). Escopo só
          // nestes arquivos históricamente sensíveis a timing, não a suíte
          // inteira.
          retry: 1
        }
      },
      {
        test: {
          name: "parallel",
          environment: "node",
          setupFiles: ["./tests/setup.ts"],
          testTimeout: 120000,
          hookTimeout: 120000,
          include: ["tests/**/*.test.ts"],
          exclude: [
            "mobile-app/**",
            "node_modules/**",
            "dist/**",
            ...CROSS_CONTAMINATION_RISK_FILES
          ]
        }
      }
    ]
  }
});
