import { z } from 'zod'
import type { CurriculumSelection } from '@/types/exam'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { correctSingleQuestion } from '@/lib/gemini/examValidator'
import { generateUnifiedQuestion, type BlueprintSlot } from '@/lib/generation'
import { cognitiveObjectives } from './targetSkills'
import { getOfficialBnccSkill } from '@/lib/curriculum/officialBncc'
import type { QualityDiagnostic } from './qualityDiagnostics'

type RepairableDiagnostic = QualityDiagnostic & { repairAction: 'reparo_local' }
type RepairKind = 'bncc_alignment' | 'objective_answer_only' | 'statement' | 'support_statement' | 'single_alternative' | 'alternatives' | 'alternatives_and_key' | 'answer_rubric'

const statementSchema = z.object({ statement: z.string().min(20) })
const supportStatementSchema = z.object({ supportText: z.string().min(40), statement: z.string().min(20) })
const alternativesSchema = z.object({ alternatives: z.array(z.object({ letter: z.string().min(1).max(2), text: z.string().min(1) })).min(2) })
const alternativesAndKeySchema = alternativesSchema.extend({ correctLetter: z.string().min(1).max(2) })
const singleAlternativeSchema = z.object({ text: z.string().min(1) })
const answerRubricSchema = z.object({ expectedAnswer: z.string().min(10), gradingCriteria: z.array(z.string().min(5)).min(3).max(5) })
const objectiveAnswerOnlySchema = z.object({
  statement: z.string().min(20),
  alternatives: z.array(z.object({ letter: z.string().regex(/^[A-E]$/), text: z.string().min(1) })),
})

const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required })
const STATEMENT_RESPONSE_SCHEMA = objectSchema({ statement: { type: 'string' } }, ['statement'])
const SUPPORT_STATEMENT_RESPONSE_SCHEMA = objectSchema({ supportText: { type: 'string' }, statement: { type: 'string' } }, ['supportText', 'statement'])
const ALTERNATIVES_RESPONSE_SCHEMA = objectSchema({ alternatives: { type: 'array', items: objectSchema({ letter: { type: 'string' }, text: { type: 'string' } }, ['letter', 'text']) } }, ['alternatives'])
const ALTERNATIVES_KEY_RESPONSE_SCHEMA = objectSchema({ alternatives: { type: 'array', items: objectSchema({ letter: { type: 'string' }, text: { type: 'string' } }, ['letter', 'text']) }, correctLetter: { type: 'string' } }, ['alternatives', 'correctLetter'])
const SINGLE_ALTERNATIVE_RESPONSE_SCHEMA = objectSchema({ text: { type: 'string' } }, ['text'])
const ANSWER_RUBRIC_RESPONSE_SCHEMA = objectSchema({ expectedAnswer: { type: 'string' }, gradingCriteria: { type: 'array', items: { type: 'string' } } }, ['expectedAnswer', 'gradingCriteria'])
const OBJECTIVE_ANSWER_ONLY_RESPONSE_SCHEMA = objectSchema({ statement: { type: 'string' }, alternatives: { type: 'array', items: objectSchema({ letter: { type: 'string' }, text: { type: 'string' } }, ['letter', 'text']) } }, ['statement', 'alternatives'])

function repairable(diagnostics: QualityDiagnostic[]) {
  return diagnostics.filter((item): item is RepairableDiagnostic => item.repairAction === 'reparo_local' && item.severity === 'bloqueante')
}

