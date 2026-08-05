import { MercadoPagoConfig } from "mercadopago";
import { env } from "./env";

// Épico de Frentes, Frente 12, Lote 2: exportada porque qualquer transação
// interativa do Prisma que chame a MP no meio (ex: captura de pagamento
// dentro da confirmação de sessão, booking.service.ts::confirmCompletion)
// precisa de um timeout PRÓPRIO maior que este - senão a chamada à MP pode
// levar até esse tempo inteiro e ainda assim a transação já ter estourado o
// dela, deixando o pagamento capturado (commitado numa conexão separada) sem
// o resto do trabalho (evidência, status do booking) ter sido salvo.
export const MP_CLIENT_TIMEOUT_MS = 15000;

export const mp = new MercadoPagoConfig({
  accessToken: env.MP_ACCESS_TOKEN,
  options: { timeout: MP_CLIENT_TIMEOUT_MS }
});
