import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma";
import {
  jobLastSuccessTimestamp,
  jobRunTotal,
  paymentOperationTotal,
  recordJobFailure,
  recordJobSuccess,
  register
} from "../src/observability/metrics";

// Frente 13 (segunda camada), Lote 6: até aqui, a única métrica exposta era
// HTTP genérico — sem visibilidade de negócio (job periódico atrasado, fila
// de e-mail acumulando, erro de operação de pagamento). Testa que as novas
// métricas de fato aparecem no texto exposto pelo /metrics (register é o
// mesmo Registry usado por metricsHandler) e refletem estado real do banco.

const createdEmailQueueIds: string[] = [];

describe("Frente 13, Lote 6 — métricas de negócio (jobs, fila de e-mail, operações financeiras)", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.emailDeliveryQueue.deleteMany({ where: { id: { in: createdEmailQueueIds } } });
    await prisma.$disconnect();
  });

  it("recordJobSuccess atualiza job_last_success_timestamp_seconds e job_run_total", async () => {
    recordJobSuccess("frente13-lote6-test-job");
    const text = await register.metrics();

    expect(text).toContain("job_last_success_timestamp_seconds");
    expect(text).toMatch(/job_last_success_timestamp_seconds\{job="frente13-lote6-test-job"\} \d+/);
    const runTotal = await jobRunTotal.get();
    const successValue = runTotal.values.find(
      (v) => v.labels.job === "frente13-lote6-test-job" && v.labels.result === "success"
    )?.value;
    expect(successValue).toBeGreaterThan(0);
  });

  it("recordJobFailure incrementa job_run_total com result=failure, sem tocar o timestamp de sucesso", async () => {
    const before = await jobLastSuccessTimestamp.get();
    const beforeValue = before.values.find((v) => v.labels.job === "frente13-lote6-test-job-fail")?.value;
    expect(beforeValue).toBeUndefined();

    recordJobFailure("frente13-lote6-test-job-fail");
    const text = await register.metrics();

    expect(text).toMatch(/job_run_total\{job="frente13-lote6-test-job-fail",result="failure"\} \d+/);
    // Falha sozinha não deve ter criado uma entrada de sucesso pra esse job.
    const after = await jobLastSuccessTimestamp.get();
    const afterValue = after.values.find((v) => v.labels.job === "frente13-lote6-test-job-fail")?.value;
    expect(afterValue).toBeUndefined();
  });

  it("paymentOperationTotal aparece no texto exposto do registro", async () => {
    paymentOperationTotal.inc({ operation: "frente13_lote6_test_op", result: "success" });
    const text = await register.metrics();
    expect(text).toMatch(/payment_operation_total\{operation="frente13_lote6_test_op",result="success"\} \d+/);
  });

  it("email_queue_pending e email_queue_failed_pending_purge refletem o estado real do banco", async () => {
    const pending = await prisma.emailDeliveryQueue.create({
      data: { template: "PASSWORD_RESET", payload: { to: "f13l6-pending@test.com" }, failedAt: null }
    });
    createdEmailQueueIds.push(pending.id);
    const failed = await prisma.emailDeliveryQueue.create({
      data: {
        template: "PASSWORD_RESET",
        payload: { to: "f13l6-failed@test.com" },
        failedAt: new Date(),
        attempts: 6
      }
    });
    createdEmailQueueIds.push(failed.id);

    const text = await register.metrics();

    const pendingMatch = text.match(/email_queue_pending (\d+)/);
    const failedMatch = text.match(/email_queue_failed_pending_purge (\d+)/);
    expect(pendingMatch).not.toBeNull();
    expect(failedMatch).not.toBeNull();
    expect(Number(pendingMatch?.[1])).toBeGreaterThanOrEqual(1);
    expect(Number(failedMatch?.[1])).toBeGreaterThanOrEqual(1);
  });
});
