import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { UserService } from "../src/modules/users/services/user.service";
import { EmailService } from "../src/shared/services/email.service";

// Achado em teste manual (2026-09-27): enviar uma mensagem de suporte
// mostrava "Erro interno do servidor" mesmo com o chamado já salvo de
// verdade no banco (visível em "Meus chamados") - a chamada síncrona de
// SMTP (aviso interno por e-mail) não tinha try/catch, então uma falha
// transitória de envio derrubava a requisição inteira, mesmo o dado
// principal (o ticket) já tendo sido persistido com sucesso.

const userService = new UserService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let userId = "";
const ticketIds: string[] = [];

describe("sendSupportMessage — resiliência a falha de envio de e-mail", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        name: "Profissional Teste Suporte Email",
        email: `${uid("support_email_test")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}4`,
        role: UserRole.PROVIDER
      }
    });
    userId = user.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.supportTicket.deleteMany({ where: { id: { in: ticketIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("quando o envio do e-mail de aviso falha, o chamado continua salvo e a chamada não lança erro", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);
    vi.spyOn(EmailService.prototype, "sendSupportMessageEmail").mockRejectedValue(
      new Error("SMTP timeout (simulado)")
    );

    const result = await userService.sendSupportMessage(userId, { message: "teste teste" });
    ticketIds.push(result.ticketId);

    expect(result.delivered).toBe(false);
    expect(result.queued).toBe(true);

    const savedTicket = await prisma.supportTicket.findUnique({ where: { id: result.ticketId } });
    expect(savedTicket).not.toBeNull();
    expect(savedTicket?.message).toBe("teste teste");
  });

  it("quando o envio do e-mail funciona normalmente, delivered continua true", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);
    const sendSpy = vi.spyOn(EmailService.prototype, "sendSupportMessageEmail").mockResolvedValue();

    const result = await userService.sendSupportMessage(userId, { message: "outra mensagem de teste" });
    ticketIds.push(result.ticketId);

    expect(result.delivered).toBe(true);
    expect(result.queued).toBe(false);
    expect(sendSpy).toHaveBeenCalled();
  });
});
