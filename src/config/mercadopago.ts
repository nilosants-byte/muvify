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

// Pergunta do Danilo / achado de 21/10/2026: a biblioteca do Mercado Pago
// (mercadopago@3) IGNORA `accessToken` dentro de `requestOptions` — o
// cabeçalho Authorization sai sempre do MercadoPagoConfig. Os 13 pontos que
// cobravam "em nome do personal" passavam o token do personal ali e, na
// prática, cobravam com a conta da plataforma (sem split nenhum). O split
// (docs de Split Payments / Checkout Transparente) exige criar o pagamento
// com o token OAuth do personal + `application_fee` — e qualquer operação
// posterior nesse pagamento (consultar, capturar, cancelar, estornar) também
// tem que sair da conta dele.
//
// Config novo a cada chamada (barato, é só um objeto): a classe Payment da
// biblioteca faz `this.config.options = {...this.config.options,
// ...requestOptions}`, ou seja, a idempotencyKey de uma chamada fica grudada
// no config compartilhado e vaza pra chamada seguinte que não passar a sua.
export function mpConfigFor(accessToken?: string | null): MercadoPagoConfig {
  return new MercadoPagoConfig({
    accessToken: accessToken || env.MP_ACCESS_TOKEN,
    options: { timeout: MP_CLIENT_TIMEOUT_MS }
  });
}
