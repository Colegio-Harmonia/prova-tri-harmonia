import { BLOOM_LEVELS, type ExamQuestion } from '@/lib/gemini/examSchema'
import { evaluateWithJev, type JevAnswers, type JsonValue } from '@/lib/ai/jevClient'

const criteria = {
  lembrar: 'Reconhecer ou recuperar uma informação, fato, conceito ou procedimento conhecido.',
  compreender: 'Interpretar, explicar, exemplificar, resumir ou comparar significados.',
  aplicar: 'Usar um conceito ou procedimento para resolver uma situação ou executar uma tarefa.',
  analisar: 'Decompor informações, relacionar partes, inferir causas ou distinguir evidências e argumentos.',
  avaliar: 'Julgar uma solução, argumento ou decisão com critérios explícitos e justificar o julgamento.',
  criar: 'Produzir uma solução, hipótese, texto ou produto novo integrando elementos em uma organização própria.',
} as const

/** Bloom is a classification of the original task, never a rewrite or quality approval. */
export async function classifyQuestionBloom(questions: ExamQuestion[], context: { subject: string; gradeYear: number; segment: string }): Promise<ExamQuestion[]> {
  const imported = questions.filter((question) => question.source !== 'enem_bank')
  if (!imported.length) return questions
  const decisions = Object.fromEntries(imported.flatMap((q) => BLOOM_LEVELS.map((level) => [`q${q.number}_${level}`, {
    type: 'score' as const,
    instructions: 'Classifique a demanda cognitiva real desta questão pela Taxonomia de Bloom revisada. Escolha a operação indispensável para resolver o item, considerando enunciado, apoio, alternativas e gabarito. Não classifique apenas pelo verbo de comando ou pela dificuldade. Não altere o conteúdo e não use um nível previamente atribuído como referência.',
    criteria: Array.from({ length: 10 }, (_, score) => `${score}: ${score === 0 ? 'Não corresponde à tarefa' : score === 9 ? 'É a operação cognitiva principal e indispensável' : 'Correspondência crescente com a operação necessária'}. Nível avaliado: ${level}. ${criteria[level]}`),
  }])))
  const fallbackAnswers: JevAnswers = Object.fromEntries(imported.flatMap((q) => BLOOM_LEVELS.map((level) => [`q${q.number}_${level}`, { type: 'score', score: level === q.bloomLevel ? 1 : 0, confidence: 0 }])))
  const result = await evaluateWithJev({
    operation: 'jev/exams/question-bloom', questionVersion: 'question-bloom-scores-v4', cacheTtlMs: 24 * 60 * 60 * 1000,
    state: {
      subject: context.subject, gradeYear: context.gradeYear, segment: context.segment,
      questions: imported.map((q) => ({ id: `q${q.number}`, type: q.type, statement: q.statement, supportText: q.supportText ?? null, alternatives: q.alternatives ?? null, correctLetter: q.correctLetter ?? null, expectedAnswer: q.expectedAnswer ?? null, gradingCriteria: q.gradingCriteria ?? null, resolution: q.commentedResolution ?? null, bnccCodes: q.bnccCodes, originalMedia: q.acervoRef?.original.midias ?? null, imageDescription: q.imageDescription ?? q.imageQuery ?? null })),
    } as JsonValue,
    questions: decisions,
    route: () => ({ route: 'automatic', outcome: 'imported_bloom_highest_score' }),
    fallback: { answers: fallbackAnswers, routing: { route: 'fallback', outcome: 'imported_bloom_provider_unavailable' } },
    context: { subject: context.subject, gradeYear: context.gradeYear, segment: context.segment, questionCount: imported.length },
  })
  return questions.map((q) => {
    if (q.source === 'enem_bank') return q
    const ranked = BLOOM_LEVELS.map((level) => {
      const answer = result.answers[`q${q.number}_${level}`]
      return { level, score: answer?.type === 'score' && Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= 9 ? answer.score : -1, confidence: answer?.type === 'score' ? answer.confidence ?? null : null }
    }).sort((a, b) => b.score - a.score)
    const selected = ranked[0]!
    return {
      ...q,
      bloomLevel: result.source !== 'fallback' && selected.score > 0 ? selected.level : q.bloomLevel,
      bloomAssessment: { status: result.source === 'fallback' || selected.score <= 0 ? 'unavailable' as const : 'classified' as const, source: result.source, model: result.model, confidence: selected.confidence, scores: Object.fromEntries(ranked.map(({ level, score }) => [level, score])), classifiedAt: new Date().toISOString() },
    }
  })
}

/** Acervo imports need classification; ENEM retains its bank classification. */
export async function classifyImportedQuestionBloom(questions: ExamQuestion[], context: { subject: string; gradeYear: number; segment: string }): Promise<ExamQuestion[]> {
  const classified = await classifyQuestionBloom(questions.filter((q) => q.source === 'acervo'), context)
  const byNumber = new Map(classified.map((q) => [q.number, q]))
  return questions.map((q) => byNumber.get(q.number) ?? q)
}
