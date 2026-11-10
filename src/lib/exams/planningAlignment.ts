import { evaluateWithJev, type JsonValue } from '@/lib/ai/jevClient'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import type { TargetEnemSkill } from './targetSkills'

export type PlanningTarget = {
  subject: string
  gradeYear: number
  classLabel?: string
  unitTitle: string
  curriculumContent: string | null
  enrichedContent?: string | null
  objectives: string[]
  targetEnemSkill?: TargetEnemSkill | null
  targetBnccCodes?: string[]
}

const ALIGNMENT_INSTRUCTIONS = 'Considere o enunciado, os distratores e o gabarito; não reescreva o item. Compare os conceitos, procedimentos e a operação necessários à resolução com o conteúdo e os objetivos do planejamento. Situações, vocabulário e temas diferentes são compatíveis quando mobilizam os mesmos conhecimentos trabalhados; não exija palavras iguais ao título nem que uma questão cubra todos os tópicos do capítulo. O título sozinho também não prova aderência. Não aceite apenas um tema semelhante quando a resolução exige outro conteúdo ou pré-requisitos não trabalhados. Habilidade: avaliar a operação que resolve o item, não mera coincidência temática nem rótulo recebido. Sem alvo ENEM, use objetivos e BNCC. Turma: confira série, idioma da disciplina, leitura e pré-requisitos. Uma questão de Português sobre outro país não é uma questão de Inglês. Se houver mídia essencial sem conteúdo suficiente para julgá-la, devolva partial. Não invente evidência.'

export class PlanningAlignmentUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'PlanningAlignmentUnavailableError' }
}

/**
 * Decide se um candidato do acervo é aceito. Conferência indisponível nunca
 * presume compatibilidade: o candidato é descartado e a busca segue (no pior
 * caso a questão é gerada por IA). Só quando a indisponibilidade se repete além
 * do limite — sinal de que o provedor está fora, não de uma falha pontual —
 * a geração é interrompida, para o worker adiar o job.
 * Antes, uma única falha derrubava a prova inteira (lote 477, 10/11/2026).
 */
export function createPlanningAcceptance(maxUnavailable = 5) {
  let unavailable = 0
  return (alignment: NonNullable<ExamQuestion['planningAlignment']>): boolean => {
    if (alignment.status !== 'unavailable') return alignment.status === 'aligned'
    unavailable++
    if (unavailable > maxUnavailable) throw new PlanningAlignmentUnavailableError(alignment.evidence)
    console.warn('[planning-alignment] conferência indisponível; candidato descartado', { unavailable, maxUnavailable })
    return false
  }
}
export type PlanningQuestion = Pick<ExamQuestion, 'number' | 'statement' | 'supportText' | 'alternatives' | 'correctLetter' | 'expectedAnswer' | 'acervoRef' | 'imageDescription'>

/** A classificação do item e sua adequação a uma unidade são decisões distintas. */
export async function assessPlanningAlignment(
  question: PlanningQuestion,
  target: PlanningTarget,
  evaluate: typeof evaluateWithJev = evaluateWithJev,
): Promise<NonNullable<ExamQuestion['planningAlignment']>> {
  const dimensions = ['conteudo', 'habilidade', 'turma'] as const
  const criteria = {
    aligned: 'Compatível, sustentado pelo conteúdo e pela operação realmente exigida para resolver o item.',
    partial: 'Relação parcial ou evidência insuficiente; precisa de decisão docente.',
    misaligned: 'Incompatível com o recorte, operação, idioma ou conhecimentos prévios da turma.',
  }
  const result = await evaluate({
    operation: 'jev/exams/planning-alignment', questionVersion: 'planning-alignment-v1', cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    state: { target: {
      subject: target.subject, gradeYear: target.gradeYear, classLabel: target.classLabel ?? null,
      unitTitle: target.unitTitle, curriculumContent: target.curriculumContent,
      enrichedContent: target.enrichedContent ?? null, objectives: target.objectives,
      targetEnemSkill: target.targetEnemSkill ?? null, targetBnccCodes: target.targetBnccCodes ?? [],
    }, question: {
      statement: question.statement, supportText: question.supportText ?? null,
      alternatives: question.alternatives ?? null, correctLetter: question.correctLetter ?? null,
      expectedAnswer: question.expectedAnswer ?? null,
      media: question.acervoRef?.original.midias ?? null,
      imageDescription: question.imageDescription ?? null,
    } } as unknown as JsonValue,
    questions: Object.fromEntries(dimensions.map((dimension) => [dimension, {
      type: 'choice' as const,
      instructions: `Avalie ${dimension} independentemente. ${ALIGNMENT_INSTRUCTIONS}`,
      criteria,
    }])),
    route: () => ({ route: 'automatic', outcome: 'planning_alignment_checked' }),
    fallback: { answers: Object.fromEntries(dimensions.map((dimension) => [dimension, { type: 'choice' as const, choice: 'partial', confidence: 0 }])), routing: { route: 'fallback', outcome: 'planning_alignment_unavailable' } },
    context: { subject: target.subject, gradeYear: target.gradeYear, questionNumber: question.number },
  })
  const answers = dimensions.map((dimension) => {
    const answer = result.answers[dimension]
    return answer?.type === 'choice' && Object.hasOwn(criteria, answer.choice) ? answer.choice : 'partial'
  })
  const status = result.source === 'fallback' ? 'unavailable' : answers.includes('misaligned') ? 'misaligned' : answers.every((answer) => answer === 'aligned') ? 'aligned' : 'partial'
  const labels: Record<string, string> = { aligned: 'compatível', partial: 'relação parcial ou sem evidência suficiente', misaligned: 'incompatível' }
  return { status, evidence: result.source === 'fallback' ? 'Conferência de aderência indisponível; nenhuma compatibilidade foi presumida.' : dimensions.map((dimension, index) => `${dimension}: ${labels[answers[index]]}`).join('; '), model: result.model, checkedAt: new Date().toISOString() }
}

