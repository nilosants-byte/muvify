/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["**/?(*.)+(spec|test).[tj]s?(x)"],
  testPathIgnorePatterns: ["/node_modules/", "/android/", "/ios/"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/__tests__/**",
    // Staged modular UI from lotes A-E (not yet wired into active runtime).
    "!src/components/ui/**",
    "!src/components/feedback/**",
    "!src/mocks/**",
    "!src/navigation/client-tabs.tsx",
    "!src/navigation/professional-tabs.tsx",
    "!src/navigation/root-stack.tsx",
    "!src/screens/client/**",
    "!src/screens/professional/**",
    "!src/screens/shared/**",
    "!src/types/**",
    "!src/utils/**"
  ],
  coverageReporters: ["text-summary", "lcov", "html"],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 75,
      lines: 75,
      statements: 75
    }
  }
};
