import { QueryClient } from '@tanstack/react-query'

export const QUERY_STALE_TIME_MS = 60_000

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  })
}
