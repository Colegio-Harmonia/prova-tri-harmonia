import { z } from 'zod'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import type { AnswerKeyCheck, QualityJudgeIssue } from '@/lib/ai/questionQualityDecision'
import { MULTIPLE_CORRECT_ALTERNATIVES, NO_CORRECT_ALTERNATIVE } from '@/lib/ai/questionQualityContract'

// Diagnósticos são o contrato entre validação, reparo e revisão humana. A
// mensagem continua legível, mas o fluxo nunca precisa tomar decisões a
// partir de texto livre da IA.
export const QUALITY_DIAGNOSTIC_CODES = [
  'INVALID_AI_RESPONSE',
  'QUESTION_STRUCTURE',
  'DUPLICATE_ALTERNATIVE',
  'DISTRACTOR_EQUALS_ANSWER',
  'ALTERNATIVE_AMBIGUITY',
  'ALTERNATIVE_FORMAT_OUTLIER',
  'ALTERNATIVE_CONTENT_INCOMPLETE',
  'OBJECTIVE_CALCULATION_REQUEST',
  'ALTERNATIVE_EXPOSES_CALCULATION',
  'ANSWER_KEY_MISMATCH',
  'ANSWER_EXPOSED_IN_STATEMENT',
  'NO_CORRECT_ALTERNATIVE',
  'MISSING_SUPPORT_TEXT',
  'FACTUAL_INCONSISTENCY',
  'GRADING_CRITERIA',
  'EVIDENCE_NOT_FOUND',
  'INSUFFICIENT_INFORMATION',
  'INVENTED_NUMBER',
  'BNCC_MAPPING',
  'MISSING_REQUIRED_VISUAL',
  'UNSUPPORTED_MATH_DOMAIN',
  'CALCULATION_UNVERIFIED',
  'CURRICULUM_MISMATCH',
  'CURRICULUM_LEAK',
  'REGENERATE_QUESTION',
] as const

export const QUALITY_DIAGNOSTIC_SEVERITIES = ['bloqueante', 'alerta', 'revisao_humana'] as const
export const QUALITY_REPAIR_ACTIONS = ['reparo_local', 'regenerar_questao', 'revisao_humana', 'nenhuma'] as const

export const qualityDiagnosticSchema = z.object({
  code: z.enum(QUALITY_DIAGNOSTIC_CODES),
  severity: z.enum(QUALITY_DIAGNOSTIC_SEVERITIES),
  repairAction: z.enum(QUALITY_REPAIR_ACTIONS),
  fields: z.array(z.string()).default([]),
  protectedFields: z.array(z.string()).default([]),
  message: z.string().min(1),
  evidence: z.string().nullable().optional(),
  alternativeLetter: z.string().regex(/^[A-E]$/).nullable().optional(),
  blocksApproval: z.boolean().default(false),
})

export type QualityDiagnostic = z.infer<typeof qualityDiagnosticSchema>

type RawIssue = { severity: 'bloqueante' | 'alerta'; reason: string }

const BASE_PROTECTED = ['number', 'source', 'type', 'curriculumUnitRowIndex', 'bnccCodes', 'bnccStatus']

function diagnostic(params: Omit<QualityDiagnostic, 'protectedFields'> & { protectedFields?: string[] }): QualityDiagnostic {
  return {
    ...params,
    protectedFields: params.protectedFields ?? BASE_PROTECTED,
  }
}

