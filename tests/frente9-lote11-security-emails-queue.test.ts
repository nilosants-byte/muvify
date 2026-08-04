import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { EmailQueueService } from "../src/shared/services/email-queue.service";
import { EmailService } from "../src/shared/services/email.service";

// Épico de Frentes, Frente 9, Lote 11: sendPasswordChangedEmail/
// sendRecoveryEmailUpdated eram envios síncronos sem retry - se o SMTP
// caísse justamente nesse instante (ex: troca de senha indevida por
// invasor), a vítima nunca era avisada por nenhum canal. Passam a usar a
// mesma fila com retry já usada por EMAIL_VERIFICATION/PASSWORD_RESET.

const password = "Test1234";
const emailQueueService = new EmailQueueService();

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
}

const createdUserIds: string[] = [];
const trackedQueueIds = new Set<string>();

describe("Frente 9, Lote 11 — e-mails de segurança usam a fila com retry", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const ids = Array.from(trackedQueueIds);
    trackedQueueIds.clear();
    if (ids.length > 0) {
      await prisma.emailDeliveryQueue.deleteMany({ where: { id: { in: ids } } });
    }
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("trocar a senha com SMTP indisponível enfileira o e-mail de aviso em vez de perdê-lo, e o job de retry entrega quando o SMTP volta", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);

    const register = await request(app).post("/api/auth/register").send({
      name: "Frente Nove Lote Onze Password",
      email: uniqueEmail("f9l11_password"),
      password,
      phone: `1177${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    expect(register.status).toBe(201);
    const userId = register.body.user.id as string;
    const userEmail = register.body.user.email as string;
    const token = register.body.accessToken as string;
    createdUserIds.push(userId);

    const sendSpyDown = vi
      .spyOn(EmailService.prototype, "sendPasswordChangedEmail")
      .mockRejectedValue(new Error("smtp offline"));

    const changePassword = await request(app)
      .post("/api/users/me/security/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: "NewTest5678", confirmNewPassword: "NewTest5678" });
    expect([200, 204]).toContain(changePassword.status);

    // O envio síncrono não é mais chamado - só o enfileiramento.
    expect(sendSpyDown).not.toHaveBeenCalled();

    const queued = await prisma.emailDeliveryQueue.findFirst({
      where: { template: "PASSWORD_CHANGED" },
      orderBy: { createdAt: "desc" }
    });
    expect(queued).not.toBeNull();
    expect((queued!.payload as { to: string }).to).toBe(userEmail);
    trackedQueueIds.add(queued!.id);

    // processRetryQueue só processa os 50 primeiros por nextRetryAt - numa
    // suíte completa, outros arquivos deixam um backlog real de
    // EMAIL_VERIFICATION na fila (nenhum deles chama processRetryQueue).
    // Sem isso, esse teste starva de forma intermitente dependendo de
    // quantos arquivos já rodaram antes dele na mesma suíte.
    await prisma.emailDeliveryQueue.update({
      where: { id: queued!.id },
      data: { nextRetryAt: new Date(0) }
    });

    vi.restoreAllMocks();
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);
    const sendSpyUp = vi.spyOn(EmailService.prototype, "sendPasswordChangedEmail").mockResolvedValue();

    await emailQueueService.processRetryQueue();

    expect(sendSpyUp).toHaveBeenCalledWith(expect.objectContaining({ to: userEmail }));
    const stillQueued = await prisma.emailDeliveryQueue.findUnique({ where: { id: queued!.id } });
    expect(stillQueued).toBeNull();
  });

  it("trocar o e-mail de recuperação com SMTP indisponível enfileira os dois avisos (novo e-mail e conta) em vez de perdê-los", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);

    const register = await request(app).post("/api/auth/register").send({
      name: "Frente Nove Lote Onze Recovery",
      email: uniqueEmail("f9l11_recovery"),
      password,
      phone: `1188${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    expect(register.status).toBe(201);
    const userId = register.body.user.id as string;
    const token = register.body.accessToken as string;
    createdUserIds.push(userId);

    const sendSpyDown = vi
      .spyOn(EmailService.prototype, "sendRecoveryEmailUpdated")
      .mockRejectedValue(new Error("smtp offline"));

    const newRecoveryEmail = uniqueEmail("f9l11_new_recovery");
    const setRecoveryEmail = await request(app)
      .put("/api/users/me/security/recovery-email")
      .set("Authorization", `Bearer ${token}`)
      .send({ recoveryEmail: newRecoveryEmail, password });
    expect(setRecoveryEmail.status).toBe(200);

    expect(sendSpyDown).not.toHaveBeenCalled();

    const queuedRows = await prisma.emailDeliveryQueue.findMany({
      where: { template: "RECOVERY_EMAIL_UPDATED" },
      orderBy: { createdAt: "desc" },
      take: 2
    });
    expect(queuedRows.length).toBe(2);
    queuedRows.forEach((row) => trackedQueueIds.add(row.id));
    const recipients = queuedRows.map((row) => (row.payload as { to: string }).to).sort();
    expect(recipients).toContain(newRecoveryEmail);

    // Mesmo motivo do teste anterior: garante que essas linhas fiquem
    // primeiro na fila (por nextRetryAt), independente do backlog de
    // EMAIL_VERIFICATION deixado por outros arquivos na mesma suíte.
    await prisma.emailDeliveryQueue.updateMany({
      where: { id: { in: queuedRows.map((row) => row.id) } },
      data: { nextRetryAt: new Date(0) }
    });

    vi.restoreAllMocks();
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);
    const sendSpyUp = vi.spyOn(EmailService.prototype, "sendRecoveryEmailUpdated").mockResolvedValue();

    await emailQueueService.processRetryQueue();

    expect(sendSpyUp).toHaveBeenCalledTimes(2);
    const remaining = await prisma.emailDeliveryQueue.count({
      where: { id: { in: queuedRows.map((row) => row.id) } }
    });
    expect(remaining).toBe(0);
  });
});
