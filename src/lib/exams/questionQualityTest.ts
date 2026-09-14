import { z } from 'zod'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import type { CurriculumSelection } from '@/types/exam'
import { generateValidatedStructuredContent, StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import type { ExamQualityIssue } from './examQualityAssembly'

const QUALITY_CRITERIA = ['gabarito', 'unicidade', 'cálculo_ou_dados', 'linguagem', 'alinhamento'] as const

const qualitySchema = z.object({
  questionNumber: z.number().int().positive(),
  approved: z.boolean(),
  verdictReason: z.string().min(1).default('Sem justificativa detalhada retornada pelo teste.'),
  checks: z.array(z.object({
    criterion: z.enum(QUALITY_CRITERIA),
    // Alguns provedores devolvem "não_aprovado" apesar do enum solicitado.
    // Normalizamos essa variação sem desperdiçar uma geração válida.
    status: z.preprocess((value) => value === 'não_aprovado' ? 'reprovado' : value, z.enum(['aprovado', 'reprovado', 'não_aplicável'])),
    evidence: z.string().min(1),
  })).default([]),
  // Para itens objetivos, esta é a evidência estruturada que impede que um
  // texto contraditório seja exibido como "aprovado" no relatório.
  answerKeyAudit: z.object({
    declaredLetter: z.string().nullable(),
    independentlyDerivedLetter: z.string().nullable(),
    matchesDeclared: z.boolean(),
    evidence: z.string().min(1),
  }).nullable().optional(),
  issues: z.array(z.object({ reason: z.string().min(1), severity: z.enum(['bloqueante', 'alerta']) })).default([]),
})

const QUALITY_RESPONSE_SCHEMA = {
  type: 'object', properties: {
    questionNumber: { type: 'integer' }, approved: { type: 'boolean' }, verdictReason: { type: 'string' },
    checks: { type: 'array', items: { type: 'object', properties: { criterion: { type: 'string', enum: QUALITY_CRITERIA }, status: { type: 'string', enum: ['aprovado', 'reprovado', 'não_aplicável'] }, evidence: { type: 'string' } }, required: ['criterion', 'status', 'evidence'] } },
    answerKeyAudit: { type: 'object', nullable: true, properties: { declaredLetter: { type: 'string', nullable: true }, independentlyDerivedLetter: { type: 'string', nullable: true }, matchesDeclared: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['declaredLetter', 'independentlyDerivedLetter', 'matchesDeclared', 'evidence'] },
    issues: { type: 'array', items: { type: 'object', properties: { reason: { type: 'string' }, severity: { type: 'string', enum: ['bloqueante', 'alerta'] } }, required: ['reason', 'severity'] } },
  }, required: ['questionNumber', 'approved', 'verdictReason', 'checks', 'issues'],
}

function normalized(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ') }

function brazilianNumber(value: string) { return Number(value.replace(/\./g, '').replace(',', '.')) }

function compoundInterestIssue(question: ExamQuestion): ExamQualityIssue | null {
  if (question.type !== 'objetiva' || !question.alternatives) return null
  const text = `${question.supportText ?? ''} ${question.statement}`
  const initial = text.match(/(?:valor|investimento) inicial(?: investido)?(?: foi de)?\s*R\$\s*([\d.]+,\d{2})/i)?.[1]
  const rate = text.match(/(?:taxa(?: fixa)? de|rende(?: a cada mês)? uma taxa(?: fixa)? de)\s*(\d+(?:,\d+)?)%/i)?.[1]
  const months = text.match(/(?:ao )?(?:final|fim) do\s*(\d+)(?:º|o|ª|a)?\s*m[eê]s/i)?.[1]
  if (!initial || !rate || !months) return null
  const expected = Number((brazilianNumber(initial) * Math.pow(1 + brazilianNumber(rate) / 100, Number(months))).toFixed(2))
  const matches = question.alternatives.filter((alternative) => {
    const amount = alternative.text.match(/R\$\s*([\d.]+,\d{2})/i)?.[1]
    return amount !== undefined && Math.abs(brazilianNumber(amount) - expected) < 0.011
  })
  if (matches.length !== 1) return { questionNumbers: [question.number], severity: 'bloqueante', reason: `Juros compostos/P.G.: o saldo calculado é R$ ${expected.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}; a prova não oferece exatamente uma alternativa correspondente.` }
  if (question.correctLetter !== matches[0].letter) return { questionNumbers: [question.number], severity: 'bloqueante', reason: `Juros compostos/P.G.: o saldo calculado é R$ ${expected.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, na alternativa ${matches[0].letter}, mas o gabarito declarado é ${question.correctLetter ?? 'ausente'}.` }
  return null
}

/** Regras locais baratas; não substituem a revisão semântica da IA. */
export function deterministicQuestionQualityIssues(questions: ExamQuestion[]): ExamQualityIssue[] {
  const issues: ExamQualityIssue[] = []
  for (const question of questions) {
    if (question.type !== 'objetiva' || !question.alternatives) continue
    const seen = new Map<string, string>()
    for (const alternative of question.alternatives) {
      const prior = seen.get(normalized(alternative.text))
      if (prior) issues.push({ questionNumbers: [question.number], severity: 'bloqueante', reason: `Alternativas ${prior} e ${alternative.letter} têm o mesmo conteúdo.` })
      else seen.set(normalized(alternative.text), alternative.letter)
    }
    const interest = compoundInterestIssue(question)
    if (interest) issues.push(interest)
  }
  return issues
}

function card(question: ExamQuestion) {
  const alternatives = question.alternatives?.map((alternative) => `${alternative.letter}) ${alternative.text}`).join('\n') ?? '(questão descritiva)'
  const solutionBlueprint = question.solutionBlueprint
  const blueprint = solutionBlueprint
    ? `\nFICHA TÉCNICA INTERNA (confira o cálculo; não a trate como prova por si só): domínio ${solutionBlueprint.domain}; equações ${solutionBlueprint.equations.join(' | ') || '(não se aplica)'}; valores ${JSON.stringify(solutionBlueprint.values)}; resposta derivada ${solutionBlueprint.derivedAnswer}.`
    : ''
  return `QUESTÃO ${question.number}\nTipo: ${question.type}\nGabarito declarado: ${question.correctLetter ?? question.expectedAnswer ?? '(não se aplica)'}\nEnunciado: ${question.statement}\n${question.supportText ? `Apoio: ${question.supportText}\n` : ''}Alternativas:\n${alternatives}${blueprint}`
}

function auditConsistencyIssues(question: ExamQuestion, result: z.infer<typeof qualitySchema>): ExamQualityIssue[] {
  const issues: ExamQualityIssue[] = []
  const blocking = (reason: string) => issues.push({ questionNumbers: [question.number], severity: 'bloqueante', reason })
  const rejectedChecks = result.checks.filter((check) => check.status === 'reprovado')

  for (const check of rejectedChecks) {
    blocking(`Teste de qualidade — ${check.criterion}: ${check.evidence}`)
  }
  if (!result.approved && !rejectedChecks.length && !result.issues.some((issue) => issue.severity === 'bloqueante')) {
    blocking(`Teste de qualidade reprovou a questão: ${result.verdictReason}`)
  }

  if (question.type !== 'objetiva') return issues

  const answerKeyChecks = result.checks.filter((check) => check.criterion === 'gabarito')
  if (answerKeyChecks.length !== 1 || answerKeyChecks[0]?.status !== 'aprovado') {
    blocking('Teste de qualidade não confirmou o gabarito como correto e único.')
  }
  const audit = result.answerKeyAudit
  if (!audit) {
    blocking('Teste de qualidade não apresentou a conferência independente do gabarito.')
  } else if (
    audit.declaredLetter !== question.correctLetter ||
    audit.independentlyDerivedLetter !== question.correctLetter ||
    !audit.matchesDeclared
  ) {
    blocking(`Conferência independente do gabarito diverge: declarado ${question.correctLetter ?? 'ausente'}, calculado ${audit.independentlyDerivedLetter ?? 'sem alternativa única'}. ${audit.evidence}`)
  }
  return issues
}

/**
 * Gate semântico independente do gerador. Ele recalcula mentalmente a
 * resposta e só reprova por evidência concreta, para evitar que uma crítica
 * especulativa da IA interrompa uma prova válida.
 */
export async function runQuestionQualityTest(curriculum: CurriculumSelection, questions: ExamQuestion[]) {
  const deterministic = deterministicQuestionQualityIssues(questions)
  const subjectRule = /^(matemática|matematica)$/i.test(curriculum.subject.trim())
    ? 'MATEMÁTICA: refaça o cálculo passo a passo, compare o resultado numérico com TODAS as alternativas e só então confira o gabarito.'
    : /^(língua portuguesa|lingua portuguesa|português|portugues)$/i.test(curriculum.subject.trim())
      ? 'LÍNGUA PORTUGUESA: em questões de som, ortografia ou gramática, avalie cada palavra/alternativa individualmente; duas respostas defensáveis tornam a questão bloqueante.'
      : 'Confira conceito, dados, gabarito e se existe somente uma resposta defensável.'
  const reports: Array<z.infer<typeof qualitySchema>> = []
  const warnings: string[] = []
  for (const question of questions) {
    const prompt = `Você executa o TESTE DE QUALIDADE de UMA questão escolar. Não reescreva a questão e não mostre raciocínio interno.

Contexto: ${curriculum.subject}, ${curriculum.gradeYear}º ano, ${curriculum.segment}. ${subjectRule}

    Produza uma JUSTIFICATIVA VERIFICÁVEL, não um raciocínio interno livre: informe um veredito curto e os critérios gabarito, unicidade, cálculo_ou_dados, linguagem e alinhamento. Cada critério deve trazer status e evidência objetiva; quando não se aplicar, use não_aplicável e explique brevemente. Decida UMA única vez: approved:true somente quando não houver falha; approved:false somente quando existir pelo menos um item bloqueante. Nunca use alerta para afirmar que a questão está errada. Todo bloqueio precisa citar o dado, cálculo ou alternativa específica que prova o erro.

    PARA QUESTÃO OBJETIVA, answerKeyAudit É OBRIGATÓRIO: primeiro determine independentemente a letra correta a partir do enunciado e das alternativas; depois compare-a com o "Gabarito declarado". Preencha declaredLetter, independentlyDerivedLetter, matchesDeclared e uma evidência curta. Se as letras diferirem, matchesDeclared deve ser false, o critério gabarito deve ser reprovado e approved deve ser false. Não aprove uma questão cujo texto de evidência indique discrepância no gabarito.

    QUESTÕES DISCURSIVAS: expectedAnswer e gradingCriteria podem ser nulos nesta fase porque a aprovação humana confere a resposta esperada. Isso NÃO é falha nem bloqueio. Só reprove se o próprio enunciado for impossível, ambíguo ou não permitir uma correção pedagógica.

${card(question)}`
    try {
      const audited = await generateValidatedStructuredContent({
        context: `exams/question-quality-test-${question.number}`, prompt, responseSchema: QUALITY_RESPONSE_SCHEMA, zodSchema: qualitySchema, maxAttempts: 2,
        // A consistência entre veredito, critérios e issues é normalizada
        // abaixo. Não transformamos uma contradição textual da auditoria em
        // falha da geração da prova.
        validate: (value) => ({ value: { ...value, questionNumber: question.number }, issues: [] }),
      })
      reports.push(audited.value)
      warnings.push(...audited.warnings)
    } catch (error) {
      const detail = error instanceof StructuredGenerationError ? error.issues.join(' ') : 'falha operacional inesperada'
      warnings.push(`Questão ${question.number}: teste de qualidade não pôde concluir a auditoria (${detail}). A prova segue para revisão humana.`)
      reports.push({
        questionNumber: question.number,
        approved: true,
        verdictReason: 'O teste automático não concluiu esta análise; a questão foi encaminhada para revisão humana.',
        checks: [],
        issues: [{ severity: 'alerta', reason: 'Auditoria automática indisponível nesta tentativa; revisar manualmente antes da aprovação.' }],
      })
    }
  }
  const semantic: ExamQualityIssue[] = reports.flatMap((result) => {
    const question = questions.find((candidate) => candidate.number === result.questionNumber)
    const declared = result.issues.map((issue) => ({ questionNumbers: [result.questionNumber], severity: issue.severity, reason: `Teste de qualidade: ${issue.reason}` } satisfies ExamQualityIssue))
    return question ? [...declared, ...auditConsistencyIssues(question, result)] : declared
  })
  const rejected = [...new Set([...deterministic, ...semantic].filter((issue) => issue.severity === 'bloqueante').flatMap((issue) => issue.questionNumbers))]
  const report = questions.map((question) => {
    const semanticResult = reports.find((result) => result.questionNumber === question.number)
    const localIssues = deterministic.filter((issue) => issue.questionNumbers.includes(question.number)).map((issue) => ({ severity: issue.severity, reason: issue.reason }))
    const semanticIssues = semantic.filter((issue) => issue.questionNumbers.includes(question.number)).map((issue) => ({ severity: issue.severity, reason: issue.reason }))
    return {
      questionNumber: question.number,
      approved: ![...localIssues, ...semanticIssues].some((issue) => issue.severity === 'bloqueante'),
      verdictReason: semanticResult?.verdictReason,
      checks: semanticResult?.checks,
      issues: [...localIssues, ...semanticIssues],
    }
  })
  return { issues: [...deterministic, ...semantic], warnings, rejected, checked: questions.map((question) => question.number), report }
}

/**
 * Última barreira antes de gerar os documentos. Não basta o cartão visual
 * dizer "Aprovada": cada objetiva precisa ter uma auditoria independente
 * confirmando a mesma letra do gabarito.
 */
export function qualityApprovalBlocks(payload: ExamGenerationResult): string[] {
  const reports = payload.metadata.qualityTest?.reports
  const latest = reports?.at(-1)?.results
  if (!latest) return ['O teste de qualidade não possui relatório final; regenere ou execute a auditoria antes de aprovar.']

  const blocks: string[] = []
  for (const question of payload.questions) {
    const result = latest.find((candidate) => candidate.questionNumber === question.number)
    if (!result) {
      blocks.push(`Questão ${question.number}: ausente do relatório final de qualidade.`)
      continue
    }
    if (!result.approved || result.issues.some((issue) => issue.severity === 'bloqueante') || result.checks?.some((check) => check.status === 'reprovado')) {
      blocks.push(`Questão ${question.number}: o relatório de qualidade a reprovou.`)
    }
    if (question.type === 'objetiva') {
      const audit = result.answerKeyAudit
      const answerKeyCheck = result.checks?.filter((check) => check.criterion === 'gabarito') ?? []
      if (answerKeyCheck.length !== 1 || answerKeyCheck[0]?.status !== 'aprovado') {
        blocks.push(`Questão ${question.number}: o relatório não aprovou explicitamente o gabarito.`)
      }
      if (!audit || audit.declaredLetter !== question.correctLetter || audit.independentlyDerivedLetter !== question.correctLetter || !audit.matchesDeclared) {
        blocks.push(`Questão ${question.number}: falta confirmação independente de que o gabarito (${question.correctLetter ?? 'ausente'}) é a alternativa correta.`)
      }
    }
  }
  return [...new Set(blocks)]
}
