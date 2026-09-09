import type { Segment } from '@/types/exam'

export type SaebApplicability =
  | { applicable: false }
  | { applicable: true; matrixType: 'saeb'; adapted: boolean }
  | { applicable: true; matrixType: 'enem' }

const LP_ALIASES = ['língua portuguesa', 'português']
const MAT_ALIASES = ['matemática']
const CIENCIAS_ALIASES = ['ciências', 'ciencias']
const CH_ALIASES = ['história', 'geografia']

function normalize(subject: string): string {
  return subject.trim().toLowerCase()
}

/**
 * Hardcoded per the root + segment CLAUDE.md rules — never inferred from
 * model output. Inglês (e outras disciplinas sem matriz oficial) continua
 * sem cobertura SAEB em anos-iniciais/anos-finais.
 *
 * Ciências Humanas (História/Geografia) e Ciências da Natureza (Ciências)
 * confirmadas com matriz oficial própria pra 5º E 9º ano — fonte direta:
 * "Matrizes de Referência do Saeb: Ciências da Natureza e Ciências
 * Humanas" (INEP, 24/02/2025) e "Matriz de Referência de Ciências da
 * Natureza do Saeb" (INEP, maio/2020), baixados 15/07/2026. Isso substitui
 * a suposição conservadora anterior de que Ciências só tinha matriz no 9º
 * ano — os documentos oficiais mostram proporção de itens definida também
 * pro 5º ano.
 */
export function getSaebApplicability(segment: Segment, gradeYear: number, subject: string): SaebApplicability {
  const normalized = normalize(subject)

  if (segment === 'ensino-medio') {
    // BNCC EM codes (EM13<AREA>...) already embed the ENEM área — any
    // subject with a mapped habilidade crosswalks to ENEM. Subjects with no
    // Habilidades column at all (e.g. Sociologia 1º ano) are a data-
    // availability problem handled in curriculumService, not here.
    return { applicable: true, matrixType: 'enem' }
  }

  const officialGrade = segment === 'anos-iniciais' ? 5 : 9

  const isLpOrMat = LP_ALIASES.includes(normalized) || MAT_ALIASES.includes(normalized)
  if (isLpOrMat) {
    // 2º ano tem matriz própria (não aproximada) além do 5º/9º — só 3º/4º
    // ano ficam "adapted" (SAEB não testa oficialmente essas séries).
    const hasOwnMatrix = gradeYear === officialGrade || (segment === 'anos-iniciais' && gradeYear === 2)
    return { applicable: true, matrixType: 'saeb', adapted: !hasOwnMatrix }
  }

  if (CIENCIAS_ALIASES.includes(normalized) || CH_ALIASES.includes(normalized)) {
    return { applicable: true, matrixType: 'saeb', adapted: gradeYear !== officialGrade }
  }

  return { applicable: false }
}
