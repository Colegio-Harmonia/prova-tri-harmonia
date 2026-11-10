import type { ExamQuestion } from '@/lib/gemini/examSchema'

export function questionOriginLabel(question: ExamQuestion): string {
  if (question.source === 'acervo') return `IMPORTADA DO ${question.acervoRef?.origin ?? 'ACERVO'}`
  if (question.source === 'enem_bank') return 'IMPORTADA DO ENEM'
  return 'GERADO POR IA'
}

export function questionContentKey(question: Pick<ExamQuestion, 'statement'>): string {
  return question.statement.normalize('NFKC').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function acervoIdentity(question: ExamQuestion): string | null {
  return question.acervoRef ? `${question.acervoRef.origin}:${question.acervoRef.externalId ?? question.acervoRef.questionId}` : null
}

/** Only original bank media is accepted automatically; replacements keep their own review. */
export function isOriginalBankImage(question: ExamQuestion): boolean {
  const image = question.image
  if (!image || !['acervo', 'enem_bank'].includes(question.source ?? '')) return false
  if (image.originalBankMedia) return true
  // Compatibility with originals imported before the provenance flag existed.
  if (question.source === 'enem_bank' && question.enemBankRef && image.source === 'enem') return true
  if (question.source !== 'acervo' || !question.acervoRef || image.source !== 'importado' || !image.sourceUrl) return false
  try { return new URL(image.sourceUrl).pathname === '/api/v1/questoes/aleatoria' } catch { return false }
}

export function isQuestionImageApproved(question: ExamQuestion): question is ExamQuestion & { image: NonNullable<ExamQuestion['image']> } {
  return Boolean(question.image && (question.image.approved || isOriginalBankImage(question)))
}

/** Banca e ano da fonte editorial, compartilhados pela revisão e pelos documentos. */
export function questionBoardLabel(question: ExamQuestion): string | null {
  if (question.source !== 'acervo') return null
  const original = question.acervoRef?.original
  const origin = original?.origem as { banca?: string | { label?: string }; ano?: number | string } | undefined
  const board = typeof origin?.banca === 'string' ? origin.banca : origin?.banca?.label
  if (!board?.trim()) return null
  return [board.trim(), origin?.ano].filter(Boolean).join(' — ')
}

/** Editorial source and collection are distinct from the hosting platform. */
export function questionProvenanceTags(question: ExamQuestion): string[] {
  if (question.source === 'enem_bank') return [`Origem: ENEM${question.enemBankRef ? ` ${question.enemBankRef.year}` : ''}`]
  if (question.source !== 'acervo') return []
  const origin = question.acervoRef?.original.origem as { criacao?: unknown; acervo?: unknown; plataforma?: unknown } | undefined
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  const board = questionBoardLabel(question)
  const creation = text(origin?.criacao)
  const collection = text(origin?.acervo)
  const platform = text(origin?.plataforma)
  return [board ? `Banca: ${board}` : null, creation ? `Origem: ${creation}` : null,
    collection ? `Acervo: ${collection}` : null, platform ? `Banco: ${platform.toUpperCase()}` : null,
    !creation && !collection && !platform ? `Origem: ${question.acervoRef?.origin ?? 'Acervo'}` : null,
  ].filter((label): label is string => Boolean(label))
}

/** Prioriza a banca; originais Techy/SAE sem banca recebem o crédito de importação. */
export function questionPrintAttribution(question: ExamQuestion): string | null {
  if (question.source === 'enem_bank') return question.enemBankRef ? `ENEM ${question.enemBankRef.year}` : 'ENEM'
  if (question.source !== 'acervo') return null
  const board = questionBoardLabel(question)
  if (board) return board
  const source = question.acervoRef?.origin.trim().toLowerCase()
  if (source === 'techy') return 'Importado do Techy'
  if (source === 'sae') return 'Importado do SAE'
  return null
}
