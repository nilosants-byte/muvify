import "dotenv/config";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// Achado em teste manual (2026-09-30): o envio por SMTP tradicional (porta
// 587) ficava com "Connection timeout" persistente a partir do Render,
// mesmo com timeouts generosos e credenciais do Resend corretas -
// hospedagens costumam restringir tráfego SMTP de saída. Migrado pra API
// HTTP do Resend (mesma porta 443 que qualquer outra chamada do servidor
// já usa sem problema). Este teste (antes "Frente 14, Lote 3", sobre
// timeouts do transporter Nodemailer) deixou de fazer sentido - não existe
// mais transporter SMTP nenhum - e foi substituído por um teste
// equivalente sobre a chamada HTTP à API do Resend.
const fetchMock = vi.hoisted(() => vi.fn());

import { env } from "../src/config/env";
import { EmailService } from "../src/shared/services/email.service";

describe("Envio de e-mail via API HTTP do Resend (não SMTP)", () => {
  const originalEnabledInTest = env.SMTP_ENABLED_IN_TEST;
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    env.SMTP_ENABLED_IN_TEST = true;
  });

  afterAll(() => {
    env.SMTP_ENABLED_IN_TEST = originalEnabledInTest;
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ""
    } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("chama a API do Resend (https://api.resend.com/emails) com autenticação e corpo corretos", async () => {
    const emailService = new EmailService();
    await emailService.sendEmailVerificationEmail({
      to: "teste@muvify.local",
      name: "Teste",
      verificationUrl: "https://muvify.local/verify?token=abc"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.method).toBe("POST");
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${env.SMTP_PASS}`);
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(options.body as string);
    expect(body.to).toBe("teste@muvify.local");
    expect(body.from).toBe(env.SMTP_FROM);
    expect(body.subject).toContain("Confirme seu e-mail");
    expect(typeof body.html).toBe("string");
    expect(typeof body.text).toBe("string");
  });

  it("inclui reply_to quando informado (ex: mensagem de suporte)", async () => {
    const emailService = new EmailService();
    await emailService.sendSupportMessageEmail({
      to: "suporte@muvify.local",
      userName: "Teste",
      userEmail: "usuario@teste.local",
      userRole: "CLIENT",
      subject: "Duvida",
      message: "teste teste"
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.reply_to).toBe("usuario@teste.local");
  });

  it("lança erro com a mensagem do Resend quando a API responde com erro", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ message: "invalid `to` field" })
    } as Response);

    const emailService = new EmailService();
    await expect(
      emailService.sendEmailVerificationEmail({
        to: "teste@muvify.local",
        name: "Teste",
        verificationUrl: "https://muvify.local/verify?token=abc"
      })
    ).rejects.toThrow(/Resend API error/);
  });
});
