export type DashboardStats = {
  total: number
  byStatus: Record<string, number>
  bySegment: Record<string, number>
  byGrade: Record<string, number>
  bySubject: Record<string, number>
  bloomCounts: Record<string, number>
  totalQuestions: number
  bnccMappedPct: number
  questionsNeedingImage: number
  imagesApproved: number
}

export type DistributionEntry = {
  label: string
  value: number
}

export type ManagementSummary = {
  totalExams: number
  totalQuestions: number
  bnccMappedPct: number
  pendingReview: number
}

export type ManagementAttention = {
  label: string
  detail: string
  value: number
  href: '/status'
}
