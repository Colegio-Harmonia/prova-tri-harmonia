import { assessPlanningAlignment, PlanningAlignmentUnavailableError } from './planningAlignment'
import type { TargetEnemSkill } from './targetSkills'
import { classifyMissingQuestionBncc } from './questionBnccClassification'
import { classifyImportedQuestionBloom } from './importedQuestionBloom'
import { z } from 'zod'
import { createAcervoSearchSession, findAcervoQuestion, type AcervoHistory, type AcervoSearchResult } from './acervoQuestions'
import { questionContentKey } from './questionOrigin'
import { BLOOM_LEVELS, examGenerationResultSchema, examQuestionSchema, GEMINI_RESPONSE_SCHEMA, type ExamQuestion } from '@/lib/gemini/examSchema'
import type { OfficialBnccSkill } from '@/lib/curriculum/officialBncc'
import { coherenceIssues } from '@/lib/generation/coherence'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { evaluateWithJev, type JevChoiceAnswer, type JsonValue } from '@/lib/ai/jevClient'
import { validateExamAssembly } from './examQualityAssembly'
import type { PlannedQuestionSlot } from './contentPlan'
import { normalizeBlueprintNumber } from '@/lib/gemini/responseJson'

export type WholeExamBlueprintSlot = PlannedQuestionSlot & {
  targetEnemSkill?: TargetEnemSkill | null
  targetBloomLevel: typeof BLOOM_LEVELS[number]
  targetSkills: OfficialBnccSkill[]
  unitTitle: string
  curriculumContent: string | null
  enrichedContent: string | null
  objectives: string[]
}

export type WholeExamGenerationInput = {
  subject: string
  segment: 'anos-iniciais' | 'anos-finais' | 'ensino-medio'
  gradeYear: number
  academicYear?: number
  classLabel?: string
  bimester?: number
  questionCount: number
  questionSource?: 'acervo' | 'ia'
  generationJobId?: number
  alternativesCount: number
  objectiveCount: number
  discursiveCount: number
  slots: WholeExamBlueprintSlot[]
  generationInstruction?: string
  excludedQuestions?: ExamQuestion[]
  acervoHistory?: AcervoHistory
  onStage?: (number: number, stage: 'buscando_acervo' | 'acervo_importado' | 'gerando_prova_completa' | 'classificando_bloom') => Promise<void>
}

const examResultZod = examGenerationResultSchema

// O blueprint continua sendo o JSON final completo. A resposta do modelo
// contém só os campos vazios: o servidor recoloca BNCC, currículo, pesos e
// metadados oficiais sem pedir que a IA os copie dez vezes.
const fillQuestionSchema = examQuestionSchema.pick({
  slotId: true,
  statement: true,
  supportText: true,
  alternatives: true,
  correctLetter: true,
  expectedAnswer: true,
  gradingCriteria: true,
  solutionBlueprint: true,
  pedagogicalClassification: true,
  hasImage: true,
  imageDescription: true,
}).required()
/**
 * Ficha de cálculo sem nenhum passo não é um cálculo verificável: o prompt manda
 * devolver solutionBlueprint:null nesse caso, mas o modelo às vezes devolve o
 * objeto vazio (visto em provas de Inglês, 09/11/2026), e a resposta inteira era
 * recusada. Ficha vazia (sem passos, equações nem valores) vira null; as demais só têm os números normalizados.
 */
export function normalizeWholeExamBlueprint(question: Record<string, unknown>): Record<string, unknown> {
  const blueprint = question.solutionBlueprint
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) return question
  const { calculationSteps: steps, equations, values } = blueprint as { calculationSteps?: unknown; equations?: unknown; values?: unknown }
  const filled = (list: unknown) => Array.isArray(list) && list.some((item) => (typeof item === 'string' ? item.trim().length > 0 : item != null))
  const hasValues = !!values && typeof values === 'object' && !Array.isArray(values) && Object.keys(values).length > 0
  // Só a ficha vazia de fato vira null. Ficha com equações/valores e sem passos
  // (Matemática incompleta) continua sendo recusada para a IA completar o cálculo.
  if (!filled(steps) && !filled(equations) && !hasValues) return { ...question, solutionBlueprint: null }
  if (!values || typeof values !== 'object' || Array.isArray(values)) return question
  return { ...question, solutionBlueprint: { ...blueprint, values: Object.fromEntries(Object.entries(values).map(([key, number]) => [key, normalizeBlueprintNumber(number)])) } }
}

const wholeExamFillsSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { questions?: unknown }).questions)) return value
  const response = value as { questions: Array<Record<string, unknown>> }
  return { ...response, questions: response.questions.map((question) => {
    if (!question || typeof question !== 'object') return question
    return normalizeWholeExamBlueprint(question)
  }) }
}, z.object({ questions: z.array(fillQuestionSchema).min(1).max(30) }))

function withoutAdditionalProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAdditionalProperties)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'additionalProperties')
    .map(([key, nested]) => [key, withoutAdditionalProperties(nested)]))
}

export function wholeExamResponseSchema(input: WholeExamGenerationInput) {
  const base = GEMINI_RESPONSE_SCHEMA.properties.questions.items.properties as Record<string, unknown>
  const letters = Array.from({ length: input.alternativesCount }, (_, index) => String.fromCharCode(65 + index))
  const properties: Record<string, unknown> = {
    slotId: { type: 'string' },
    statement: base.statement,
    supportText: base.supportText,
    alternatives: {
      type: 'array', nullable: true,
      items: { type: 'object', properties: { letter: { type: 'string', enum: letters }, text: { type: 'string' } }, required: ['letter', 'text'] },
    },
    correctLetter: { type: 'string', nullable: true, enum: letters },
    expectedAnswer: base.expectedAnswer,
    gradingCriteria: base.gradingCriteria,
    solutionBlueprint: withoutAdditionalProperties(base.solutionBlueprint),
    pedagogicalClassification: base.pedagogicalClassification,
    hasImage: { type: 'boolean' },
    imageDescription: { type: 'string', nullable: true },
  }
  return {
    type: 'object',
    properties: {
      // O Gemini rejeita a restrição de tamanho para um array de prova
      // inteira. A contagem exata é conferida no Zod e na validação abaixo.
      questions: { type: 'array', items: {
        type: 'object', properties, required: Object.keys(properties),
      } },
    },
    required: ['questions'],
  }
}

function questionId(number: number) {
  return `q${String(number).padStart(2, '0')}`
}

