import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Frente 14 (segunda camada, carga real), Lote 3: o transporter SMTP não
// definia connectionTimeout/greetingTimeout/socketTimeout — na prática sem
// nenhum timeout de socket (fica esperando indefinidamente um servidor de
// destino lento/travado). Como email-queue.service.ts entrega os itens da
// fila em série (um de cada vez), um único destinatário problemático
// travava a fila inteira por tempo indeterminado. Este teste intercepta
// nodemailer.createTransport (sem enviar e-mail real nenhum) pra confirmar
// que os três timeouts agora são passados.

const { createTransportMock, sendMailMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn((_options?: Record<string, unknown>) => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: "test" })
  })),
  sendMailMock: vi.fn()
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock }
}));

import { env } from "../src/config/env";
import { EmailService } from "../src/shared/services/email.service";

describe("Frente 14, Lote 3 — transporter SMTP tem timeouts explícitos", () => {
  const originalEnabledInTest = env.SMTP_ENABLED_IN_TEST;

  beforeAll(() => {
    env.SMTP_ENABLED_IN_TEST = true;
  });

  afterAll(() => {
    env.SMTP_ENABLED_IN_TEST = originalEnabledInTest;
  });

  it("createTransport é chamado com connectionTimeout, greetingTimeout e socketTimeout definidos", async () => {
    const emailService = new EmailService();
    await emailService.sendEmailVerificationEmail({
      to: "teste@muvify.local",
      name: "Teste",
      verificationUrl: "https://muvify.local/verify?token=abc"
    });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: expect.any(Number),
        greetingTimeout: expect.any(Number),
        socketTimeout: expect.any(Number)
      })
    );
    const options = createTransportMock.mock.calls[0]?.[0] as Record<string, number>;
    expect(options.connectionTimeout).toBeGreaterThan(0);
    expect(options.greetingTimeout).toBeGreaterThan(0);
    expect(options.socketTimeout).toBeGreaterThan(0);
  });
});
