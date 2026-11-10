import { evaluateWithJev, type JevAnswers, type JevQuestions, type JsonValue } from './jevClient'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { ALTERNATIVE_COMPLETE, ALTERNATIVE_EXPOSES_WORK, ALTERNATIVE_FINAL_ONLY, ALTERNATIVE_FORMAT_OUTLIER, ALTERNATIVE_FORMAT_STANDARD, ALTERNATIVE_HAS_CORRECTION_COMMENT, ALTERNATIVE_INCOMPLETE, ALTERNATIVE_NEUTRAL_TEXT, ALTERNATIVE_REVEALS_ANSWER, MULTIPLE_CORRECT_ALTERNATIVES, NO_CORRECT_ALTERNATIVE, OBJECTIVE_ANSWER_ONLY, OBJECTIVE_ASKS_WORK } from './questionQualityContract'

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

export const QUESTION_QUALITY_VERSION = '2026-10-07.v15'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 15_000
const COMPOSITE_WARNING_BLOCK = 3

export const QUALITY_CRITERIA_IDS = [
  'linguagem_turma',
  'adequacao_turma',
  'resposta_substantiva',
  'resposta_exposta_enunciado',
  'resposta_induzida',
  'informacao_suficiente',
  'copia_escopo_curricular',
  'apoio_autossuficiente',
  'resposta_copiavel_apoio',
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
export type QuestionQualityAuditMode = 'full' | 'answers'

const INSUFFICIENT_ANSWER_INFORMATION = '__informacao_insuficiente__'

function questionNeedsVisualReview(question: Pick<QualityJudgeQuestion, 'needsImage' | 'image'> & Partial<Pick<QualityJudgeQuestion, 'statement' | 'supportText'>>): boolean {
  const text = `${question.statement ?? ''}\n${question.supportText ?? ''}`.toLocaleLowerCase('pt-BR')
  const refersToMissingVisual = !question.image && /(?:figura|imagem|foto|gr[aá]fico|mapa|diagrama)\s+(?:apresentad[oa]|abaixo|acima|a seguir)|(?:observe|analise)\s+(?:a\s+)?(?:figura|imagem|foto|gr[aá]fico|mapa|diagrama)/.test(text)
  return Boolean(question.needsImage && !question.image) || refersToMissingVisual
}

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
    id: 'linguagem_turma', applies: ['objetiva', 'descritiva'], polarity: 'good', block: 0.35, warn: 0.65,
    instructions: 'O vocabulário, a extensão das frases e os conhecimentos pressupostos são adequados à série e ao segmento indicados? Considere a idade escolar, sem simplificar indevidamente o conteúdo.',
    message: 'A linguagem ou os conhecimentos pressupostos podem não ser adequados à turma. Marque para revisão pedagógica.',
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
    id: 'resposta_induzida', applies: ['objetiva', 'descritiva'], polarity: 'defect', block: 0.75, warn: 0.4,
    instructions: 'Sem usar o gabarito cadastrado, o enunciado ou o texto de apoio já afirma, explica ou praticamente dita a conclusão que a questão pede ao aluno? Não considere dados necessários para resolver como vazamento; procure uma conclusão fornecida antes da tarefa.',
    message: 'O enunciado ou o texto de apoio induz a resposta ao fornecer a conclusão que o aluno deveria produzir. Remova somente a pista, preservando dados necessários e coerência.',
  },
  {
    id: 'informacao_suficiente', applies: ['objetiva', 'descritiva'], polarity: 'good', block: 0.4, warn: 0.7,
    instructions: 'O enunciado e o texto de apoio, em conjunto, fornecem todas as informações necessárias para responder sem adivinhar dados, contexto ou referência ausente?',
    message: 'Faltam informações para responder. Acrescente um texto de apoio autocontido e ajuste somente o enunciado para usá-lo.',
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
    id: 'resposta_copiavel_apoio', applies: ['objetiva', 'descritiva'], polarity: 'defect', block: 0.7, warn: 0.4,
    instructions: 'Se existe texto de apoio, o aluno consegue responder apenas localizando ou copiando uma frase, dado ou conclusão pronta, sem executar a habilidade solicitada? Marque como defeito quando o apoio entrega a resposta; informação necessária para interpretar ou calcular não é, por si só, vazamento.',
    message: 'O texto de apoio permite localizar ou copiar a resposta sem realizar a atividade cognitiva pedida. Mantenha os dados necessários e remova a conclusão pronta.',
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

export type QualityJudgeQuestion = Pick<ExamQuestion, 'type' | 'statement' | 'supportText' | 'alternatives' | 'correctLetter' | 'expectedAnswer' | 'gradingCriteria'> & Partial<Pick<ExamQuestion, 'pedagogicalClassification' | 'needsImage' | 'image' | 'visualPlan' | 'solutionBlueprint'>>

export type QualityJudgeInput = {
  auditMode?: QuestionQualityAuditMode
  /** Habilidades BNCC declaradas pela questão (código + descrição oficial). */
  skills?: Array<{ code: string; description: string; context?: string[]; source?: string; dataVersion?: string }>
  subject: string
  gradeYear: number
  segment: string
  classLabel?: string
  question: QualityJudgeQuestion
  /** Escopo curricular (títulos e tópicos do capítulo), para detectar cópia. */
  curriculumScope: string
  /** Conferências determinísticas anexadas como evidência; somente o Jev decide se reprovam. */
  verificationEvidence?: string[]
}

export type QualityJudgeIssue = {
  severity: 'bloqueante' | 'alerta'
  criterion: QualityCriterionId | 'alternativa_exibe_calculo' | 'alternativa_comentario_correcao' | 'alternativa_revela_resposta' | 'composto' | 'gabarito' | 'indisponivel' | 'imagem_dependencia'
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
  imageDependency: { decision: 'resolvivel_sem_foto' | 'depende_de_foto' | 'indeterminado'; confidence: number | null } | null
  issues: QualityJudgeIssue[]
  blocked: boolean
}

const ANSWER_KEY_MIN_CONFIDENCE = 0.6

export function criteriaForType(type: QuestionKind, _hasSkill = true, auditMode: QuestionQualityAuditMode = 'full'): CriterionSpec[] {
  if (auditMode === 'answers') {
    if (type === 'objetiva') return []
    return QUALITY_CRITERIA.filter((criterion) => criterion.id === 'correcao_objetiva').map((criterion) => ({
      ...criterion,
      block: 0.25,
      warn: 0.5,
      instructions: 'Compare somente o enunciado aprovado, a respostaEsperada e os criteriosDeCorrecao. A resposta esperada responde aos elementos essenciais pedidos, com conteúdo correto a partir dos dados disponíveis? Os critérios permitem pontuar esses elementos? Aceite exemplos, sinônimos e explicações equivalentes, bem como resposta mais detalhada. Indique baixa adequação apenas se houver contradição factual clara, omissão de parte essencial ou critérios que impossibilitem a correção. Não exija cálculo quando o enunciado não pede cálculo; não avalie BNCC, série, estilo ou tamanho da resposta.',
    }))
  }
  // A resposta correta é conferida em uma decisão Jev independente. Não
  // enviamos o gabarito a outro critério na mesma avaliação, para evitar
  // contaminar essa resolução independente.
  return QUALITY_CRITERIA.filter((criterion) => criterion.id !== 'resposta_substantiva' && criterion.applies.includes(type))
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
export function evaluateQualityAnswers(question: Pick<QualityJudgeQuestion, 'type' | 'correctLetter'> & Partial<Pick<QualityJudgeQuestion, 'alternatives' | 'needsImage' | 'image' | 'solutionBlueprint'>>, answers: JevAnswers, _hasSkill = true, isMathSubject = false, auditMode: QuestionQualityAuditMode = 'full'): Pick<QualityJudgeVerdict, 'scores' | 'answerKey' | 'alternativeOutlier' | 'imageDependency' | 'issues' | 'blocked'> {
  const scores: Partial<Record<QualityCriterionId, number>> = {}
  const issues: QualityJudgeIssue[] = []
  const visualAnswer = answers.dependencia_visual
  let imageDependency: QualityJudgeVerdict['imageDependency'] = null
  if (questionNeedsVisualReview(question)) {
    const decision = visualAnswer?.type === 'choice'
      && ['resolvivel_sem_foto', 'depende_de_foto', 'indeterminado'].includes(visualAnswer.choice)
      ? visualAnswer.choice as NonNullable<QualityJudgeVerdict['imageDependency']>['decision']
      : 'indeterminado'
    const confidence = visualAnswer?.type === 'choice'
      ? visualAnswer.confidence ?? visualAnswer.probabilities?.[decision] ?? null
      : null
    imageDependency = { decision, confidence }
    if (decision !== 'resolvivel_sem_foto' || confidence === null || confidence < 0.7) {
      issues.push({ severity: 'bloqueante', criterion: 'imagem_dependencia', reason: decision === 'depende_de_foto'
        ? `O Jev concluiu que a questão depende de uma foto/imagem ausente${confidence === null ? '' : ` (confiança ${Math.round(confidence * 100)}%)`}. Mantenha o rascunho pendente para revisão; não regenere a questão.`
        : `O Jev não confirmou com confiança suficiente que a questão pode ser resolvida sem foto${confidence === null ? '' : ` (confiança ${Math.round(confidence * 100)}%)`}. Mantenha o rascunho pendente para revisão; não regenere a questão.` })
    }
  }

  // Na auditoria final de uma objetiva, o Jev tem uma única tarefa: resolver
  // sem conhecer o gabarito e indicar quantas opções respondem ao comando.
  // Formato, extensão, estilo e completude dos distratores não reprovam aqui.
  if (auditMode === 'answers' && question.type === 'objetiva') {
    const key = answers.gabarito_independente
    if (key?.type !== 'choice') {
      if (question.solutionBlueprint) return { scores, answerKey: null, alternativeOutlier: null, imageDependency, issues, blocked: false }
      issues.push({ severity: 'bloqueante', criterion: 'indisponivel', reason: 'O Jev não retornou uma decisão utilizável sobre a quantidade de respostas corretas.' })
      return { scores, answerKey: null, alternativeOutlier: null, imageDependency, issues, blocked: true }
    }
    const confidence = key.confidence ?? key.probabilities?.[key.choice] ?? null
    const declaredLetter = question.correctLetter?.toUpperCase() ?? null
    const independentLetter = key.choice.toUpperCase()
    const matches = independentLetter === declaredLetter
    const answerKey: AnswerKeyCheck = { declaredLetter, independentLetter, confidence, matches }
    const validLetters = new Set((question.alternatives ?? []).map((item) => item.letter.toUpperCase()))
    if (independentLetter === MULTIPLE_CORRECT_ALTERNATIVES) {
      issues.push({ severity: 'bloqueante', criterion: 'gabarito', reason: 'O Jev encontrou mais de uma alternativa que responde ao enunciado.' })
    } else if (independentLetter === NO_CORRECT_ALTERNATIVE) {
      issues.push({ severity: 'bloqueante', criterion: 'gabarito', reason: 'O Jev não encontrou uma alternativa que responda ao enunciado.' })
    } else if (independentLetter === INSUFFICIENT_ANSWER_INFORMATION) {
      issues.push({ severity: 'bloqueante', criterion: 'gabarito', reason: 'O enunciado não fornece informação suficiente para identificar uma única resposta.' })
    } else if (!validLetters.has(independentLetter)) {
      issues.push({ severity: 'bloqueante', criterion: 'indisponivel', reason: `O Jev retornou uma alternativa inexistente (${independentLetter}); a decisão precisa ser refeita.` })
    } else if (!matches) {
      issues.push({ severity: 'bloqueante', criterion: 'gabarito', reason: `A resposta independente do Jev divergiu do gabarito (${independentLetter} vs. ${declaredLetter ?? 'ausente'}; confiança ${confidence === null ? 'não informada' : `${Math.round(confidence * 100)}%`}). Mantenha a questão pendente para conferência; não altere o gabarito automaticamente.` })
    } else if (confidence === null || confidence < ANSWER_KEY_MIN_CONFIDENCE) {
      issues.push({ severity: 'bloqueante', criterion: 'gabarito', reason: `O Jev confirmou a alternativa ${independentLetter}, mas a confiança é baixa ou não foi informada (${confidence === null ? 'ausente' : `${Math.round(confidence * 100)}%`}). Mantenha a questão pendente para conferência.` })
    }
    return { scores, answerKey, alternativeOutlier: null, imageDependency, issues, blocked: issues.some((issue) => issue.severity === 'bloqueante') }
  }

  for (const spec of criteriaForType(question.type, _hasSkill, auditMode)) {
    if (answers[spec.id]?.type !== 'noul') {
      issues.push({ severity: 'bloqueante', criterion: 'indisponivel', reason: `O Jev não concluiu o critério ${spec.id}; a questão não pode ser aprovada sem a avaliação final completa.` })
    }
  }

  for (const spec of criteriaForType(question.type, _hasSkill, auditMode)) {
    const answer = answers[spec.id]
    if (answer?.type !== 'noul') continue
    scores[spec.id] = answer.noul
    let severity = criterionSeverity(spec, answer.noul)
    if (severity === 'alerta' && spec.id === 'linguagem_turma') severity = 'bloqueante'
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
    const asksWork = auditMode === 'full' ? answers.objetiva_comando_resposta : undefined
    if (auditMode === 'full') {
      if (asksWork?.type === 'choice') {
        if (asksWork.choice === OBJECTIVE_ASKS_WORK) {
          issues.push({
            severity: 'bloqueante', criterion: 'objetiva_exige_desenvolvimento',
            reason: 'Jev identificou que o enunciado objetivo pede mostrar cálculos, fórmulas usadas ou justificar a resolução. Em múltipla escolha, peça apenas o resultado ou os demais produtos finais solicitados.',
          })
        } else if (asksWork.choice !== OBJECTIVE_ANSWER_ONLY) {
          issues.push({ severity: 'bloqueante', criterion: 'indisponivel', reason: 'O Jev não retornou uma decisão válida sobre o comando da questão objetiva; ela não pode ser aprovada sem essa conferência.' })
        }
      } else {
        issues.push({ severity: 'bloqueante', criterion: 'indisponivel', reason: 'O Jev não concluiu a análise do comando da questão objetiva.' })
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
      } else {
        issues.push({ severity: 'bloqueante', criterion: 'indisponivel', alternativeLetter: letter, reason: `O Jev não concluiu a análise de completude da alternativa ${letter}.` })
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
      } else {
        issues.push({ severity: 'bloqueante', criterion: 'indisponivel', alternativeLetter: letter, reason: `O Jev não concluiu a análise de padrão da alternativa ${letter}.` })
      }
      const calculation = answers[`calculo_na_alternativa_${letter}`]
      if (isMathSubject) {
        if (calculation?.type !== 'choice') {
          issues.push({ severity: 'bloqueante', criterion: 'indisponivel', alternativeLetter: letter, reason: `O Jev não concluiu a análise de exposição de cálculo da alternativa ${letter}.` })
        } else if (calculation.choice === ALTERNATIVE_EXPOSES_WORK) {
          issues.push({ severity: 'bloqueante', criterion: 'alternativa_exibe_calculo', alternativeLetter: letter, reason: `Jev identificou fórmula utilizada, conta armada, etapas ou justificativa de cálculo na alternativa ${letter}. Reescreva somente essa opção com a resposta final pedida, preservando fórmulas que sejam o próprio resultado solicitado e as interpretações conceituais pedidas.` })
        } else if (calculation.choice !== ALTERNATIVE_FINAL_ONLY) {
          issues.push({ severity: 'bloqueante', criterion: 'indisponivel', alternativeLetter: letter, reason: `O Jev não retornou uma decisão válida sobre a exposição do cálculo na alternativa ${letter}; ela não pode ser aprovada sem essa conferência.` })
        }
      }
      const content = answers[`conteudo_alternativa_${letter}`]
      if (content?.type !== 'choice' || ![ALTERNATIVE_NEUTRAL_TEXT, ALTERNATIVE_HAS_CORRECTION_COMMENT, ALTERNATIVE_REVEALS_ANSWER].includes(content.choice as never)) {
        issues.push({ severity: 'bloqueante', criterion: 'indisponivel', alternativeLetter: letter, reason: `O Jev não concluiu a verificação de comentários e pistas da alternativa ${letter}; ela não pode ser aprovada sem essa conferência.` })
      } else if (content.choice === ALTERNATIVE_HAS_CORRECTION_COMMENT) {
        issues.push({ severity: 'bloqueante', criterion: 'alternativa_comentario_correcao', alternativeLetter: letter, reason: `Jev identificou comentário editorial na alternativa ${letter} que avalia/corrige uma resposta. Remova o comentário e preserve somente uma resposta plausível no mesmo padrão das demais.` })
      } else if (content.choice === ALTERNATIVE_REVEALS_ANSWER) {
        issues.push({ severity: 'bloqueante', criterion: 'alternativa_revela_resposta', alternativeLetter: letter, reason: `Jev identificou que a alternativa ${letter} revela ou corrige a resposta. Reescreva a opção para manter apenas a resposta que o aluno deve avaliar.` })
      }
    }
    const key = answers.gabarito_independente
    if (key?.type === 'choice') {
      const confidence = key.confidence ?? key.probabilities?.[key.choice] ?? null
      const matches = key.choice === question.correctLetter
      answerKey = { declaredLetter: question.correctLetter ?? null, independentLetter: key.choice, confidence, matches }
      if (!matches && (key.choice === NO_CORRECT_ALTERNATIVE || key.choice === MULTIPLE_CORRECT_ALTERNATIVES || confidence === null || confidence >= ANSWER_KEY_MIN_CONFIDENCE)) {
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
      } else if (!matches) {
        issues.push({ severity: 'bloqueante', criterion: 'gabarito', reason: `O Jev divergiu do gabarito, mas com confiança baixa ou ausente (${confidence === null ? 'não informada' : `${Math.round(confidence * 100)}%`}); mantenha a questão pendente para conferência, sem alterar o gabarito automaticamente.`, score: confidence ?? undefined })
      } else if (confidence !== null && confidence < ANSWER_KEY_MIN_CONFIDENCE) {
        issues.push({ severity: 'bloqueante', criterion: 'gabarito', reason: `A conferência independente apontou a letra ${key.choice} com confiança baixa (${Math.round(confidence * 100)}%); mantenha a questão pendente para conferência.`, score: confidence })
      } else if (confidence === null) {
        issues.push({ severity: 'bloqueante', criterion: 'gabarito', reason: 'O Jev não informou a confiança da resposta independente; mantenha a questão pendente para conferência.' })
      }
    }
  }

  return { scores, answerKey, alternativeOutlier, imageDependency, issues, blocked: issues.some((issue) => issue.severity === 'bloqueante') }
}

function buildState(input: QualityJudgeInput) {
  const { question } = input
  const visualPlanAsJson = (): JsonValue => {
    if (!question.visualPlan) return null
    const serialized = JSON.stringify(question.visualPlan)
    return serialized === undefined ? null : JSON.parse(serialized) as JsonValue
  }
  if (input.auditMode === 'answers') {
    return {
      disciplina: input.subject,
      tipo: question.type,
      enunciadoAprovado: question.statement,
      textoDeApoio: question.supportText?.trim() || null,
      ...(questionNeedsVisualReview(question)
        ? { decisaoVisual: { recursoSolicitado: true, imagemDisponivel: Boolean(question.image), plano: visualPlanAsJson() } }
        : {}),
      alternativas: (question.alternatives ?? []).map((alternative) => ({ letra: alternative.letter, texto: alternative.text })),
      respostaEsperada: question.expectedAnswer ?? null,
      criteriosDeCorrecao: question.gradingCriteria ?? null,
      ...(input.verificationEvidence?.length ? { evidenciasDeConferencia: input.verificationEvidence.slice(0, 8) } : {}),
    }
  }
  return {
    disciplina: input.subject,
    serie: `${input.gradeYear}º ano (${input.segment})`,
    turma: input.classLabel ?? null,
    dificuldadePlanejada: question.pedagogicalClassification?.difficulty ?? null,
    tipo: question.type,
    escopoCurricular: input.curriculumScope.slice(0, 1500),
    enunciado: question.statement,
    textoDeApoio: question.supportText?.trim() || null,
    ...(questionNeedsVisualReview(question)
      ? { decisaoVisual: { recursoSolicitado: true, imagemDisponivel: Boolean(question.image), plano: visualPlanAsJson() } }
      : {}),
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
  if (questionNeedsVisualReview(input.question)) {
    questions.dependencia_visual = {
      type: 'choice',
      instructions: 'Responda especificamente: é possível resolver esta questão sem uma foto/imagem? Considere apenas o enunciado, o texto de apoio e as alternativas, além do plano visual descrito. Não invente o conteúdo de uma imagem ausente. Escolha resolvivel_sem_foto somente se todos os dados necessários estão textualmente disponíveis e o aluno pode responder sem observar a imagem. Escolha depende_de_foto se a resposta exige observar informação visual ausente. Escolha indeterminado se não houver evidência suficiente para decidir.',
      criteria: {
        resolvivel_sem_foto: 'A questão pode ser resolvida sem foto; todos os dados necessários estão disponíveis em texto.',
        depende_de_foto: 'A questão exige observar uma foto/imagem que não está disponível.',
        indeterminado: 'Não é possível concluir com segurança se a questão pode ser resolvida sem foto.',
      },
    }
  }
  if (input.auditMode === 'answers' && input.question.type === 'objetiva') {
    if (input.question.solutionBlueprint) return questions
    questions.gabarito_independente = {
      type: 'choice',
      instructions: 'Resolva a questão por conta própria usando o enunciado, o apoio e todas as alternativas. Não veja nem infira o gabarito cadastrado. Escolha a única alternativa que responde naturalmente ao que foi pedido. Considere uma segunda opção correta somente quando ela também responder diretamente ao comando; não reprove por interpretações remotas, diferenças de estilo, tamanho ou por um distrator plausível que esteja simplesmente errado. Se duas alternativas realmente respondem ao comando, escolha “mais de uma”; se nenhuma responde, escolha “nenhuma”; se faltam dados indispensáveis, escolha “informação insuficiente”. Não avalie BNCC, série, qualidade pedagógica ou apresentação.',
      criteria: {
        ...Object.fromEntries((input.question.alternatives ?? []).map((alternative) => [alternative.letter.toUpperCase(), alternative.text])),
        [NO_CORRECT_ALTERNATIVE]: 'Nenhuma alternativa responde ao que o enunciado pede.',
        [MULTIPLE_CORRECT_ALTERNATIVES]: 'Duas ou mais alternativas respondem diretamente ao que o enunciado pede.',
        [INSUFFICIENT_ANSWER_INFORMATION]: 'Faltam dados indispensáveis para determinar uma resposta.',
      },
    }
    return questions
  }
  const evidenceInstruction = input.verificationEvidence?.length
    ? ' Confira também evidenciasDeConferencia no estado. São verificações preliminares: confirme cada evidência contra os dados e respostas apresentados antes de decidir.'
    : ''
  for (const spec of criteriaForType(input.question.type, Boolean(input.skills?.length), input.auditMode)) {
    // O JEV precisa ver a alternativa marcada para julgar se a resposta é
    // substantiva. O gabarito fica restrito a este critério e não é revelado
    // ao avaliador independente que resolve a questão.
    const substantiveAnswer = input.auditMode !== 'answers' && spec.id === 'resposta_substantiva' && input.question.type === 'objetiva'
      ? ` Alternativa declarada como correta: ${input.question.correctLetter ?? 'gabarito ausente'} — ${input.question.alternatives?.find((item) => item.letter === input.question.correctLetter)?.text ?? 'texto não localizado'}. Avalie apenas se esse conteúdo responde ao comando; não escolha nem revele o gabarito.`
      : ''
    const answerOnlyInstruction = input.auditMode === 'answers' && spec.id === 'resposta_unica'
      ? 'Há exatamente uma alternativa defensável que responde ao enunciado, considerando o conteúdo de TODAS as opções e sem usar gabarito cadastrado? Não procure falhas pedagógicas do enunciado; reporte somente se as respostas oferecidas não têm uma única solução.'
      : ''
    questions[spec.id] = { type: 'noul', instructions: `${answerOnlyInstruction || spec.instructions}${substantiveAnswer}${evidenceInstruction}` }
  }
  if (input.question.type === 'objetiva') {
    const isMathSubject = /matemática|matematica|física|fisica|química|quimica/i.test(input.subject)
    if (isMathSubject) {
      if (input.auditMode !== 'answers') questions.objetiva_comando_resposta = {
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
      questions[`conteudo_alternativa_${letter}`] = {
        type: 'choice',
        instructions: `Classifique o conteúdo visível da alternativa ${letter}. Há comentário editorial que julga/corrige a opção ou rotula uma resposta como certa/errada ("incorreto", "confundiu", "a resposta certa é")? Ou o texto revela/corrige a resposta correta antes de o aluno resolver? Não marque afirmação legítima que responde ao comando nem conteúdo disciplinar pedido. Use exatamente a categoria aplicável. Enunciado: ${input.question.statement}. Alternativa avaliada: ${alternative.text}. Demais alternativas: ${JSON.stringify((input.question.alternatives ?? []).filter((item) => item.letter !== alternative.letter))}`,
        criteria: {
          [ALTERNATIVE_NEUTRAL_TEXT]: 'Texto neutro, sem comentário editorial sobre acerto, erro ou gabarito.',
          [ALTERNATIVE_HAS_CORRECTION_COMMENT]: 'Contém comentário que identifica/corrige erro, explica por que a opção está errada ou revela a resposta.',
          [ALTERNATIVE_REVEALS_ANSWER]: 'Entrega a resposta correta ou corrige outra opção antes de o aluno resolver.',
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
    if (!input.question.solutionBlueprint) questions.gabarito_independente = {
      type: 'choice',
      instructions: `Com base somente no enunciado aprovado, no texto de apoio e nas alternativas, resolva por conta própria sem receber o gabarito declarado. Qual alternativa responde corretamente? Se nenhuma ou mais de uma forem defensáveis, retorne a categoria correspondente. ${evidenceInstruction}`,
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
  options: { evaluate?: typeof evaluateWithJev; auditMode?: QuestionQualityAuditMode } = {},
): Promise<QualityJudgeVerdict> {
  const evaluate = options.evaluate ?? evaluateWithJev
  const auditMode = options.auditMode ?? input.auditMode ?? 'full'
  const judgeInput = { ...input, auditMode }
  const questions = buildQuestions(judgeInput)
  const call = () => evaluate({
    operation: auditMode === 'answers' ? 'jev/exams/answer-validation' : 'jev/exams/question-quality',
    questionVersion: QUESTION_QUALITY_VERSION,
    state: buildState(judgeInput),
    questions,
    route: (answers) => {
      const evaluated = evaluateQualityAnswers(input.question, answers, Boolean(input.skills?.length), /matemática|matematica|física|fisica|química|quimica/i.test(input.subject), auditMode)
      if (evaluated.blocked) return { route: 'review', outcome: 'question_quality_blocked' }
      return evaluated.issues.length ? { route: 'review', outcome: 'question_quality_warning' } : { route: 'automatic', outcome: 'question_quality_ok' }
    },
    fallback: { answers: {}, routing: { route: 'fallback', outcome: 'question_quality_unavailable' } },
    context: { feature: auditMode === 'answers' ? 'answer_validation' : 'question_quality', subject: input.subject, gradeYear: input.gradeYear, questionType: input.question.type },
    cacheTtlMs: CACHE_TTL_MS,
    timeoutMs: TIMEOUT_MS,
  })

  // Uma avaliação por candidata. A fila pode retomar uma falha operacional;
  // repetir a mesma decisão aqui esconderia chamadas e ampliaria ciclos Jev.
  const result = await call()

  if (result.source === 'fallback') {
    return {
      available: false,
      source: 'fallback',
      scores: {},
      answerKey: null,
      alternativeOutlier: null,
      imageDependency: null,
      blocked: false,
      issues: [{ severity: 'alerta', criterion: 'indisponivel', reason: 'O juiz de qualidade (Jev) não respondeu; sem o parecer exclusivo dele, a questão permanece sem aprovação.' }],
    }
  }
  const evaluated = evaluateQualityAnswers(
    input.question,
    result.answers,
    auditMode === 'full' && Boolean(input.skills?.length),
    /matemática|matematica|física|fisica|química|quimica/i.test(input.subject),
    auditMode,
  )
  const evidencePatterns: Partial<Record<QualityCriterionId | 'gabarito' | 'composto', RegExp>> = {
    resposta_substantiva: /resposta correta|conte[uú]do da resposta|alternativa marcada/i,
    resposta_exposta_enunciado: /enunciado|conclus[aã]o/i,
    resposta_induzida: /pista|induz|conclus[aã]o/i,
    informacao_suficiente: /informa[cç][aã]o|dados ausentes|insuficiente/i,
    gabarito: /gabarito|alternativa correta|alternativa independente/i,
    copia_escopo_curricular: /escopo curricular|t[ií]tulo|t[oó]pico curricular/i,
    linguagem_turma: /linguagem|vocabul[aá]rio|s[eé]rie|turma/i,
    resposta_copiavel_apoio: /apoio|texto|copiar|localizar/i,
  }
  const issuesWithEvidence = evaluated.issues.map((issue) => {
    const pattern = evidencePatterns[issue.criterion as keyof typeof evidencePatterns]
    const matching = pattern ? (input.verificationEvidence ?? []).filter((evidence) => pattern.test(evidence)) : []
    return matching.length
      ? { ...issue, reason: `${issue.reason} Evidência concreta para conferir: ${matching.slice(0, 3).join(' | ')}` }
      : issue
  })
  return {
    available: true,
    source: result.source,
    ...evaluated,
    issues: issuesWithEvidence,
  }
}
