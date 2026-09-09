import type { ScoringMethod } from '@/db/schema'
import type { InternalEstimate } from './internalEstimate'

// Política de pontuação: TRI INEP não é um rótulo de prova. Ela só existe
// quando a prova/atividade contém questões reais do banco ENEM. O cálculo
// depois filtra novamente os itens sem parâmetros oficiais a/b/c; questões
// autorais e geradas por IA nunca entram nela. O SAE externo fica fora deste
// fluxo e usa apenas indicadores descritivos.

export type ScorableQuestion = { type?: string; source?: string }

export function scoringMethodForQuestions(questions: ScorableQuestion[]): ScoringMethod {
  return questions.some((question) => question.type === 'objetiva' && question.source === 'enem_bank')
    ? 'tri'
    : 'percentual'
}

// Cobertura mínima de itens calibrados pro score TRI ser apresentado sem
// ressalva. Abaixo disso o score sai rotulado "estimativa aproximada"
// com o percentual ao lado (decisão confirmada 24/07/2026); com ZERO
// itens calibrados não existe TRI — só percentual com aviso.
export const TRI_MIN_CALIBRATED_COVERAGE = 0.7

// ---------------------------------------------------------------------------
// Shape de exam_corrections.score_result (JSONB) — gravado pelo job
// 'pontuar_prova', nunca recalculado na leitura.
// ---------------------------------------------------------------------------

export type PercentualBreakdown = {
  percent: number // 0-100, 1 casa decimal
  decimal: number // 0-10, 2 casas decimais
  gradedQuestions: number
  objectiveTotal: number
  objectiveCorrect: number
  // Respostas ainda sem correção fechada (objetiva sem isCorrect,
  // descritiva sem finalGrade) — contadas como 0 e sinalizadas, em vez de
  // silenciosamente ignoradas.
  incompleteAnswers: number
}

export type PercentualScore = PercentualBreakdown & {
  method: 'percentual'
  // Presente somente quando houver itens autorais/IA. É um diagnóstico
  // pedagógico ponderado por dificuldade declarada; não é TRI.
  internalEstimate?: InternalEstimate | null
}

export type TriEstimate = {
  score: number // 0-1000, inteiro
  theta: number
  sem: number // erro-padrão da estimativa EAP
  itemsUsed: number // itens objetivos com calibração oficial que entraram
  itemsTotal: number // total de itens objetivos da prova
  approximate: boolean // cobertura < TRI_MIN_CALIBRATED_COVERAGE
}

export type TriScore = {
  method: 'tri'
  // null quando nenhum item da prova tem calibração oficial — nesse caso
  // só o percentual é exibido, com o motivo em noTriReason.
  tri: TriEstimate | null
  noTriReason: string | null
  // Sempre presente: exibido ao lado do TRI quando approximate, e é o
  // único número quando tri é null.
  percentual: PercentualBreakdown
  internalEstimate?: InternalEstimate | null
}

export type ScoreResult = PercentualScore | TriScore
