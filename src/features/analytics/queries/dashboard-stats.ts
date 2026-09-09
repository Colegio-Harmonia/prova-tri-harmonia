import { queryOptions } from '@tanstack/react-query'
import { apiRequest } from '@/lib/api/client'
import type { DashboardStats } from '@/features/analytics/types/dashboard'

export type { DashboardStats } from '@/features/analytics/types/dashboard'

export const dashboardStatsQueryKey = ['stats', 'dashboard'] as const

export const dashboardStatsQueryOptions = queryOptions({
  queryKey: dashboardStatsQueryKey,
  queryFn: () => apiRequest<DashboardStats>('/api/stats/dashboard'),
})
