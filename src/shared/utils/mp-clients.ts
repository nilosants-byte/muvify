import { CardToken, Payment, PaymentRefund } from "mercadopago";
import { mpConfigFor } from "../../config/mercadopago";

// Clientes do Mercado Pago amarrados a uma conta: sem token → conta da
// plataforma; com o token OAuth do personal → conta dele (split). Ver o
// comentário de mpConfigFor em config/mercadopago.ts.
export function mpPaymentFor(accessToken?: string | null) {
  return new Payment(mpConfigFor(accessToken));
}

export function mpRefundFor(accessToken?: string | null) {
  return new PaymentRefund(mpConfigFor(accessToken));
}

export function mpCardTokenFor(accessToken?: string | null) {
  return new CardToken(mpConfigFor(accessToken));
}

// Campo de comissão da plataforma no POST /v1/payments do split.
export function splitFeeFields(accessToken: string | null | undefined, feeCents: number) {
  return accessToken ? { application_fee: feeCents / 100 } : {};
}
