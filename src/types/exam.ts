import type { BloomLevel } from '@/config/bloomVerbs'

export type Segment = 'anos-iniciais' | 'anos-finais' | 'ensino-medio'

export type HabilidadeStatus = 'mapeado' | 'nao_mapeado'

export type ParsedHabilidade = {
  code: string
  description: string | null
}

export type HabilidadesParseResult = {
  status: HabilidadeStatus
  skills: ParsedHabilidade[]
  reason?: string
}

export type ObjectiveSentence = {
  text: string
  kind: 'cognitiva' | 'atitudinal'
  bloomLevel: BloomLevel | null
  estimated: boolean
}

export type CurricularUnit = {
  rowIndex: number
  bimestre: string | null
  tituloCapitulo: string
  conteudo: string | null
  habilidades: HabilidadesParseResult
  objetivos: ObjectiveSentence[]
  objetivosColumnMissing: boolean
  /** Conteúdo enriquecido do banco (Programação Trimestral / Manual do Professor) */
  enrichedContent?: string | null
  /** Objetivos detalhados do banco */
  enrichedObjectives?: string | null
}

export type CurriculumSelection = {
  segment: Segment
  gradeYear: number
  subject: string
  bimester?: number
  tabName: string
  units: CurricularUnit[]
  unmappedWarnings: string[]
}

/**
 * Desenho de prova escolhido pelo professor a partir do planejamento da
 * escola. Os IDs são rowIndex da planilha: não muda o contrato da prova
 * final, apenas registra como os itens foram solicitados.
 */
export type CurriculumPlanItem = {
  unitRowIndex: number
  questionCount: number
  priority: 'alta' | 'media' | 'baixa'
  visualAid: 'auto' | 'obrigatorio' | 'sem_imagem'
}

export type ColumnRoles = {
  tituloCapituloIdx: number | null
  conteudoIdx: number | null
  habilidadesIdx: number | null
  objetivosIdx: number | null
  bimestreIdx: number | null
  trimestreIdx: number | null
  unidadeIdx: number | null
}