/** Converte a decisão tipada do Jev sem inferir ações a partir de prosa. */
export function diagnosticFromJevIssue(
  issue: QualityJudgeIssue,
  question: ExamQuestion,
  answerKey: AnswerKeyCheck | null,
): QualityDiagnostic {
  const common = { severity: issue.severity, evidence: issue.reason, blocksApproval: issue.severity === 'bloqueante' }
  switch (issue.criterion) {
    case 'objetiva_exige_desenvolvimento':
      return diagnostic({ ...common, code: 'OBJECTIVE_CALCULATION_REQUEST', repairAction: 'reparo_local', fields: ['statement'], protectedFields: ['supportText', 'alternatives', 'correctLetter'], message: 'Em questão objetiva, ajuste somente o comando para pedir os resultados finais, sem solicitar que o aluno mostre cálculos ou justifique a resolução.' })
    case 'alternativa_exibe_calculo':
      return diagnostic({ ...common, code: 'ALTERNATIVE_EXPOSES_CALCULATION', repairAction: 'reparo_local', fields: issue.alternativeLetter ? [`alternatives.${issue.alternativeLetter}`] : ['alternatives'], alternativeLetter: issue.alternativeLetter ?? null, protectedFields: ['statement', 'supportText', 'correctLetter'], message: issue.alternativeLetter ? `Reescreva somente a alternativa ${issue.alternativeLetter} para exibir o resultado final pedido, sem fórmulas de resolução, contas ou etapas.` : issue.reason })
    case 'resposta_exposta_enunciado':
      return diagnostic({ ...common, code: 'ANSWER_EXPOSED_IN_STATEMENT', repairAction: 'reparo_local', fields: ['statement'], message: 'O enunciado entrega a resposta e deve ser reescrito sem alterar o restante da questão.' })
    case 'informacao_suficiente':
      return diagnostic({ ...common, code: 'INSUFFICIENT_INFORMATION', repairAction: 'reparo_local', fields: ['statement'], protectedFields: ['supportText', 'alternatives', 'correctLetter'], message: 'O enunciado não permite resolver a questão com os dados disponíveis. Reescreva somente o enunciado para perguntar algo que os dados existentes permitam responder, sem acrescentar fatos ou números.' })
    case 'apoio_autossuficiente':
      return diagnostic({ ...common, code: question.supportText?.trim() ? 'INSUFFICIENT_INFORMATION' : 'MISSING_SUPPORT_TEXT', repairAction: 'reparo_local', fields: ['supportText', 'statement'], message: 'Falta contexto suficiente; é necessário criar ou corrigir o texto de apoio e ajustar o enunciado.' })
    case 'alternativas_homogeneas':
    case 'resposta_unica':
      return diagnostic({ ...common, code: 'ALTERNATIVE_AMBIGUITY', repairAction: 'reparo_local', fields: ['alternatives'], message: 'As alternativas devem ser refeitas preservando a resposta correta e o restante da questão.' })
    case 'alternativa_formato_outlier':
      return diagnostic({ ...common, code: 'ALTERNATIVE_FORMAT_OUTLIER', repairAction: 'reparo_local', fields: ['alternatives'], alternativeLetter: issue.alternativeLetter ?? null, message: issue.alternativeLetter ? `Reescreva somente a alternativa ${issue.alternativeLetter} para seguir o padrão das demais e responder integralmente à questão.` : issue.reason })
    case 'alternativa_completa':
      return diagnostic({ ...common, code: 'ALTERNATIVE_CONTENT_INCOMPLETE', repairAction: 'reparo_local', fields: ['alternatives'], alternativeLetter: issue.alternativeLetter ?? null, message: issue.alternativeLetter ? `Complete somente a alternativa ${issue.alternativeLetter} com todos os componentes pedidos no enunciado.` : issue.reason })
    case 'gabarito':
      return diagnostic({
        ...common,
        code: answerKey?.independentLetter === NO_CORRECT_ALTERNATIVE ? 'NO_CORRECT_ALTERNATIVE' : answerKey?.independentLetter === MULTIPLE_CORRECT_ALTERNATIVES ? 'ALTERNATIVE_AMBIGUITY' : 'ANSWER_KEY_MISMATCH',
        repairAction: answerKey?.independentLetter === MULTIPLE_CORRECT_ALTERNATIVES || answerKey?.independentLetter === NO_CORRECT_ALTERNATIVE ? 'reparo_local' : 'regenerar_questao',
        fields: answerKey?.independentLetter === NO_CORRECT_ALTERNATIVE ? ['alternatives', 'correctLetter'] : ['alternatives'],
        message: answerKey?.independentLetter === NO_CORRECT_ALTERNATIVE ? 'Nenhuma alternativa é correta; refaça somente as alternativas e o gabarito.' : issue.reason,
      })
    case 'correcao_objetiva':
      return diagnostic({ ...common, code: 'GRADING_CRITERIA', repairAction: 'reparo_local', fields: ['expectedAnswer', 'gradingCriteria'], message: 'A resposta-modelo e os critérios de correção devem ser refeitos sem mudar o enunciado.' })
    case 'fatos_corretos':
      return diagnostic({ ...common, code: 'FACTUAL_INCONSISTENCY', repairAction: 'regenerar_questao', fields: ['statement', 'supportText', 'alternatives', 'expectedAnswer'], message: 'Há possível erro factual; a questão precisa ser refeita a partir da fonte curricular.' })
    case 'alinhamento_bncc':
      return diagnostic({
        ...common,
        code: 'BNCC_MAPPING',
        repairAction: 'reparo_local',
        fields: ['statement', 'supportText', 'alternatives', 'correctLetter', 'expectedAnswer', 'gradingCriteria'],
        protectedFields: ['number', 'source', 'type', 'curriculumUnitRowIndex', 'bnccCodes', 'bnccStatus'],
        message: 'A questão não mede a habilidade BNCC indicada. Reescreva a tarefa para exigir a operação cognitiva da habilidade, mantendo o tema e os fatos do currículo escolar.',
      })
    case 'copia_escopo_curricular':
    case 'resposta_substantiva':
      return diagnostic({ ...common, code: 'CURRICULUM_LEAK', repairAction: 'regenerar_questao', fields: ['statement', 'supportText', 'alternatives', 'expectedAnswer'], message: issue.reason })
    default:
      return diagnostic({ ...common, code: 'REGENERATE_QUESTION', repairAction: issue.severity === 'bloqueante' ? 'regenerar_questao' : 'nenhuma', fields: [], message: issue.reason })
  }
}