/** Avalia vários itens independentes na mesma chamada, sem misturar as evidências. */
export async function assessPlanningAlignmentBatch(
  questions: PlanningQuestion[],
  target: PlanningTarget,
  evaluate: typeof evaluateWithJev = evaluateWithJev,
): Promise<Array<NonNullable<ExamQuestion['planningAlignment']>>> {
  if (!questions.length) return []
  const dimensions = ['conteudo', 'habilidade', 'turma'] as const
  const criteria = {
    aligned: 'Compatível, sustentado pelo conteúdo e pela operação realmente exigida para resolver o item.',
    partial: 'Relação parcial ou evidência insuficiente; precisa de decisão docente.',
    misaligned: 'Incompatível com o recorte, operação, idioma ou conhecimentos prévios da turma.',
  }
  const entries = questions.flatMap((_, index) => dimensions.map((dimension) => [
    `item_${index}_${dimension}`, {
      type: 'choice' as const,
      instructions: `Avalie apenas ${dimension} do item_${index}, de forma independente dos demais itens. ${ALIGNMENT_INSTRUCTIONS}`,
      criteria,
    },
  ] as const))
  const result = await evaluate({
    operation: 'jev/exams/planning-alignment-batch', questionVersion: 'planning-alignment-batch-v1', cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    state: { target, items: Object.fromEntries(questions.map((question, index) => [`item_${index}`, {
      statement: question.statement, supportText: question.supportText ?? null,
      alternatives: question.alternatives ?? null, correctLetter: question.correctLetter ?? null,
      expectedAnswer: question.expectedAnswer ?? null, media: question.acervoRef?.original.midias ?? null,
      imageDescription: question.imageDescription ?? null,
    }])) } as unknown as JsonValue,
    questions: Object.fromEntries(entries),
    route: () => ({ route: 'automatic', outcome: 'planning_alignment_checked' }),
    fallback: { answers: Object.fromEntries(entries.map(([key]) => [key, { type: 'choice' as const, choice: 'partial', confidence: 0 }])), routing: { route: 'fallback', outcome: 'planning_alignment_unavailable' } },
    context: { subject: target.subject, gradeYear: target.gradeYear },
  })
  const labels: Record<string, string> = { aligned: 'compatível', partial: 'relação parcial ou sem evidência suficiente', misaligned: 'incompatível' }
  const checkedAt = new Date().toISOString()
  return questions.map((_, index) => {
    const answers = dimensions.map((dimension) => {
      const answer = result.answers[`item_${index}_${dimension}`]
      return answer?.type === 'choice' && Object.hasOwn(criteria, answer.choice) ? answer.choice : 'partial'
    })
    const status = result.source === 'fallback' ? 'unavailable' : answers.includes('misaligned') ? 'misaligned' : answers.every((answer) => answer === 'aligned') ? 'aligned' : 'partial'
    return { status, evidence: result.source === 'fallback' ? 'Conferência de aderência indisponível; nenhuma compatibilidade foi presumida.' : dimensions.map((dimension, i) => `${dimension}: ${labels[answers[i]]}`).join('; '), model: result.model, checkedAt }
  })
}

export function planningTargetForUnit(unit: import('@/types/exam').CurricularUnit, context: { subject: string; gradeYear: number; classLabel?: string }, targetEnemSkill?: TargetEnemSkill | null, targetBnccCodes?: string[]): PlanningTarget {
  return { subject: context.subject, gradeYear: context.gradeYear, classLabel: context.classLabel, unitTitle: unit.tituloCapitulo, curriculumContent: unit.conteudo, enrichedContent: unit.enrichedContent,
    objectives: unit.objetivos.filter((objective) => objective.kind === 'cognitiva').map((objective) => objective.text),
    targetEnemSkill, targetBnccCodes: targetBnccCodes ?? unit.habilidades.skills.map((skill) => skill.code) }
}
