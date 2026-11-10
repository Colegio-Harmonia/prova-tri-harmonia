import { z } from 'zod'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import type { QualityJudgeIssue } from '@/lib/ai/questionQualityDecision'
import { NO_CORRECT_ALTERNATIVE } from '@/lib/ai/questionQualityContract'

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
  'ALTERNATIVE_CORRECTION_COMMENT',
  'ALTERNATIVE_REVEALS_ANSWER',
  'ANSWER_KEY_MISMATCH',
  'ANSWER_EXPOSED_IN_STATEMENT',
  'ANSWER_CUE_EXPOSED',
  'NO_CORRECT_ALTERNATIVE',
  'MISSING_SUPPORT_TEXT',
  'FACTUAL_INCONSISTENCY',
  'GRADING_CRITERIA',
  'EVIDENCE_NOT_FOUND',
  'INSUFFICIENT_INFORMATION',
  'INVENTED_NUMBER',
  'BNCC_MAPPING',
  'GRADE_LEVEL_MISMATCH',
  'MISSING_REQUIRED_VISUAL',
  'IMAGE_DEPENDENCY_REVIEW',
  'PEDAGOGICAL_REVIEW',
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
  location: z.string().nullable().optional(),
  resolutionCheck: z.string().nullable().optional(),
  alternativeLetter: z.string().regex(/^[A-E]$/).nullable().optional(),
  blocksApproval: z.boolean().default(false),
})

export type QualityDiagnostic = z.infer<typeof qualityDiagnosticSchema>

const REPAIR_GROUP_BY_CODE: Partial<Record<QualityDiagnostic['code'], 'conteudo' | 'texto' | 'alternativas' | 'alinhamento'>> = {
  CALCULATION_UNVERIFIED: 'conteudo', FACTUAL_INCONSISTENCY: 'conteudo', INSUFFICIENT_INFORMATION: 'conteudo',
  NO_CORRECT_ALTERNATIVE: 'conteudo', CURRICULUM_LEAK: 'conteudo',
  ANSWER_EXPOSED_IN_STATEMENT: 'texto', ANSWER_CUE_EXPOSED: 'texto', MISSING_SUPPORT_TEXT: 'texto',
  QUESTION_STRUCTURE: 'texto',
  DUPLICATE_ALTERNATIVE: 'alternativas', DISTRACTOR_EQUALS_ANSWER: 'alternativas', ALTERNATIVE_AMBIGUITY: 'alternativas',
  ALTERNATIVE_FORMAT_OUTLIER: 'alternativas', ALTERNATIVE_CONTENT_INCOMPLETE: 'alternativas',
  ALTERNATIVE_EXPOSES_CALCULATION: 'alternativas', ALTERNATIVE_CORRECTION_COMMENT: 'alternativas', ALTERNATIVE_REVEALS_ANSWER: 'alternativas',
  BNCC_MAPPING: 'alinhamento', GRADE_LEVEL_MISMATCH: 'alinhamento', REGENERATE_QUESTION: 'alinhamento',
}

/** Reparo local só quando o diagnóstico é localizado e pertence a um grupo. */
export function shouldRegenerateQuestionFromDiagnostics(diagnostics: QualityDiagnostic[]): boolean {
  const blocking = diagnostics.filter((item) => item.blocksApproval)
  if (!blocking.length) return false
  if (blocking.some((item) => item.repairAction === 'regenerar_questao' || item.repairAction === 'revisao_humana')) return true
  if (blocking.some((item) => !item.location && !item.alternativeLetter)) return true
  const groups = new Set(blocking.map((item) => REPAIR_GROUP_BY_CODE[item.code]).filter(Boolean))
  return groups.size > 1 || groups.has('alinhamento')
}