/** Converte regras existentes (inclusive relatórios legados) no contrato novo. */
export function diagnosticFromIssue(issue: RawIssue): QualityDiagnostic {
  const text = issue.reason
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const blocking = issue.severity === 'bloqueante'

  if (/vazamento-curricular|copia_escopo_curricular|resposta_substantiva/.test(normalized)) {
    return diagnostic({ code: 'CURRICULUM_LEAK', severity: issue.severity, repairAction: 'regenerar_questao', fields: ['statement', 'supportText', 'alternatives', 'expectedAnswer'], message: 'A questão reproduz o escopo curricular (título ou tópico) em vez de uma resposta própria.', evidence: text, blocksApproval: blocking })
  }
  if (/resposta da ia invalida|json invalido|campo obrigatorio|schema|output truncated|resposta vazia/.test(normalized)) {
    return diagnostic({ code: 'INVALID_AI_RESPONSE', severity: issue.severity, repairAction: 'regenerar_questao', fields: [], message: 'A IA não retornou uma resposta estruturada utilizável.', evidence: text, blocksApproval: blocking })
  }
  if (/distrator.*repet|alternativas? .*mesmo conteudo|alternativas? .*mesmo valor|duplicad/.test(normalized)) {
    return diagnostic({ code: 'DUPLICATE_ALTERNATIVE', severity: issue.severity, repairAction: 'reparo_local', fields: ['alternatives'], message: 'Há alternativas ou distratores repetidos.', evidence: text, blocksApproval: blocking })
  }
  if (/distrator.*(igual|reproduz).*resposta|alternativa correta.*atribuicao/.test(normalized)) {
    return diagnostic({ code: 'DISTRACTOR_EQUALS_ANSWER', severity: issue.severity, repairAction: 'reparo_local', fields: ['alternatives'], message: 'Um distrator coincide com a resposta correta.', evidence: text, blocksApproval: blocking })
  }
  if (/alternativas?.*(equivalentes|defensaveis)|ambig/.test(normalized)) {
    return diagnostic({ code: 'ALTERNATIVE_AMBIGUITY', severity: issue.severity, repairAction: 'reparo_local', fields: ['alternatives'], message: 'Há mais de uma alternativa potencialmente defensável.', evidence: text, blocksApproval: blocking })
  }
  if (/evidencia.*(nao existe|nao.*encontr|vazia|curta)|material-fonte/.test(normalized)) {
    return diagnostic({ code: 'EVIDENCE_NOT_FOUND', severity: issue.severity, repairAction: 'regenerar_questao', fields: ['statement', 'supportText', 'expectedAnswer'], message: 'A evidência não foi localizada literalmente no material-fonte.', evidence: text, blocksApproval: blocking })
  }
  if (/gabarito|letra correta|conferencia independente/.test(normalized)) {
    return diagnostic({ code: 'ANSWER_KEY_MISMATCH', severity: issue.severity, repairAction: 'regenerar_questao', fields: ['alternatives', 'correctLetter', 'statement'], message: 'O gabarito não foi confirmado de forma independente.', evidence: text, blocksApproval: blocking })
  }
  if (/numero.*(nao existem|inexistente|inventad)|valor\(es\).*fonte de verdade/.test(normalized)) {
    return diagnostic({ code: 'INVENTED_NUMBER', severity: issue.severity, repairAction: 'regenerar_questao', fields: ['statement', 'supportText'], message: 'O enunciado contém dados que não foram confirmados.', evidence: text, blocksApproval: blocking })
  }
  if (/bncc|habilidade.*curriculo/.test(normalized)) {
    return diagnostic({ code: 'BNCC_MAPPING', severity: issue.severity, repairAction: 'regenerar_questao', fields: ['bnccCodes', 'bnccStatus', 'statement'], message: 'O vínculo BNCC não está consistente com o currículo.', evidence: text, blocksApproval: blocking })
  }
  if (/figura|imagem|grafico|mapa|diagrama/.test(normalized)) {
    return diagnostic({ code: 'MISSING_REQUIRED_VISUAL', severity: issue.severity, repairAction: 'regenerar_questao', fields: ['statement', 'visualPlan', 'image'], message: 'A questão depende de um recurso visual que não está disponível.', evidence: text, blocksApproval: blocking })
  }
  if (/dominio.*recalculador|motor de regras|recalculo falhou|ficha tecnica/.test(normalized)) {
    return diagnostic({ code: 'UNSUPPORTED_MATH_DOMAIN', severity: 'revisao_humana', repairAction: 'revisao_humana', fields: ['statement', 'alternatives', 'correctLetter', 'solutionBlueprint'], message: 'O cálculo não pôde ser verificado automaticamente.', evidence: text, blocksApproval: true })
  }
  if (/informacao.*insuficiente|dados.*ausentes|nao permite responder/.test(normalized)) {
    return diagnostic({ code: 'INSUFFICIENT_INFORMATION', severity: issue.severity, repairAction: 'regenerar_questao', fields: ['statement', 'supportText'], message: 'A questão não contém informação suficiente para uma resposta verificável.', evidence: text, blocksApproval: blocking })
  }
  return diagnostic({ code: 'REGENERATE_QUESTION', severity: issue.severity, repairAction: blocking ? 'regenerar_questao' : 'nenhuma', fields: ['statement', 'supportText', 'alternatives'], message: blocking ? 'A questão precisa ser regenerada com as restrições da validação.' : 'Há um ponto de atenção para revisão docente.', evidence: text, blocksApproval: blocking })
}

