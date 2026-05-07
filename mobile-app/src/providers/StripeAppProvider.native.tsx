import React from "react";

type Props = { children: React.ReactNode };

// Stripe foi substituído pelo Mercado Pago — não é mais necessário um provider de SDK de pagamentos.
export function StripeAppProvider({ children }: Props) {
  return <>{children}</>;
}