/** Uma rodada corrige um grupo coeso; o novo parecer do Jev decide a próxima rodada. */
export function chooseRepairKind(diagnostics: QualityDiagnostic[], declaredCorrectLetter?: string | null): RepairKind | null {
  const applicable = repairable(diagnostics)
  const codes = new Set(applicable.map((item) => item.code))
  if (codes.has('BNCC_MAPPING') || codes.has('CURRICULUM_MISMATCH')) return 'bncc_alignment'
  if (codes.has('MISSING_SUPPORT_TEXT')) return 'support_statement'
  if (codes.has('INSUFFICIENT_INFORMATION')) return 'statement'
  if (codes.has('OBJECTIVE_CALCULATION_REQUEST') || codes.has('ALTERNATIVE_EXPOSES_CALCULATION')) return 'objective_answer_only'
  if (codes.has('ANSWER_EXPOSED_IN_STATEMENT')) return 'statement'
  if (applicable.some((item) => item.code === 'ALTERNATIVE_CONTENT_INCOMPLETE' && item.alternativeLetter === declaredCorrectLetter)) return 'single_alternative'
  if (codes.has('NO_CORRECT_ALTERNATIVE')) return 'alternatives_and_key'
  if (applicable.some((item) => (item.code === 'ALTERNATIVE_FORMAT_OUTLIER' || item.code === 'ALTERNATIVE_CONTENT_INCOMPLETE') && item.alternativeLetter)) return 'single_alternative'
  if (codes.has('DUPLICATE_ALTERNATIVE') || codes.has('DISTRACTOR_EQUALS_ANSWER') || codes.has('ALTERNATIVE_AMBIGUITY')) return 'alternatives'
  if (codes.has('GRADING_CRITERIA')) return 'answer_rubric'
  return null
}

function curriculumContext(curriculum: CurriculumSelection) {
  return curriculum.units.map((unit) => [unit.tituloCapitulo, unit.conteudo, unit.enrichedContent].filter(Boolean).join(': ')).join('\n').slice(0, 7000)
}

function invariantIssues(original: ExamQuestion, candidate: ExamQuestion, allowed: Array<keyof ExamQuestion>) {
  const allowedSet = new Set<string>([...allowed, 'review'])
  return Object.keys(original).flatMap((key) => {
    if (allowedSet.has(key)) return []
    return JSON.stringify(original[key as keyof ExamQuestion]) === JSON.stringify(candidate[key as keyof ExamQuestion])
      ? []
      : [`O campo protegido "${key}" não pode ser alterado neste reparo.`]
  })
}

/**
 * Executa somente o reparo escolhido pelo diagnóstico tipado do Jev. A saída
 * contém apenas os campos autorizados; todo o restante vem da questão original.
 */
