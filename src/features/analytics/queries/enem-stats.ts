import { queryOptions } from '@tanstack/react-query'
import { apiRequest } from '@/lib/api/client'

export type EnemStats = {
  total: number
  byYear: Record<string, number>
  byArea: Record<string, number>
  bloomCounts: Record<string, number>
  bloomClassified: number
  bloomPending: number
  matrixStats: Array<{ area: string; count: number; level: string | null }>
  topSkills: Array<{ skillCode: string | null; skillDescription: string | null; count: number }>
  byCompetency: Array<{ area: string; number: number; description: string; count: number }>
  bySkillInCompetency: Array<{ area: string; competencyNumber: number; skillCode: string; skillDescription: string | null; count: number }>
  classificationSource: Record<string, number>
  cognitiveAxes: Record<string, number>
  cognitiveAxesNames: Record<string, string>
}

export const enemStatsQueryOptions = queryOptions({
  queryKey: ['stats', 'enem'] as const,
  queryFn: () => apiRequest<EnemStats>('/api/stats/enem'),
})