/** Domínios matemáticos sem verificador são seguros apenas após confirmação humana. */
export function unsupportedMathDiagnostics(question: ExamQuestion, subject: string): QualityDiagnostic[] {
  const mathOrScience = /^(matemática|matematica|física|fisica|química|quimica)$/i.test(subject.trim())
  if (!mathOrScience || question.solutionBlueprint?.domain !== 'other') return []
  return [diagnostic({
    code: 'CALCULATION_UNVERIFIED',
    severity: 'revisao_humana',
    repairAction: 'revisao_humana',
    fields: ['statement', 'alternatives', 'correctLetter', 'solutionBlueprint'],
    message: 'Esta questão usa um cálculo sem verificador independente. Confira enunciado, alternativas e gabarito antes de aprovar.',
    evidence: 'O domínio da ficha técnica está marcado como não verificável.',
    blocksApproval: true,
  })]
}

export function diagnosticsForQuestion(payload: ExamGenerationResult, questionNumber: number): QualityDiagnostic[] {
  return payload.metadata.qualityTest?.reports?.at(-1)?.results.find((result) => result.questionNumber === questionNumber)?.diagnostics ?? []
}

export function humanReviewDiagnostics(payload: ExamGenerationResult): Array<{ questionNumber: number; diagnostic: QualityDiagnostic; acknowledged: boolean }> {
  return payload.questions.flatMap((question) => diagnosticsForQuestion(payload, question.number)
    .filter((item) => item.severity === 'revisao_humana' && item.blocksApproval)
    .map((item) => ({ questionNumber: question.number, diagnostic: item, acknowledged: question.review?.adequacy === 'adequada' })))
}

export function humanReviewApprovalBlocks(payload: ExamGenerationResult): string[] {
  return humanReviewDiagnostics(payload)
    .filter((item) => !item.acknowledged)
    .map((item) => `Questão ${item.questionNumber}: ${item.diagnostic.message}`)
}
