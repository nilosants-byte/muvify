type PaymentSheetError = { message: string };

type PaymentSheetResult = {
  error?: PaymentSheetError;
};

export function usePaymentSheet() {
  return {
    available: false,
    initPaymentSheet: async (): Promise<PaymentSheetResult> => ({
      error: { message: "Configuração de cartão indisponível na versão web." }
    }),
    presentPaymentSheet: async (): Promise<PaymentSheetResult> => ({
      error: { message: "Configuração de cartão indisponível na versão web." }
    })
  };
}

