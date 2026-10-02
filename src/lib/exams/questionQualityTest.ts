import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import type { CurriculumSelection } from '@/types/exam'
import { judgeQuestionQuality, type QualityJudgeVerdict } from '@/lib/ai/questionQualityDecision'
import { curriculumLeakageIssues } from '@/lib/generation/curriculumLeakage'
import { detectAlternativeAmbiguities } from '@/lib/generation/alternatives'
import { diversityIssues } from '@/lib/generation/coherence'
import { hasMissingRequiredVisual } from '@/lib/illustrations/recommendations'
import type { ExamQualityIssue } from './examQualityAssembly'
import { diagnosticFromIssue, humanReviewApprovalBlocks, unsupportedMathDiagnostics, type QualityDiagnostic } from './qualityDiagnostics'
import { missingRequiredSupportTextReason } from './supportTextIntegrity'

type JudgeReport = {
  questionNumber: number
  approved: boolean
  verdictReason: string
  checks: QualityCheck[]
  answerKeyAudit?: { declaredLetter: string | null; independentlyDerivedLetter: string | null; matchesDeclared: boolean; evidence: string } | null
  issues: Array<{ reason: string; severity: 'bloqueante' | 'alerta'; criterion?: string }>
}

function normalized(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ') }

function brazilianNumber(value: string) { return Number(value.replace(/\./g, '').replace(',', '.')) }

export type QualityCheck = { criterion: string; status: 'aprovado' | 'reprovado' | 'não_aplicável'; evidence: string }

export type QualityReportResult = {
  questionNumber: number
  approved: boolean
  verdictReason?: string
  checks?: QualityCheck[]
  answerKeyAudit?: { declaredLetter: string | null; independentlyDerivedLetter: string | null; matchesDeclared: boolean; evidence: string } | null
  issues: Array<{ severity: 'bloqueante' | 'alerta'; reason: string }>
  diagnostics?: QualityDiagnostic[]
}

// Critérios que vetam a questão. Os critérios do juiz Jev (probabilidade com
// limiar calibrado) entram aqui; `linguagem`/`alinhamento` são os critérios
// legados do auditor LLM e continuam só como alerta em relatórios antigos.
const AI_BLOCKING_CRITERIA = new Set(['gabarito', 'unicidade', 'cálculo_ou_dados', 'resposta_substantiva', 'copia_escopo_curricular', 'apoio_autossuficiente', 'alternativas_homogeneas', 'resposta_unica', 'fatos_corretos', 'correcao_objetiva'])

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

/** Regras locais baratas; não substituem a revisão semântica da IA. */
export function deterministicQuestionQualityIssues(questions: ExamQuestion[], curriculum?: CurriculumSelection): ExamQualityIssue[] {
  const issues: ExamQualityIssue[] = diversityIssues(questions)
  for (const question of questions) {
    if (curriculum && question.source === 'ia') {
      for (const leak of curriculumLeakageIssues(question, curriculumScopeFor(curriculum, question))) {
        issues.push({ questionNumbers: [question.number], severity: leak.severity, reason: leak.reason })
      }
    }
    const supportTextIssue = missingRequiredSupportTextReason(question)
    if (supportTextIssue) issues.push({ questionNumbers: [question.number], severity: 'bloqueante', reason: supportTextIssue })
    if (hasMissingRequiredVisual(question)) {
      issues.push({ questionNumbers: [question.number], severity: 'bloqueante', reason: 'A questão depende de uma figura, imagem, gráfico, mapa ou diagrama que não foi fornecido.' })
    }
    if (question.type !== 'objetiva' || !question.alternatives) continue
    // Pares de alternativas defensáveis: duplicadas, numericamente
    // equivalentes, quase idênticas ou separadas por negação.
    for (const ambiguity of detectAlternativeAmbiguities(question.alternatives)) {
      issues.push({ questionNumbers: [question.number], severity: ambiguity.severity, reason: ambiguity.reason })
    }
    const interest = compoundInterestIssue(question)
    if (interest) issues.push(interest)
  }
  return issues
}

export function curriculumScopeFor(curriculum: CurriculumSelection, question: Pick<ExamQuestion, 'curriculumUnitRowIndex'>): string {
  const unit = curriculum.units.find((candidate) => candidate.rowIndex === question.curriculumUnitRowIndex) ?? (curriculum.units.length === 1 ? curriculum.units[0] : undefined)
  const units = unit ? [unit] : curriculum.units
  return units.flatMap((item) => [item.tituloCapitulo, item.conteudo, item.enrichedContent]).filter(Boolean).join('\n')
}

/** Converte o parecer do Jev no formato de relatório que a UI e a barreira de aprovação já consomem. */
export function reportFromJudgeVerdict(question: ExamQuestion, verdict: QualityJudgeVerdict): JudgeReport {
  const checks: QualityCheck[] = []
  const issueByCriterion = new Map(verdict.issues.map((issue) => [issue.criterion, issue]))
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
    checks.push({ criterion: 'gabarito', status: key.matches ? 'aprovado' : 'reprovado', evidence })
  }
  const blocked = verdict.issues.filter((issue) => issue.severity === 'bloqueante')
  return {
    questionNumber: question.number,
    approved: !blocked.length,
    verdictReason: blocked.length
      ? `Reprovada pelo juiz Jev: ${blocked.map((issue) => issue.criterion).join(', ')}.`
      : verdict.issues.length ? 'Aprovada pelo juiz Jev com pontos de atenção para a revisão docente.' : 'Aprovada pelo juiz Jev, sem indícios de problema.',
    checks,
    answerKeyAudit,
    issues: verdict.issues.map((issue) => ({ severity: issue.severity, criterion: issue.criterion, reason: issue.reason })),
  }
}

