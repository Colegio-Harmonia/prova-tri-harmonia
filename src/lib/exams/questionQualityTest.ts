import { createHash } from 'node:crypto'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import type { CurriculumSelection } from '@/types/exam'
import { judgeQuestionQuality, type QualityJudgeVerdict, type QuestionQualityAuditMode } from '@/lib/ai/questionQualityDecision'
import { curriculumLeakageIssues } from '@/lib/generation/curriculumLeakage'
import { detectAlternativeAmbiguities } from '@/lib/generation/alternatives'
import { diversityIssues } from '@/lib/generation/coherence'
import { hasMissingRequiredVisual } from '@/lib/illustrations/recommendations'
import type { ExamQualityIssue } from './examQualityAssembly'
import { diagnosticFromIssue, diagnosticFromJevIssue, humanReviewApprovalBlocks, unsupportedMathDiagnostics, type QualityDiagnostic } from './qualityDiagnostics'
import { referencesMissingVisual } from './examVisualReview'
import { getOfficialBnccSkill } from '@/lib/curriculum/officialBncc'
import { validateSolutionBlueprint } from '@/lib/math/solutionBlueprint'
import { mapInBatches, QUESTION_GENERATION_CONCURRENCY } from './questionConcurrency'
import { enemOriginalIssues, loadEnemOriginals } from './enemOriginalQuality'

type JudgeReport = {
  questionNumber: number
  questionFingerprint: string
  approved: boolean
  auditStatus?: 'jev_audited' | 'jev_unavailable' | 'corrected_without_reaudit' | 'correction_unavailable' | 'official_bank_verified' | 'official_bank_invalid'
  verdictReason: string
  checks: QualityCheck[]
  answerKeyAudit?: { declaredLetter: string | null; independentlyDerivedLetter: string | null; matchesDeclared: boolean; evidence: string } | null
  issues: Array<{ reason: string; severity: 'bloqueante' | 'alerta'; criterion?: string }>
  diagnostics?: QualityDiagnostic[]
}