function educationInstruction(input: WholeExamGenerationInput) {
  const classSuffix = input.classLabel ? `, turma ${input.classLabel}` : ''
  return input.segment === 'ensino-medio'
    ? `Essa prova é para o ${input.gradeYear}º ano do Ensino Médio${classSuffix}, do ensino brasileiro.`
    : `Essa prova é para o ${input.gradeYear}º ano do Ensino Fundamental, ${input.segment === 'anos-iniciais' ? 'Anos Iniciais' : 'Anos Finais'}${classSuffix}, do ensino brasileiro.`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const fields = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return `{${fields.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function officialBnccDetails(skills: OfficialBnccSkill[]) {
  return skills.map((skill) => ({
    code: skill.code,
    description: skill.text,
    context: skill.context,
    source: skill.source,
    dataVersion: skill.dataVersion,
    record: skill.record as unknown as Record<string, unknown>,
  }))
}

export function buildWholeExamBlueprint(input: WholeExamGenerationInput) {
  const alternatives = Array.from({ length: input.alternativesCount }, (_, index) => ({
    letter: String.fromCharCode(65 + index),
    text: null,
  }))
  const educationContext = educationInstruction(input)

  return {
    metadata: {
      segment: input.segment,
      gradeYear: input.gradeYear,
      ...(input.academicYear ? { academicYear: input.academicYear } : {}),
      subject: input.subject,
      ...(input.classLabel ? { classLabel: input.classLabel } : {}),
      bimester: input.bimester ?? null,
      questionCount: input.questionCount,
      objectiveCount: input.objectiveCount,
      discursiveCount: input.discursiveCount,
      alternativesCount: input.alternativesCount,
    },
    questions: input.slots.map((slot) => ({
      slotId: questionId(slot.number),
      number: slot.number,
      curriculumUnitRowIndex: slot.unitRowIndex,
      type: slot.type,
      weight: Number((100 / Math.max(1, input.questionCount)).toFixed(2)),
      bloomLevel: slot.targetBloomLevel,
      plannedEnemSkill: slot.targetEnemSkill ?? null,
      bnccCodes: slot.targetSkills.map((skill) => skill.code),
      bnccStatus: slot.targetSkills.length ? 'mapeado' : 'nao_mapeado',
      bnccSummary: slot.targetSkills.map((skill) => skill.text).join(' '),
      bnccDetails: officialBnccDetails(slot.targetSkills),
      generationContext: {
        educationContext,
        subject: input.subject,
        bimester: input.bimester ?? null,
        alternativesCount: slot.type === 'objetiva' ? input.alternativesCount : 0,
        visualAid: slot.visualAid,
        targetDifficulty: null,
      },
      curriculumSnapshot: {
        unitTitle: slot.unitTitle,
        content: slot.curriculumContent,
        enrichedContent: slot.enrichedContent,
        objectives: slot.objectives,
      },
      statement: null,
      supportText: null,
      alternatives: slot.type === 'objetiva' ? alternatives : null,
      correctLetter: null,
      expectedAnswer: null,
      gradingCriteria: null,
      solutionBlueprint: null,
      pedagogicalClassification: { dok: null, soloExpected: null, difficulty: null },
      saeb: { applicable: false, source: null, value: null, approximate: false },
      hasImage: slot.visualAid === 'obrigatorio' ? true : slot.visualAid === 'sem_imagem' ? false : null,
      imageDescription: null,
    })),
  }
}

/** Select originals first; only vacant slots reach the AI generator. */
export async function generateWholeExam(input: WholeExamGenerationInput): Promise<{ questions: ExamQuestion[]; blueprint: ReturnType<typeof buildWholeExamBlueprint> }> {
  if (input.slots.length !== input.questionCount) throw new Error('O blueprint precisa conter um objeto para cada questão solicitada.')
  input = { ...input, slots: input.slots.map((slot) => ({ ...slot })) }
  const selected: ExamQuestion[] = []
  const remaining: WholeExamBlueprintSlot[] = []
  const reasons = new Map<number, string>()
  const selectionStartedAt = Date.now()
  const acervoSession = createAcervoSearchSession()
  await Promise.all(input.slots.map(async (slot) => {
    if (input.questionSource === 'ia') { remaining.push(slot); return }
    await input.onStage?.(slot.number, 'buscando_acervo')
    const found: AcervoSearchResult = await findAcervoQuestion({
      codes: slot.targetSkills.map((skill) => skill.code), number: slot.number, type: slot.type,
      visualAid: slot.visualAid, excludedQuestions: [...(input.excludedQuestions ?? []), ...selected], history: input.acervoHistory,
      session: acervoSession,
      jobId: input.generationJobId,
      ...(input.segment === 'ensino-medio' ? { planningSearch: { subject: input.subject, content: slot.curriculumContent ?? '', title: slot.unitTitle } } : {}),
      ...(input.segment === 'ensino-medio' ? { acceptCandidate: async (question: ExamQuestion) => {
        const alignment = await assessPlanningAlignment(question, { subject: input.subject, gradeYear: input.gradeYear, classLabel: input.classLabel, ...slot, targetBnccCodes: slot.targetSkills.map((skill) => skill.code) })
        question.plannedEnemSkill = slot.targetEnemSkill ?? null
        question.planningAlignment = alignment
        if (alignment.status === 'unavailable') throw new PlanningAlignmentUnavailableError(alignment.evidence)
        return alignment.status === 'aligned'
      } } : {}),
    })
    if (!found.question) {
      remaining.push(slot)
      reasons.set(slot.number, found.reason)
      return
    }
    slot.type = found.question.type
    selected.push({
      ...found.question, curriculumUnitRowIndex: slot.unitRowIndex,
      generationContext: { educationContext: educationInstruction(input), subject: input.subject, bimester: input.bimester ?? null, alternativesCount: found.question.alternatives?.length ?? 0, visualAid: slot.visualAid, targetDifficulty: null },
      bnccDetails: officialBnccDetails(slot.targetSkills.filter((skill) => found.question!.bnccCodes.includes(skill.code))),
      bnccSummary: slot.targetSkills.filter((skill) => found.question!.bnccCodes.includes(skill.code)).map((skill) => skill.text).join(' '),
      curriculumSnapshot: { unitTitle: slot.unitTitle, content: slot.curriculumContent, enrichedContent: slot.enrichedContent, objectives: slot.objectives },
    })
    await input.onStage?.(slot.number, 'acervo_importado')
  }))
  remaining.sort((a, b) => a.number - b.number)
  console.info('[exam/generation] seleção do acervo concluída', { jobId: input.generationJobId, durationMs: Date.now() - selectionStartedAt, importedCount: selected.length, aiSlotCount: remaining.length, ...acervoSession.stats })
  if (remaining.length) {
    await Promise.all(remaining.map((slot) => input.onStage?.(slot.number, 'gerando_prova_completa')))
    const peers = [...(input.excludedQuestions ?? []), ...selected]
    const forbidden = new Set([...peers.map(questionContentKey), ...(input.acervoHistory ?? []).map(questionContentKey)])
    let generated: Awaited<ReturnType<typeof generateWholeExamWithAi>> | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      generated = await generateWholeExamWithAi({
        ...input, slots: remaining, questionCount: remaining.length,
        objectiveCount: remaining.filter((slot) => slot.type === 'objetiva').length,
        discursiveCount: remaining.filter((slot) => slot.type === 'descritiva').length,
        generationInstruction: [input.generationInstruction, 'Não repita os itens já selecionados nem forneça suas respostas. Itens preservados:', JSON.stringify(peers.map((q) => ({ statement: q.statement, alternatives: q.alternatives })))].filter(Boolean).join('\n'),
      })
      const keys = generated.questions.map(questionContentKey)
      if (keys.every((key) => !forbidden.has(key)) && new Set(keys).size === keys.length) break
      if (attempt === 1) throw new Error('A geração por IA repetiu questões existentes; tente substituir a questão novamente.')
    }
    selected.push(...generated!.questions.map((q) => ({ ...q, acervoFallbackReason: reasons.get(q.number) })))
  }
  if (input.segment === 'ensino-medio') {
    for (const question of selected.filter((q) => q.source !== 'acervo')) {
      const slot = input.slots.find((slot) => slot.number === question.number)!
      question.plannedEnemSkill = slot.targetEnemSkill ?? null
      question.planningAlignment = await assessPlanningAlignment(question, { subject: input.subject, gradeYear: input.gradeYear, classLabel: input.classLabel, ...slot, targetBnccCodes: slot.targetSkills.map((skill) => skill.code) })
    }
  }
  await Promise.all(selected.filter((q) => q.source !== 'ia').map((q) => input.onStage?.(q.number, 'classificando_bloom')))
  return {
    questions: await classifyMissingQuestionBncc(await classifyImportedQuestionBloom(selected.sort((a, b) => a.number - b.number), input), input),
    blueprint: buildWholeExamBlueprint({
      ...input,
      objectiveCount: selected.filter((question) => question.type === 'objetiva').length,
      discursiveCount: selected.filter((question) => question.type === 'descritiva').length,
    }),
  }
}

async function generateWholeExamWithAi(input: WholeExamGenerationInput): Promise<{ questions: ExamQuestion[]; blueprint: ReturnType<typeof buildWholeExamBlueprint> }> {
  if (input.slots.length !== input.questionCount) throw new Error('O blueprint precisa conter um objeto para cada questão solicitada.')
  const blueprint = buildWholeExamBlueprint(input)
  const prompt = [
    'Gere uma prova completa em uma única resposta estruturada. O blueprint abaixo É O JSON FINAL pré-definido: cada objeto corresponde a uma questão. Preencha mentalmente todos os campos vazios, considerando a prova como conjunto. O sistema incorporará sua resposta ao blueprint.',
    educationInstruction(input),
    `Disciplina: ${input.subject}. Quantidade: ${input.questionCount}. Objetivas: ${input.objectiveCount}. Discursivas: ${input.discursiveCount}.`,
    'Quando plannedEnemSkill estiver preenchido, a operação exigida para resolver a questão deve medir essa habilidade ENEM, respeitando simultaneamente o conteúdo e os objetivos da unidade. A habilidade é um alvo, não uma classificação já comprovada.',
    'O conteúdo oficial de cada habilidade BNCC e os recortes do planejamento já estão em cada objeto. Use-os como limite curricular. Número, slotId, tipo, BNCC, bloomLevel, unidade, currículo, série e contexto são fixos. Não invente códigos ou descrições BNCC. A mesma habilidade pode aparecer mais de uma vez apenas se as tarefas e os raciocínios cobrados forem realmente diferentes.',
    'Escreva a prova como conjunto: varie o contexto, o tipo de raciocínio e a forma de perguntar; não repita uma questão com palavras diferentes; uma questão não pode dar a resposta de outra; cada item deve ser respondível sem depender das demais. O bloomLevel predefinido descreve a operação cognitiva que a questão deve exigir.',
    `Para objetivas, preencha exatamente as alternativas ${Array.from({ length: input.alternativesCount }, (_, index) => String.fromCharCode(65 + index)).join(', ')} já listadas, sem mudar as letras nem a quantidade, e escolha um correctLetter válido. Para discursivas, deixe alternatives e correctLetter como null e preencha expectedAnswer e gradingCriteria com resposta e critérios observáveis.`,
    'Use supportText somente quando a questão exigir interpretar um texto, tabela, gráfico ou conjunto de dados; caso contrário mantenha null. Não revele no apoio a resposta que o aluno deve inferir.',
    'Preencha hasImage com boolean e imageDescription com uma descrição detalhada quando um recurso visual for necessário ou pedagogicamente útil. Quando não houver imagem, use hasImage:false e imageDescription:null. Ainda não gere a imagem.',
    'Uma questão que manda observar uma figura, malha, gráfico ou imagem precisa desse recurso: marque hasImage:true e descreva todos os dados e opções visuais. Para os Anos Iniciais, use tarefas curtas de observação com alternativas simples. Não substitua figuras por descrições abstratas que revelem a resposta. Diferencie eixo de reflexão do eixo de simetria da própria figura.',
    'Respeite generationContext.visualAid por questão: obrigatorio exige hasImage:true e imageDescription preenchida, com uma atividade que use o visual; sem_imagem exige hasImage:false e imageDescription:null e enunciado autossuficiente; auto permite decidir conforme a tarefa. Prefira recursos visuais úteis nos Anos Iniciais, sem impor imagens a todas as questões de um capítulo.',
    'Para cada posição, devolva somente slotId, statement, supportText, alternatives, correctLetter, expectedAnswer, gradingCriteria, solutionBlueprint, pedagogicalClassification, hasImage e imageDescription. Use solutionBlueprint:null quando não houver cálculo verificável. Não devolva BNCC, currículo, peso nem metadata: o sistema já mantém esses dados no JSON final.',
    'Não calcule dificuldade nem pesos. O sistema classifica dificuldade depois e calcula a participação percentual de cada questão sobre 100% da prova.',
    'Em solutionBlueprint.values, cada valor deve ser um número JSON, nunca texto, fórmula, fração ou unidade. Escreva fórmulas em equations e unidades em variables.meaning. Use notação matemática em texto simples e símbolos Unicode; evite comandos LaTeX com barras invertidas. Use solutionBlueprint:null se não houver cálculo verificável.',
    input.generationInstruction ?? '',
    `Blueprint JSON completo:\n${JSON.stringify(blueprint)}`,
    `Retorne um objeto JSON {"questions":[...]} com exatamente ${input.questionCount} itens, na ordem do blueprint e com os mesmos slotId. O sistema une os campos retornados aos objetos completos. Não inclua comentários ou markdown.`,
    'Preencha pedagogicalClassification.dok e soloExpected com categorias, evidências e justificativas coerentes com a questão. Deixe pedagogicalClassification.difficulty como null ou omita: o Jev fará somente essa classificação depois.',
  ].filter(Boolean).join('\n\n')

  const result = await generateValidatedStructuredContent({
    context: 'generation/whole-exam-v1',
    prompt,
    responseSchema: wholeExamResponseSchema(input),
    zodSchema: wholeExamFillsSchema,
    // Uma geração e no máximo uma correção do JSON original, ainda completo.
    maxAttempts: 2,
    validate: (fills) => {
      const issues: string[] = []
      if (fills.questions.length !== input.questionCount) {
        return { value: [] as ExamQuestion[], issues: [`Esperadas ${input.questionCount} questões; recebidas ${fills.questions.length}.`], stopRetry: true }
      }
      const complete = examResultZod.safeParse({
        metadata: blueprint.metadata,
        questions: fills.questions.map((fields, index) => ({
          ...blueprint.questions[index],
          ...fields,
          pedagogicalClassification: { ...fields.pedagogicalClassification, difficulty: null },
        })),
      })
      if (!complete.success) {
        return { value: [] as ExamQuestion[], issues: complete.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`), stopRetry: true }
      }
      const parsed = complete.data
      if (parsed.metadata.segment !== input.segment) issues.push('Metadata: segmento diverge do blueprint.')
      if (parsed.metadata.gradeYear !== input.gradeYear) issues.push('Metadata: série diverge do blueprint.')
      if (input.academicYear && parsed.metadata.academicYear !== input.academicYear) issues.push('Metadata: ano letivo diverge do blueprint.')
      if (parsed.metadata.subject !== input.subject) issues.push('Metadata: disciplina diverge do blueprint.')
      if (input.classLabel && parsed.metadata.classLabel !== input.classLabel) issues.push('Metadata: turma diverge do blueprint.')
      if ((parsed.metadata.bimester ?? null) !== (input.bimester ?? null)) issues.push('Metadata: bimestre diverge do blueprint.')
      if (parsed.metadata.questionCount !== input.questionCount) issues.push('Metadata: quantidade de questões diverge do blueprint.')
      if (parsed.metadata.objectiveCount !== input.objectiveCount) issues.push('Metadata: quantidade de questões objetivas diverge do blueprint.')
      if (parsed.metadata.discursiveCount !== input.discursiveCount) issues.push('Metadata: quantidade de questões discursivas diverge do blueprint.')
      if (parsed.metadata.alternativesCount !== input.alternativesCount) issues.push('Metadata: quantidade de alternativas diverge do blueprint.')
      const byNumber = new Map(input.slots.map((slot) => [slot.number, slot]))
      const seenNumbers = new Set<number>()
      for (const [index, question] of parsed.questions.entries()) {
        const slot = byNumber.get(question.number)
        if (!slot) { issues.push(`Questão ${question.number}: posição não existe no blueprint.`); continue }
        if (seenNumbers.has(question.number)) issues.push(`Questão ${question.number}: posição duplicada.`)
        seenNumbers.add(question.number)
        if (input.slots[index]?.number !== question.number) issues.push(`Posição ${index + 1}: questões devem voltar na mesma ordem do blueprint.`)
        const expectedId = questionId(slot.number)
        if (question.slotId !== expectedId) issues.push(`Questão ${question.number}: slotId deve ser ${expectedId}.`)
        if (question.type !== slot.type) issues.push(`Questão ${question.number}: tipo diverge do blueprint.`)
        if (question.curriculumUnitRowIndex !== slot.unitRowIndex) issues.push(`Questão ${question.number}: unidade diverge do blueprint.`)
        if (question.bloomLevel !== slot.targetBloomLevel) issues.push(`Questão ${question.number}: Bloom diverge do blueprint.`)
        if (JSON.stringify(question.bnccCodes) !== JSON.stringify(slot.targetSkills.map((skill) => skill.code))) issues.push(`Questão ${question.number}: BNCC diverge do blueprint.`)
        if (stableJson(question.bnccDetails) !== stableJson(officialBnccDetails(slot.targetSkills))) issues.push(`Questão ${question.number}: detalhes oficiais da BNCC foram alterados.`)
        if (stableJson(question.curriculumSnapshot) !== stableJson({ unitTitle: slot.unitTitle, content: slot.curriculumContent, enrichedContent: slot.enrichedContent, objectives: slot.objectives })) issues.push(`Questão ${question.number}: snapshot do currículo foi alterado.`)
        if (question.generationContext?.educationContext !== educationInstruction(input) || question.generationContext?.subject !== input.subject || question.generationContext?.bimester !== (input.bimester ?? null) || question.generationContext?.alternativesCount !== (slot.type === 'objetiva' ? input.alternativesCount : 0) || question.generationContext?.visualAid !== slot.visualAid || question.generationContext?.targetDifficulty !== null) issues.push(`Questão ${question.number}: contexto predefinido foi alterado.`)
        if (question.bnccStatus !== (slot.targetSkills.length ? 'mapeado' : 'nao_mapeado')) issues.push(`Questão ${question.number}: status BNCC diverge do blueprint.`)
        if (question.bnccSummary !== slot.targetSkills.map((skill) => skill.text).join(' ')) issues.push(`Questão ${question.number}: resumo BNCC diverge do blueprint.`)
        if (!question.statement.trim()) issues.push(`Questão ${question.number}: enunciado vazio.`)
        const expectedWeight = Number((100 / Math.max(1, input.questionCount)).toFixed(2))
        if (question.weight !== expectedWeight) issues.push(`Questão ${question.number}: o peso provisório do blueprint foi alterado.`)
        if (typeof question.hasImage !== 'boolean') issues.push(`Questão ${question.number}: hasImage deve ser booleano explícito.`)
        if (slot.type === 'objetiva') {
          const expectedLetters = Array.from({ length: input.alternativesCount }, (_, i) => String.fromCharCode(65 + i))
          const letters = question.alternatives?.map((alternative) => alternative.letter) ?? []
          if (JSON.stringify(letters) !== JSON.stringify(expectedLetters)) issues.push(`Questão ${question.number}: alternativas precisam ser exatamente ${expectedLetters.join(', ')}.`)
          if (question.alternatives?.some((alternative) => !alternative.text.trim())) issues.push(`Questão ${question.number}: alternativa sem conteúdo.`)
          if (!question.correctLetter || !expectedLetters.includes(question.correctLetter) || !question.alternatives?.some((alternative) => alternative.letter === question.correctLetter)) issues.push(`Questão ${question.number}: gabarito sem alternativa correspondente.`)
        } else if (!question.expectedAnswer?.trim() || !question.gradingCriteria?.trim()) {
          issues.push(`Questão ${question.number}: questão discursiva precisa de resposta esperada e critérios.`)
        }
        const hasImage = question.hasImage ?? question.needsImage ?? false
        const description = question.imageDescription ?? question.imageQuery ?? null
        if (slot.visualAid === 'obrigatorio' && !hasImage) issues.push(`Questão ${question.number}: o blueprint exige recurso visual.`)
        if (slot.visualAid === 'sem_imagem' && hasImage) issues.push(`Questão ${question.number}: o blueprint exige questão sem imagem.`)
        if (hasImage && !description?.trim()) issues.push(`Questão ${question.number}: declarou imagem sem descrevê-la.`)
        if (!hasImage && description) issues.push(`Questão ${question.number}: imagem sem solicitação explícita.`)
      }
      for (const slot of input.slots) if (!seenNumbers.has(slot.number)) issues.push(`Questão ${slot.number}: posição do blueprint ausente.`)
      const localSlots = input.slots.map((slot) => ({ number: slot.number, unitRowIndex: slot.unitRowIndex, type: slot.type, visualAid: slot.visualAid }))
      // Alertas editoriais de variedade orientam a revisão; apenas violações
      // bloqueantes devem descartar uma prova completa já gerada.
      issues.push(...validateExamAssembly(parsed.questions, localSlots)
        .filter((issue) => issue.severity === 'bloqueante')
        .map((issue) => issue.reason))
      issues.push(...coherenceIssues(parsed.questions).filter((issue) => issue.severity === 'bloqueante').map((issue) => issue.reason))
      return {
        value: parsed.questions,
        issues: [...new Set(issues)],
        // Uma falha visual ou de conteúdo pode ser corrigida na resposta
        // original. O limite de duas chamadas impede ciclos de reparo.
        stopRetry: false,
        repairInstructions: issues.map((message) => ({ code: 'WHOLE_EXAM_CONTRACT', message })),
      }
    },
  })

  const questions = result.value.map((question) => {
    const slot = byNumberOrThrow(input.slots, question.number)
    const hasImage = question.hasImage ?? question.needsImage ?? false
    const imageDescription = question.imageDescription ?? question.imageQuery ?? null
    return {
      ...question,
      slotId: questionId(slot.number),
      source: 'ia' as const,
      bnccStatus: slot.targetSkills.length ? 'mapeado' as const : 'nao_mapeado' as const,
      bnccSummary: slot.targetSkills.map((skill) => skill.text).join(' '),
      bnccDetails: officialBnccDetails(slot.targetSkills),
      curriculumSnapshot: {
        unitTitle: slot.unitTitle,
        content: slot.curriculumContent,
        enrichedContent: slot.enrichedContent,
        objectives: slot.objectives,
      },
      generationContext: {
        educationContext: educationInstruction(input),
        subject: input.subject,
        bimester: input.bimester ?? null,
        alternativesCount: slot.type === 'objetiva' ? input.alternativesCount : 0,
        visualAid: slot.visualAid,
        targetDifficulty: null,
      },
      hasImage,
      imageDescription: hasImage ? imageDescription : null,
      needsImage: hasImage,
      imageQuery: hasImage ? imageDescription : null,
      image: null,
      review: null,
    }
  })
  return { questions, blueprint }
}

