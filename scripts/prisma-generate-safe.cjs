const { spawnSync } = require("node:child_process");
const path = require("node:path");

const MAX_ATTEMPTS = process.platform === "win32" ? 5 : 2;
const BASE_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isWindowsPrismaEngineLockError(errorText) {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes("eperm") &&
    normalized.includes("operation not permitted") &&
    normalized.includes("query_engine-windows.dll.node")
  );
}

function runGenerate(extraEnv) {
  const npxCliPath = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js"
  );
  const directResult = spawnSync(
    process.execPath,
    [npxCliPath, "prisma", "generate"],
    {
      env: { ...process.env, ...extraEnv },
      encoding: "utf-8"
    }
  );

  if (!directResult.error) {
    return directResult;
  }

  return spawnSync("npx prisma generate", {
    shell: true,
    env: { ...process.env, ...extraEnv },
    encoding: "utf-8"
  });
}

function printResult(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

async function run() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = runGenerate();
    printResult(result);

    if (result.status === 0) {
      return;
      }

    const errorText = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    const retryable = isWindowsPrismaEngineLockError(errorText);
    const canRetry = retryable && attempt < MAX_ATTEMPTS;

    if (!canRetry) {
      if (retryable && process.platform === "win32") {
        console.warn(
          "\n[PRISMA_GENERATE] Lock persistente no engine Node-API. " +
            "Tentando fallback seguro com engine=binary..."
        );
        const binaryResult = runGenerate({
          PRISMA_CLIENT_ENGINE_TYPE: "binary",
          PRISMA_CLI_QUERY_ENGINE_TYPE: "binary"
        });
        printResult(binaryResult);
        if (binaryResult.status === 0) {
          console.warn(
            "[PRISMA_GENERATE] Generate concluido com engine=binary (fallback para Windows lock)."
          );
          return;
        }
        console.error(
          "[PRISMA_GENERATE] Fallback com engine=binary tambem falhou. " +
            "Feche processos que usam Prisma (API, testes/watch, extensoes) e tente novamente."
        );
      }

      process.exitCode = result.status ?? 1;
      return;
    }

    const waitMs = BASE_DELAY_MS * attempt;
    console.warn(
      `[PRISMA_GENERATE] Tentativa ${attempt}/${MAX_ATTEMPTS} falhou por lock de arquivo. ` +
        `Nova tentativa em ${waitMs}ms...`
    );
    await sleep(waitMs);
  }
}

run().catch((error) => {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
});
