import { evaluateWithJev, type JevAnswers, type JevQuestions } from './jevClient'
import type { ExamQuestion } from '@/lib/gemini/examSchema'

/**
 * Juiz de qualidade de questões, decidido pelo Jev (TypeSafe) — não por LLM.
 *
 * O Jev devolve probabilidades (Noul) e escolhas (Choice) tipadas; o código
 * decide o que bloqueia. Os limiares abaixo foram calibrados em 02/10/2026
 * contra a prova #391 (10 questões com texto da planilha vazando para
 * alternativas, gabaritos e textos de apoio) e contra 10 questões-controle
 * boas de 6 disciplinas: todas as 10 ruins foram barradas e nenhuma boa foi
 * barrada. Ver `docs/GESTAO_QUALIDADE_QUESTOES_JEV.md`.
 *
 * Falha aberta e explícita: se o Jev estiver indisponível, devolvemos
 * `available:false` com um alerta; os gates determinísticos continuam valendo
 * e a aprovação final exige a conferência independente do gabarito.
 */

export const QUESTION_QUALITY_VERSION = '2026-10-02.v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 15_000
const COMPOSITE_WARNING_BLOCK = 3

export const QUALITY_CRITERIA_IDS = [
  'resposta_substantiva',
  'copia_escopo_curricular',
  'apoio_autossuficiente',
  'alternativas_homogeneas',
  'resposta_unica',
  'fatos_corretos',
  'enunciado_coerente',
  'correcao_objetiva',
] as const
export type QualityCriterionId = (typeof QUALITY_CRITERIA_IDS)[number]

type QuestionKind = ExamQuestion['type']

type CriterionSpec = {
  id: QualityCriterionId
  applies: readonly QuestionKind[]
  /** `good`: probabilidade alta = qualidade. `defect`: probabilidade alta = defeito. */
  polarity: 'good' | 'defect'
  /** `good` bloqueia abaixo deste valor; `defect` bloqueia a partir dele. `null` nunca bloqueia sozinho. */
  block: number | null
  /** `good` alerta abaixo deste valor; `defect` alerta a partir dele. */
  warn: number
  instructions: string
  message: string
}

export const QUALITY_CRITERIA: readonly CriterionSpec[] = [
  {
    id: 'resposta_substantiva', applies: ['objetiva', 'descritiva'], polarity: 'good', block: 0.4, warn: 0.7,
    instructions: 'A resposta correta (a alternativa indicada como correta, ou a respostaEsperada nas discursivas) responde de fato ao que o enunciado pergunta, com conteúdo próprio da disciplina, e NÃO se limita a repetir o título de um capítulo, um tópico do escopo curricular ou as palavras da própria pergunta?',
    message: 'A resposta correta não responde de fato à pergunta: repete um título/tópico do currículo ou os termos do próprio enunciado. Escreva uma resposta com conteúdo da disciplina.',
  },
  {
    id: 'copia_escopo_curricular', applies: ['objetiva', 'descritiva'], polarity: 'defect', block: 0.75, warn: 0.4,
    instructions: 'Alguma alternativa, a respostaEsperada ou o textoDeApoio reproduz quase literalmente um título, rótulo ou tópico do escopoCurricular (por exemplo: uma alternativa que repete um tópico do escopo, que começa com "O estudo de", ou um texto de apoio que abre com a numeração e o título do capítulo)?',
    message: 'Há texto copiado do escopo curricular (título, tópico ou numeração de capítulo) em alternativa, resposta esperada ou texto de apoio. O currículo indica apenas o assunto: redija tudo do zero para o aluno.',
  },
  {
    id: 'apoio_autossuficiente', applies: ['objetiva', 'descritiva'], polarity: 'good', block: 0.4, warn: 0.7,
    instructions: 'O texto de apoio é um texto, dado ou situação completo e autossuficiente que o aluno consegue ler e usar para responder, e NÃO um título, rótulo, número de capítulo ou lista de tópicos? (Se não há texto de apoio e a questão não precisa dele, a resposta é verdadeira.)',
    message: 'O texto de apoio não é um texto ou dado completo e autossuficiente (parece título, rótulo ou lista de tópicos).',
  },
  {
    id: 'alternativas_homogeneas', applies: ['objetiva'], polarity: 'good', block: 0.3, warn: 0.55,
    instructions: 'A alternativa correta tem formato, extensão e grau de especificidade semelhantes aos dos distratores, de modo que um aluno não a identifique só pela forma (a única longa, a única que repete termos do enunciado, do escopo curricular ou de rótulos)?',
    message: 'A alternativa correta se destaca pela forma (mais longa ou elaborada, ou repete termos do enunciado/currículo). Padronize formato e extensão de todas as alternativas.',
  },
  {
    id: 'resposta_unica', applies: ['objetiva'], polarity: 'good', block: 0.45, warn: 0.65,
    instructions: 'Apenas a alternativa indicada como correta é defensável para a pergunta feita, e as demais são claramente incorretas?',
    message: 'Mais de uma alternativa é defensável, ou a alternativa marcada não é claramente a única correta.',
  },
  {
    id: 'fatos_corretos', applies: ['objetiva', 'descritiva'], polarity: 'good', block: 0.4, warn: 0.7,
    instructions: 'As afirmações científicas ou factuais da questão, do gabarito e da resposta esperada estão corretas para o ano escolar indicado?',
    message: 'Há afirmação factual incorreta ou inadequada à série no enunciado, no gabarito ou na resposta esperada.',
  },
  {
    id: 'enunciado_coerente', applies: ['objetiva', 'descritiva'], polarity: 'good', block: null, warn: 0.6,
    instructions: 'O enunciado é claro, coerente com o texto de apoio e sem repetir desnecessariamente o texto de apoio nem trazer instruções duplicadas?',
    message: 'O enunciado repete o texto de apoio ou traz instruções duplicadas ou incoerentes.',
  },
  {
    id: 'correcao_objetiva', applies: ['descritiva'], polarity: 'good', block: 0.4, warn: 0.7,
    instructions: 'A respostaEsperada realmente responde ao enunciado e os critérios de correção descrevem o que pontuar, de modo que um professor corrija respostas de forma objetiva e consistente?',
    message: 'A resposta esperada não responde ao enunciado, ou os critérios não permitem uma correção objetiva.',
  },
]