function normalized(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ') }

function brazilianNumber(value: string) { return Number(value.replace(/\./g, '').replace(',', '.')) }

function calendarOffsetIssue(question: ExamQuestion): string | null {
  const text = `${question.statement}\n${question.supportText ?? ''}`
  const match = text.match(/(\d+)\s+dias?\s+(?:ap[oó]s|depois de)\s+(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i)
  if (!match) return /\b(?:quantos dias|que dia|qual data|data.*(?:depois|antes)|\d+\s+(?:semanas?|meses?|anos?)\s+(?:ap[oó]s|depois de))\b/i.test(text)
    ? `Questão ${question.number}: a operação com datas ainda não tem um verificador de calendário determinístico compatível e exige revisão humana.`
    : null
  const [, daysText, dayText, monthText, yearText] = match
  const days = Number(daysText)
  const day = Number(dayText)
  const month = Number(monthText)
  const year = Number(yearText)
  const start = new Date(Date.UTC(year, month - 1, day))
  if (start.getUTCFullYear() !== year || start.getUTCMonth() !== month - 1 || start.getUTCDate() !== day || !Number.isSafeInteger(days)) {
    return `Questão ${question.number}: a data ou o intervalo de dias não pôde ser validado no calendário.`
  }
  start.setUTCDate(start.getUTCDate() + days)
  const expected = `${String(start.getUTCDate()).padStart(2, '0')}/${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}`
  const answer = question.type === 'objetiva'
    ? question.alternatives?.find((alternative) => alternative.letter === question.correctLetter)?.text ?? ''
    : question.expectedAnswer ?? ''
  const formats = [expected, `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`]
  if (!formats.some((date) => answer.includes(date))) {
    return `Questão ${question.number}: o calendário determinístico calculou ${expected}, mas a resposta/gabarito não registra essa data. A questão fica pendente para revisão.`
  }
  return null
}

export type QualityCheck = { criterion: string; status: 'aprovado' | 'reprovado' | 'não_aplicável'; evidence: string }

export type QualityReportResult = {
  questionNumber: number
  questionFingerprint: string
  approved: boolean
  auditStatus?: 'jev_audited' | 'jev_unavailable' | 'corrected_without_reaudit' | 'correction_unavailable' | 'official_bank_verified' | 'official_bank_invalid'
  verdictReason?: string
  checks?: QualityCheck[]
  answerKeyAudit?: { declaredLetter: string | null; independentlyDerivedLetter: string | null; matchesDeclared: boolean; evidence: string } | null
  issues: Array<{ severity: 'bloqueante' | 'alerta'; reason: string }>
  diagnostics?: QualityDiagnostic[]
}

/** Identifica exatamente o conteúdo que recebeu o parecer do Jev. */
export function questionQualityFingerprint(question: ExamQuestion, classLabel?: string): string {
  const auditedContent = {
    number: question.number,
    classLabel: classLabel?.trim() || null,
    source: question.source,
    type: question.type,
    statement: question.statement,
    supportText: question.supportText,
    alternatives: question.alternatives,
    correctLetter: question.correctLetter,
    expectedAnswer: question.expectedAnswer,
    gradingCriteria: question.gradingCriteria,
    bnccCodes: question.bnccCodes,
    bnccStatus: question.bnccStatus,
    bnccSummary: question.bnccSummary,
    solutionBlueprint: question.solutionBlueprint,
    needsImage: question.needsImage,
    visualPlan: question.visualPlan,
    ...(question.source === 'enem_bank' ? { bankReference: question.enemBankRef, bankMedia: question.image?.driveFileId ?? null } : {}),
  }
  return createHash('sha256').update(JSON.stringify(auditedContent)).digest('hex')
}

// Critérios do parecer tipado do Jev que bloqueiam a aprovação.
const JEV_BLOCKING_CRITERIA = new Set(['gabarito', 'unicidade', 'linguagem_turma', 'dependencia_visual', 'resposta_substantiva', 'resposta_exposta_enunciado', 'resposta_induzida', 'informacao_suficiente', 'copia_escopo_curricular', 'apoio_autossuficiente', 'resposta_copiavel_apoio', 'alternativas_homogeneas', 'alternativa_formato_outlier', 'alternativa_completa', 'objetiva_exige_desenvolvimento', 'alternativa_exibe_calculo', 'alternativa_comentario_correcao', 'alternativa_revela_resposta', 'resposta_unica', 'fatos_corretos', 'correcao_objetiva'])

// O modelo às vezes devolve status "reprovado" com uma evidência que, na
// prática, diz que o critério NÃO se aplica (ex.: cálculo_ou_dados numa
// questão discursiva de Química). Isso é uma inconsistência do relatório,
// não uma falha da questão. Detectamos pelo texto normalizado (sem acento).
const NOT_APPLICABLE_EVIDENCE = /nao aplic|nao se aplic|nao e aplicavel|sem calculo|nao envolve calculo|nao ha calculo|nao possui calculo|nao se trata de calculo|analise conceitual, sem|conceitual, sem calculo/i

export function isNotApplicableEvidence(evidence: string): boolean {
  return NOT_APPLICABLE_EVIDENCE.test(normalized(evidence))
}

/**
 * Normaliza os critérios do relatório: um "reprovado" cuja evidência diz
 * "não aplicável" vira "não_aplicável" e deixa de bloquear a aprovação.
 * Usado tanto ao gerar o relatório quanto ao lê-lo (inclusive de provas
 * antigas já persistidas).
 */
export function normalizeQualityChecks(checks: QualityCheck[] | undefined): QualityCheck[] {
  return (checks ?? []).map((check) =>
    check.status === 'reprovado' && isNotApplicableEvidence(check.evidence)
      ? { ...check, status: 'não_aplicável' as const }
      : check,
  )
}

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

/** Conferências auxiliares; os resultados são enviados ao Jev como evidência. */
export function deterministicQuestionQualityIssues(questions: ExamQuestion[], curriculum?: CurriculumSelection, purpose: 'audit' | 'approval' = 'audit'): ExamQualityIssue[] {
  const issues: ExamQualityIssue[] = diversityIssues(questions)
  for (const question of questions) {
    const invalidBnccCodes = question.bnccCodes.filter((code) => !getOfficialBnccSkill(code))
    if (invalidBnccCodes.length) {
      issues.push({
        questionNumbers: [question.number],
        severity: 'bloqueante',
        reason: `Código(s) BNCC sem registro oficial em @bncc/dados: ${invalidBnccCodes.join(', ')}.`,
      })
    }
    if (curriculum && question.source === 'ia') {
      for (const leak of curriculumLeakageIssues(question, curriculumScopeFor(curriculum, question))) {
        issues.push({ questionNumbers: [question.number], severity: leak.severity, reason: leak.reason })
      }
    }
    if (purpose === 'audit' && question.solutionBlueprint) {
      for (const issue of validateSolutionBlueprint(question)) {
        issues.push({ questionNumbers: [question.number], severity: 'bloqueante', reason: `Conferência determinística da resposta: ${issue}` })
      }
    }
    const dateIssue = calendarOffsetIssue(question)
    if (dateIssue) issues.push({ questionNumbers: [question.number], severity: 'bloqueante', reason: dateIssue })
    for (const diagnostic of unsupportedMathDiagnostics(question, curriculum?.subject ?? '')) {
      issues.push({ questionNumbers: [question.number], severity: diagnostic.blocksApproval ? 'bloqueante' : 'alerta', reason: diagnostic.message })
    }
    if (hasMissingRequiredVisual(question)) {
      issues.push({ questionNumbers: [question.number], severity: 'bloqueante', reason: 'A questão depende de uma figura, imagem, gráfico, mapa ou diagrama que não foi fornecido.' })
    }
    if (question.type !== 'objetiva' || !question.alternatives) continue
    // Pares de alternativas defensáveis: duplicadas, numericamente
    // equivalentes, quase idênticas ou separadas por negação.
    // Estes indícios orientam a revisão; não vetam a decisão de aprovação.
    for (const ambiguity of purpose === 'audit' ? detectAlternativeAmbiguities(question.alternatives) : []) {
      issues.push({ questionNumbers: [question.number], severity: ambiguity.severity, reason: ambiguity.reason })
    }
    const interest = compoundInterestIssue(question)
    if (interest) issues.push(interest)
  }
  return issues
}

/** Evidência recalculada localmente para o Jev; ela informa uma divergência sem aprovar ou reparar por conta própria. */
export function solutionBlueprintEvidence(question: ExamQuestion): string[] {
  if (!question.solutionBlueprint) return []
  return validateSolutionBlueprint(question).map((issue) =>
    `${issue} Resposta derivada informada pela ficha técnica: (${question.solutionBlueprint?.derivedAnswer ?? 'ausente'}). É evidência preliminar; a decisão de qualidade cabe ao Jev.`,
  )
}

/** A habilidade vem do código BNCC; o tema e os fatos continuam vindo da planilha escolar. */
export function skillsFor(curriculum: CurriculumSelection, question: Pick<ExamQuestion, 'bnccCodes' | 'bnccStatus' | 'bnccSummary'>): Array<{ code: string; description: string; context?: string[]; source?: string; dataVersion?: string }> {
  return question.bnccCodes.flatMap((code) => {
    const official = getOfficialBnccSkill(code)
    if (!official) return []
    return [{ code: official.code, description: official.text, context: official.context, source: official.source, dataVersion: official.dataVersion }]
  })
}

export function curriculumScopeFor(curriculum: CurriculumSelection, question: Pick<ExamQuestion, 'curriculumUnitRowIndex'>): string {
  const unit = curriculum.units.find((candidate) => candidate.rowIndex === question.curriculumUnitRowIndex) ?? (curriculum.units.length === 1 ? curriculum.units[0] : undefined)
  const units = unit ? [unit] : curriculum.units
  return units.flatMap((item) => [item.tituloCapitulo, item.conteudo, item.enrichedContent]).filter(Boolean).join('\n')
}

/** Converte o parecer do Jev no formato de relatório que a UI e a barreira de aprovação já consomem. */
export function reportFromJudgeVerdict(question: ExamQuestion, verdict: QualityJudgeVerdict, classLabel?: string): JudgeReport {
  const checks: QualityCheck[] = []
  const hasBlockingComposite = verdict.issues.some((issue) => issue.criterion === 'composto' && issue.severity === 'bloqueante')
  // O bloqueio composto significa que os critérios em alerta, juntos,
  // reprovam a questão. Promova cada causa para o contrato de correção e
  // retire o diagnóstico genérico que não diz ao gerador o que mudar.
  const actionableIssues = verdict.issues
    .filter((issue) => !(hasBlockingComposite && issue.criterion === 'composto'))
    .map((issue) => hasBlockingComposite && issue.severity === 'alerta' ? { ...issue, severity: 'bloqueante' as const } : issue)
  const issueByCriterion = new Map(actionableIssues.map((issue) => [issue.criterion, issue]))
  for (const [criterion, score] of Object.entries(verdict.scores)) {
    const issue = issueByCriterion.get(criterion as never)
    checks.push({
      criterion,
      status: issue?.severity === 'bloqueante' ? 'reprovado' : 'aprovado',
      evidence: issue ? `Jev (${Math.round(score * 100)}%): ${issue.reason}` : `Jev (${Math.round(score * 100)}%): sem indício de problema.`,
    })
  }
  let answerKeyAudit: JudgeReport['answerKeyAudit'] = null
  if (verdict.answerKey) {
    const key = verdict.answerKey
    const confidence = key.confidence === null ? '' : ` com confiança de ${Math.round(key.confidence * 100)}%`
    const evidence = key.matches
      ? `O Jev resolveu a questão de forma independente e chegou à alternativa ${key.independentLetter}${confidence}.`
      : `O Jev resolveu a questão de forma independente e chegou à alternativa ${key.independentLetter}${confidence}, não à ${key.declaredLetter ?? 'declarada'}.`
    answerKeyAudit = { declaredLetter: key.declaredLetter, independentlyDerivedLetter: key.independentLetter, matchesDeclared: key.matches, evidence }
    checks.push({ criterion: 'gabarito', status: key.matches && key.confidence !== null && key.confidence >= 0.6 ? 'aprovado' : 'reprovado', evidence })
  } else if (question.type === 'objetiva' && question.solutionBlueprint) {
    const deterministicIssues = validateSolutionBlueprint(question)
    const hasDeclaredAlternative = Boolean(question.correctLetter && question.alternatives?.some((alternative) => alternative.letter === question.correctLetter))
    const passed = deterministicIssues.length === 0 && hasDeclaredAlternative
    const evidence = deterministicIssues.length
      ? `A conferência determinística divergiu: ${deterministicIssues.join(' ')}`
      : !hasDeclaredAlternative
        ? 'A conferência determinística não pode aprovar o gabarito: falta uma alternativa marcada válida.'
        : 'O gabarito confere com a resposta recalculada a partir da ficha técnica determinística.'
    answerKeyAudit = {
      declaredLetter: question.correctLetter ?? null,
      independentlyDerivedLetter: passed ? question.correctLetter ?? null : null,
      matchesDeclared: passed,
      evidence,
    }
    checks.push({ criterion: 'gabarito', status: passed ? 'aprovado' : 'reprovado', evidence })
  }
  if (verdict.imageDependency) {
    const image = verdict.imageDependency
    const confidenceText = image.confidence === null ? 'sem confiança informada' : `confiança ${Math.round(image.confidence * 100)}%`
    const resolved = image.decision === 'resolvivel_sem_foto' && image.confidence !== null && image.confidence >= 0.7
    checks.push({ criterion: 'dependencia_visual', status: resolved ? 'aprovado' : 'reprovado', evidence: `Jev respondeu “é possível resolver sem foto?”: ${image.decision}; ${confidenceText}.` })
  }
  const blocked = verdict.issues.filter((issue) => issue.severity === 'bloqueante')
  if (verdict.alternativeOutlier && !verdict.issues.some((issue) => issue.criterion === 'alternativa_formato_outlier')) {
    checks.push({ criterion: 'alternativa_formato_outlier', status: 'aprovado', evidence: `Jev apontou ${verdict.alternativeOutlier.letter} com confiança abaixo do limite de reprovação.` })
  }
  return {
    questionNumber: question.number,
    questionFingerprint: questionQualityFingerprint(question, classLabel),
    approved: !blocked.length,
    auditStatus: 'jev_audited',
    verdictReason: blocked.length
      ? `Reprovada pelo juiz Jev: ${blocked.map((issue) => issue.criterion).join(', ')}.`
      : verdict.issues.length ? 'Aprovada pelo juiz Jev com pontos de atenção para a revisão docente.' : 'Aprovada pelo juiz Jev, sem indícios de problema.',
    checks,
    answerKeyAudit,
    issues: verdict.issues.map((issue) => ({ severity: issue.severity, criterion: issue.criterion, reason: issue.reason })),
    diagnostics: actionableIssues.map((issue) => diagnosticFromJevIssue(issue, question, verdict.answerKey ? {
      declaredLetter: verdict.answerKey.declaredLetter,
      independentLetter: verdict.answerKey.independentLetter,
      confidence: verdict.answerKey.confidence,
      matches: verdict.answerKey.matches,
    } : null)),
  }
}

/**
 * Gate semântico independente do gerador, decidido pelo Jev (probabilidades e
 * escolha tipadas com limiares calibrados) e não por um LLM em texto livre.
 * Ele resolve a questão por conta própria para conferir o gabarito e mede
 * cópia do escopo curricular, resposta tautológica, alternativas desiguais,
 * fatos incorretos e critérios de correção inúteis.
 */
export async function runQuestionQualityTest(
  curriculum: CurriculumSelection,
  questions: ExamQuestion[],
  generatedEvidence: Map<number, string[]> = new Map(),
  classLabel?: string,
  onQuestionStart?: (questionNumber: number) => Promise<void> | void,
  onQuestionComplete?: (report: JudgeReport) => Promise<void> | void,
  auditMode: QuestionQualityAuditMode = 'full',
) {
  // The semantic audit and deterministic evidence belong to one complete
  // question. Cross-question variety is handled by the exam assembly checks.
  const deterministic = auditMode === 'full'
    ? questions.filter((question) => question.source !== 'enem_bank').flatMap((question) => deterministicQuestionQualityIssues([question], curriculum))
    : questions.flatMap((question) => [
      ...(question.solutionBlueprint ? validateSolutionBlueprint(question).map((reason) => ({ questionNumbers: [question.number], severity: 'bloqueante' as const, reason: `Conferência determinística da resposta: ${reason}` })) : []),
      ...(calendarOffsetIssue(question) ? [{ questionNumbers: [question.number], severity: 'bloqueante' as const, reason: calendarOffsetIssue(question)! }] : []),
    ])
  const reports: JudgeReport[] = []
  const warnings: string[] = []
  const originals = await loadEnemOriginals(questions)
  const auditQuestion = async (question: ExamQuestion): Promise<{ report: JudgeReport; warnings: string[] }> => {
    if (question.source === 'enem_bank') {
      const reasons = enemOriginalIssues(question, originals.get(question.enemBankRef?.questionId ?? -1))
      return { report: {
        questionNumber: question.number,
        questionFingerprint: questionQualityFingerprint(question, classLabel),
        approved: reasons.length === 0,
        auditStatus: reasons.length ? 'official_bank_invalid' : 'official_bank_verified',
        verdictReason: reasons.length ? 'O item precisa corresponder ao original do banco.' : 'Texto, alternativas e gabarito conferidos com o banco original do ENEM.',
        checks: [],
        issues: reasons.map((reason) => ({ severity: 'bloqueante', reason })),
        diagnostics: reasons.map((reason) => diagnosticFromIssue({ reason, severity: 'bloqueante' })),
      }, warnings: [] }
    }
    const answerEvidence = [
      ...unsupportedMathDiagnostics(question, curriculum.subject).map((diagnostic) => diagnostic.message),
      ...solutionBlueprintEvidence(question),
    ]
    const verdict = await judgeQuestionQuality({
      auditMode,
      subject: curriculum.subject,
      gradeYear: curriculum.gradeYear,
      segment: curriculum.segment,
      classLabel,
      question,
      curriculumScope: curriculumScopeFor(curriculum, question),
      skills: skillsFor(curriculum, question),
      verificationEvidence: auditMode === 'answers' ? answerEvidence : [
        ...(generatedEvidence.get(question.number) ?? []),
        ...deterministic.filter((issue) => issue.questionNumbers.includes(question.number)).map((issue) => issue.reason),
        ...unsupportedMathDiagnostics(question, curriculum.subject).map((diagnostic) => diagnostic.message),
      ],
    }, { auditMode })
    if (!verdict.available) {
      return {
        report: {
          questionNumber: question.number,
          questionFingerprint: questionQualityFingerprint(question, classLabel),
          approved: false,
          auditStatus: 'jev_unavailable',
          verdictReason: 'Sem parecer do Jev, a qualidade desta questão não pode ser aprovada.',
          checks: [],
          issues: verdict.issues.map((issue) => ({ severity: issue.severity, reason: issue.reason })),
          diagnostics: [{
            code: 'REGENERATE_QUESTION',
            severity: 'revisao_humana',
            repairAction: 'revisao_humana',
            fields: [],
            protectedFields: [],
            message: 'O Jev não concluiu a avaliação. Reexecute a análise antes de aprovar esta questão.',
            evidence: verdict.issues.map((issue) => issue.reason).join('; '),
            blocksApproval: true,
          }],
        },
        warnings: [`Questão ${question.number}: o juiz de qualidade (Jev) não respondeu nesta tentativa.`],
      }
    }
    return { report: reportFromJudgeVerdict(question, verdict, classLabel), warnings: [] }
  }
  // Cada chamada recebe uma questão completa. Limite de três mantém uma
  // concorrência previsível sem misturar itens em uma única decisão do Jev.
  for (let offset = 0; offset < questions.length; offset += QUESTION_GENERATION_CONCURRENCY) {
    const group = questions.slice(offset, offset + QUESTION_GENERATION_CONCURRENCY)
    const audited = await mapInBatches(group, async (question) => {
      await onQuestionStart?.(question.number)
      const item = await auditQuestion(question)
      await onQuestionComplete?.(item.report)
      return item
    })
    for (const item of audited) {
      reports.push(item.report)
      warnings.push(...item.warnings)
    }
  }
  const semantic: ExamQualityIssue[] = reports.flatMap((result) => result.issues.map((issue) => ({
    questionNumbers: [result.questionNumber],
    severity: issue.severity,
    reason: `Teste de qualidade${issue.criterion ? ` — ${issue.criterion}` : ''}: ${issue.reason}`,
  } satisfies ExamQualityIssue)))
  // Divergências determinísticas em cálculo e estrutura bloqueiam por código;
  // as decisões pedagógicas continuam sob avaliação do Jev.
  const allIssues = [...semantic, ...deterministic]
  const rejected = [...new Set(allIssues.filter((issue) => issue.severity === 'bloqueante').flatMap((issue) => issue.questionNumbers))]
  const report = questions.map((question) => {
    const semanticResult = reports.find((result) => result.questionNumber === question.number)
    const questionIssues = allIssues.filter((issue) => issue.questionNumbers.includes(question.number))
    const semanticIssues = questionIssues.map((issue) => ({ severity: issue.severity, reason: issue.reason }))
    const diagnostics = [
      ...(semanticResult?.diagnostics ?? []),
      ...deterministic.filter((issue) => issue.questionNumbers.includes(question.number)).map((issue) => diagnosticFromIssue(issue)),
    ]
    return {
      questionNumber: question.number,
      questionFingerprint: questionQualityFingerprint(question, classLabel),
      approved: semanticResult?.approved === true && !questionIssues.some((issue) => issue.severity === 'bloqueante'),
      auditStatus: semanticResult?.auditStatus,
      verdictReason: semanticResult?.verdictReason,
      checks: semanticResult ? normalizeQualityChecks(semanticResult.checks) : undefined,
      // A aprovação final precisa desta evidência estruturada: sem ela a tela
      // pode mostrar "Aprovada", mas a barreira não tem como comprovar o gabarito.
      answerKeyAudit: semanticResult?.answerKeyAudit,
      issues: semanticIssues,
      diagnostics,
    }
  })
  return { issues: allIssues, warnings, rejected, checked: questions.map((question) => question.number), report }
}

/** Marca uma versão pós-correção sem afirmar que o Jev aprovou o novo texto. */
export function reportAfterCorrectionWithoutReaudit(
  previous: QualityReportResult,
  question: ExamQuestion,
  correctionApplied: boolean,
  classLabel?: string,
): QualityReportResult {
  const auditStatus = correctionApplied ? 'corrected_without_reaudit' : 'correction_unavailable'
  const reason = correctionApplied
    ? 'Correção automática processada. A versão corrigida foi incluída sem nova avaliação do Jev, conforme configuração solicitada.'
    : 'Não foi possível aplicar uma alteração automática. A versão original foi incluída sem nova avaliação do Jev, conforme configuração solicitada.'
  return {
    ...previous,
    questionNumber: question.number,
    questionFingerprint: questionQualityFingerprint(question, classLabel),
    approved: true,
    auditStatus,
    verdictReason: reason,
    answerKeyAudit: null,
    issues: (previous.issues ?? []).map((issue) => ({ severity: 'alerta' as const, reason: `Diagnóstico da versão inicial: ${issue.reason}` })),
    diagnostics: (previous.diagnostics ?? []).map((item) => ({
      ...item,
      severity: 'alerta' as const,
      repairAction: 'nenhuma' as const,
      message: `Diagnóstico da versão inicial (sem reauditoria): ${item.message}`,
      blocksApproval: false,
    })),
  }
}

/**
 * Última barreira antes de gerar os documentos. Não basta o cartão visual
 * dizer "Aprovada": cada objetiva precisa ter uma auditoria independente
 * confirmando a mesma letra do gabarito.
 */
export function qualityApprovalBlocks(payload: ExamGenerationResult, curriculum?: CurriculumSelection): string[] {
  const officialBlocks = payload.questions.filter((q) => q.source === 'enem_bank').flatMap((question) => {
    const result = payload.metadata.qualityTest?.reports?.at(-1)?.results.find((r) => r.questionNumber === question.number)
    if (result?.auditStatus === 'official_bank_invalid' && result.questionFingerprint === questionQualityFingerprint(question, payload.metadata.classLabel)) {
      return result.issues.filter((issue) => issue.severity === 'bloqueante').map((issue) => issue.reason)
    }
    if (result?.auditStatus !== 'official_bank_verified' || !result.approved || result.questionFingerprint !== questionQualityFingerprint(question, payload.metadata.classLabel)) {
      return [`Questão ${question.number}: o original do banco ainda precisa ser conferido.`]
    }
    return result.issues.filter((issue) => issue.severity === 'bloqueante').map((issue) => issue.reason)
  })
  if (payload.questions.length && payload.questions.every((q) => q.source === 'enem_bank')) return [...new Set(officialBlocks)]
  if (payload.metadata.generationEngine === 'whole-exam-v1') {
    const blocks: string[] = [...officialBlocks]
    for (const question of payload.questions) {
      if (referencesMissingVisual(question)) blocks.push(`Questão ${question.number}: o enunciado faz referência a uma figura ausente.`)
      if (question.visualReview?.status === 'pending' && question.review?.adequacy !== 'adequada') blocks.push(`Questão ${question.number}: revisão visual automática pendente; confira a questão e registre sua decisão.`)
      if (!question.statement.trim()) blocks.push(`Questão ${question.number}: enunciado vazio.`)
      if (question.type === 'objetiva' && (!question.correctLetter || !question.alternatives?.some((alternative) => alternative.letter === question.correctLetter))) {
        blocks.push(`Questão ${question.number}: gabarito ou alternativas inválidos.`)
      }
      if (question.type === 'descritiva' && (!question.expectedAnswer?.trim() || !question.gradingCriteria?.trim())) {
        blocks.push(`Questão ${question.number}: resposta esperada ou critérios de correção ausentes.`)
      }
      if ((question.needsImage ?? question.hasImage) && !question.image) {
        blocks.push(`Questão ${question.number}: imagem obrigatória ainda não foi produzida.`)
      }
    }
    blocks.push(...deterministicQuestionQualityIssues(payload.questions.filter((q) => q.source !== 'enem_bank'), curriculum, 'approval')
      .filter((issue) => issue.severity === 'bloqueante')
      .map((issue) => issue.reason))
    blocks.push(...humanReviewApprovalBlocks(payload))
    return [...new Set(blocks)]
  }
  const reports = payload.metadata.qualityTest?.reports
  const latest = reports?.at(-1)?.results
  if (!latest) return ['O teste de qualidade não possui relatório final; regenere ou execute a auditoria antes de aprovar.']

  const blocks: string[] = [...officialBlocks]
  for (const question of payload.questions) {
    if (question.source === 'enem_bank') continue
    const result = latest.find((candidate) => candidate.questionNumber === question.number)
    if (!result) {
      blocks.push(`Questão ${question.number}: ausente do relatório final de qualidade.`)
      continue
    }
    if (result.auditStatus === 'corrected_without_reaudit' || result.auditStatus === 'correction_unavailable') {
      if (question.type === 'objetiva' && (!question.correctLetter || !question.alternatives?.some((alternative) => alternative.letter === question.correctLetter))) {
        blocks.push(`Questão ${question.number}: correção sem reauditoria deixou gabarito ou alternativas inválidos.`)
      }
      continue
    }
    // A leitura também normaliza ("reprovado" com evidência de não
    // aplicável não bloqueia) e ignora o booleano `approved` cru do modelo:
    // o que bloqueia é evidência concreta do Jev em um critério bloqueante.
    const checks = normalizeQualityChecks(result.checks)
    const humanReviews = (result.diagnostics ?? []).filter((item) => item.blocksApproval && item.repairAction === 'revisao_humana')
    const humanAcknowledged = question.review?.adequacy === 'adequada'
    const rejectedCheck = checks.find((check) => check.status === 'reprovado' && JEV_BLOCKING_CRITERIA.has(check.criterion) && !(humanAcknowledged && (check.criterion === 'dependencia_visual' || check.criterion === 'linguagem_turma' || (check.criterion === 'gabarito' && humanReviews.some((item) => item.code === 'PEDAGOGICAL_REVIEW')))))
    const blockingIssue = result.issues.find((issue) =>
      issue.severity === 'bloqueante' &&
      !isNotApplicableEvidence(issue.reason) &&
      !(humanAcknowledged && humanReviews.some((item) =>
        issue.reason.includes(item.message) ||
        item.message.includes(issue.reason) ||
        Boolean(item.evidence && issue.reason.includes(item.evidence)),
      )),
    )
    if (rejectedCheck || blockingIssue) {
      blocks.push(`Questão ${question.number}: o relatório de qualidade a reprovou.`)
    }
    if (question.type === 'objetiva') {
      const audit = result.answerKeyAudit
      const answerKeyCheck = checks.filter((check) => check.criterion === 'gabarito')
      if (answerKeyCheck.length !== 1 || answerKeyCheck[0]?.status !== 'aprovado') {
        blocks.push(`Questão ${question.number}: o relatório não aprovou explicitamente o gabarito.`)
      }
      if (!audit || audit.declaredLetter !== question.correctLetter || audit.independentlyDerivedLetter !== question.correctLetter || !audit.matchesDeclared) {
        blocks.push(`Questão ${question.number}: falta confirmação independente de que o gabarito (${question.correctLetter ?? 'ausente'}) é a alternativa correta.`)
      }
    }
  }
  blocks.push(...humanReviewApprovalBlocks(payload))
  return [...new Set(blocks)]
}
