import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const E2E_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(E2E_ROOT, "..");
const BATCH_CONFIG_PATH = path.join(E2E_ROOT, "batches", "implemented-flows-by-priority.json");

const ORDERED_MODULES = [
  "smoke",
  "auth",
  "profile",
  "scheduling",
  "professional",
  "regression"
];
const PRIORITIES = ["high", "medium", "low"];

function usageAndExit(exitCode = 1) {
  console.log("Uso:");
  console.log("  node e2e/helpers/run-maestro.mjs all [--report]");
  console.log("  node e2e/helpers/run-maestro.mjs <modulo> [--report]");
  console.log("  node e2e/helpers/run-maestro.mjs batch <high|medium|low> [--report]");
  console.log("Modulos disponiveis:");
  console.log(`  ${ORDERED_MODULES.join(", ")}`);
  process.exit(exitCode);
}

function hasYamlFlows(dirPath) {
  if (!fs.existsSync(dirPath)) return false;
  const files = fs.readdirSync(dirPath, { withFileTypes: true });
  return files.some((item) => item.isFile() && (item.name.endsWith(".yaml") || item.name.endsWith(".yml")));
}

function runModule(moduleName, reportRoot = null) {
  const moduleDir = path.join(E2E_ROOT, moduleName);
  if (!fs.existsSync(moduleDir)) {
    throw new Error(`Modulo inexistente: ${moduleName}`);
  }
  if (!hasYamlFlows(moduleDir)) {
    console.log(`[e2e] modulo '${moduleName}' sem flows .yaml. Pulando.`);
    return 0;
  }

  const args = ["test", moduleDir];

  if (reportRoot) {
    const moduleReportDir = path.join(reportRoot, moduleName);
    const moduleDebugDir = path.join(moduleReportDir, "debug");
    fs.mkdirSync(moduleReportDir, { recursive: true });
    fs.mkdirSync(moduleDebugDir, { recursive: true });

    args.push(
      "--format",
      "junit",
      "--output",
      path.join(moduleReportDir, "junit.xml"),
      "--debug-output",
      moduleDebugDir
    );
  }

  console.log(`[e2e] executando modulo '${moduleName}'`);
  const result = spawnSync("maestro", args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (typeof result.status === "number") {
    return result.status;
  }
  return result.error ? 1 : 0;
}

function sanitizeFileName(input) {
  return input.replace(/[\\/:"*?<>|]+/g, "-").replace(/\s+/g, "_");
}

function runFlowFile(flowPathFromRepoRoot, reportRoot = null, label = "flow") {
  const absoluteFlowPath = path.resolve(REPO_ROOT, flowPathFromRepoRoot);
  if (!fs.existsSync(absoluteFlowPath)) {
    throw new Error(`Flow nao encontrado: ${flowPathFromRepoRoot}`);
  }

  const args = ["test", absoluteFlowPath];
  if (reportRoot) {
    const safe = sanitizeFileName(label);
    const flowReportDir = path.join(reportRoot, safe);
    const flowDebugDir = path.join(flowReportDir, "debug");
    fs.mkdirSync(flowReportDir, { recursive: true });
    fs.mkdirSync(flowDebugDir, { recursive: true });
    args.push(
      "--format",
      "junit",
      "--output",
      path.join(flowReportDir, "junit.xml"),
      "--debug-output",
      flowDebugDir
    );
  }

  console.log(`[e2e] executando flow '${flowPathFromRepoRoot}'`);
  const result = spawnSync("maestro", args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (typeof result.status === "number") {
    return result.status;
  }
  return result.error ? 1 : 0;
}

function loadBatchConfig() {
  if (!fs.existsSync(BATCH_CONFIG_PATH)) {
    throw new Error(`Arquivo de lotes nao encontrado: ${BATCH_CONFIG_PATH}`);
  }
  const raw = fs.readFileSync(BATCH_CONFIG_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  for (const priority of PRIORITIES) {
    if (!Array.isArray(parsed[priority])) {
      parsed[priority] = [];
    }
  }
  return parsed;
}

const rawArgs = process.argv.slice(2);
const report = rawArgs.includes("--report");
const filteredArgs = rawArgs.filter((arg) => arg !== "--report");
const arg0 = filteredArgs[0];
const arg1 = filteredArgs[1];

if (!arg0) {
  usageAndExit(1);
}

let reportRoot = null;
if (report) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  reportRoot = path.join(E2E_ROOT, "reports", `run-${timestamp}`);
  fs.mkdirSync(reportRoot, { recursive: true });
  console.log(`[e2e] relatorios/evidencias em: ${reportRoot}`);
}

if (arg0 === "batch") {
  if (!arg1 || !PRIORITIES.includes(arg1)) {
    console.error(`[e2e] prioridade invalida: ${String(arg1)}`);
    usageAndExit(1);
  }
  const batchConfig = loadBatchConfig();
  const flows = Array.from(new Set(batchConfig[arg1]));
  if (flows.length === 0) {
    console.log(`[e2e] lote '${arg1}' sem flows implementados.`);
    process.exit(0);
  }
  const batchReportRoot = reportRoot ? path.join(reportRoot, `batch-${arg1}`) : null;
  if (batchReportRoot) {
    fs.mkdirSync(batchReportRoot, { recursive: true });
  }
  for (const flow of flows) {
    const code = runFlowFile(flow, batchReportRoot, flow);
    if (code !== 0) {
      console.error(`[e2e] falhou no flow '${flow}' com exit code ${code}.`);
      process.exit(code);
    }
  }
  console.log(`[e2e] lote '${arg1}' concluido com sucesso.`);
  process.exit(0);
}

let modulesToRun = [];
if (arg0 === "all") {
  modulesToRun = ORDERED_MODULES;
} else if (ORDERED_MODULES.includes(arg0)) {
  modulesToRun = [arg0];
} else {
  console.error(`[e2e] modulo invalido: ${arg0}`);
  usageAndExit(1);
}

for (const moduleName of modulesToRun) {
  const code = runModule(moduleName, reportRoot);
  if (code !== 0) {
    console.error(`[e2e] falhou no modulo '${moduleName}' com exit code ${code}.`);
    process.exit(code);
  }
}

console.log("[e2e] execucao concluida com sucesso.");
