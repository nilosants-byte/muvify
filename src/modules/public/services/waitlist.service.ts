import { WaitlistAudience } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { env } from "../../../config/env";
import { AppError } from "../../../shared/errors/app-error";
import { EmailQueueService } from "../../../shared/services/email-queue.service";

const emailQueueService = new EmailQueueService();

type WaitlistSignupInput = {
  email: string;
  name?: string;
  audience: WaitlistAudience;
  whatsapp?: string;
  city?: string;
  utmSource?: string;
};

export class WaitlistService {
  // E-mail é a identidade única da lista: reenviar o mesmo e-mail atualiza
  // o cadastro (audience/whatsapp/cidade) em vez de dar erro de duplicado -
  // alguém que só quer corrigir o que preencheu não deveria ver uma
  // mensagem de falha.
  async signup(input: WaitlistSignupInput) {
    // Mesmo padrão de checagem prévia já usado por User.apelido
    // (user.service.ts) - WhatsApp é @unique no schema, mas checar antes
    // do upsert (em vez de deixar o P2002 estourar) permite distinguir
    // "esse WhatsApp é meu mesmo, só tô corrigindo o cadastro" (mesmo
    // e-mail) de "alguém tentando usar e-mails diferentes com o mesmo
    // número real" (bloqueado). Mensagem genérica de propósito - não
    // confirma pra quem está tentando que aquele WhatsApp específico já
    // está cadastrado.
    if (input.whatsapp) {
      const existingByWhatsapp = await prisma.waitlistSignup.findFirst({
        where: { whatsapp: input.whatsapp },
        select: { email: true }
      });
      if (existingByWhatsapp && existingByWhatsapp.email !== input.email) {
        throw new AppError("Não foi possível concluir o cadastro.", StatusCodes.BAD_REQUEST);
      }
    }

    const signup = await prisma.waitlistSignup.upsert({
      where: { email: input.email },
      update: {
        name: input.name,
        audience: input.audience,
        whatsapp: input.whatsapp,
        city: input.city,
        utmSource: input.utmSource
      },
      create: input
    });

    // Enfileirar (não enviar) é só um INSERT rápido - mesmo padrão de
    // await direto já usado em auth.service.ts/booking.service.ts pros
    // outros enqueueX. O envio de verdade acontece depois, de forma
    // assíncrona, via processRetryQueue.
    if (env.WAITLIST_ENABLED) {
      await emailQueueService.enqueueWaitlistWelcome({ to: signup.email, audience: signup.audience });
    }

    return signup;
  }

  async countForSocialProof() {
    return prisma.waitlistSignup.count();
  }
}
