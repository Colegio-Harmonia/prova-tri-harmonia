import type { ExamQuestion } from '@/lib/gemini/examSchema'
import type { AdaptedQuestion } from './adaptationSchema'

// Validador de equivalência (spec 4.3 passo 4) — DETERMINÍSTICO, roda
// depois da IA e nunca confia nela: a adaptação muda a FORMA, nunca o
// construto avaliado. Reprova se mudou contagem de questões, alternativas
// (quantidade/letras/ordem) ou se alguma questão sumiu/sobrou. BNCC,
// Bloom, gabarito e critérios de correção são preservados POR CONSTRUÇÃO
// (a IA nunca recebe nem devolve esses campos — o payload adaptado é
// montado copiando a questão original e trocando só os campos de forma),
// e o relatório registra isso explicitamente.

export type EquivalenceReport = {
  questionCountMatch: boolean
  answerKeyIntact: boolean
  alternativesCountIntact: boolean
  bnccBloomIntact: boolean
  issues: string[]
}

export function validateEquivalence(original: ExamQuestion[], adapted: AdaptedQuestion[]): EquivalenceReport {
  const issues: string[] = []

  const originalByNumber = new Map(original.map((q) => [q.number, q]))
  const adaptedNumbers = adapted.map((a) => a.number)

  const missing = original.filter((q) => !adaptedNumbers.includes(q.number)).map((q) => q.number)
  const extras = adaptedNumbers.filter((n) => !originalByNumber.has(n))
  const duplicated = adaptedNumbers.filter((n, i) => adaptedNumbers.indexOf(n) !== i)
  if (missing.length) issues.push(`Questões sem adaptação: ${missing.join(', ')}.`)
  if (extras.length) issues.push(`Adaptações de questões inexistentes: ${extras.join(', ')}.`)
  if (duplicated.length) issues.push(`Questões adaptadas em duplicidade: ${[...new Set(duplicated)].join(', ')}.`)
  const questionCountMatch = !missing.length && !extras.length && !duplicated.length

  let alternativesCountIntact = true
  let answerKeyIntact = true

  for (const a of adapted) {
    const q = originalByNumber.get(a.number)
    if (!q) continue

    if (!a.adaptedStatement?.trim()) {
      issues.push(`Questão ${a.number}: enunciado adaptado vazio.`)
    }

    if (q.type === 'objetiva' && a.adaptedAlternatives) {
      const originalAlts = q.alternatives ?? []
      if (a.adaptedAlternatives.length !== originalAlts.length) {
        alternativesCountIntact = false
        issues.push(`Questão ${a.number}: quantidade de alternativas mudou (${originalAlts.length} → ${a.adaptedAlternatives.length}).`)
      }
      const originalLetters = originalAlts.map((alt) => alt.letter.toUpperCase())
      const adaptedLetters = a.adaptedAlternatives.map((alt) => alt.letter.toUpperCase())
      if (originalLetters.join(',') !== adaptedLetters.join(',')) {
        answerKeyIntact = false
        issues.push(`Questão ${a.number}: letras/ordem das alternativas mudaram (${originalLetters.join('')} → ${adaptedLetters.join('')}).`)
      }
      if (q.correctLetter && !adaptedLetters.includes(q.correctLetter.toUpperCase())) {
        answerKeyIntact = false
        issues.push(`Questão ${a.number}: a alternativa correta (${q.correctLetter}) não existe mais.`)
      }
      if (a.adaptedAlternatives.some((alt) => !alt.text?.trim())) {
        issues.push(`Questão ${a.number}: alternativa adaptada com texto vazio.`)
      }
    }

    if (q.type === 'descritiva' && a.adaptedAlternatives?.length) {
      issues.push(`Questão ${a.number}: descritiva não pode ganhar alternativas.`)
      alternativesCountIntact = false
    }
  }

  return {
    questionCountMatch,
    answerKeyIntact,
    alternativesCountIntact,
    // Por construção: o motor copia a questão original e substitui só os
    // campos de forma — BNCC/Bloom/gabarito/critérios nunca passam pela IA.
    bnccBloomIntact: true,
    issues,
  }
}

export function equivalenceApproved(report: EquivalenceReport): boolean {
  return report.issues.length === 0 && report.questionCountMatch && report.answerKeyIntact && report.alternativesCountIntact
}