export type DifficultyResult = {
  source: 'provider' | 'cache' | 'fallback'
  model: string
  classifiedAt: string
  questions: ExamQuestion[]
  distribution: {
    facil: number
    media: number
    dificil: number
    facilPercent: number
    mediaPercent: number
    dificilPercent: number
  }
}

const difficultyChoices = {
  facil: 'Exige recuperação ou reconhecimento direto, poucos passos e pouca inferência para a série desta questão.',
  media: 'Exige compreensão e aplicação com algum raciocínio, comparação ou mais de uma informação para a série.',
  dificil: 'Exige autonomia, várias etapas, inferência ou integração de ideias acima do nível direto esperado para a série, sem cobrar conteúdo fora do currículo.',
} as const

export async function classifyExamDifficulty(questions: ExamQuestion[], educationContext: string, subject: string): Promise<DifficultyResult> {
  const ids = questions.map((question) => question.slotId ?? `q${String(question.number).padStart(2, '0')}`)
  const decisions = Object.fromEntries(questions.map((question, index) => [ids[index]!, {
    type: 'choice' as const,
    instructions: `Classifique somente a dificuldade da questão ${question.number} considerando a série, a etapa e a disciplina informadas. Avalie o trabalho cognitivo real necessário para resolver, não apenas o tamanho do texto ou o bloomLevel.`,
    criteria: difficultyChoices,
  }]))
  const state = {
    educationContext,
    subject,
    rubric: 'A dificuldade é relativa ao ano escolar brasileiro informado. Bloom é uma dimensão separada. Escolha a categoria que melhor descreve o esforço de resolução para um estudante dessa turma.',
    questions: questions.map((question) => ({
      id: question.slotId ?? `q${String(question.number).padStart(2, '0')}`,
      number: question.number,
      type: question.type,
      bloomLevel: question.bloomLevel,
      statement: question.statement,
      supportText: question.supportText ?? null,
      alternatives: question.alternatives ?? null,
      expectedAnswer: question.expectedAnswer ?? null,
      gradingCriteria: question.gradingCriteria ?? null,
      bnccCodes: question.bnccCodes,
      bnccSummary: question.bnccSummary ?? null,
    })),
  } as JsonValue
  const fallbackAnswers = Object.fromEntries(ids.map((id) => [id, { type: 'choice' as const, choice: 'media', confidence: 0 }]))
  const decision = await evaluateWithJev({
    operation: 'jev/exams/whole-exam-difficulty',
    questionVersion: 'whole-exam-difficulty-v1',
    state,
    questions: decisions,
    route: () => ({ route: 'automatic', outcome: 'difficulty_classified' }),
    fallback: { answers: fallbackAnswers, routing: { route: 'fallback', outcome: 'difficulty_defaulted_to_medium' } },
    context: { subject, questionCount: questions.length, engine: 'whole-exam-v1' },
  })
  const classifiedAt = new Date().toISOString()
  const classified = questions.map((question, index) => {
    const answer = decision.answers[ids[index]!]
    const difficulty = answer?.type === 'choice' && ['facil', 'media', 'dificil'].includes(answer.choice)
      ? answer.choice as 'facil' | 'media' | 'dificil'
      : 'media'
    return {
      ...question,
      pedagogicalClassification: { ...question.pedagogicalClassification, difficulty },
      difficultyAssessment: {
        source: decision.source,
        model: decision.model,
        confidence: answer?.type === 'choice' ? answer.confidence ?? null : null,
        classifiedAt,
      },
    }
  })
  const counts = {
    facil: classified.filter((question) => question.pedagogicalClassification.difficulty === 'facil').length,
    media: classified.filter((question) => question.pedagogicalClassification.difficulty === 'media').length,
    dificil: classified.filter((question) => question.pedagogicalClassification.difficulty === 'dificil').length,
  }
  const total = Math.max(1, classified.length)
  return {
    source: decision.source,
    model: decision.model,
    classifiedAt,
    questions: classified,
    distribution: {
      ...counts,
      facilPercent: Math.round((counts.facil / total) * 1000) / 10,
      mediaPercent: Math.round((counts.media / total) * 1000) / 10,
      dificilPercent: Math.round((counts.dificil / total) * 1000) / 10,
    },
  }
}

