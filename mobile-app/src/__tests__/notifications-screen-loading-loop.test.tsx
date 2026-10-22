import React from "react";
import { render, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationsScreen } from "../screens/shared/NotificationsScreen";
import { useAppState } from "../state/AppState";

// Teste manual C13.1 (22/10/2026): abrir a central de notificações enquanto
// a lista ainda carregava entrava em loop infinito ("Maximum update depth
// exceeded") — um "= []" criava uma lista nova a cada render e um efeito
// dependente dela chamava setState de novo.
jest.mock("../state/AppState", () => ({ useAppState: jest.fn() }));

test("central de notificações carregando não entra em loop de atualização", async () => {
  // Na versão com o bug, este teste trava até estourar o tempo (o loop não
  // deixa o render terminar) — por isso o limite curto abaixo.
  // Carregamento que nunca termina = o instante em que o usuário abriu rápido.
  (useAppState as jest.Mock).mockReturnValue({
    runWithAuth: jest.fn(() => new Promise(() => {})),
    showToast: jest.fn(),
    role: "CLIENT",
    user: { id: "u1", role: "CLIENT" }
  });
  const errors: string[] = [];
  const spy = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <NotificationsScreen navigation={{ navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}) }} />
    </QueryClientProvider>
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });

  spy.mockRestore();
  expect(errors.filter((e) => e.includes("Maximum update depth"))).toEqual([]);
}, 30000);
