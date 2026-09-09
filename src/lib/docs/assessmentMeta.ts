import type { Segment } from '@/types/exam'
import type { ExamKind } from '@/db/schema'

export type AssessmentMeta = {
  ano: string
  bimestre: string
  disciplina: string
  tituloProva: string
  tituloGabarito: string
  tituloMapa: string
}

export function buildAssessmentMeta(params: {
  segment: Segment
  gradeYear: number
  subject: string
  bimester?: number | null
  // 'reforco_enem' (Módulo 3) troca os títulos dos 3 documentos:
  // Atividade / Gabarito Comentado / Mapa da Atividade.
  examKind?: ExamKind
  enemSkills?: string[]
}): AssessmentMeta {
  const ano = `${params.gradeYear}º ano`
  const disciplinaUpper = params.subject.toUpperCase()

  if (params.examKind === 'reforco_enem') {
    const skillsSuffix = params.enemSkills?.length ? ` (${params.enemSkills.join(', ')})` : ''
    return {
      ano,
      bimestre: 'Reforço',
      disciplina: params.subject,
      tituloProva: `ATIVIDADE DE REFORÇO ENEM - ${disciplinaUpper}${skillsSuffix}`,
      tituloGabarito: `GABARITO COMENTADO - ${disciplinaUpper}${skillsSuffix}`,
      tituloMapa: `MAPA DA ATIVIDADE - ${disciplinaUpper}${skillsSuffix}`,
    }
  }

  if (params.examKind === 'atividade') {
    const bimestre = params.bimester ? `${params.bimester}º` : 'Formativa'
    return { ano, bimestre, disciplina: params.subject, tituloProva: `ATIVIDADE - ${disciplinaUpper}`, tituloGabarito: `GABARITO DA ATIVIDADE - ${disciplinaUpper}`, tituloMapa: `MAPA DA ATIVIDADE - ${disciplinaUpper}` }
  }

  const bimestre = params.bimester ? `${params.bimester}º` : 'Final'
  const tipoAvaliacao = params.bimester ? 'BIMESTRAL' : 'FINAL'

  return {
    ano,
    bimestre,
    disciplina: params.subject,
    tituloProva: `AVALIAÇÃO ${tipoAvaliacao} - ${disciplinaUpper}`,
    tituloGabarito: `GABARITO - ${disciplinaUpper}`,
    tituloMapa: `MAPA DA PROVA - ${disciplinaUpper}`,
  }
}
