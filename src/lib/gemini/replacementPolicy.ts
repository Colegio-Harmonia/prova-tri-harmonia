export const REPLACEMENT_STRATEGIES = [
  'outro_tema_planejamento',
  'mesmo_tema_outra_abordagem',
  'mais_facil',
  'mais_dificil',
] as const

export type ReplacementStrategy = (typeof REPLACEMENT_STRATEGIES)[number]

export type ReplacementRequest = {
  strategy: ReplacementStrategy
  /**
   * Termos explícitos que não podem aparecer na questão substituta. São
   * definidos pelo professor, pois o tema central de um enunciado não é algo
   * que possamos extrair com segurança por comparação literal.
   */
  excludedTopics: string[]
}

function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}

export function normalizeExcludedTopics(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    const trimmed = value.trim().replace(/\s+/g, ' ')
    const key = foldText(trimmed)
    if (trimmed && !seen.has(key)) {
      seen.add(key)
      normalized.push(trimmed)
    }
  }

  return normalized
}

export function questionTextForReplacementCheck(question: {
  statement: string
  supportText?: string | null
  alternatives?: Array<{ text: string }> | null
  expectedAnswer?: string | null
  gradingCriteria?: string | null
}): string {
  return [
    question.statement,
    question.supportText,
    ...(question.alternatives?.map((alternative) => alternative.text) ?? []),
    question.expectedAnswer,
    question.gradingCriteria,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')
}

/** Retorna os termos bloqueados que ainda apareceram na questão candidata. */
export function findExcludedTopicsInQuestion(
  question: Parameters<typeof questionTextForReplacementCheck>[0],
  excludedTopics: string[],
): string[] {
  const questionText = foldText(questionTextForReplacementCheck(question))
  return normalizeExcludedTopics(excludedTopics).filter((topic) => questionText.includes(foldText(topic)))
}

export function replacementStrategyInstruction(request: ReplacementRequest): string {
  const excludedTopics = normalizeExcludedTopics(request.excludedTopics)
  const excludedInstruction = excludedTopics.length
    ? `\n- TERMOS/TEMAS PROIBIDOS: ${excludedTopics.map((topic) => `"${topic}"`).join(', ')}. Não os mencione em nenhum campo da resposta, incluindo enunciado, texto de apoio, alternativas, resposta esperada e critérios.`
    : ''

  const strategyInstruction: Record<ReplacementStrategy, string> = {
    outro_tema_planejamento:
      'A troca deve usar OUTRO TEMA do planejamento curricular disponível abaixo. Identifique o assunto central da questão anterior e não o reutilize: escolha obrigatoriamente outro capítulo, conteúdo ou habilidade previsto na lista. Não basta trocar nomes, contexto ou redação.',
    mesmo_tema_outra_abordagem:
      'Mantenha o mesmo tema curricular, mas mude de verdade a abordagem cognitiva: use outro contexto, recorte, situação-problema ou habilidade. Não reformule superficialmente a pergunta anterior.',
    mais_facil:
      'Mantenha o escopo curricular, mas torne a questão MAIS FÁCIL: priorize conhecimento essencial, linguagem direta e raciocínio de menor complexidade. Retorne pedagogicalClassification.difficulty:"facil".',
    mais_dificil:
      'Mantenha o escopo curricular, mas torne a questão MAIS DIFÍCIL: exija análise, aplicação ou relação entre conceitos, sem aumentar artificialmente o texto. Retorne pedagogicalClassification.difficulty:"dificil".',
  }

  return `INTENÇÃO DA TROCA (obrigatória): ${strategyInstruction[request.strategy]}${excludedInstruction}`
}
