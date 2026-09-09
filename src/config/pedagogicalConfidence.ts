export const PEDAGOGICAL_CONFIDENCE_THRESHOLDS = {
  autoApprove: 0.9,
  reviewOptional: 0.75,
  reviewRequired: 0.6,
} as const

export type PedagogicalConfidenceBand =
  | 'auto_eligible'
  | 'review_optional'
  | 'review_required'
  | 'below_threshold'
  | 'unscored'

export function getPedagogicalConfidenceBand(confidence: number | null): PedagogicalConfidenceBand {
  if (confidence === null) return 'unscored'
  if (confidence >= PEDAGOGICAL_CONFIDENCE_THRESHOLDS.autoApprove) return 'auto_eligible'
  if (confidence >= PEDAGOGICAL_CONFIDENCE_THRESHOLDS.reviewOptional) return 'review_optional'
  if (confidence >= PEDAGOGICAL_CONFIDENCE_THRESHOLDS.reviewRequired) return 'review_required'
  return 'below_threshold'
}
