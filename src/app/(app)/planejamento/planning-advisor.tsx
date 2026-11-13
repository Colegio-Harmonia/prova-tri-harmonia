'use client'

import { useState } from 'react'
import { SEGMENT_GRADES, SEGMENT_LABELS, SEGMENT_SUBJECTS } from '@/config/subjects'
import type { Segment } from '@/types/exam'
import type { ChapterAnalysis, ChapterIssue, EnemCoverage, PlanningAnalysis, PlanningFinding } from '@/lib/planningAdvisor/analyzePlanning'
import { BLOOM_ORDER } from '@/lib/planningAdvisor/analyzePlanning'
import type { AdvisorRecommendations, ChapterSuggestions, EnemSkillSuggestion, SuggestionConfidence } from '@/lib/planningAdvisor/recommendations'

type Report = { analysis: PlanningAnalysis; recommendations: AdvisorRecommendations | null }
type Severity = PlanningFinding['severity']

const SEVERITY_CLASS: Record<Severity, string> = {
  alta: 'border-status-danger-border bg-status-danger-surface text-status-danger-content',
  media: 'border-status-warning-border bg-status-warning-surface text-status-warning-content',
  info: 'border-border bg-surface-subtle text-content-secondary',
}
const SEVERITY_LABEL: Record<Severity, string> = { alta: 'Prioridade', media: 'Atenção', info: 'Informação' }
const CONFIDENCE_LABEL: Record<SuggestionConfidence, string> = { alta: 'Relação direta', media: 'Depende da condução da aula', baixa: 'Possibilidade' }
const BLOOM_LABEL: Record<string, string> = { lembrar: 'Lembrar', compreender: 'Compreender', aplicar: 'Aplicar', analisar: 'Analisar', avaliar: 'Avaliar', criar: 'Criar' }
const fieldClass = 'rounded border border-border bg-canvas px-3 py-2'

