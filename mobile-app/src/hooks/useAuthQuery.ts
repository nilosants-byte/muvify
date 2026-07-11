import {
  useMutation,
  useQuery,
  UseMutationOptions,
  UseQueryOptions,
  QueryKey,
} from "@tanstack/react-query";
import { useAppState } from "../state/AppState";

/**
 * useAuthQuery — wrapper do TanStack Query que injeta o token via runWithAuth.
 *
 * Substitui o padrão:
 *   useEffect(() => { void load(); }, [load]);
 *
 * Por:
 *   const { data, isLoading } = useAuthQuery(queryKeys.xxx(), t => api.xxx(t));
 *
 * Comportamento:
 * - Se há cache: exibe imediatamente + busca dados frescos em segundo plano.
 * - Se não há cache: exibe loading skeleton + busca dados.
 * - Em caso de erro: propaga para o caller via `isError` / `error`.
 */
export function useAuthQuery<T>(
  queryKey: QueryKey,
  queryFn: (token: string) => Promise<T>,
  options?: Omit<UseQueryOptions<T, Error, T, QueryKey>, "queryKey" | "queryFn">
) {
  const { runWithAuth } = useAppState();
  return useQuery<T, Error>({
    queryKey,
    queryFn: () => runWithAuth(queryFn),
    ...options,
  });
}

/**
 * useAuthMutation — wrapper do TanStack Query para operações de escrita.
 *
 * Substitui o padrão:
 *   const [saving, setSaving] = useState(false);
 *   async function handleSave() { setSaving(true); await runWithAuth(...); setSaving(false); }
 *
 * Por:
 *   const mutation = useAuthMutation((t, vars) => api.save(t, vars), {
 *     onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.xxx.all }),
 *   });
 *   mutation.mutate(vars);
 *
 * mutation.isPending substitui o estado `saving`.
 */
export function useAuthMutation<TData = unknown, TVariables = void>(
  mutationFn: (token: string, variables: TVariables) => Promise<TData>,
  options?: UseMutationOptions<TData, Error, TVariables>
) {
  const { runWithAuth } = useAppState();
  return useMutation<TData, Error, TVariables>({
    mutationFn: (variables) => runWithAuth((t) => mutationFn(t, variables)),
    ...options,
  });
}
