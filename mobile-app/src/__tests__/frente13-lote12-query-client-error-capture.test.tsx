/**
 * Frente 13 (segunda camada), Lote 12: captura de erro de query/mutation
 * dependia de cada tela lembrar de adicionar um useEffect observando
 * query.error — ausente nas telas de maior tráfego do app (Home do
 * cliente, Favoritos). Protegido agora na raiz do QueryClient
 * (queryCache/mutationCache onError), cobrindo toda tela automaticamente.
 */
import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient";
import { captureException } from "../observability/sentry";

jest.mock("../observability/sentry", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setSentryUser: jest.fn()
}));

function FailingQueryProbe() {
  useQuery({
    queryKey: ["frente13-lote12-query-probe"],
    queryFn: () => Promise.reject(new Error("falha de query de teste")),
    retry: false
  });
  return null;
}

function FailingMutationProbe() {
  const mutation = useMutation({
    mutationKey: ["frente13-lote12-mutation-probe"],
    mutationFn: () => Promise.reject(new Error("falha de mutation de teste"))
  });
  React.useEffect(() => {
    mutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

describe("Frente 13, Lote 12 — captura de erro global do QueryClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uma query que falha aciona captureException via queryCache global, sem a tela precisar fazer nada", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <FailingQueryProbe />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ source: "react-query", type: "query" })
      )
    );
  });

  it("uma mutation que falha aciona captureException via mutationCache global", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <FailingMutationProbe />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ source: "react-query", type: "mutation" })
      )
    );
  });
});
