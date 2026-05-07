import { MercadoPagoConfig } from "mercadopago";
import { env } from "./env";

export const mp = new MercadoPagoConfig({
  accessToken: env.MP_ACCESS_TOKEN,
  options: { timeout: 15000 }
});
