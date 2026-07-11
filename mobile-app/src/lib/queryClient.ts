import { QueryClient } from "@tanstack/react-query";

/**
 * QueryClient singleton compartilhado pelo app inteiro.
 *
 * staleTime: 0 → dados são imediatamente considerados stale após a primeira busca.
 *   Isso garante que, ao montar uma tela, o TanStack Query sempre busca dados frescos
 *   NO FUNDO — mas exibe o cache anterior na hora (sem spinner). Comportamento
 *   idêntico ao atual, porém sem a tela em branco/skeleton enquanto espera.
 *
 * gcTime: 5 min → mantém o cache em memória por 5 min após todos os assinantes
 *   desmontarem. Navegando de volta para uma tela dentro de 5 min = dado aparece
 *   instantaneamente enquanto o refetch acontece em segundo plano.
 *
 * retry: 1 → uma tentativa extra em caso de falha de rede antes de retornar erro.
 * refetchOnWindowFocus: false → não aplicável em mobile.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
