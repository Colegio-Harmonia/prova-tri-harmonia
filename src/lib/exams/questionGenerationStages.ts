import { z } from 'zod'
import { evaluateWithJev, type JevQuestions } from '@/lib/ai/jevClient'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { fundamentalOneQuestionGuidance } from '@/lib/pedagogical/gradeInstructions'
import type { Segment } from '@/types/exam'

export type QuestionStageContext = {
  questionNumber: number
  segment: string
  gradeYear: number
  classLabel?: string
  subject: string
  questionType: 'objetiva' | 'descritiva'
  difficulty: 'facil' | 'media' | 'dificil'
  curriculumContent: string
  targetSkills: Array<{ code: string; description: string | null; context?: string[]; source?: string; dataVersion?: string }>
  /** Habilidade da Matriz do ENEM definida no planejamento (C:H), quando houver. */
  targetEnemSkill?: { code: string; description: string | null } | null
  objectives: string[]
}

export type ApprovedQuestionStatement = {
  statement: string
  supportText: string | null
  visual: {
    required: boolean
    probability: number | null
    pendingReview: boolean
    rationale: string
  }
}

const statementSchema = z.object({
  statement: z.string().trim().min(20).max(1800),
  supportText: z.string().trim().max(5000).nullable(),
})

const statementResponseSchema = {
  type: 'object',
  properties: { statement: { type: 'string' }, supportText: { type: 'string', nullable: true } },
  required: ['statement', 'supportText'],
}

function contextualSkillText(context: QuestionStageContext) {
  const enem = context.targetEnemSkill
    ? `\nHabilidade ENEM-alvo (Matriz de Referência do ENEM, definida no planejamento — a tarefa do aluno precisa exigir exatamente esta habilidade, no formato de item do ENEM): ${context.targetEnemSkill.code}${context.targetEnemSkill.description ? ` — ${context.targetEnemSkill.description}` : ''}`
    : ''
  return bnccSkillText(context) + enem
}

function bnccSkillText(context: QuestionStageContext) {
  return context.targetSkills.length
    ? context.targetSkills.map((skill) => [
      `${skill.code}: ${skill.description ?? 'descrição oficial indisponível'}`,
      skill.context?.length ? `Contexto oficial (componente/unidade/objeto/eixo): ${skill.context.join('; ')}` : '',
      skill.source ? `Fonte oficial: ${skill.source} (${skill.dataVersion ?? 'versão não informada'})` : '',
    ].filter(Boolean).join('\n')).join('\n')
    : 'Não há habilidade BNCC mapeada para este recorte.'
}

// Mantido por compatibilidade com chamadas antigas; o fluxo ativo não pede
// ao Jev que atribua nota ou rejeite alinhamento BNCC.
export function normalizeJevRubricScore(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > 9) return null
  return (value / 9) * 100
}

export function buildAlignmentRetryFeedback(
  context: QuestionStageContext,
  rejectedDraft: { statement: string; supportText: string | null },
  scores: { skillScore: number | null },
  diagnostics: string[],
): string {
  const skillLabel = scores.skillScore === null ? 'sem score válido' : `${scores.skillScore.toFixed(1)}/100`
  return [
    'PROMPT ALTERNATIVO — reescreva o enunciado completo abaixo. Não crie alternativas ou gabarito.',
    `ENUNCIADO: ${JSON.stringify({ statement: rejectedDraft.statement, supportText: rejectedDraft.supportText })}`,
    `Diagnóstico anterior: BNCC ${skillLabel}.`,
    diagnostics.join(' '),
    `Habilidade e contexto fornecidos pelo planejamento: ${contextualSkillText(context)}.`,
  ].filter(Boolean).join('\n\n')
}

async function createStatement(context: QuestionStageContext, feedback: string, previousStatement: string, forcedVisual: boolean) {
  const fundamentalGuidance = fundamentalOneQuestionGuidance(context.segment as Segment, context.gradeYear)
  const visualGuidance = forcedVisual
    ? 'RECURSO VISUAL OBRIGATÓRIO: o comando deve depender de uma figura simples e legível que contenha os dados da atividade. Diga ao aluno o que observar nela; não resolva a atividade no texto.'
    : ''
  const prompt = `Escreva somente o enunciado de UMA questão escolar. Não escreva gabarito, alternativas, critérios, solução ou metadados.\n\nDisciplina: ${context.subject}. Etapa: ${context.segment}. Ano: ${context.gradeYear}º${context.classLabel ? `. Turma: ${context.classLabel}` : ''}. Tipo: ${context.questionType}. Dificuldade: ${context.difficulty}.\nHabilidade BNCC-alvo — use a descrição oficial, unidade temática/eixo e objeto de conhecimento; o código sozinho não define o que a questão deve medir:\n${contextualSkillText(context)}\n\nConteúdo curricular permitido:\n${context.curriculumContent.slice(0, 2400)}\n\nObjetivos de aprendizagem:\n${context.objectives.filter(Boolean).slice(0, 5).join('; ') || 'Use somente o conteúdo curricular informado.'}\n\nProduza um comando claro, adequado à série e que possa ser respondido com as informações fornecidas. Não gere texto de apoio por padrão: use supportText:null quando a habilidade puder ser avaliada sem interpretar texto, tabela, gráfico ou conjunto de dados. Só inclua apoio quando essa interpretação for exigida; apresente evidências/dados necessários sem explicar o conceito, antecipar a conclusão ou entregar a resposta. Confira se não basta copiar/localizar a resposta no apoio. Se a questão exigir cálculo, inclua todos os valores necessários, sem inventar dados. Não mencione capítulo, planilha, currículo ou material que não foi incluído.\n${fundamentalGuidance}\n${visualGuidance}\n${previousStatement ? `\nNão repita este enunciado reprovado ou substituído:\n${previousStatement.slice(0, 900)}` : ''}\n${feedback ? `\nDiagnóstico da tentativa anterior; corrija estes pontos sem ampliar o escopo:\n${feedback.slice(0, 1800)}` : ''}`
  const result = await generateValidatedStructuredContent({
    context: `generation/question-statement-${context.questionNumber}`,
    prompt,
    responseSchema: statementResponseSchema,
    zodSchema: statementSchema,
    maxAttempts: 1,
  })
  return result.value
}

