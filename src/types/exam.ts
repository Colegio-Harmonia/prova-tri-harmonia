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

/**
 * Habilidade da Matriz do ENEM planejada para o capítulo (coluna "Habilidades
 * ENEM" da planilha do Ensino Médio). `count` = quantas vezes o código
 * aparece no planejamento — usado como peso na distribuição da prova.
 */
export type ParsedEnemSkill = {
  /** Forma canônica, ex: "C2:H5" */
  code: string
  competency: number
  skill: number
  count: number
  /** Origem das questões do material, ex: ["Unesp-2022", "Enem-2020"] */
  sources: string[]
  description: string | null
}

export type EnemSkillsParseResult = {
  skills: ParsedEnemSkill[]
  /** Códigos cujo par C:H não existe na matriz da área (ex: "C2:H14") */
  invalid: string[]
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
  /** Nome da unidade quando a aba a traz separada do capítulo (ex.: Inglês) e há coluna de bimestre/trimestre. */
  unidade?: string | null
  conteudo: string | null
  habilidades: HabilidadesParseResult
  objetivos: ObjectiveSentence[]
  objetivosColumnMissing: boolean
  /** Só Ensino Médio — habilidades ENEM planejadas (C:H). Ausente/vazio fora do EM. */
  enemSkills?: EnemSkillsParseResult
  /** Texto original das habilidades ENEM (para importar no planejamento sem perder peso/origem). */
  enemSkillsRaw?: string | null
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
  habilidadesEnemIdx: number | null
  objetivosIdx: number | null
  bimestreIdx: number | null
  trimestreIdx: number | null
  unidadeIdx: number | null
}
