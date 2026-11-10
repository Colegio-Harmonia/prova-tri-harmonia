import { z } from 'zod'
import type { CurriculumSelection } from '@/types/exam'
import { examQuestionSchema, type ExamQuestion } from '@/lib/gemini/examSchema'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { correctSingleQuestion } from '@/lib/gemini/examValidator'
import { getOfficialBnccSkill } from '@/lib/curriculum/officialBncc'
import type { QualityDiagnostic } from './qualityDiagnostics'

type RepairKind = 'bncc_alignment' | 'grade_adaptation' | 'objective_answer_only' | 'statement' | 'answer_cue' | 'support_statement' | 'targeted_alternatives' | 'single_alternative' | 'alternatives' | 'alternatives_and_key' | 'answer_rubric'

/** Rótulo operacional mantido para compatibilidade com os chamadores e logs. */
export function chooseRepairKind(diagnostics: QualityDiagnostic[], _declaredCorrectLetter?: string | null): RepairKind | null {
  const applicable = diagnostics.filter((item) => item.blocksApproval && item.repairAction === 'reparo_local')
  if (!applicable.length) return null
  const codes = new Set(applicable.map((item) => item.code))
  if (codes.has('BNCC_MAPPING') || codes.has('CURRICULUM_MISMATCH')) return 'bncc_alignment'
  if (codes.has('GRADE_LEVEL_MISMATCH')) return 'grade_adaptation'
  if (codes.has('MISSING_SUPPORT_TEXT')) return 'support_statement'
  if (codes.has('INSUFFICIENT_INFORMATION')) return 'statement'
  if (codes.has('ANSWER_CUE_EXPOSED')) return 'answer_cue'
  if (codes.has('ALTERNATIVE_CORRECTION_COMMENT') || codes.has('ALTERNATIVE_REVEALS_ANSWER')) return 'targeted_alternatives'
  if (codes.has('OBJECTIVE_CALCULATION_REQUEST') || codes.has('ALTERNATIVE_EXPOSES_CALCULATION')) return 'objective_answer_only'
  if (codes.has('ANSWER_EXPOSED_IN_STATEMENT')) return 'statement'
  if (codes.has('NO_CORRECT_ALTERNATIVE')) return 'alternatives_and_key'
  if (applicable.some((item) => (item.code === 'ALTERNATIVE_FORMAT_OUTLIER' || item.code === 'ALTERNATIVE_CONTENT_INCOMPLETE') && item.alternativeLetter)) return 'targeted_alternatives'
  if (codes.has('DUPLICATE_ALTERNATIVE') || codes.has('DISTRACTOR_EQUALS_ANSWER') || codes.has('ALTERNATIVE_AMBIGUITY')) return 'alternatives'
  if (codes.has('GRADING_CRITERIA')) return 'answer_rubric'
  return 'statement'
}

function curriculumContext(curriculum: CurriculumSelection) {
  return curriculum.units.map((unit) => [unit.tituloCapitulo, unit.conteudo, unit.enrichedContent].filter(Boolean).join(': ')).join('\n').slice(0, 7000)
}

function jsonSchemaFor(value: unknown): Record<string, unknown> {
  if (value === null) return { type: 'string', nullable: true }
  if (Array.isArray(value)) return { type: 'array', items: value.length ? jsonSchemaFor(value[0]) : { type: 'string' } }
  if (typeof value === 'string') return { type: 'string' }
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' }
  if (typeof value === 'boolean') return { type: 'boolean' }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return {
      type: 'object',
      properties: Object.fromEntries(entries.map(([key, child]) => [key, jsonSchemaFor(child)])),
      ...(entries.length ? { required: entries.map(([key]) => key) } : { additionalProperties: true }),
    }
  }
  return {}
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function fieldsAllowedBy(diagnostics: QualityDiagnostic[]): Set<string> {
  const allowed = new Set<string>()
  for (const item of diagnostics) {
    for (const field of item.fields) allowed.add(field.split('.')[0])
    if (item.repairAction === 'regenerar_questao') {
      for (const field of ['statement', 'supportText', 'alternatives', 'correctLetter', 'expectedAnswer', 'gradingCriteria', 'solutionBlueprint', 'bloomLevel']) allowed.add(field)
    }
    if (item.code === 'NO_CORRECT_ALTERNATIVE' || item.code === 'ANSWER_KEY_MISMATCH' || item.code === 'FACTUAL_INCONSISTENCY') {
      allowed.add('alternatives')
      allowed.add('correctLetter')
    }
  }
  return allowed
}

