import React from "react";

type Props = { children: React.ReactNode };

export function StripeAppProvider({ children }: Props) {
  return <>{children}</>;
}
