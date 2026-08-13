import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { captureException } from "../observability/sentry";

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
// Frente 13 (segunda camada), Lote 12: a captura de erro de query/mutation
// dependia de cada tela adicionar manualmente um useEffect observando
// query.error — presente nalgumas telas, ausente nas de maior tráfego do
// app (Home do cliente, Favoritos). Protegendo aqui, na raiz do
// QueryClient (mesmo princípio já usado no backend pra sendToUsers, Frente
// 2), toda tela nasce coberta automaticamente, sem depender de lembrar de
// adicionar o useEffect em cada uma.
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      captureException(error, {
        source: "react-query",
        type: "query",
        queryKey: JSON.stringify(query.queryKey)
      });
    }
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      captureException(error, {
        source: "react-query",
        type: "mutation",
        mutationKey: mutation.options.mutationKey ? JSON.stringify(mutation.options.mutationKey) : undefined
      });
    }
  }),
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
