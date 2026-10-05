import { evaluateWithJev, type JevAnswers, type JevQuestions } from './jevClient'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { ALTERNATIVE_COMPLETE, ALTERNATIVE_EXPOSES_WORK, ALTERNATIVE_FINAL_ONLY, ALTERNATIVE_FORMAT_OUTLIER, ALTERNATIVE_FORMAT_STANDARD, ALTERNATIVE_INCOMPLETE, MULTIPLE_CORRECT_ALTERNATIVES, NO_CORRECT_ALTERNATIVE, OBJECTIVE_ANSWER_ONLY, OBJECTIVE_ASKS_WORK } from './questionQualityContract'

export { MULTIPLE_CORRECT_ALTERNATIVES, NO_CORRECT_ALTERNATIVE } from './questionQualityContract'

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
 * Se o Jev estiver indisponível, devolvemos `available:false`; sem o parecer
 * exclusivo do Jev, a questão permanece sem aprovação.
 */

export const QUESTION_QUALITY_VERSION = '2026-10-05.v5'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 15_000
const COMPOSITE_WARNING_BLOCK = 3

export const QUALITY_CRITERIA_IDS = [
  'alinhamento_bncc',
  'resposta_substantiva',
  'resposta_exposta_enunciado',
  'informacao_suficiente',
  'calculo_ou_dados',
  'copia_escopo_curricular',
  'apoio_autossuficiente',
  'alternativas_homogeneas',
  'alternativa_formato_outlier',
  'alternativa_completa',
  'objetiva_exige_desenvolvimento',
  'resposta_unica',
  'fatos_corretos',
  'enunciado_coerente',
  'correcao_objetiva',
] as const
export type QualityCriterionId = (typeof QUALITY_CRITERIA_IDS)[number]

type QuestionKind = ExamQuestion['type']

type CriterionSpec = {
  id: QualityCriterionId
  /** Só é perguntado quando a questão declara uma habilidade BNCC com descrição. */
  requiresSkill?: boolean
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
    id: 'alinhamento_bncc', requiresSkill: true, applies: ['objetiva', 'descritiva'], polarity: 'good', block: 0.3, warn: 0.6,
    instructions: 'A questão exige do aluno a operação cognitiva descrita na habilidadeBncc (o verbo e o objeto de conhecimento dela), e não apenas recordar um fato isolado do assunto?',
    message: 'A questão não mede a habilidade BNCC declarada: exige só memorizar um fato ou trata de outro objeto de conhecimento. Reescreva para exigir a operação cognitiva do verbo da habilidade.',
  },
  {
    id: 'resposta_substantiva', applies: ['objetiva', 'descritiva'], polarity: 'good', block: 0.4, warn: 0.7,
    instructions: 'A resposta correta (a alternativa indicada como correta, ou a respostaEsperada nas discursivas) responde de fato ao que o enunciado pergunta, com conteúdo próprio da disciplina, e NÃO se limita a repetir o título de um capítulo, um tópico do escopo curricular ou as palavras da própria pergunta?',
    message: 'A resposta correta não responde de fato à pergunta: repete um título/tópico do currículo ou os termos do próprio enunciado. Escreva uma resposta com conteúdo da disciplina.',
  },
  {
    id: 'resposta_exposta_enunciado', applies: ['objetiva', 'descritiva'], polarity: 'defect', block: 0.75, warn: 0.4,
    instructions: 'O próprio enunciado entrega, repete ou torna explícita a resposta que o aluno deveria produzir, mesmo sem usar o texto de apoio ou raciocinar sobre as alternativas?',
    message: 'O enunciado entrega a resposta. Reescreva somente o comando da questão, preservando conteúdo, dados, texto de apoio e gabarito.',
  },
  {
    id: 'informacao_suficiente', applies: ['objetiva', 'descritiva'], polarity: 'good', block: 0.4, warn: 0.7,
    instructions: 'O enunciado e o texto de apoio, em conjunto, fornecem todas as informações necessárias para responder sem adivinhar dados, contexto ou referência ausente?',
    message: 'Faltam informações para responder. Acrescente um texto de apoio autocontido e ajuste somente o enunciado para usá-lo.',
  },
  {
    id: 'calculo_ou_dados', applies: ['objetiva', 'descritiva'], polarity: 'good', block: 0.4, warn: 0.7,
    instructions: 'Resolva a questão de forma independente com os dados apresentados. O raciocínio, o resultado solicitado, a resposta esperada e pelo menos uma alternativa correspondem ao mesmo problema? Confira também as evidências de recálculo anexadas, sem aceitá-las sem verificar.',
    message: 'O cálculo, os dados do enunciado e a resposta não correspondem entre si. Corrija a parte apontada mantendo o tema e os dados válidos da planilha escolar.',
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
  /** Habilidades BNCC declaradas pela questão (código + descrição oficial). */
  skills?: Array<{ code: string; description: string }>
  subject: string
  gradeYear: number
  segment: string
  question: QualityJudgeQuestion
  /** Escopo curricular (títulos e tópicos do capítulo), para detectar cópia. */
  curriculumScope: string
  /** Conferências determinísticas anexadas como evidência; somente o Jev decide se reprovam. */
  verificationEvidence?: string[]
}

