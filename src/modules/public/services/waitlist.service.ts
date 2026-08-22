import { WaitlistAudience } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { env } from "../../../config/env";
import { EmailQueueService } from "../../../shared/services/email-queue.service";

const emailQueueService = new EmailQueueService();

type WaitlistSignupInput = {
  email: string;
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
    const signup = await prisma.waitlistSignup.upsert({
      where: { email: input.email },
      update: {
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