/** Distribui o máximo de pontos como percentuais da prova, totalizando exatamente 100. */
export function assignExamPercentageWeights(questions: ExamQuestion[]): ExamQuestion[] {
  if (!questions.length) return []
  const factor = (difficulty: ExamQuestion['pedagogicalClassification']['difficulty']) =>
    difficulty === 'facil' ? 0.9 : difficulty === 'dificil' ? 1.1 : 1
  const factors = questions.map((question) => factor(question.pedagogicalClassification.difficulty))
  const totalFactor = factors.reduce((sum, value) => sum + value, 0)
  const exactHundredths = factors.map((value) => value / totalFactor * 10_000)
  const allocated = exactHundredths.map(Math.floor)
  const remaining = 10_000 - allocated.reduce((sum, value) => sum + value, 0)
  const order = exactHundredths.map((value, index) => ({ index, remainder: value - allocated[index]! }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  for (let index = 0; index < remaining; index++) {
    const allocationIndex = order[index]!.index
    allocated[allocationIndex] = allocated[allocationIndex]! + 1
  }
  return questions.map((question, index) => ({ ...question, weight: allocated[index]! / 100 }))
}

function byNumberOrThrow(slots: WholeExamBlueprintSlot[], number: number) {
  const slot = slots.find((candidate) => candidate.number === number)
  if (!slot) throw new Error(`Questão ${number} não existe no blueprint.`)
  return slot
}