export type QualityJudgeQuestion = Pick<ExamQuestion, 'type' | 'statement' | 'supportText' | 'alternatives' | 'correctLetter' | 'expectedAnswer' | 'gradingCriteria'>

export type QualityJudgeInput = {
  subject: string
  gradeYear: number
  segment: string
  question: QualityJudgeQuestion
  /** Escopo curricular (títulos e tópicos do capítulo), para detectar cópia. */
  curriculumScope: string
}

export type QualityJudgeIssue = {
  severity: 'bloqueante' | 'alerta'
  criterion: QualityCriterionId | 'composto' | 'gabarito' | 'indisponivel'
  reason: string
  score?: number
}

export type AnswerKeyCheck = {
  declaredLetter: string | null
  independentLetter: string | null
  confidence: number | null
  matches: boolean
}

export type QualityJudgeVerdict = {
  available: boolean
  source: 'provider' | 'cache' | 'fallback'
  scores: Partial<Record<QualityCriterionId, number>>
  answerKey: AnswerKeyCheck | null
  issues: QualityJudgeIssue[]
  blocked: boolean
}

const ANSWER_KEY_MIN_CONFIDENCE = 0.6

export function criteriaForType(type: QuestionKind): CriterionSpec[] {
  return QUALITY_CRITERIA.filter((criterion) => criterion.applies.includes(type))
}

export function criterionSeverity(spec: CriterionSpec, score: number): 'bloqueante' | 'alerta' | null {
  if (spec.polarity === 'good') {
    if (spec.block !== null && score < spec.block) return 'bloqueante'
    return score < spec.warn ? 'alerta' : null
  }
  if (spec.block !== null && score >= spec.block) return 'bloqueante'
  return score >= spec.warn ? 'alerta' : null
}

