import { z } from 'zod'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import type { PlannedQuestionSlot } from './contentPlan'
import type { CurriculumSelection } from '@/types/exam'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import type { ExamQualityIssue } from './examQualityAssembly'

const auditSchema = z.object({
  approved: z.boolean(),
  issues: z.array(z.object({
    questionNumbers: z.array(z.number().int().positive()).min(1),
    severity: z.enum(['bloqueante', 'alerta']),
    reason: z.string().min(8),
  })),
})

const AUDIT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          questionNumbers: { type: 'array', items: { type: 'integer' } },
          severity: { type: 'string', enum: ['bloqueante', 'alerta'] },
          reason: { type: 'string' },
        },
        required: ['questionNumbers', 'severity', 'reason'],
      },
    },
  },
  required: ['approved', 'issues'],
}

function examCards(questions: ExamQuestion[]): string {
  return questions.map((question) => {
    const alternatives = question.alternatives?.map((alternative) => `${alternative.letter}) ${alternative.text}`).join(' | ') ?? 'aberta'
    return [`Q${question.number} | capítulo ${question.curriculumUnitRowIndex} | ${question.type} | Bloom ${question.bloomLevel}`,
      `Habilidade: ${question.bnccSummary ?? 'não informada'}`,
      `Enunciado: ${question.statement}`,
      question.supportText ? `Apoio: ${question.supportText}` : null,
      `Respostas: ${alternatives}`,
    ].filter(Boolean).join('\n')
  }).join('\n\n')
}

export async function auditFinalExamQuality(curriculum: CurriculumSelection, slots: PlannedQuestionSlot[], questions: ExamQuestion[]): Promise<{ issues: ExamQualityIssue[]; warnings: string[] }> {
  const validNumbers = new Set(questions.map((question) => question.number))
  const matrix = slots.map((slot) => `Q${slot.number}: capítulo ${slot.unitRowIndex}, ${slot.type}, visual=${slot.visualAid}`).join('; ')
  const prompt = `Você é o revisor editorial FINAL de uma avaliação escolar. Não crie, reescreva nem sugira textos de questões. Analise a prova como conjunto e responda somente com o JSON do schema.

CONTEXTO: ${curriculum.subject}, ${curriculum.gradeYear}º ano, ${curriculum.segment}${curriculum.bimester ? `, ${curriculum.bimester}º bimestre` : ''}.
DESENHO IMUTÁVEL: ${matrix}

MARQUE "bloqueante" SOMENTE quando houver evidência clara de: repetição substancial de habilidade/contexto/resolução, incoerência entre questões, ambiguidade que impede responder, quebra do capítulo/tipo definido, ou recurso visual necessário ausente. Use "alerta" para pontos de revisão humana não impeditivos. Não invente falhas. Se não houver bloqueio, approved:true e issues pode conter apenas alertas.

PROVA:
${examCards(questions)}`

  const audited = await generateValidatedStructuredContent({
    context: 'exams/final-quality-audit',
    prompt,
    responseSchema: AUDIT_RESPONSE_SCHEMA,
    zodSchema: auditSchema,
    validate: (result) => {
      const issues = result.issues.filter((issue) => issue.questionNumbers.every((number) => validNumbers.has(number)))
      const invalidReferences = result.issues.length - issues.length
      return {
        value: { ...result, issues },
        issues: result.approved || issues.length ? [] : ['A auditoria reprovou a prova sem indicar quais questões precisam de correção.'],
        warnings: invalidReferences ? [`Auditoria final ignorou ${invalidReferences} apontamento(s) com questão inexistente.`] : [],
      }
    },
  })
  return { issues: audited.value.issues, warnings: audited.warnings }
}
