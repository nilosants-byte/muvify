import "dotenv/config";
import { defineConfig } from "vitest/config";

process.env.NODE_ENV = process.env.NODE_ENV || "test";

const normalizeDbUrl = (url?: string) =>
  url?.replace("@localhost:", "@127.0.0.1:");

const SAFE_TEST_DB_FALLBACK = "postgresql://postgres:postgres@127.0.0.1:5432/personal_app_test";

process.env.DATABASE_URL =
  normalizeDbUrl(process.env.TEST_DATABASE_URL) ||
  SAFE_TEST_DB_FALLBACK;

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
    include: ["tests/**/*.test.ts"],
    exclude: ["mobile-app/**", "node_modules/**", "dist/**"]
  }
});