/** Regra pura: transforma as respostas do Jev em problemas. Testável sem rede. */
export function evaluateQualityAnswers(question: Pick<QualityJudgeQuestion, 'type' | 'correctLetter'>, answers: JevAnswers): Pick<QualityJudgeVerdict, 'scores' | 'answerKey' | 'issues' | 'blocked'> {
  const scores: Partial<Record<QualityCriterionId, number>> = {}
  const issues: QualityJudgeIssue[] = []

  for (const spec of criteriaForType(question.type)) {
    const answer = answers[spec.id]
    if (answer?.type !== 'noul') continue
    scores[spec.id] = answer.noul
    const severity = criterionSeverity(spec, answer.noul)
    if (severity) issues.push({ severity, criterion: spec.id, reason: spec.message, score: answer.noul })
  }

  const warnings = issues.filter((issue) => issue.severity === 'alerta')
  if (warnings.length >= COMPOSITE_WARNING_BLOCK && !issues.some((issue) => issue.severity === 'bloqueante')) {
    issues.push({
      severity: 'bloqueante',
      criterion: 'composto',
      reason: `Vários indícios de baixa qualidade ao mesmo tempo (${warnings.map((issue) => issue.criterion).join(', ')}); a questão deve ser reescrita.`,
    })
  }

  let answerKey: AnswerKeyCheck | null = null
  if (question.type === 'objetiva') {
    const key = answers.gabarito_independente
    if (key?.type === 'choice') {
      const confidence = key.confidence ?? key.probabilities?.[key.choice] ?? null
      const matches = key.choice === question.correctLetter
      answerKey = { declaredLetter: question.correctLetter ?? null, independentLetter: key.choice, confidence, matches }
      if (!matches) {
        issues.push({
          severity: 'bloqueante',
          criterion: 'gabarito',
          reason: `Conferência independente do gabarito diverge: declarado ${question.correctLetter ?? 'ausente'}, calculado ${key.choice}${confidence !== null ? ` (confiança ${Math.round(confidence * 100)}%)` : ''}.`,
          score: confidence ?? undefined,
        })
      } else if (confidence !== null && confidence < ANSWER_KEY_MIN_CONFIDENCE) {
        issues.push({ severity: 'alerta', criterion: 'gabarito', reason: `A conferência independente confirmou a letra ${key.choice}, mas com confiança baixa (${Math.round(confidence * 100)}%).`, score: confidence })
      }
    }
  }

  return { scores, answerKey, issues, blocked: issues.some((issue) => issue.severity === 'bloqueante') }
}

function buildState(input: QualityJudgeInput) {
  const { question } = input
  return {
    disciplina: input.subject,
    serie: `${input.gradeYear}º ano (${input.segment})`,
    tipo: question.type,
    escopoCurricular: input.curriculumScope.slice(0, 1500),
    enunciado: question.statement,
    textoDeApoio: question.supportText?.trim() || null,
    alternativas: (question.alternatives ?? []).map((alternative) => ({ letra: alternative.letter, texto: alternative.text })),
    alternativaCorreta: question.correctLetter ?? null,
    respostaEsperada: question.expectedAnswer ?? null,
    criteriosDeCorrecao: question.gradingCriteria ?? null,
  }
}

function buildQuestions(input: QualityJudgeInput): JevQuestions {
  const questions: JevQuestions = {}
  for (const spec of criteriaForType(input.question.type)) questions[spec.id] = { type: 'noul', instructions: spec.instructions }
  if (input.question.type === 'objetiva' && input.question.alternatives?.length) {
    questions.gabarito_independente = {
      type: 'choice',
      instructions: 'Com base apenas no enunciado, no texto de apoio e nos conhecimentos esperados para a série, qual alternativa é a correta? Resolva por conta própria; ignore qualquer alternativaCorreta sugerida.',
      criteria: Object.fromEntries(input.question.alternatives.map((alternative) => [alternative.letter, alternative.text])),
    }
  }
  return questions
}

export async function judgeQuestionQuality(
  input: QualityJudgeInput,
  options: { evaluate?: typeof evaluateWithJev } = {},
): Promise<QualityJudgeVerdict> {
  const evaluate = options.evaluate ?? evaluateWithJev
  const questions = buildQuestions(input)
  const call = () => evaluate({
    operation: 'jev/exams/question-quality',
    questionVersion: QUESTION_QUALITY_VERSION,
    state: buildState(input),
    questions,
    route: (answers) => {
      const evaluated = evaluateQualityAnswers(input.question, answers)
      if (evaluated.blocked) return { route: 'review', outcome: 'question_quality_blocked' }
      return evaluated.issues.length ? { route: 'review', outcome: 'question_quality_warning' } : { route: 'automatic', outcome: 'question_quality_ok' }
    },
    fallback: { answers: {}, routing: { route: 'fallback', outcome: 'question_quality_unavailable' } },
    context: { feature: 'question_quality', subject: input.subject, gradeYear: input.gradeYear, questionType: input.question.type },
    cacheTtlMs: CACHE_TTL_MS,
    timeoutMs: TIMEOUT_MS,
  })

  let result = await call()
  // Uma segunda tentativa cobre falha transitória (timeout/rede). Sem chave
  // configurada o resultado é determinístico, então não repetimos.
  if (result.source === 'fallback' && process.env.TYPESAFE_API_KEY) result = await call()

  if (result.source === 'fallback') {
    return {
      available: false,
      source: 'fallback',
      scores: {},
      answerKey: null,
      blocked: false,
      issues: [{ severity: 'alerta', criterion: 'indisponivel', reason: 'O juiz de qualidade (Jev) não respondeu; a questão passou apenas pelas validações determinísticas e precisa de conferência humana.' }],
    }
  }
  return { available: true, source: result.source, ...evaluateQualityAnswers(input.question, result.answers) }
}