/** Retorna os campos que um reparo local mudou sem autorização. Regenerações têm escopo de questão inteira. */
export function unauthorizedRepairChanges(
  before: ExamQuestion,
  after: ExamQuestion,
  diagnostics: QualityDiagnostic[],
  isRegeneration: boolean,
): string[] {
  if (isRegeneration) return []
  const paths = diagnostics.flatMap((item) => item.fields)
  const topLevel = new Set(paths.map((path) => path.split('.')[0]))
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key as keyof ExamQuestion]) !== JSON.stringify(after[key as keyof ExamQuestion]))
  const unauthorized = changed.filter((field) => !topLevel.has(field))
  if (changed.includes('alternatives')) {
    const scopedLetters = paths.flatMap((path) => path.match(/^alternatives\.([A-E])$/)?.[1] ?? [])
    const hasWholeAlternativesAuthorization = paths.some((path) => path === 'alternatives')
    if (scopedLetters.length && !hasWholeAlternativesAuthorization && before.alternatives && after.alternatives) {
      const scoped = new Set(scopedLetters)
      const beforeByLetter = new Map(before.alternatives.map((item) => [item.letter, item.text]))
      for (const option of after.alternatives) {
        if (!scoped.has(option.letter) && beforeByLetter.get(option.letter) !== option.text) unauthorized.push(`alternatives.${option.letter}`)
      }
    }
  }
  return [...new Set(unauthorized)].sort()
}

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
  answerKeyAudit: { declaredLetter: string | null; independentLetter: string | null; confidence: number | null; matches: boolean } | null = null,
): QualityDiagnostic {
  const alternative = issue.alternativeLetter
    ? question.alternatives?.find((item) => item.letter.toUpperCase() === issue.alternativeLetter)?.text ?? null
    : null
  const answerAlternative = question.correctLetter
    ? question.alternatives?.find((item) => item.letter === question.correctLetter)?.text ?? null
    : null
  const evidenceForCriterion: Record<string, { location: string; evidence: string | null; resolutionCheck: string }> = {
    adequacao_turma: { location: 'statement', evidence: question.statement, resolutionCheck: `A complexidade deve caber em ${question.bloomLevel} para ${question.type}, mantendo o tema e a habilidade.` },
    resposta_substantiva: { location: question.type === 'objetiva' ? `alternatives.${question.correctLetter ?? '?'}` : 'expectedAnswer', evidence: question.type === 'objetiva' ? answerAlternative : question.expectedAnswer ?? null, resolutionCheck: 'A resposta correta deve responder ao comando com conteúdo disciplinar, sem repetir somente o título, tópico ou palavras do enunciado.' },
    resposta_exposta_enunciado: { location: 'statement', evidence: question.statement, resolutionCheck: 'Localize a frase do enunciado que declara ou explica a conclusão pedida. Reescreva somente essa frase como dado ou observação. Condição de aprovação: nenhuma frase do enunciado entrega a resposta sem o raciocínio solicitado.' },
    resposta_induzida: { location: question.supportText?.trim() ? 'supportText e statement (localizar trecho)' : 'statement (localizar trecho)', evidence: [question.supportText, question.statement].filter(Boolean).join('\n'), resolutionCheck: 'Leia enunciado e apoio juntos e identifique a frase que já afirma ou praticamente dita a conclusão solicitada. Reescreva apenas essa frase como premissa/dado, preservando informações necessárias. Condição: nenhuma frase do apoio ou enunciado, isolada, pode responder à questão.' },
    informacao_suficiente: { location: 'statement e supportText', evidence: [question.statement, question.supportText].filter(Boolean).join('\n'), resolutionCheck: 'Liste internamente quais dados são necessários e quais faltam. Acrescente somente dado ausente autorizado pelo planejamento ou reformule a pergunta para usar os dados existentes; não forneça a conclusão como pista.' },
    copia_escopo_curricular: { location: question.type === 'objetiva' ? `alternatives.${question.correctLetter ?? '?'}` : 'expectedAnswer', evidence: question.type === 'objetiva' ? answerAlternative : question.expectedAnswer ?? null, resolutionCheck: 'Redija o conteúdo da resposta do zero; use o planejamento apenas como fonte do tema.' },
    apoio_autossuficiente: { location: 'supportText', evidence: question.supportText ?? null, resolutionCheck: 'Se o apoio for necessário, transforme-o em texto/dado completo; se for dispensável, retire a referência a ele sem criar fatos.' },
    resposta_copiavel_apoio: { location: 'supportText', evidence: question.supportText ?? null, resolutionCheck: 'Confirme se o apoio contém somente premissas/dados e se o aluno ainda precisa executar a habilidade pedida.' },
    linguagem_turma: { location: 'statement', evidence: question.statement, resolutionCheck: 'Revise vocabulário e conhecimentos pressupostos para a série e turma informadas.' },
  }
  const detail = evidenceForCriterion[issue.criterion]
  const common = {
    severity: issue.severity,
    evidence: alternative ?? detail?.evidence ?? issue.reason,
    location: issue.alternativeLetter ? `alternatives.${issue.alternativeLetter}` : detail?.location ?? null,
    resolutionCheck: detail?.resolutionCheck ?? issue.reason,
    blocksApproval: issue.severity === 'bloqueante',
  }
  switch (issue.criterion) {
    case 'imagem_dependencia':
      return diagnostic({ ...common, code: 'IMAGE_DEPENDENCY_REVIEW', severity: 'revisao_humana', repairAction: 'revisao_humana', fields: [], message: issue.reason, blocksApproval: true })
    case 'linguagem_turma':
      return diagnostic({ ...common, code: 'PEDAGOGICAL_REVIEW', severity: 'revisao_humana', repairAction: 'revisao_humana', fields: [], message: issue.reason, blocksApproval: true })
    case 'resposta_copiavel_apoio':
      return diagnostic({ ...common, code: 'ANSWER_CUE_EXPOSED', repairAction: 'reparo_local', fields: ['supportText'], protectedFields: ['statement', 'alternatives', 'correctLetter'], message: issue.reason })
    case 'objetiva_exige_desenvolvimento':
      return diagnostic({ ...common, code: 'OBJECTIVE_CALCULATION_REQUEST', repairAction: 'reparo_local', fields: ['statement'], protectedFields: ['supportText', 'alternatives', 'correctLetter'], message: 'Em questão objetiva, ajuste somente o comando para pedir os resultados finais, sem solicitar que o aluno mostre cálculos ou justifique a resolução.' })
    case 'alternativa_exibe_calculo':
      return diagnostic({ ...common, code: 'ALTERNATIVE_EXPOSES_CALCULATION', repairAction: 'reparo_local', fields: issue.alternativeLetter ? [`alternatives.${issue.alternativeLetter}`] : ['alternatives'], alternativeLetter: issue.alternativeLetter ?? null, protectedFields: ['statement', 'supportText', 'correctLetter'], message: issue.alternativeLetter ? `Reescreva somente a alternativa ${issue.alternativeLetter} para exibir o resultado final pedido, sem fórmulas de resolução, contas ou etapas.` : issue.reason })
    case 'alternativa_comentario_correcao':
      return diagnostic({ ...common, code: 'ALTERNATIVE_CORRECTION_COMMENT', repairAction: 'reparo_local', fields: issue.alternativeLetter ? [`alternatives.${issue.alternativeLetter}`] : ['alternatives'], alternativeLetter: issue.alternativeLetter ?? null, protectedFields: ['statement', 'supportText', 'correctLetter'], message: issue.reason })
    case 'alternativa_revela_resposta':
      return diagnostic({ ...common, code: 'ALTERNATIVE_REVEALS_ANSWER', repairAction: 'reparo_local', fields: issue.alternativeLetter ? [`alternatives.${issue.alternativeLetter}`] : ['alternatives'], alternativeLetter: issue.alternativeLetter ?? null, protectedFields: ['statement', 'supportText', 'correctLetter'], message: issue.reason })
    case 'resposta_exposta_enunciado':
      return diagnostic({ ...common, code: 'ANSWER_EXPOSED_IN_STATEMENT', repairAction: 'reparo_local', fields: ['statement'], message: 'O enunciado entrega a resposta e deve ser reescrito sem alterar o restante da questão.' })
    case 'resposta_induzida':
      return diagnostic({ ...common, code: 'ANSWER_CUE_EXPOSED', repairAction: 'reparo_local', fields: ['statement', 'supportText'], message: issue.reason })
    case 'informacao_suficiente':
      return diagnostic({ ...common, code: 'INSUFFICIENT_INFORMATION', repairAction: 'reparo_local', fields: ['statement'], protectedFields: ['supportText', 'alternatives', 'correctLetter'], message: 'O enunciado não permite resolver a questão com os dados disponíveis. Reescreva somente o enunciado para perguntar algo que os dados existentes permitam responder, sem acrescentar fatos ou números.' })
    case 'apoio_autossuficiente':
      return diagnostic({ ...common, code: question.supportText?.trim() ? 'INSUFFICIENT_INFORMATION' : 'MISSING_SUPPORT_TEXT', repairAction: 'reparo_local', fields: ['supportText', 'statement'], message: 'Falta contexto suficiente; é necessário criar ou corrigir o texto de apoio e ajustar o enunciado.' })
    case 'gabarito':
      if (answerKeyAudit && !answerKeyAudit.matches && answerKeyAudit.independentLetter === NO_CORRECT_ALTERNATIVE && (answerKeyAudit.confidence ?? 0) >= 0.6) {
        return diagnostic({ ...common, code: 'NO_CORRECT_ALTERNATIVE', severity: 'bloqueante', repairAction: 'reparo_local', fields: ['alternatives', 'correctLetter'], message: 'Nenhuma alternativa responde corretamente ao enunciado. Refaça as alternativas e confira o gabarito.' })
      }
      if (answerKeyAudit && !answerKeyAudit.matches && answerKeyAudit.independentLetter && answerKeyAudit.independentLetter !== NO_CORRECT_ALTERNATIVE && (answerKeyAudit.confidence ?? 0) >= 0.6) {
        return diagnostic({ ...common, code: 'ANSWER_KEY_MISMATCH', severity: 'bloqueante', repairAction: 'reparo_local', fields: ['alternatives', 'correctLetter'], message: `A solução independente aponta para ${answerKeyAudit.independentLetter}, diferente da alternativa marcada.` })
      }
      return diagnostic({ ...common, code: 'PEDAGOGICAL_REVIEW', severity: 'revisao_humana', repairAction: 'revisao_humana', fields: [], message: issue.reason, blocksApproval: true })
    case 'alternativas_homogeneas':
    case 'resposta_unica':
      return diagnostic({ ...common, code: 'ALTERNATIVE_AMBIGUITY', repairAction: 'reparo_local', fields: ['alternatives'], protectedFields: ['statement', 'supportText', 'correctLetter'], message: issue.criterion === 'resposta_unica' ? 'Compare cada opção com a resposta correta. Reescreva somente os distratores defensáveis como erros claros, mas plausíveis; preserve a correta.' : 'Padronize estrutura, unidades, notação e nível de detalhe das alternativas, alterando somente as opções que destoam.' , resolutionCheck: issue.criterion === 'resposta_unica' ? 'Exatamente uma alternativa deve responder ao enunciado; todos os demais distratores devem ser inequivocamente incorretos.' : 'Todas as alternativas devem cobrir os mesmos componentes na mesma ordem e ter forma/apresentação equivalente.' })
    case 'alternativa_formato_outlier':
      return diagnostic({ ...common, code: 'ALTERNATIVE_FORMAT_OUTLIER', repairAction: 'reparo_local', fields: issue.alternativeLetter ? [`alternatives.${issue.alternativeLetter}`] : ['alternatives'], alternativeLetter: issue.alternativeLetter ?? null, message: issue.alternativeLetter ? `Reescreva somente a alternativa ${issue.alternativeLetter} para seguir o padrão das demais e responder integralmente à questão.` : issue.reason, resolutionCheck: 'Compare a alternativa indicada às demais e ajuste sintaxe, quantidade de componentes, unidades, notação e nível de detalhe. Se a alternativa indicada for a correta, preserve o gabarito e ajuste apenas seu texto para corresponder ao padrão.' })
    case 'alternativa_completa':
      return diagnostic({ ...common, code: 'ALTERNATIVE_CONTENT_INCOMPLETE', repairAction: 'reparo_local', fields: ['alternatives'], alternativeLetter: issue.alternativeLetter ?? null, message: issue.alternativeLetter ? `Complete somente a alternativa ${issue.alternativeLetter} com todos os componentes pedidos no enunciado.` : issue.reason })
    case 'enunciado_coerente':
      return diagnostic({
        ...common,
        code: 'QUESTION_STRUCTURE',
        repairAction: 'reparo_local',
        fields: ['statement', 'supportText'],
        message: issue.reason,
        resolutionCheck: 'Remova a repetição ou instrução contraditória, preservando os dados e o pedido que o aluno deve responder.',
      })
    case 'correcao_objetiva':
      return diagnostic({ ...common, code: 'GRADING_CRITERIA', repairAction: 'reparo_local', fields: ['expectedAnswer', 'gradingCriteria'], message: 'A resposta-modelo e os critérios de correção devem ser refeitos sem mudar o enunciado.' })
    case 'fatos_corretos':
      return diagnostic({ ...common, code: 'FACTUAL_INCONSISTENCY', repairAction: 'regenerar_questao', fields: ['statement', 'supportText', 'alternatives', 'expectedAnswer'], message: 'Há possível erro factual; a questão precisa ser refeita a partir da fonte curricular.', resolutionCheck: 'Identifique a afirmação factual específica e o campo em que aparece. Preserve fatos/dados fornecidos no planejamento. Substitua somente a afirmação não confirmada por uma formulação simples e correta para a série; não invente datas, estatísticas ou nomes.' })
    case 'adequacao_turma':
      return diagnostic({
        ...common,
        code: 'GRADE_LEVEL_MISMATCH',
        repairAction: 'reparo_local',
        fields: ['statement', 'supportText', 'alternatives', 'expectedAnswer', 'gradingCriteria'],
        message: 'Adapte a complexidade para a etapa e série avaliadas, mantendo o tema da planilha, a habilidade BNCC e o objetivo da questão.',
      })
    case 'resposta_substantiva':
      return diagnostic({
        ...common,
        code: 'CURRICULUM_LEAK',
        repairAction: 'reparo_local',
        fields: question.type === 'objetiva' && question.correctLetter ? [`alternatives.${question.correctLetter}`] : ['expectedAnswer'],
        alternativeLetter: question.type === 'objetiva' ? question.correctLetter ?? null : null,
        protectedFields: ['statement', 'supportText', 'correctLetter'],
        message: issue.reason,
      })
    case 'copia_escopo_curricular':
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
  if (/conferencia deterministica|calendario deterministico/.test(normalized)) {
    return diagnostic({ code: 'CALCULATION_UNVERIFIED', severity: 'revisao_humana', repairAction: 'revisao_humana', fields: [], message: 'A conferência determinística encontrou divergência na resposta. Mantenha a questão pendente para revisão; não altere o gabarito automaticamente.', evidence: text, blocksApproval: true })
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
    return diagnostic({ code: 'IMAGE_DEPENDENCY_REVIEW', severity: 'revisao_humana', repairAction: 'revisao_humana', fields: [], message: 'O recurso visual não está disponível. O Jev deve confirmar se a questão pode ser resolvida sem foto; mantenha o rascunho para revisão.', evidence: text, blocksApproval: true })
  }
  if (/dominio.*recalculador|motor de regras|recalculo falhou|ficha tecnica/.test(normalized)) {
    return diagnostic({ code: 'UNSUPPORTED_MATH_DOMAIN', severity: 'revisao_humana', repairAction: 'revisao_humana', fields: ['statement', 'alternatives', 'correctLetter', 'solutionBlueprint'], message: 'O cálculo não pôde ser verificado automaticamente.', evidence: text, blocksApproval: true })
  }
  if (/calendario deterministico|data ou o intervalo.*calendario/.test(normalized)) {
    return diagnostic({ code: 'CALCULATION_UNVERIFIED', severity: 'revisao_humana', repairAction: 'revisao_humana', fields: ['statement', 'alternatives', 'correctLetter', 'expectedAnswer'], message: 'A data ou o intervalo precisa de conferência humana; o rascunho foi preservado.', evidence: text, blocksApproval: true })
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
  const result = payload.metadata.qualityTest?.reports?.at(-1)?.results.find((result) => result.questionNumber === questionNumber)
  const question = payload.questions.find((item) => item.number === questionNumber)
  // A provider failure is operational, never a pedagogical finding for the teacher.
  if (question?.source === 'enem_bank' && !['official_bank_verified', 'official_bank_invalid'].includes(result?.auditStatus ?? '')) return []
  return (result?.diagnostics ?? []).filter((item) => !(result?.auditStatus === 'jev_unavailable' && item.fields.length === 0))
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
