import type { QueryClient, QueryKey } from "@tanstack/react-query";

// The rollback half of an optimistic mutation: patch the cache immediately in
// onMutate, and if the server refuses the write, put back exactly what was
// there before. `cancelQueries` first stops a refetch that's already in
// flight from overwriting the optimistic value the instant after we set it —
// without it, a slow background refetch that resolves between onMutate and
// the user seeing their click could show the OLD data for a moment, which
// reads as "your click didn't take" instead of "we're waiting on the server."
//
// Every call site still keeps its own onSuccess/onSettled invalidation — this
// only closes the gap between the click and that refetch landing; the
// refetch remains the source of truth for anything the client can't predict
// (server-computed columns, another user's concurrent edit).
export function optimisticUpdate<TQueryData, TVariables>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  updater: (previous: TQueryData | undefined, variables: TVariables) => TQueryData | undefined,
) {
  return {
    onMutate: async (variables: TVariables) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TQueryData>(queryKey);
      queryClient.setQueryData<TQueryData>(queryKey, (current) => updater(current, variables));
      return { previous };
    },
    onError: (
      _error: unknown,
      _variables: TVariables,
      // `previous: TQueryData | undefined` (not `previous?:`) because
      // exactOptionalPropertyTypes treats those as different types, and
      // onMutate above always includes the key — its VALUE is what's
      // sometimes undefined (nothing cached yet), not the key's presence.
      context: { previous: TQueryData | undefined } | undefined,
    ) => {
      if (context) queryClient.setQueryData(queryKey, context.previous);
    },
  };
}

// useMutation accepts exactly one onError, but every optimistic call site
// needs both the rollback above and its own existing error-toast logic.
// Runs every handler in order (rollback first, so the call site's own
// handler — which may read `error.code` to pick a message — runs against
// the now-reverted cache).
export function mergeOnError<TError, TVariables, TContext>(
  ...handlers: Array<
    ((error: TError, variables: TVariables, context: TContext | undefined) => void) | undefined
  >
) {
  return (error: TError, variables: TVariables, context: TContext | undefined) => {
    for (const handler of handlers) handler?.(error, variables, context);
  };
}