export type QualityJudgeIssue = {
  severity: 'bloqueante' | 'alerta'
  criterion: QualityCriterionId | 'alternativa_exibe_calculo' | 'composto' | 'gabarito' | 'indisponivel'
  reason: string
  score?: number
  alternativeLetter?: string
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
  alternativeOutlier: { letter: string; confidence: number | null } | null
  issues: QualityJudgeIssue[]
  blocked: boolean
}

const ANSWER_KEY_MIN_CONFIDENCE = 0.6

export function criteriaForType(type: QuestionKind, hasSkill = true): CriterionSpec[] {
  return QUALITY_CRITERIA.filter((criterion) => criterion.applies.includes(type) && (hasSkill || !criterion.requiresSkill))
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
export function evaluateQualityAnswers(question: Pick<QualityJudgeQuestion, 'type' | 'correctLetter'> & Partial<Pick<QualityJudgeQuestion, 'alternatives'>>, answers: JevAnswers): Pick<QualityJudgeVerdict, 'scores' | 'answerKey' | 'alternativeOutlier' | 'issues' | 'blocked'> {
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
  let alternativeOutlier: QualityJudgeVerdict['alternativeOutlier'] = null
  if (question.type === 'objetiva') {
    const asksWork = answers.objetiva_comando_resposta
    if (asksWork?.type === 'choice') {
      if (asksWork.choice === OBJECTIVE_ASKS_WORK) {
        issues.push({
          severity: 'bloqueante', criterion: 'objetiva_exige_desenvolvimento',
          reason: 'Jev identificou que o enunciado objetivo pede mostrar cálculos, fórmulas usadas ou justificar a resolução. Em múltipla escolha, peça apenas o resultado ou os demais produtos finais solicitados.',
        })
      } else if (asksWork.choice !== OBJECTIVE_ANSWER_ONLY) {
        issues.push({ severity: 'bloqueante', criterion: 'indisponivel', reason: 'O Jev não retornou uma decisão válida sobre o comando da questão objetiva; ela não pode ser aprovada sem essa conferência.' })
      }
    }
    for (const alternative of question.alternatives ?? []) {
      const letter = alternative.letter.toUpperCase()
      const completeness = answers[`completude_alternativa_${letter}`]
      if (completeness?.type === 'choice') {
        if (completeness.choice === ALTERNATIVE_INCOMPLETE) {
          issues.push({
            severity: 'bloqueante', criterion: 'alternativa_completa', alternativeLetter: letter,
            reason: `Jev identificou que a alternativa ${letter} não responde a todos os itens pedidos. Reescreva somente essa opção para cobrir cada item do enunciado, na mesma ordem e no padrão das demais.`,
          })
        } else if (completeness.choice !== ALTERNATIVE_COMPLETE) {
          issues.push({ severity: 'bloqueante', criterion: 'indisponivel', alternativeLetter: letter, reason: `O Jev não retornou uma decisão válida sobre a completude da alternativa ${letter}; ela não pode ser aprovada sem essa conferência.` })
        }
      }
      const format = answers[`formato_alternativa_${letter}`]
      if (format?.type === 'choice') {
        if (format.choice === ALTERNATIVE_FORMAT_OUTLIER) {
          issues.push({
            severity: 'bloqueante', criterion: 'alternativa_formato_outlier', alternativeLetter: letter,
            reason: `Jev identificou que a alternativa ${letter} destoa em estrutura, componentes, unidades, notação ou nível de detalhe e pode denunciar o gabarito. Reescreva somente essa opção para igualar o padrão das demais.`,
          })
          const confidence = format.confidence ?? format.probabilities?.[ALTERNATIVE_FORMAT_OUTLIER] ?? null
          alternativeOutlier ??= { letter, confidence }
        } else if (format.choice !== ALTERNATIVE_FORMAT_STANDARD) {
          issues.push({ severity: 'bloqueante', criterion: 'indisponivel', alternativeLetter: letter, reason: `O Jev não retornou uma decisão válida sobre o padrão visual da alternativa ${letter}; ela não pode ser aprovada sem essa conferência.` })
        }
      }
      const calculation = answers[`calculo_na_alternativa_${letter}`]
      if (calculation?.type === 'choice') {
        if (calculation.choice === ALTERNATIVE_EXPOSES_WORK) {
          issues.push({
            severity: 'bloqueante', criterion: 'alternativa_exibe_calculo', alternativeLetter: letter,
            reason: `Jev identificou fórmula utilizada, conta armada, etapas ou justificativa de cálculo na alternativa ${letter}. Reescreva somente essa opção com a resposta final pedida, preservando fórmulas que sejam o próprio resultado solicitado e as interpretações conceituais pedidas.`,
          })
        } else if (calculation.choice !== ALTERNATIVE_FINAL_ONLY) {
          issues.push({ severity: 'bloqueante', criterion: 'indisponivel', alternativeLetter: letter, reason: `O Jev não retornou uma decisão válida sobre a exposição do cálculo na alternativa ${letter}; ela não pode ser aprovada sem essa conferência.` })
        }
      }
    }
    const key = answers.gabarito_independente
    if (key?.type === 'choice') {
      const confidence = key.confidence ?? key.probabilities?.[key.choice] ?? null
      const matches = key.choice === question.correctLetter
      answerKey = { declaredLetter: question.correctLetter ?? null, independentLetter: key.choice, confidence, matches }
      if (!matches) {
        issues.push({
          severity: 'bloqueante',
          criterion: 'gabarito',
          reason: key.choice === NO_CORRECT_ALTERNATIVE
            ? 'A conferência independente concluiu que nenhuma alternativa responde corretamente ao enunciado.'
            : key.choice === MULTIPLE_CORRECT_ALTERNATIVES
              ? 'A conferência independente concluiu que mais de uma alternativa pode responder corretamente ao enunciado.'
              : `Conferência independente do gabarito diverge: declarado ${question.correctLetter ?? 'ausente'}, calculado ${key.choice}${confidence !== null ? ` (confiança ${Math.round(confidence * 100)}%)` : ''}.`,
          score: confidence ?? undefined,
        })
      } else if (confidence !== null && confidence < ANSWER_KEY_MIN_CONFIDENCE) {
        issues.push({ severity: 'alerta', criterion: 'gabarito', reason: `A conferência independente confirmou a letra ${key.choice}, mas com confiança baixa (${Math.round(confidence * 100)}%).`, score: confidence })
      }
    }
  }

  return { scores, answerKey, alternativeOutlier, issues, blocked: issues.some((issue) => issue.severity === 'bloqueante') }
}

function buildState(input: QualityJudgeInput) {
  const { question } = input
  return {
    disciplina: input.subject,
    serie: `${input.gradeYear}º ano (${input.segment})`,
    tipo: question.type,
    escopoCurricular: input.curriculumScope.slice(0, 1500),
    ...(input.skills?.length ? { habilidadeBncc: input.skills.map((skill) => ({ codigo: skill.code, descricao: skill.description })) } : {}),
    enunciado: question.statement,
    textoDeApoio: question.supportText?.trim() || null,
    alternativas: (question.alternatives ?? []).map((alternative) => ({ letra: alternative.letter, texto: alternative.text })),
    respostaEsperada: question.expectedAnswer ?? null,
    criteriosDeCorrecao: question.gradingCriteria ?? null,
    ...(input.verificationEvidence?.length
      ? { evidenciasDeConferencia: input.verificationEvidence.slice(0, 12) }
      : {}),
  }
}

function buildQuestions(input: QualityJudgeInput): JevQuestions {
  const questions: JevQuestions = {}
  const evidenceInstruction = input.verificationEvidence?.length
    ? ' Confira também evidenciasDeConferencia no estado. São alertas preliminares do sistema: verifique cada um contra o enunciado, apoio, alternativas e escopo, e decida por conta própria se há um defeito real.'
    : ''
  for (const spec of criteriaForType(input.question.type, Boolean(input.skills?.length))) {
    questions[spec.id] = { type: 'noul', instructions: `${spec.instructions}${evidenceInstruction}` }
  }
  if (input.question.type === 'objetiva') {
    const isMathSubject = /matemática|matematica|física|fisica|química|quimica/i.test(input.subject)
    if (isMathSubject) {
      questions.objetiva_comando_resposta = {
        type: 'choice',
        instructions: `A questão é objetiva de ${input.subject}. O enunciado pede apenas a resposta final que o aluno deve selecionar, ou pede que ele mostre fórmulas usadas, desenvolva contas ou justifique a resolução? Se pede desenvolvimento/justificativa de cálculo, escolha a opção correspondente. Se pede expressão algébrica como resultado final, isso NÃO conta como pedir para mostrar o cálculo. Enunciado: ${input.question.statement}`,
        criteria: {
          [OBJECTIVE_ANSWER_ONLY]: 'Pede o resultado ou produtos finais; o estudante faz os cálculos sem precisar apresentá-los.',
          [OBJECTIVE_ASKS_WORK]: 'Pede apresentar cálculos, mostrar fórmula usada, desenvolver passos ou justificar como chegou ao resultado.',
        },
      }
    }
    for (const alternative of input.question.alternatives ?? []) {
      const letter = alternative.letter.toUpperCase()
      questions[`completude_alternativa_${letter}`] = {
        type: 'choice',
        instructions: `Avalie somente se a alternativa ${letter} responde a TODOS os itens solicitados no enunciado e contém os componentes necessários, na ordem. Um distrator pode ter resultado errado e ainda cobrir todos os itens; julgue completude, não correção. Escolha exatamente uma opção: completa ou incompleta. Enunciado: ${input.question.statement}. Alternativa: ${alternative.text}`,
        criteria: {
          [ALTERNATIVE_COMPLETE]: 'Responde a todos os itens pedidos e apresenta cada componente necessário.',
          [ALTERNATIVE_INCOMPLETE]: 'Omite um ou mais itens pedidos; por exemplo, apresenta apenas um número quando a pergunta exige também comparação, interpretação ou conclusão.',
        },
      }
      questions[`formato_alternativa_${letter}`] = {
        type: 'choice',
        instructions: `Compare a alternativa ${letter} com todas as demais. Ela destoa claramente em estrutura, componentes, unidades, notação ou nível de detalhe, de modo que um aluno possa suspeitar do gabarito pela apresentação? Não marque diferenças pequenas. Escolha exatamente uma opção: segue o padrão ou destoa do padrão. Enunciado: ${input.question.statement}. Alternativa avaliada: ${alternative.text}. Demais alternativas: ${JSON.stringify((input.question.alternatives ?? []).filter((item) => item.letter !== alternative.letter))}`,
        criteria: {
          [ALTERNATIVE_FORMAT_STANDARD]: 'A alternativa segue o padrão e não denuncia o gabarito pela apresentação.',
          [ALTERNATIVE_FORMAT_OUTLIER]: 'A alternativa destoa claramente e pode denunciar o gabarito pela apresentação.',
        },
      }
      if (isMathSubject) {
        questions[`calculo_na_alternativa_${letter}`] = {
          type: 'choice',
          instructions: `A alternativa ${letter} apresenta somente os resultados finais necessários, ou revela como fazer a conta por fórmula utilizada, conta armada, passos algébricos ou justificativa do cálculo? A questão não pede ao estudante que apresente o desenvolvimento. Não classifique como desenvolvimento uma expressão algébrica que seja, ela própria, o produto final solicitado; também preserve uma interpretação conceitual pedida, desde que não revele as contas. Enunciado: ${input.question.statement}. Alternativa: ${alternative.text}`,
          criteria: {
            [ALTERNATIVE_FINAL_ONLY]: 'Traz apenas os resultados finais e outros produtos conceituais pedidos, sem revelar a resolução numérica.',
            [ALTERNATIVE_EXPOSES_WORK]: 'Expõe fórmula de resolução, conta armada, etapas de cálculo ou justificativa numérica que o estudante deveria produzir.',
          },
        }
      }
    }
    questions.gabarito_independente = {
      type: 'choice',
      instructions: `Com base no enunciado, texto de apoio e conhecimentos esperados para a série, qual alternativa é correta? Resolva por conta própria e ignore qualquer gabarito indicado. ${evidenceInstruction}`,
      criteria: {
        ...Object.fromEntries((input.question.alternatives ?? []).map((alternative) => [alternative.letter, alternative.text])),
        [NO_CORRECT_ALTERNATIVE]: 'Nenhuma alternativa apresentada responde corretamente.',
        [MULTIPLE_CORRECT_ALTERNATIVES]: 'Mais de uma alternativa apresentada pode ser considerada correta.',
      },
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
      alternativeOutlier: null,
      blocked: false,
      issues: [{ severity: 'alerta', criterion: 'indisponivel', reason: 'O juiz de qualidade (Jev) não respondeu; sem o parecer exclusivo dele, a questão permanece sem aprovação.' }],
    }
  }
  return { available: true, source: result.source, ...evaluateQualityAnswers(input.question, result.answers) }
}