export async function repairQuestionFromDiagnostics(params: {
  question: ExamQuestion
  curriculum: CurriculumSelection
  diagnostics: QualityDiagnostic[]
  context: string
  blueprintSlot?: BlueprintSlot
}): Promise<{ question: ExamQuestion; warnings: string[]; repairKind: RepairKind } | null> {
  const applicable = repairable(params.diagnostics)
  const repairKind = chooseRepairKind(applicable, params.question.correctLetter)
  if (!repairKind) return null
  if ((repairKind === 'single_alternative' || repairKind === 'alternatives' || repairKind === 'alternatives_and_key') && params.question.type !== 'objetiva') return null
  if (repairKind === 'answer_rubric' && params.question.type !== 'descritiva') return null
  if (repairKind === 'objective_answer_only' && params.question.type !== 'objetiva') return null

  if (repairKind === 'bncc_alignment') {
    const slot = params.blueprintSlot
    const unit = params.curriculum.units.find((candidate) => candidate.rowIndex === params.question.curriculumUnitRowIndex)
      ?? (params.curriculum.units.length === 1 ? params.curriculum.units[0] : undefined)
    const code = params.question.bnccCodes[0]?.trim().toUpperCase()
    const officialSkill = code ? getOfficialBnccSkill(code) : null
    if (!slot || !unit || !code || params.question.bnccStatus !== 'mapeado') return null
    const sheetTopic = [unit.tituloCapitulo, unit.conteudo, unit.enrichedContent].filter(Boolean).join('\n').trim()
    const sheetSkillDescription = unit.habilidades.status === 'mapeado'
      ? unit.habilidades.skills.find((skill) => skill.code.toUpperCase() === code)?.description
      : null
    const skillDescription = officialSkill?.text ?? sheetSkillDescription ?? params.question.bnccSummary ?? 'descrição oficial não disponível'
    const unitCurriculum = { ...params.curriculum, units: [unit] }
    const instruction = [
      'REPARO DIRECIONADO PELO JEV: a questão foi reprovada porque não mede a habilidade BNCC declarada.',
      `HABILIDADE OBRIGATÓRIA ${code}: ${skillDescription}`,
      officialSkill?.context.length ? `CONTEXTO OFICIAL DA HABILIDADE: ${officialSkill.context.join('; ')}.` : '',
      officialSkill?.source ? `REFERÊNCIA DA BNCC: ${officialSkill.source} (${officialSkill.dataVersion}).` : '',
      `TEMA E CONTEÚDO DA PLANILHA ESCOLAR (única fonte de fatos e material de ensino):\n${sheetTopic}`,
      `DIAGNÓSTICO DO JEV: ${applicable.map((item) => item.evidence ?? item.message).join('; ')}`,
      `A questão deve exigir a ação indicada pelo verbo da habilidade aplicada ao objeto de conhecimento, não apenas recordar uma definição. Preserve o código BNCC ${code}, o tipo ${params.question.type}, o capítulo e o tema da planilha. Não introduza fatos ou assuntos de fora do conteúdo da planilha. Refaça a questão de forma coerente, incluindo resposta e alternativas/rubrica quando aplicável. A versão anterior era: ${params.question.statement}`,
    ].filter(Boolean).join('\n\n')
    const generated = await generateUnifiedQuestion({
      questionNumber: params.question.number,
      subject: params.curriculum.subject,
      gradeYear: params.curriculum.gradeYear,
      segment: params.curriculum.segment,
      curriculumContent: sheetTopic,
      targetSkills: [{ code, description: skillDescription }],
      objectives: cognitiveObjectives(unit),
      contentPlanInstruction: instruction,
      questionType: params.question.type,
    }, slot)
    const corrected = correctSingleQuestion({
      ...generated.question,
      number: params.question.number,
      curriculumUnitRowIndex: unit.rowIndex,
      bnccCodes: [code],
      bnccStatus: 'mapeado',
      bnccSummary: officialSkill?.text ?? params.question.bnccSummary ?? null,
      review: null,
    }, unitCurriculum, { allowMathReviewFallback: true, deferContentQualityToJev: true })
    return {
      question: corrected.question,
      warnings: [...generated.issues.map((issue) => issue.reason), ...corrected.issues.map((issue) => `Conferência para o Jev: ${issue}`), ...corrected.warnings, `Reparo da habilidade ${code} orientado pelo diagnóstico do Jev (${officialSkill?.dataVersion ?? 'texto BNCC disponível no currículo'}).`],
      repairKind,
    }
  }

  const common = `Você executa um reparo CIRÚRGICO em uma questão escolar.\n\nDISCIPLINA: ${params.curriculum.subject}\nSÉRIE: ${params.curriculum.gradeYear}º ano (${params.curriculum.segment})\nBNCC: ${params.question.bnccCodes.join(', ') || 'não mapeada'}\nFONTE CURRICULAR (limite factual; não copie títulos nem invente fatos):\n${curriculumContext(params.curriculum)}\n\nQUESTÃO ATUAL:\n${JSON.stringify(params.question)}\n\nDIAGNÓSTICO TIPADO DO JEV:\n${JSON.stringify(applicable)}\n\nRetorne SOMENTE os campos solicitados em JSON, sem markdown.`

  const validate = (patch: Partial<ExamQuestion>, allowed: Array<keyof ExamQuestion>) => {
    const merged = { ...params.question, ...patch, review: null }
    const corrected = correctSingleQuestion(merged, params.curriculum, { deferContentQualityToJev: true })
    return {
      value: corrected.question,
      // correctSingleQuestion fornece evidências; só o Jev decide se elas
      // comprometem a qualidade. As invariantes limitam o escopo do reparo.
      issues: invariantIssues(params.question, corrected.question, allowed),
      warnings: [...corrected.warnings, ...corrected.issues.map((issue) => `Conferência para o Jev: ${issue}`)],
      repairInstructions: applicable.map((item) => ({ code: item.code, fields: item.fields, protectedFields: item.protectedFields, message: item.message })),
    }
  }

  if (repairKind === 'objective_answer_only') {
    const statementNeedsRepair = applicable.some((item) => item.code === 'OBJECTIVE_CALCULATION_REQUEST')
    const targetLetters = [...new Set(applicable
      .filter((item) => item.code === 'ALTERNATIVE_EXPOSES_CALCULATION' && item.alternativeLetter)
      .map((item) => item.alternativeLetter!))].sort()
    if (!statementNeedsRepair && targetLetters.length === 0) return null
    const currentAlternatives = params.question.alternatives ?? []
    const targetText = JSON.stringify(currentAlternatives.filter((item) => targetLetters.includes(item.letter)))
    const prompt = common + '\n\nREPARO DIRECIONADO EXCLUSIVAMENTE PELO JEV.\n'
      + (statementNeedsRepair
        ? 'Reescreva o comando para solicitar somente a resposta final ou os produtos finais necessários. Remova pedidos para mostrar fórmula usada, cálculos, etapas ou justificativas de resolução.\n'
        : 'Copie o enunciado literalmente, sem alterá-lo: ' + params.question.statement + '\n')
      + (targetLetters.length
        ? 'Reescreva somente as alternativas ' + targetLetters.join(', ') + '. Cada uma deve trazer os resultados finais e as interpretações conceituais solicitadas, sem expor fórmula usada para resolver, conta armada, etapas ou justificativa de cálculo. Preserve uma expressão algébrica quando ela própria for a resposta pedida. Mantenha padrão, unidade e estrutura das opções não sinalizadas. Alvo e texto atual: ' + targetText + '\n'
        : 'Retorne alternatives como lista vazia: [].\n')
      + 'Preserve literalmente texto de apoio, gabarito, alternativas não sinalizadas e todos os demais campos. Não adicione dados. Retorne {"statement":"...","alternatives":[{"letter":"A","text":"..."}]} contendo exatamente as letras sinalizadas; se nenhuma alternativa foi sinalizada, use [].'
    const generated = await generateValidatedStructuredContent({
      context: params.context + '/objective-answer-only',
      prompt,
      responseSchema: OBJECTIVE_ANSWER_ONLY_RESPONSE_SCHEMA,
      zodSchema: objectiveAnswerOnlySchema,
      maxAttempts: 2,
      validate: (value) => {
        const returnedLetters = value.alternatives.map((item) => item.letter).sort()
        const expectedLetters = [...targetLetters].sort()
        const candidateAlternatives = currentAlternatives.map((item) => {
          const replacement = value.alternatives.find((candidate) => candidate.letter === item.letter)
          return replacement ? { ...item, text: replacement.text } : item
        })
        const candidate = { ...params.question, statement: value.statement, alternatives: candidateAlternatives, review: null }
        const corrected = correctSingleQuestion(candidate, params.curriculum, { deferContentQualityToJev: true })
        const invariants = invariantIssues(params.question, corrected.question, ['statement', 'alternatives'])
        const untouchedAlternatives = currentAlternatives.filter((item) => !targetLetters.includes(item.letter))
        const correctedUntouched = (corrected.question.alternatives ?? []).filter((item) => !targetLetters.includes(item.letter))
        const issues = [
          ...(JSON.stringify(returnedLetters) === JSON.stringify(expectedLetters) ? [] : ['O reparo deve retornar exatamente as letras sinalizadas (' + (expectedLetters.join(', ') || 'nenhuma') + ').']),
          ...(!statementNeedsRepair && value.statement !== params.question.statement ? ['O enunciado estava fora do alvo e deve permanecer literalmente inalterado.'] : []),
          ...(JSON.stringify(untouchedAlternatives) === JSON.stringify(correctedUntouched) ? [] : ['Alternativas não sinalizadas devem permanecer literalmente inalteradas.']),
          ...invariants,
        ]
        return {
          value: corrected.question,
          issues,
          warnings: [...corrected.warnings, ...corrected.issues.map((item) => 'Conferência para o Jev: ' + item)],
          repairInstructions: applicable.map((item) => ({ code: item.code, fields: item.fields, protectedFields: item.protectedFields, message: item.message })),
        }
      },
    })
    return { question: generated.value, warnings: generated.warnings, repairKind }
  }

  if (repairKind === 'statement') {
    const generated = await generateValidatedStructuredContent({
      context: `${params.context}/statement`, prompt: `${common}\n\nReescreva SOMENTE "statement" para corrigir o diagnóstico. Se faltam informações, reformule a pergunta para usar apenas os dados já disponíveis no texto de apoio/questão; não acrescente números nem fatos. Preserve texto de apoio, alternativas, gabarito, tema da planilha e habilidade BNCC.`,
      responseSchema: STATEMENT_RESPONSE_SCHEMA, zodSchema: statementSchema, maxAttempts: 2,
      validate: (value) => validate(value, ['statement']),
    })
    return { question: generated.value, warnings: generated.warnings, repairKind }
  }

  if (repairKind === 'support_statement') {
    const generated = await generateValidatedStructuredContent({
      context: `${params.context}/support-statement`, prompt: `${common}\n\nCrie SOMENTE um "supportText" autocontido, factual e suficiente, e ajuste SOMENTE "statement" para fazer referência clara a ele. Preserve a resposta, alternativas, gabarito e habilidade BNCC. O apoio não pode entregar a resposta nem copiar linguagem de planejamento.`,
      responseSchema: SUPPORT_STATEMENT_RESPONSE_SCHEMA, zodSchema: supportStatementSchema, maxAttempts: 2,
      validate: (value) => validate(value, ['supportText', 'statement']),
    })
    return { question: generated.value, warnings: generated.warnings, repairKind }
  }

  if (repairKind === 'single_alternative') {
    const issue = applicable.find((item) => (item.code === 'ALTERNATIVE_FORMAT_OUTLIER' || item.code === 'ALTERNATIVE_CONTENT_INCOMPLETE') && item.alternativeLetter)
    const letter = issue?.alternativeLetter
    const originalAlternative = params.question.alternatives?.find((item) => item.letter === letter)
    if (!letter || !originalAlternative) return null
    const generated = await generateValidatedStructuredContent({
      context: `${params.context}/alternative-${letter}`,
      prompt: `${common}\n\nREPARO DIRECIONADO PELO JEV: o diagnóstico informa por que a alternativa ${letter} falhou. Corrija especificamente esse apontamento e reescreva SOMENTE o texto dessa alternativa. Primeiro resolva a questão pelo enunciado e pelo texto de apoio. A alternativa ${letter} deve cobrir todos os itens pedidos, na mesma ordem e com os mesmos componentes, unidades, notação e nível de detalhe das demais. Se ${letter} é o gabarito, escreva a resposta completa e matematicamente correta; se for distrator, mantenha um erro plausível, sem torná-la correta. Não invente dados fora da planilha. Preserve literalmente as outras alternativas, o enunciado, o apoio, a letra do gabarito e os demais campos. Texto atual de ${letter}: ${originalAlternative.text}. Retorne {"text":"..."}.`,
      responseSchema: SINGLE_ALTERNATIVE_RESPONSE_SCHEMA,
      zodSchema: singleAlternativeSchema,
      maxAttempts: 2,
      validate: (value) => {
        const alternatives = (params.question.alternatives ?? []).map((item) => item.letter === letter ? { ...item, text: value.text } : item)
        const corrected = correctSingleQuestion({ ...params.question, alternatives, review: null }, params.curriculum, { deferContentQualityToJev: true })
        const untouchedOptions = (params.question.alternatives ?? []).filter((item) => item.letter !== letter)
        const correctedUntouchedOptions = (corrected.question.alternatives ?? []).filter((item) => item.letter !== letter)
        const unchanged = JSON.stringify(untouchedOptions) === JSON.stringify(correctedUntouchedOptions)
        const protectedFields = invariantIssues(params.question, corrected.question, ['alternatives'])
        return {
          value: corrected.question,
          issues: [...protectedFields, ...(unchanged ? [] : ['As alternativas fora do alvo devem permanecer literalmente inalteradas.'])],
          warnings: [...corrected.warnings, ...corrected.issues.map((item) => `Conferência para o Jev: ${item}`)],
          repairInstructions: [{ code: issue?.code ?? 'ALTERNATIVE_FORMAT_OUTLIER', fields: [`alternatives.${letter}`], message: issue?.message ?? `Reescreva somente a alternativa ${letter}.`, protectedFields: ['statement', 'supportText', 'correctLetter'] }],
        }
      },
    })
    return { question: generated.value, warnings: generated.warnings, repairKind }
  }

  if (repairKind === 'alternatives' || repairKind === 'alternatives_and_key') {
    const correct = params.question.alternatives?.find((item) => item.letter === params.question.correctLetter)
    const withKey = repairKind === 'alternatives_and_key'
    const expectedAlternativeCount = params.curriculum.segment === 'anos-iniciais' ? 4 : 5
    const generated = await generateValidatedStructuredContent({
      context: `${params.context}/${withKey ? 'alternatives-key' : 'alternatives'}`,
      prompt: `${common}\n\nRefaça SOMENTE "alternatives"${withKey ? ' e "correctLetter"' : ''}. Gere exatamente ${expectedAlternativeCount} opções com as letras ${Array.from({ length: expectedAlternativeCount }, (_, index) => String.fromCharCode(65 + index)).join(', ')}. ${withKey ? 'Derive uma única resposta correta a partir do enunciado e do apoio; se nenhuma opção atual responder à pergunta, inclua a resposta correta em uma alternativa e informe sua letra.' : `Preserve literalmente a alternativa correta ${params.question.correctLetter}: ${correct?.text ?? ''}; substitua apenas os distratores problemáticos.`} As opções devem ser homogêneas, plausíveis e mutuamente exclusivas.`,
      responseSchema: withKey ? ALTERNATIVES_KEY_RESPONSE_SCHEMA : ALTERNATIVES_RESPONSE_SCHEMA,
      zodSchema: withKey ? alternativesAndKeySchema : alternativesSchema,
      maxAttempts: 2,
      validate: (value) => {
        const patch = value as { alternatives: ExamQuestion['alternatives']; correctLetter?: string }
        const extra: string[] = []
        if (patch.alternatives?.length !== expectedAlternativeCount) extra.push(`A questão precisa ter exatamente ${expectedAlternativeCount} alternativas.`)
        if (!withKey && patch.alternatives?.find((item) => item.letter === params.question.correctLetter)?.text !== correct?.text) extra.push('A alternativa correta deve ser preservada literalmente.')
        const result = validate(patch, withKey ? ['alternatives', 'correctLetter'] : ['alternatives'])
        return { ...result, issues: [...result.issues, ...extra] }
      },
    })
    return { question: generated.value, warnings: generated.warnings, repairKind }
  }

  const generated = await generateValidatedStructuredContent({
    context: `${params.context}/answer-rubric`, prompt: `${common}\n\nReescreva SOMENTE "expectedAnswer" e "gradingCriteria". A resposta-modelo deve responder integralmente ao enunciado. Retorne de 3 a 5 critérios objetivos, observáveis e sem inventar exigências ausentes.`,
    responseSchema: ANSWER_RUBRIC_RESPONSE_SCHEMA, zodSchema: answerRubricSchema, maxAttempts: 2,
    validate: (value) => validate({ expectedAnswer: value.expectedAnswer, gradingCriteria: value.gradingCriteria.map((item, index) => `${index + 1}) ${item}`).join(' ') }, ['expectedAnswer', 'gradingCriteria']),
  })
  return { question: generated.value, warnings: generated.warnings, repairKind }
}
