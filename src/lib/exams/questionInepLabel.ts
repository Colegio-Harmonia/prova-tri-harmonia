import type { ExamQuestion } from '@/lib/gemini/examSchema'

/** Codes are display labels; the saved area/matrix/competency disambiguate correction tracking. */
export function questionInepLabel(question: ExamQuestion): string {
  const source = question.inepAssessment?.matrix ?? question.saeb.source
  const code = question.inepAssessment?.skill?.code
    ?? question.saeb.value?.match(/\b(?:H\d+(?:\.\d+)?|D\d+|[259][A-Z]\d+\.\d+|[ABC]\d+)\b/g)?.at(-1)
  const planned = question.plannedEnemSkill?.code
  if (code) {
    const label = `${source === 'enem' ? 'ENEM' : 'SAEB'}: ${code.toUpperCase()}`
    if (!planned) return label
    // Habilidade planejada × o que o Jev classificou que a questão mede.
    const competency = question.inepAssessment?.competency?.code?.toUpperCase()
    const classified = competency ? `${competency}:${code.toUpperCase()}` : null
    const matches = classified ? classified === planned : planned.endsWith(`:${code.toUpperCase()}`)
    return matches ? label : `${label} · planejado ${planned}`
  }
  return planned ? `ENEM planejado: ${planned}` : 'SAEB: N/A'
}
