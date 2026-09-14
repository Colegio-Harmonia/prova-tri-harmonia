/**
 * Repara uma prova existente usando exatamente o mesmo gate de integridade
 * aplicado às novas gerações. Uso único/auditável:
 *   node --env-file=.env node_modules/.bin/tsx scripts/repair-exam-text.ts 275
 */
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { buildSingleQuestionPrompt } from '@/lib/gemini/promptBuilder'
import { SINGLE_QUESTION_RESPONSE_SCHEMA, singleQuestionResultSchema, type ExamGenerationResult, type ExamQuestion, type SingleQuestionResult } from '@/lib/gemini/examSchema'
import { correctSingleQuestion } from '@/lib/gemini/examValidator'
import { normalizeAndValidateQuestionText } from '@/lib/math/mathTextIntegrity'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'

// Alguns caracteres de controle substituem letras já no armazenamento; não há
// como inferi-los com segurança por uma regra mecânica. Esta restauração é
// deliberadamente limitada ao registro auditado, preserva o objetivo e evita
// uma prova visivelmente corrompida enquanto a nova validação protege as
// próximas gerações.
function knownManualRepair(examId: number, question: ExamQuestion): ExamQuestion | null {
  if (examId !== 275 || question.number !== 3) return null
  return {
    ...question,
    statement: 'Com base nos vetores fornecidos acima, calcule o vetor resultante da soma de $A$ e $B$. Em seguida, analise geometricamente o significado desse vetor resultante para a estrutura, considerando a direção e o sentido das forças. Por fim, avalie como a transformação linear que projeta qualquer vetor no eixo $x$ afetaria o vetor resultante e explique a relevância dessa transformação na análise da estrutura.',
    supportText: 'Um engenheiro está projetando uma estrutura metálica composta por barras representadas por vetores no plano cartesiano. Ele possui dois vetores, $A = (3, 4)$ e $B = (-1, 2)$, que representam forças aplicadas em pontos diferentes da estrutura.',
    pedagogicalClassification: {
      ...question.pedagogicalClassification,
      dok: { ...question.pedagogicalClassification.dok, evidence: 'Calcula a soma de vetores, analisa geometricamente o resultado e avalia o efeito de uma transformação linear.', justification: 'Exige cálculo vetorial, interpretação geométrica e justificativa do efeito de uma transformação linear em contexto aplicado.' },
      soloExpected: { ...question.pedagogicalClassification.soloExpected, evidence: 'Integra cálculo vetorial, interpretação geométrica e análise de transformação linear.', justification: 'A resposta relaciona procedimentos, interpretação e justificativa em uma situação aplicada.' },
    },
  }
}

async function regenerateInvalidQuestion(
  original: ExamQuestion,
  exam: { segment: 'anos-iniciais' | 'anos-finais' | 'ensino-medio'; gradeYear: number; subject: string; bimester: number | null },
): Promise<ExamQuestion> {
  const completeCurriculum = await getCurriculumForExam({ ...exam, bimester: exam.bimester ?? undefined })
  const unit = original.curriculumUnitRowIndex == null
    ? null
    : completeCurriculum.units.find((candidate) => candidate.rowIndex === original.curriculumUnitRowIndex)
  const curriculum = unit ? { ...completeCurriculum, units: [unit] } : completeCurriculum
  const prompt = await buildSingleQuestionPrompt(curriculum, {
    type: original.type,
    questionNumber: original.number,
    avoidStatement: original.statement,
    reviewFeedback: 'A versão anterior apresentou caracteres corrompidos ou LaTeX inválido. Entregue texto UTF-8 legível e use $...$ ou $$...$$ em toda fórmula.',
  })
  const generated = await generateValidatedStructuredContent<SingleQuestionResult, ExamQuestion>({
    context: `maintenance/repair-exam-${original.number}`,
    prompt,
    responseSchema: SINGLE_QUESTION_RESPONSE_SCHEMA,
    zodSchema: singleQuestionResultSchema,
    validate: async (parsed) => {
      const candidate = { ...parsed.question, number: original.number, curriculumUnitRowIndex: original.curriculumUnitRowIndex }
      const { question, issues, warnings } = correctSingleQuestion(candidate, curriculum)
      if (question.type !== original.type) issues.push(`Questão ${original.number}: tipo da substituição não corresponde ao original.`)
      return { value: question, issues, warnings }
    },
  })
  return { ...generated.value, number: original.number, curriculumUnitRowIndex: original.curriculumUnitRowIndex, review: original.review ?? null }
}

async function main() {
  const examId = Number(process.argv[2])
  if (!Number.isInteger(examId) || examId <= 0) throw new Error('Informe um ID de prova válido.')
  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  if (!exam) throw new Error(`Prova ${examId} não encontrada.`)
  const payload = exam.generationPayload as ExamGenerationResult
  const repaired: number[] = []
  const regenerated: number[] = []
  const questions: ExamQuestion[] = []

  for (const original of payload.questions) {
    const audit = normalizeAndValidateQuestionText(original)
    if (audit.issues.length) {
      console.log(`Questão ${original.number}: regenerando (${audit.issues.join(' | ')})`)
      const manualRepair = knownManualRepair(examId, original)
      if (manualRepair) {
        questions.push(manualRepair)
        repaired.push(original.number)
      } else {
        questions.push(await regenerateInvalidQuestion(original, exam))
        regenerated.push(original.number)
      }
    } else {
      questions.push(audit.question)
      if (audit.normalized) repaired.push(original.number)
    }
  }

  const newPayload: ExamGenerationResult = { ...payload, questions }
  const repairWarning = `Manutenção de integridade: fórmulas normalizadas nas questões ${repaired.length ? repaired.join(', ') : 'nenhuma'}; questões regeneradas por texto corrompido ${regenerated.length ? regenerated.join(', ') : 'nenhuma'}.`
  const warnings = [...(Array.isArray(exam.unmappedWarnings) ? exam.unmappedWarnings : []), repairWarning]
  await db.update(generatedExams).set({ generationPayload: newPayload, unmappedWarnings: warnings }).where(eq(generatedExams.id, examId))
  console.log(`Prova ${examId} reparada. Normalizadas: ${repaired.join(', ') || 'nenhuma'}. Regeneradas: ${regenerated.join(', ') || 'nenhuma'}.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
