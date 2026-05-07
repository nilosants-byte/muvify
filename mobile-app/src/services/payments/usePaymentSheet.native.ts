// Stripe foi substituído pelo Mercado Pago.
// O salvamento de cartão agora usa o formulário nativo com tokenização MP.
export function usePaymentSheet() {
  return {
    available: false,
    initPaymentSheet: async () => ({ error: { message: "Use o formulário de cartão MP." } }),
    presentPaymentSheet: async () => ({ error: { message: "Use o formulário de cartão MP." } })
  };
}