async function decideVisualNeed(context: QuestionStageContext, statement: { statement: string; supportText: string | null }, forcedVisual = false) {
  const questions: JevQuestions = {
    image_required: {
      type: 'noul',
      instructions: `A afirmação é verdadeira: para responder corretamente a questão, o estudante PRECISA consultar uma imagem, gráfico, tabela visual, mapa ou diagrama que não pode ser representado com clareza apenas pelo texto atual? Responda a probabilidade de a afirmação ser verdadeira. Não marque como necessária uma ilustração apenas decorativa. Em turmas do Fundamental I, considere se um recurso visual simples é necessário para a criança observar, contar, comparar ou medir os dados da habilidade. ${forcedVisual ? 'O planejamento marcou recurso visual obrigatório; verifique se o enunciado realmente depende dele e sinalize dúvida se não depender.' : ''} Questão de ${context.subject}, ${context.segment}, ${context.gradeYear}º ano. Enunciado: ${statement.statement}. Texto de apoio: ${statement.supportText ?? '(sem texto de apoio)'}`,
    },
  }
  const result = await evaluateWithJev({
    operation: 'jev/exams/question-visual-need',
    questionVersion: '2026-10-06.v1',
    state: {
      subject: context.subject,
      segment: context.segment,
      gradeYear: context.gradeYear,
      forcedVisual,
      statement: statement.statement,
      supportText: statement.supportText,
    },
    questions,
    route: (answers) => {
      const answer = answers.image_required
      const probability = answer?.type === 'noul' ? answer.noul : 0
      const required = probability > 0.8
      return { route: required ? 'automatic' : 'review', outcome: required ? 'visual_required_over_80_percent' : 'visual_not_required' }
    },
    fallback: { answers: { image_required: { type: 'noul', noul: 0 } }, routing: { route: 'fallback', outcome: 'visual_decision_unavailable_assume_text_only' } },
    context: { feature: 'question_visual_need', subject: context.subject, gradeYear: context.gradeYear, questionNumber: context.questionNumber },
    cacheTtlMs: 24 * 60 * 60 * 1000,
    timeoutMs: 15_000,
  })
  const answer = result.answers.image_required
  const probability = answer?.type === 'noul' ? answer.noul : null
  const pendingReview = result.source === 'fallback' || probability === null || (probability >= 0.2 && probability <= 0.8) || (forcedVisual && probability <= 0.8)
  return {
    required: result.source !== 'fallback' && probability !== null && (probability > 0.8 || forcedVisual),
    probability,
    pendingReview,
    rationale: result.source === 'fallback'
      ? 'Jev indisponível; imagem não considerada necessária.'
      : `Decisão Jev: ${probability === null ? 'sem probabilidade válida' : `${Math.round(probability * 100)}%`} de necessidade; limiar estrito acima de 80%.`,
  }
}

/** Gera o enunciado sem avaliação Jev de BNCC/Bloom e decide separadamente se depende de imagem. */
export async function generateApprovedQuestionStatement(context: QuestionStageContext, options: {
  forcedVisual?: boolean
  forceNoVisual?: boolean
  skipJevVisualDecision?: boolean
  previousStatement?: string
  feedback?: string
  savedDraft?: { statement: string; supportText: string | null }
  onDraft?: (draft: { statement: string; supportText: string | null }) => Promise<void>
  onStage?: (stage: 'gerando_enunciado' | 'decidindo_imagem') => Promise<void>
} = {}): Promise<ApprovedQuestionStatement> {
  const feedback = options.feedback ?? ''
  await options.onStage?.('gerando_enunciado')
  const statement = options.savedDraft && !options.forcedVisual ? options.savedDraft : await createStatement(context, feedback, options.previousStatement ?? '', Boolean(options.forcedVisual))
  await options.onDraft?.(statement)
  if (!options.forceNoVisual) await options.onStage?.('decidindo_imagem')
  const visual = options.forceNoVisual
    ? { required: false, probability: null, pendingReview: false, rationale: 'Imagem desativada para esta regeneração.' }
    : options.skipJevVisualDecision
      ? { required: Boolean(options.forcedVisual), probability: null, pendingReview: false, rationale: 'Decisão visual veio do plano estruturado da questão; Jev reservado à classificação de dificuldade.' }
    : await decideVisualNeed(context, statement, options.forcedVisual)
  return { ...statement, visual }
}