function Badge({ severity, children }: { severity: Severity; children: React.ReactNode }) {
  return <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${SEVERITY_CLASS[severity]}`}>{children}</span>
}

function CopyCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(codes.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setCopied(false) }
  }
  return <button type="button" onClick={copy} className="rounded border border-border px-2 py-1 text-xs font-medium text-content-secondary hover:text-content-primary">{copied ? 'Copiado' : 'Copiar códigos para a planilha'}</button>
}

function SuggestionRow({ suggestion }: { suggestion: EnemSkillSuggestion }) {
  return <li className="text-sm">
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="font-mono text-xs font-semibold text-content-primary">{suggestion.code}</span>
      <span className="rounded border border-border px-1.5 py-0.5 text-xs text-content-secondary">{CONFIDENCE_LABEL[suggestion.confidence]}</span>
      {suggestion.fillsGap && <span className="rounded border border-status-success-border bg-status-success-surface px-1.5 py-0.5 text-xs font-medium text-status-success-content">Cobre lacuna do ano</span>}
    </div>
    <p className="mt-0.5 text-content-secondary">{suggestion.description}</p>
    <p className="mt-1 border-l-2 border-border pl-2 text-xs text-content-muted"><span className="font-semibold">Por que a IA sugeriu:</span> {suggestion.justification}</p>
  </li>
}

function ChapterCard({ chapter, suggestions, showEnem }: { chapter: ChapterAnalysis; suggestions?: ChapterSuggestions; showEnem: boolean }) {
  const visibleIssues = chapter.issues.filter((issue: ChapterIssue) => issue.severity !== 'info')
  const notes = chapter.issues.filter((issue: ChapterIssue) => issue.severity === 'info')
  return <div className="rounded border border-border p-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="font-medium">{chapter.title}</p>
      {chapter.bimestre && <span className="text-xs text-content-muted">Período: {chapter.bimestre}</span>}
    </div>
    {chapter.conteudo && <p className="mt-1 text-sm text-content-secondary">{chapter.conteudo}</p>}
    <dl className="mt-2 grid gap-1 text-xs text-content-secondary sm:grid-cols-3">
      {showEnem && <div><dt className="font-semibold text-content-primary">ENEM na planilha</dt><dd className="font-mono">{chapter.enemSkills.map((skill) => skill.count > 1 ? `${skill.code} ×${skill.count}` : skill.code).join(', ') || '—'}</dd></div>}
      <div><dt className="font-semibold text-content-primary">BNCC na planilha</dt><dd className="font-mono">{chapter.bnccCodes.join(', ') || '—'}</dd></div>
      <div><dt className="font-semibold text-content-primary">Bloom dos objetivos{chapter.bloomEstimated ? ' (estimado)' : ''}</dt><dd>{chapter.bloomLevels.map((level) => BLOOM_LABEL[level]).join(', ') || '—'}</dd></div>
    </dl>
    {visibleIssues.length > 0 && <ul className="mt-3 space-y-1">{visibleIssues.map((issue) => <li key={issue.code} className="flex flex-wrap items-baseline gap-2 text-sm"><Badge severity={issue.severity}>{SEVERITY_LABEL[issue.severity]}</Badge><span>{issue.message}</span></li>)}</ul>}
    {notes.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-content-muted">{notes.map((issue) => <li key={issue.code}>• {issue.message}</li>)}</ul>}
    {suggestions && <div className="mt-3 rounded border border-border bg-surface-subtle p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Sugestões da IA para o professor validar</p>
        <CopyCodes codes={suggestions.suggestions.map((suggestion) => suggestion.code)} />
      </div>
      <ul className="mt-2 space-y-3">{suggestions.suggestions.map((suggestion) => <SuggestionRow key={suggestion.code} suggestion={suggestion} />)}</ul>
    </div>}
  </div>
}

function EnemCoverageSection({ enem, remainingGaps }: { enem: EnemCoverage; remainingGaps: string[] | null }) {
  const gaps = enem.rows.filter((row) => !row.covered)
  const covered = enem.rows.filter((row) => row.covered)
  return <section className="rounded border border-border bg-surface p-4">
    <h2 className="font-semibold">Cobertura da Matriz do ENEM no ano</h2>
    <p className="mt-1 text-sm text-content-secondary">{enem.scope.areaLabel} · {enem.coveredCount} de {enem.rows.length} habilidades do recorte da disciplina aparecem no planejamento.</p>
    <p className="mt-1 text-xs text-content-muted">{enem.scope.note}</p>
    {gaps.length > 0 && <div className="mt-4">
      <h3 className="text-sm font-semibold">Habilidades sem cobertura ({gaps.length})</h3>
      <ul className="mt-2 space-y-2">{gaps.map((row) => <li key={row.code} className="text-sm">
        <span className="font-mono text-xs font-semibold">{row.code}</span>
        {remainingGaps?.includes(row.code) && <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs text-content-muted">Sem capítulo candidato nas sugestões</span>}
        <p className="text-content-secondary">{row.description}</p>
      </li>)}</ul>
    </div>}
    {covered.length > 0 && <details className="mt-4">
      <summary className="cursor-pointer text-sm font-semibold">Habilidades já planejadas ({covered.length})</summary>
      <ul className="mt-2 space-y-2">{covered.map((row) => <li key={row.code} className="text-sm">
        <span className="font-mono text-xs font-semibold">{row.code}</span>
        <span className="ml-2 text-xs text-content-muted">{row.occurrences} {row.occurrences === 1 ? 'ocorrência' : 'ocorrências'} · {row.chapters.map((chapter) => chapter.title).join('; ')}</span>
        <p className="text-content-secondary">{row.description}</p>
      </li>)}</ul>
    </details>}
  </section>
}

export default function PlanningAdvisor() {
  const [segment, setSegment] = useState<Segment>('ensino-medio')
  const [gradeYear, setGradeYear] = useState(1)
  const [subject, setSubject] = useState('Língua Portuguesa')
  const [withSuggestions, setWithSuggestions] = useState(true)
  const [report, setReport] = useState<Report | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  function changeSegment(value: Segment) { setSegment(value); setGradeYear(SEGMENT_GRADES[value][0]); setSubject(SEGMENT_SUBJECTS[value][0]); setReport(null) }

  async function analyze() {
    setLoading(true); setMessage(''); setReport(null)
    try {
      const response = await fetch('/api/curriculum/planning-advisor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segment, gradeYear, subject, withSuggestions: withSuggestions && segment === 'ensino-medio' }),
      })
      const body = await response.json()
      if (!response.ok) { setMessage([body.error, body.availableTabs?.length ? `Abas disponíveis: ${body.availableTabs.join(', ')}` : ''].filter(Boolean).join(' ') || 'Não foi possível analisar o planejamento.'); return }
      setReport(body)
    } catch {
      setMessage('Não foi possível analisar o planejamento. Verifique a conexão e tente de novo.')
    } finally {
      setLoading(false)
    }
  }

  const analysis = report?.analysis
  const recommendations = report?.recommendations ?? null
  const suggestionsByRow = new Map((recommendations?.chapters ?? []).map((chapter) => [chapter.rowIndex, chapter]))
  const isEnsinoMedio = segment === 'ensino-medio'

  return <div className="mt-6 space-y-5">
    <p className="text-sm text-content-secondary">O assistente lê o plano de curso do ano inteiro na planilha e aponta o que falta. No Ensino Médio, confere as habilidades da Matriz de Referência do ENEM (INEP) por capítulo; nos demais segmentos, BNCC e Bloom. Ele só recomenda: a planilha nunca é alterada.</p>
    <div className="grid gap-3 rounded border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
      <select aria-label="Segmento" disabled={loading} value={segment} onChange={(e) => changeSegment(e.target.value as Segment)} className={fieldClass}>{Object.entries(SEGMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="Série" disabled={loading} value={gradeYear} onChange={(e) => { setGradeYear(Number(e.target.value)); setReport(null) }} className={fieldClass}>{SEGMENT_GRADES[segment].map((grade) => <option key={grade} value={grade}>{grade}º ano</option>)}</select>
      <select aria-label="Disciplina" disabled={loading} value={subject} onChange={(e) => { setSubject(e.target.value); setReport(null) }} className={fieldClass}>{SEGMENT_SUBJECTS[segment].map((item) => <option key={item}>{item}</option>)}</select>
      <button type="button" disabled={loading} onClick={analyze} className="rounded bg-harmonia-green px-4 py-2 font-semibold text-action-primary-foreground disabled:opacity-50">{loading ? 'Analisando…' : 'Analisar planejamento'}</button>
      {isEnsinoMedio && <label className="flex items-center gap-2 text-sm text-content-secondary sm:col-span-2 lg:col-span-4">
        <input type="checkbox" disabled={loading} checked={withSuggestions} onChange={(e) => setWithSuggestions(e.target.checked)} />
        Pedir à IA sugestões de habilidades do ENEM por capítulo (pode levar até um minuto)
      </label>}
    </div>
    {message && <p role="status" className="rounded border border-border bg-surface p-3 text-sm text-content-secondary">{message}</p>}

    {analysis && <>
      <section className="rounded border border-border bg-surface p-4">
        <h2 className="font-semibold">{analysis.subject} · {analysis.gradeYear}º ano</h2>
        <p className="text-sm text-content-secondary">Origem: aba {analysis.tabName} · {analysis.chapters.length} capítulos · {analysis.bncc.distinctCodes} códigos BNCC distintos{analysis.enem ? ` · ${analysis.enem.coveredCount}/${analysis.enem.rows.length} habilidades ENEM cobertas` : ''}</p>
        {analysis.findings.length === 0
          ? <p className="mt-3 rounded border border-status-success-border bg-status-success-surface p-3 text-sm text-status-success-content">Nenhuma pendência encontrada neste planejamento.</p>
          : <ul className="mt-3 space-y-2">{analysis.findings.map((finding) => <li key={finding.title} className={`rounded border p-3 text-sm ${SEVERITY_CLASS[finding.severity]}`}><p className="font-semibold">{SEVERITY_LABEL[finding.severity]}: {finding.title}</p><p className="mt-1">{finding.detail}</p></li>)}</ul>}
        <p className="mt-3 text-xs text-content-muted">{analysis.saeb.note}</p>
        {analysis.bloom.total > 0 && <p className="mt-1 text-xs text-content-muted">Objetivos por nível de Bloom{analysis.bloom.allEstimated ? ' (estimado)' : ''}: {BLOOM_ORDER.filter((level) => analysis.bloom.counts[level] > 0).map((level) => `${BLOOM_LABEL[level]} ${analysis.bloom.counts[level]}`).join(' · ')}</p>}
      </section>

      {recommendations && recommendations.status !== 'ok' && recommendations.message && <p role="status" className="rounded border border-status-warning-border bg-status-warning-surface p-3 text-sm text-status-warning-content">{recommendations.message}</p>}
      {recommendations?.status === 'ok' && <p role="status" className="rounded border border-border bg-surface p-3 text-sm text-content-secondary">
        {recommendations.message ?? `A IA sugeriu habilidades para ${recommendations.chapters.length} ${recommendations.chapters.length === 1 ? 'capítulo' : 'capítulos'}. Ela só escolhe entre as habilidades oficiais do INEP; cada sugestão precisa ser validada pelo professor antes de ir para a planilha.`}
        {recommendations.discardedCount > 0 && ` ${recommendations.discardedCount} ${recommendations.discardedCount === 1 ? 'sugestão foi descartada' : 'sugestões foram descartadas'} por não conferir com a matriz.`}
      </p>}

      {analysis.enem && <EnemCoverageSection enem={analysis.enem} remainingGaps={recommendations?.status === 'ok' ? recommendations.remainingGaps : null} />}

      <section className="rounded border border-border bg-surface p-4">
        <h2 className="font-semibold">Capítulo por capítulo</h2>
        <div className="mt-3 space-y-2">{analysis.chapters.map((chapter) => <ChapterCard key={chapter.rowIndex} chapter={chapter} suggestions={suggestionsByRow.get(chapter.rowIndex)} showEnem={Boolean(analysis.enem)} />)}</div>
      </section>

      {analysis.sheetWarnings.length > 0 && <details className="rounded border border-border bg-surface p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Avisos da leitura da planilha ({analysis.sheetWarnings.length})</summary>
        <ul className="mt-2 space-y-1 text-content-secondary">{analysis.sheetWarnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>
      </details>}
    </>}
  </div>
}
