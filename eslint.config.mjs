// Frente 2 (segunda camada), Lote 3: vigia automático contra o mesmo tipo de
// bug que motivou toda essa frente — uma chamada assíncrona disparada sem
// tratamento de erro que, se falhar, derruba o processo inteiro (política de
// unhandledRejection em src/server.ts). Em vez de depender de alguém lembrar
// de tratar erro em cada chamada nova, o build passa a falhar automaticamente
// se esse padrão for reintroduzido — a auditoria manual vira rede de segurança
// permanente, não um esforço de uma vez só.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "mobile-app/**",
      "coverage/**",
      "artifacts/**",
      "scripts/**",
      "tests/**",
      "prisma/**",
      "*.mjs",
      "*.cjs",
      "*.js"
    ]
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin
    },
    rules: {
      // Chamada assíncrona cujo resultado (e eventual erro) nunca é
      // aguardado nem tratado — exatamente o padrão "void algo()" sem
      // .catch() encontrado 18+ vezes na investigação desta frente.
      "@typescript-eslint/no-floating-promises": "error",
      // Passar uma função async onde é esperada uma função síncrona (ex.:
      // callback de evento) — o erro escapa do jeito que os handlers de
      // socket.io escapavam antes do Lote 1 desta frente. "arguments: false"
      // desliga só o caso de passar controller async direto pro Express
      // (router.get("/x", controller.metodo)) — padrão usado centenas de
      // vezes no projeto e seguro de propósito, porque express-async-errors
      // (importado em src/app.ts) já encaminha a rejeição pro middleware de
      // erro em vez de deixá-la sem dono. Sinalizar isso seria ruído, não
      // um risco real.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }]
    }
  }
);