/**
 * Gate semântico independente do gerador, decidido pelo Jev (probabilidades e
 * escolha tipadas com limiares calibrados) e não por um LLM em texto livre.
 * Ele resolve a questão por conta própria para conferir o gabarito e mede
 * cópia do escopo curricular, resposta tautológica, alternativas desiguais,
 * fatos incorretos e critérios de correção inúteis.
 */
export async function runQuestionQualityTest(curriculum: CurriculumSelection, questions: ExamQuestion[]) {
  const deterministic = deterministicQuestionQualityIssues(questions, curriculum)
  const reports: JudgeReport[] = []
  const warnings: string[] = []
  const auditQuestion = async (question: ExamQuestion): Promise<{ report: JudgeReport; warnings: string[] }> => {
    // Questões reais do banco ENEM já têm gabarito oficial; não há o que julgar aqui.
    if (question.source === 'enem_bank') {
      const evidence = 'Gabarito oficial do ENEM; não é reavaliado.'
      return {
        report: {
          questionNumber: question.number,
          approved: true,
          verdictReason: 'Questão oficial do banco ENEM.',
          checks: [{ criterion: 'gabarito', status: 'aprovado', evidence }],
          answerKeyAudit: { declaredLetter: question.correctLetter ?? null, independentlyDerivedLetter: question.correctLetter ?? null, matchesDeclared: true, evidence },
          issues: [],
        },
        warnings: [],
      }
    }
    const verdict = await judgeQuestionQuality({
      subject: curriculum.subject,
      gradeYear: curriculum.gradeYear,
      segment: curriculum.segment,
      question,
      curriculumScope: curriculumScopeFor(curriculum, question),
    })
    if (!verdict.available) {
      return {
        report: {
          questionNumber: question.number,
          approved: true,
          verdictReason: 'O juiz Jev não concluiu esta análise; a questão foi encaminhada para revisão humana.',
          checks: [],
          issues: verdict.issues.map((issue) => ({ severity: issue.severity, reason: issue.reason })),
        },
        warnings: [`Questão ${question.number}: o juiz de qualidade (Jev) não respondeu nesta tentativa.`],
      }
    }
    return { report: reportFromJudgeVerdict(question, verdict), warnings: [] }
  }
  // As questões são independentes; três julgamentos em paralelo respeitam o limite do provedor.
  const concurrency = Math.max(1, Math.min(3, questions.length))
  for (let offset = 0; offset < questions.length; offset += concurrency) {
    const group = await Promise.all(questions.slice(offset, offset + concurrency).map(auditQuestion))
    for (const item of group) {
      reports.push(item.report)
      warnings.push(...item.warnings)
    }
  }
  const semantic: ExamQualityIssue[] = reports.flatMap((result) => result.issues.map((issue) => ({
    questionNumbers: [result.questionNumber],
    severity: issue.severity,
    reason: `Teste de qualidade${issue.criterion ? ` — ${issue.criterion}` : ''}: ${issue.reason}`,
  } satisfies ExamQualityIssue)))
  const rejected = [...new Set([...deterministic, ...semantic].filter((issue) => issue.severity === 'bloqueante').flatMap((issue) => issue.questionNumbers))]
  const report = questions.map((question) => {
    const semanticResult = reports.find((result) => result.questionNumber === question.number)
    const localIssues = deterministic.filter((issue) => issue.questionNumbers.includes(question.number)).map((issue) => ({ severity: issue.severity, reason: issue.reason }))
    const semanticIssues = semantic.filter((issue) => issue.questionNumbers.includes(question.number)).map((issue) => ({ severity: issue.severity, reason: issue.reason }))
    const diagnostics = [
      ...[...localIssues, ...semanticIssues].map((issue) => diagnosticFromIssue(issue)),
      ...unsupportedMathDiagnostics(question, curriculum.subject),
    ]
    return {
      questionNumber: question.number,
      approved: ![...localIssues, ...semanticIssues].some((issue) => issue.severity === 'bloqueante'),
      verdictReason: semanticResult?.verdictReason,
      checks: semanticResult ? normalizeQualityChecks(semanticResult.checks) : undefined,
      // A aprovação final precisa desta evidência estruturada: sem ela a tela
      // pode mostrar "Aprovada", mas a barreira não tem como comprovar o gabarito.
      answerKeyAudit: semanticResult?.answerKeyAudit,
      issues: [...localIssues, ...semanticIssues],
      diagnostics,
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
    const supportTextIssue = missingRequiredSupportTextReason(question)
    if (supportTextIssue) blocks.push(`Questão ${question.number}: ${supportTextIssue}`)
    const result = latest.find((candidate) => candidate.questionNumber === question.number)
    if (!result) {
      blocks.push(`Questão ${question.number}: ausente do relatório final de qualidade.`)
      continue
    }
    // A leitura também normaliza ("reprovado" com evidência de não
    // aplicável não bloqueia) e ignora o booleano `approved` cru do modelo:
    // o que bloqueia é evidência concreta.
    const checks = normalizeQualityChecks(result.checks)
    const rejectedCheck = checks.find((check) => check.status === 'reprovado' && AI_BLOCKING_CRITERIA.has(check.criterion))
    const blockingIssue = result.issues.find((issue) => issue.severity === 'bloqueante' && !isNotApplicableEvidence(issue.reason))
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