async function repairAnswersFromDiagnostics(
  params: {
    question: ExamQuestion
    curriculum: CurriculumSelection
    diagnostics: QualityDiagnostic[]
    context: string
    classLabel?: string
  },
  diagnostics: QualityDiagnostic[],
): Promise<{ question: ExamQuestion; warnings: string[]; repairKind: RepairKind } | null> {
  const repairKind = chooseRepairKind(diagnostics, params.question.correctLetter) ?? 'alternatives'
  const reported = fieldsAllowedBy(diagnostics)
  const responseFields = params.question.type === 'objetiva'
    ? ['alternatives', 'correctLetter']
    : ['expectedAnswer', 'gradingCriteria']
  const allowed = new Set(responseFields.filter((field) => reported.has(field)))
  if (params.question.type === 'objetiva' && diagnostics.some((item) => item.code === 'ANSWER_KEY_MISMATCH' || item.code === 'NO_CORRECT_ALTERNATIVE')) {
    allowed.add('correctLetter')
  }
  if (!allowed.size) return null

  const originalAlternatives = params.question.alternatives ?? []
  const alternativeDiagnostics = diagnostics.filter((item) => item.fields.some((field) => field === 'alternatives' || field.startsWith('alternatives.')))
  const targetedLetters = [...new Set(alternativeDiagnostics.flatMap((item) => [item.alternativeLetter, item.location?.match(/alternatives\.([A-E])/i)?.[1]?.toUpperCase()].filter((value): value is string => Boolean(value))))]
  const scopedAlternatives = alternativeDiagnostics.length > 0
    && targetedLetters.length > 0
    && alternativeDiagnostics.every((item) => Boolean(item.alternativeLetter || item.location?.match(/alternatives\.[A-E]/i)))
  const shape: z.ZodRawShape = {}
  if (allowed.has('alternatives')) {
    shape.alternatives = z.array(z.object({ letter: z.string().regex(/^[A-E]$/), text: z.string().trim().min(1) })).length(originalAlternatives.length)
  }
  if (allowed.has('correctLetter')) shape.correctLetter = z.enum(['A', 'B', 'C', 'D', 'E']).nullable()
  if (allowed.has('expectedAnswer')) shape.expectedAnswer = z.string().trim().min(1)
  if (allowed.has('gradingCriteria')) shape.gradingCriteria = z.string().trim().min(1)
  const answerSchema = z.object(shape).strict()
  const responseSchema = {
    type: 'object',
    properties: Object.fromEntries(Object.keys(shape).map((field) => [field, field === 'alternatives'
      ? { type: 'array', items: { type: 'object', properties: { letter: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E'] }, text: { type: 'string' } }, required: ['letter', 'text'], additionalProperties: false }, minItems: originalAlternatives.length, maxItems: originalAlternatives.length }
      : field === 'correctLetter' ? { type: 'string', nullable: true, enum: ['A', 'B', 'C', 'D', 'E'] } : { type: 'string' }])),
    required: Object.keys(shape),
    additionalProperties: false,
  }
  const reference = {
    tipo: params.question.type,
    enunciadoAprovado: params.question.statement,
    textoDeApoioAprovado: params.question.supportText ?? null,
    ...(params.question.type === 'objetiva'
      ? { alternativas: originalAlternatives, gabaritoAtual: params.question.correctLetter }
      : { respostaEsperadaAtual: params.question.expectedAnswer, criteriosAtuais: params.question.gradingCriteria }),
  }
  const prompt = [
    'Corrija somente as respostas da questão abaixo, considerando o enunciado aprovado como referência imutável.',
    `Diagnóstico do Jev: ${JSON.stringify(diagnostics.map((item) => ({ codigo: item.code, evidencia: item.evidence ?? null, defeito: item.message, correcao: item.resolutionCheck ?? item.message, campos: item.fields })))}`,
    `Questão de referência (leitura apenas): ${JSON.stringify(reference)}`,
    `Campos de resposta que pode devolver: ${[...allowed].join(', ')}. Não devolva enunciado, apoio, BNCC, turma, solução técnica ou metadados. Não altere campos fora dessa lista.`,
    params.question.type === 'objetiva'
      ? allowed.has('alternatives')
        ? 'Devolva todas as alternativas, com as mesmas letras e exatamente a mesma quantidade, e o gabarito quando autorizado. Preserve as alternativas sem diagnóstico. Cada opção deve ser uma resposta plausível ao enunciado; nenhuma pode conter comentários editoriais de certo ou errado.'
        : 'Devolva somente o gabarito autorizado. Use a alternativa indicada pela resolução independente do Jev, desde que ela responda ao enunciado. Não altere alternativas nem enunciado.'
      : 'Devolva a resposta esperada e/ou os critérios autorizados. Responda exatamente ao enunciado, cubra todos os itens pedidos e torne os critérios observáveis para correção.',
    'Retorne somente o objeto JSON dos campos autorizados.',
  ].join('\n\n')

  const generated = await generateValidatedStructuredContent<Record<string, unknown>, Record<string, unknown>>({
    context: `${params.context}/jev-answer-repair`,
    prompt,
    responseSchema,
    zodSchema: answerSchema,
    maxAttempts: 2,
    validate: (raw) => {
      const merged: Record<string, unknown> = { ...params.question }
      for (const field of allowed) {
        if (!(field in raw)) continue
        if (field === 'alternatives' && params.question.alternatives) {
          merged.alternatives = normalizeAlternativeResponse(raw.alternatives, params.question.alternatives, scopedAlternatives ? targetedLetters : null)
        } else merged[field] = raw[field]
      }
      const parsed = examQuestionSchema.safeParse(merged)
      if (!parsed.success) return { value: raw, issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }
      const corrected = correctSingleQuestion({ ...parsed.data, review: null } as ExamQuestion, params.curriculum, { deferContentQualityToJev: true })
      const result: ExamQuestion = { ...params.question }
      if (allowed.has('alternatives')) result.alternatives = corrected.question.alternatives
      if (allowed.has('correctLetter')) result.correctLetter = corrected.question.correctLetter
      if (allowed.has('expectedAnswer')) result.expectedAnswer = corrected.question.expectedAnswer
      if (allowed.has('gradingCriteria')) result.gradingCriteria = corrected.question.gradingCriteria
      const finalParsed = examQuestionSchema.safeParse(result)
      return {
        value: finalParsed.success ? finalParsed.data as unknown as Record<string, unknown> : raw,
        issues: finalParsed.success ? [] : finalParsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      }
    },
  })
  const question = generated.value as unknown as ExamQuestion
  if (sameJson(params.question, question)) return null
  return { question, warnings: generated.warnings, repairKind }
}

function normalizeAlternativeResponse(raw: unknown, original: NonNullable<ExamQuestion['alternatives']>, targetedLetters: string[] | null) {
  const returned = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? 'letter' in raw && 'text' in raw
        ? [raw]
        : Object.entries(raw as Record<string, unknown>).map(([key, value], index) => ({ letter: /^[A-E]$/i.test(key) ? key : original[index]?.letter, ...(typeof value === 'string' ? { text: value } : value && typeof value === 'object' ? value as object : {}) }))
      : []
  const replacements = new Map<string, string>()
  returned.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const candidate = item as { letter?: unknown; text?: unknown }
    const letter = typeof candidate.letter === 'string' ? candidate.letter.toUpperCase() : original[index]?.letter
    if (letter && typeof candidate.text === 'string' && candidate.text.trim()) replacements.set(letter, candidate.text)
  })
  return original.map((item) => !targetedLetters || targetedLetters.includes(item.letter)
    ? { ...item, text: replacements.get(item.letter) ?? item.text }
    : item)
}

/**
 * Uma chamada recebe os diagnósticos do Jev, corrige somente os campos
 * autorizados e devolve o objeto completo da questão. O chamador reaudita e
 * controla o orçamento global de no máximo duas intervenções.
 */
export async function repairQuestionFromDiagnostics(params: {
  question: ExamQuestion
  curriculum: CurriculumSelection
  diagnostics: QualityDiagnostic[]
  context: string
  blueprintSlot?: unknown
  classLabel?: string
  scope?: 'full' | 'answers'
  previousAttempt?: {
    attempt: number
    blockingCriteria: string[]
    changedFields: string[]
    outcome: string
  } | null
}): Promise<{ question: ExamQuestion; warnings: string[]; repairKind: RepairKind } | null> {
  const diagnostics = params.diagnostics.filter((item) => item.blocksApproval && ['reparo_local', 'regenerar_questao'].includes(item.repairAction))
  if (!diagnostics.length) return null
  if (params.scope === 'answers') return repairAnswersFromDiagnostics(params, diagnostics)
  const repairKind = chooseRepairKind(diagnostics, params.question.correctLetter) ?? 'statement'
  const allowed = fieldsAllowedBy(diagnostics)
  if (!allowed.size) return null

  const alternativeDiagnostics = diagnostics.filter((item) => item.fields.some((field) => field === 'alternatives' || field.startsWith('alternatives.')))
  const targetedLetters = [...new Set(alternativeDiagnostics.map((item) => item.alternativeLetter).filter((letter): letter is string => Boolean(letter)))].sort()
  const alternativesAreScoped = alternativeDiagnostics.length > 0 && alternativeDiagnostics.every((item) => Boolean(item.alternativeLetter))
  const officialSkills = params.question.bnccCodes.map((code) => {
    const skill = getOfficialBnccSkill(code)
    return skill ? `${code}: ${skill.text}${skill.context.length ? ` Contexto: ${skill.context.join('; ')}` : ''}` : `${code}: ${params.question.bnccSummary ?? 'descrição oficial indisponível'}`
  }).join('\n')
  const diagnosis = diagnostics.map((item, index) => ({
    numero: index + 1,
    codigo: item.code,
    local: item.location ?? (item.alternativeLetter ? `alternatives.${item.alternativeLetter}` : item.fields.join(', ') || 'questão'),
    evidencia: item.evidence ?? null,
    defeito: item.message,
    correcaoObrigatoria: item.resolutionCheck ?? item.message,
    camposQuePodeAlterar: item.fields,
    camposProtegidos: item.protectedFields,
  }))
  const allowedFields = [...allowed]
  const requiresFullRewrite = diagnostics.some((item) => item.repairAction === 'regenerar_questao')
  const previousAttemptPrompt = params.previousAttempt
    ? `TENTATIVA ANTERIOR (não repita):\n- Correção anterior: ${params.previousAttempt.attempt}.\n- Critérios que continuaram bloqueando: ${params.previousAttempt.blockingCriteria.join(', ') || 'nenhum'}.\n- Campos que mudaram: ${params.previousAttempt.changedFields.join(', ') || 'nenhum'}.\n- Resultado da auditoria: ${params.previousAttempt.outcome}.\nMude a abordagem no campo e trecho que ainda causam o bloqueio; não devolva a mesma redação.`
    : ''
  const prompt = [
    'Corrija uma questão escolar reprovada pelo Jev. Antes de editar, resolva a questão e localize no JSON o campo e trecho exatos que causam cada defeito. Use essa localização somente no seu raciocínio; edite os campos autorizados e devolva o JSON COMPLETO da questão.',
    `Disciplina: ${params.curriculum.subject}. Etapa: ${params.curriculum.segment}. Série: ${params.curriculum.gradeYear}º ano. Turma: ${params.classLabel ?? 'não informada'}.`,
    `Habilidades BNCC oficiais (referência da habilidade, não fonte de conteúdo):\n${officialSkills || 'não informadas'}`,
    `ESCOPO ESCOLAR: o planejamento selecionado delimita tema, objetivos e conteúdo. Não copie títulos/tópicos como resposta nem introduza conteúdo fora desse escopo. Use os dados numéricos já presentes na questão/blueprint; se uma situação hipotética precisar de valores de exemplo, identifique-a como hipotética e mantenha os cálculos internamente coerentes. Não invente fatos históricos, estatísticas, datas ou nomes próprios.\n${curriculumContext(params.curriculum)}`,
    `DIAGNÓSTICOS DO JEV — corrija cada item e confirme a condição indicada em correcaoObrigatoria:\n${JSON.stringify(diagnosis, null, 2)}`,
    `QUESTÃO ATUAL COMPLETA:\n${JSON.stringify(params.question, null, 2)}`,
    `CAMPOS AUTORIZADOS A MUDAR: ${allowedFields.join(', ')}.${alternativesAreScoped ? ` Em alternatives, somente as letras ${targetedLetters.join(', ')} podem mudar.` : ''} Preserve todos os demais campos literalmente, inclusive número, tipo, código BNCC, origem, vínculo ao planejamento, peso, recurso visual e metadados.`,
    previousAttemptPrompt,
    requiresFullRewrite
      ? 'O Jev classificou pelo menos um defeito como regeneração necessária. Reescreva a questão por inteiro, cobrindo todos os diagnósticos, e preserve número, tipo, capítulo, habilidade BNCC, nível da turma e recurso visual exigido. Mantenha os dados válidos e não reutilize o enunciado/apoio defeituoso.'
      : 'Faça a menor alteração que resolva todos os diagnósticos deste grupo. Em resposta induzida, transforme a conclusão antecipada em dado/premissa sem removê-la por completo da lógica. Em cálculo, resolva primeiro e altere somente a origem divergente. Em alternativas, preserve literalmente as opções não autorizadas.',
    'Regras: se nenhuma alternativa responde corretamente, inclua uma correta e ajuste o gabarito; se o enunciado não puder ser resolvido, altere apenas o enunciado para torná-lo resolvível com os dados existentes; ausência de gráfico/visual, sozinha, não exige criar imagem nem bloquear a questão. Não inclua comentários de certo/errado no texto das alternativas nem mostre cálculos quando o aluno só deve selecionar o resultado. Preserve tema, dados válidos e nível da turma.',
    'Retorne SOMENTE um objeto JSON completo da questão, com todas as chaves existentes no objeto atual. Sem markdown, explicações ou campos omitidos.',
  ].join('\n\n')
  const responseSchema = { ...jsonSchemaFor(params.question), required: Object.keys(params.question), additionalProperties: false }
  const generated = await generateValidatedStructuredContent<unknown, ExamQuestion>({
    context: `${params.context}/jev-full-question-repair`,
    prompt,
    responseSchema,
    // A saída completa pode conter erro de tipo em um campo protegido (p.ex.
    // solutionBlueprint como texto). Primeiro aceitamos o objeto JSON e
    // restauramos esses campos da versão auditada; depois validamos a questão.
    zodSchema: z.record(z.string(), z.unknown()),
    maxAttempts: 2,
    validate: (value) => {
      const candidateRaw = value as Record<string, unknown>
      const normalized: Record<string, unknown> = { ...params.question }
      for (const field of allowed) {
        if (!(field in candidateRaw)) continue
        const rawField = candidateRaw[field]
        if (field === 'alternatives' && params.question.alternatives) {
          normalized.alternatives = normalizeAlternativeResponse(rawField, params.question.alternatives, alternativesAreScoped ? targetedLetters : null)
          continue
        }
        const current = params.question[field as keyof ExamQuestion]
        if (typeof current === 'string' && typeof rawField === 'string') normalized[field] = rawField
        else if (typeof current === 'number' && typeof rawField === 'number') normalized[field] = rawField
        else if (typeof current === 'boolean' && typeof rawField === 'boolean') normalized[field] = rawField
        else if (current === null && (rawField === null || typeof rawField === 'string' || (rawField && typeof rawField === 'object'))) normalized[field] = rawField
        else if (rawField === null && current !== undefined) normalized[field] = null
        else if (current === undefined) normalized[field] = rawField
        else if (current && typeof current === 'object' && rawField && typeof rawField === 'object') normalized[field] = rawField
      }
      const parsed = examQuestionSchema.safeParse(normalized)
      if (!parsed.success) {
        return {
          value: params.question,
          issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'questão'}: ${issue.message}`),
          warnings: [],
          repairInstructions: diagnosis.map((item) => ({ code: item.codigo, fields: item.camposQuePodeAlterar, protectedFields: item.camposProtegidos, message: item.correcaoObrigatoria })),
        }
      }
      const corrected = correctSingleQuestion({ ...parsed.data, review: null } as ExamQuestion, params.curriculum, { deferContentQualityToJev: true })
      const finalPayload: Record<string, unknown> = { ...corrected.question }
      for (const field of Object.keys(params.question)) {
        if (!allowed.has(field)) finalPayload[field] = params.question[field as keyof ExamQuestion]
      }
      if (alternativesAreScoped && params.question.alternatives) {
        finalPayload.alternatives = normalizeAlternativeResponse(corrected.question.alternatives, params.question.alternatives, targetedLetters)
      }
      const finalParsed = examQuestionSchema.safeParse(finalPayload)
      const issues = [
        ...(!finalParsed.success ? finalParsed.error.issues.map((issue) => `${issue.path.join('.') || 'questão'}: ${issue.message}`) : []),
        ...(params.question.type === 'objetiva' && (!corrected.question.alternatives?.length || !corrected.question.correctLetter) ? ['A questão objetiva precisa conter alternativas e gabarito.'] : []),
        ...(params.question.type === 'objetiva' && corrected.question.correctLetter && !corrected.question.alternatives?.some((item) => item.letter === corrected.question.correctLetter) ? ['O gabarito precisa apontar para uma alternativa existente.'] : []),
        ...(params.question.type === 'descritiva' && !corrected.question.expectedAnswer?.trim() ? ['A questão descritiva precisa manter resposta esperada.'] : []),
      ]
      return {
        value: finalParsed.success ? finalParsed.data : params.question,
        issues,
        warnings: [...corrected.warnings, ...corrected.issues.map((issue) => `O Jev reavaliará: ${issue}`)],
        repairInstructions: diagnosis.map((item) => ({ code: item.codigo, fields: item.camposQuePodeAlterar, protectedFields: item.camposProtegidos, message: item.correcaoObrigatoria })),
      }
    },
  })
  if (sameJson(params.question, generated.value)) return null
  return { question: generated.value, warnings: generated.warnings, repairKind }
}
