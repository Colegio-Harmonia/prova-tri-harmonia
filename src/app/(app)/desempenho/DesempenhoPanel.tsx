'use client'

import { useDeferredValue, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

type GroupStats = Record<string, { avg: number | null; count: number }>
type BloomStats = {
  itemCount: number
  equivalentCorrect: number
  accuracyPercent: number | null
  averageScore: number | null
  confidence: 'baixa' | 'media' | 'alta'
  sampleSize: number
  insufficientSample: boolean
  evolution: Array<{ period: string; count: number; accuracyPercent: number | null }>
}
type DokStats = {
  itemCount: number
  equivalentCorrect: number
  accuracyPercent: number | null
  confidence: 'baixa' | 'media' | 'alta'
  sampleSize: number
  insufficientSample: boolean
  evolution: Array<{ period: string; count: number; accuracyPercent: number | null }>
  subjectDistribution: Array<{ subject: string; count: number }>
}
type BnccStatus = 'dominio' | 'desenvolvimento' | 'intervencao' | 'amostra_insuficiente'
type BnccGroupStats = {
  name: string
  itemCount: number
  accuracyPercent: number | null
  confidence: 'baixa' | 'media' | 'alta'
  status: BnccStatus
}
type BnccSkillStats = {
  code: string
  summary: string | null
  unitTheme: string | null
  itemCount: number
  equivalentCorrect: number
  accuracyPercent: number | null
  confidence: 'baixa' | 'media' | 'alta'
  sampleSize: number
  insufficientSample: boolean
  status: BnccStatus
  primarySubject: string
  primaryGradeYear: string
  subjects: Array<{ name: string; count: number }>
  gradeYears: Array<{ name: string; count: number }>
  evolution: Array<{ period: string; count: number; accuracyPercent: number | null }>
}
type BnccDashboardData = {
  summary: { mappedSkillCount: number; mappedItemLinks: number; unmappedItemCount: number }
  bySubject: BnccGroupStats[]
  byGradeYear: BnccGroupStats[]
  skills: BnccSkillStats[]
}
type InepAxisStats = {
  code: string
  name: string
  description: string | null
  itemCount: number
  equivalentCorrect: number
  accuracyPercent: number | null
  confidence: 'baixa' | 'media' | 'alta'
  sampleSize: number
  insufficientSample: boolean
  subjectDistribution: Array<{ subject: string; count: number }>
  evolution: Array<{ period: string; count: number; accuracyPercent: number | null }>
}
type InepAxisDashboardData = {
  summary: { classifiedItemCount: number; unclassifiedEnemItemCount: number }
  axes: InepAxisStats[]
}
type BloomDokCell = {
  bloomLevel: string
  dokLevel: string
  itemCount: number
  equivalentCorrect: number
  accuracyPercent: number | null
  sampleSize: number
  confidence: 'baixa' | 'media' | 'alta'
  insufficientSample: boolean
}
type BloomDokMatrixData = {
  summary: { itemCount: number }
  rows: Array<{ bloomLevel: string; cells: BloomDokCell[] }>
}
type SoloLevelStats = {
  level: string
  itemCount: number
  equivalentCorrect: number
  accuracyPercent: number | null
  averageScore: number | null
  confidence: 'baixa' | 'media' | 'alta'
  sampleSize: number
  insufficientSample: boolean
}
type SoloDashboardData = {
  expected: { summary: { classifiedItemCount: number; unclassifiedItemCount: number }; levels: SoloLevelStats[] }
  observed: { summary: { classifiedAnswerCount: number; unclassifiedDiscursiveAnswerCount: number }; levels: SoloLevelStats[] }
}
type CognitiveProfile = {
  studentName: string
  overallAverage: number | null
  itemAccuracyPercent: number | null
  sampleSize: number
  confidence: 'baixa' | 'media' | 'alta'
  periods: string[]
  subjects: Array<{ name: string; count: number }>
  strengths: string[]
  development: string[]
  bnccStrengths: Array<{ code: string; summary: string | null; itemCount: number; accuracyPercent: number | null }>
  bnccInterventions: Array<{ code: string; summary: string | null; itemCount: number; accuracyPercent: number | null }>
  sustainedDok: { level: string; accuracyPercent: number | null; itemCount: number } | null
  inepHighlights: Array<{ key: string; itemCount: number; accuracyPercent: number | null; averageScore: number | null }>
  limitations: string[]
}
type Performance = {
  overall: { avg: number | null; max: number; min: number; count: number } | null
  bySubject: GroupStats
  byGradeYear: GroupStats
  byBloomLevel: GroupStats
  bloomDashboard: Record<string, BloomStats>
  dokDashboard: Record<string, DokStats>
  bnccDashboard: BnccDashboardData
  inepAxisDashboard: InepAxisDashboardData
  bloomDokMatrix: BloomDokMatrixData
  soloDashboard: SoloDashboardData
  cognitiveProfiles: CognitiveProfile[]
  byProfessor: GroupStats
  topMissedQuestions: Array<{ examId: number; questionNumber: number; subject: string; gradeYear: number; errorRate: number }>
}
type UserOption = { id: number; name: string }

const BLOOM_ORDER = ['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar']
const DOK_ORDER = ['DOK_1', 'DOK_2', 'DOK_3', 'DOK_4']
const INEP_AXIS_ORDER = ['DL', 'CF', 'SP', 'CA', 'EP']
const SOLO_EXPECTED_ORDER = ['UNIESTRUTURAL', 'MULTIESTRUTURAL', 'RELACIONAL', 'ABSTRATO_AMPLIADO']
const SOLO_OBSERVED_ORDER = ['PRE_ESTRUTURAL', 'UNIESTRUTURAL', 'MULTIESTRUTURAL', 'RELACIONAL', 'ABSTRATO_AMPLIADO']
const BLOOM_LABELS: Record<string, string> = {
  lembrar: 'Lembrar', compreender: 'Compreender', aplicar: 'Aplicar', analisar: 'Analisar', avaliar: 'Avaliar', criar: 'Criar',
}
const DOK_LABELS: Record<string, string> = {
  DOK_1: 'DOK 1',
  DOK_2: 'DOK 2',
  DOK_3: 'DOK 3',
  DOK_4: 'DOK 4',
}
const INEP_AXIS_FALLBACK: Record<string, { name: string; description: string }> = {
  DL: { name: 'Dominar Linguagens', description: 'Dominar linguagens, códigos e sistemas simbólicos.' },
  CF: { name: 'Compreender Fenômenos', description: 'Compreender fenômenos naturais, sociais, produtivos ou culturais.' },
  SP: { name: 'Enfrentar Situações-Problema', description: 'Selecionar e relacionar dados para resolver situações-problema.' },
  CA: { name: 'Construir Argumentação', description: 'Construir argumentação consistente com base em informações e conhecimentos.' },
  EP: { name: 'Elaborar Propostas', description: 'Elaborar propostas de intervenção considerando valores humanos e diversidade.' },
}
const SOLO_LABELS: Record<string, string> = {
  PRE_ESTRUTURAL: 'Pré-estrutural',
  UNIESTRUTURAL: 'Uniestrutural',
  MULTIESTRUTURAL: 'Multiestrutural',
  RELACIONAL: 'Relacional',
  ABSTRATO_AMPLIADO: 'Abstrato ampliado',
}
const CONFIDENCE_LABELS: Record<BloomStats['confidence'], string> = {
  baixa: 'Confiança baixa',
  media: 'Confiança média',
  alta: 'Confiança alta',
}
const BNCC_STATUS_LABELS: Record<BnccStatus, string> = {
  dominio: 'Domínio',
  desenvolvimento: 'Em desenvolvimento',
  intervencao: 'Intervenção',
  amostra_insuficiente: 'Amostra insuficiente',
}

type ReportView = 'geral' | 'bloom' | 'dok' | 'bncc' | 'perfis'

const VIEW_LABELS: Record<ReportView, string> = {
  geral: 'Visão geral',
  bloom: 'Análise Bloom',
  dok: 'Análise DOK',
  bncc: 'Análise BNCC',
  perfis: 'Perfis cognitivos',
}

function toPercent(score: number | null) {
  return score === null ? null : Math.round(score * 10)
}

function formatPercent(score: number | null) {
  const percent = toPercent(score)
  return percent === null ? '—' : `${percent}%`
}

function statusBadgeClass(status: BnccStatus) {
  if (status === 'dominio') return 'bg-status-success-surface text-status-success-content'
  if (status === 'desenvolvimento') return 'bg-status-info-surface text-status-info-content'
  if (status === 'intervencao') return 'bg-status-danger-surface text-status-danger-content'
  return 'bg-status-warning-surface text-status-warning-content'
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <p className="text-sm text-content-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-content-primary">{value}</p>
    </div>
  )
}

function ReportReading({ overall, bySubject }: { overall: Performance['overall']; bySubject: GroupStats }) {
  if (!overall || overall.count < 3) {
    return (
      <div className="rounded border border-status-warning-border bg-status-warning-surface p-4 text-sm text-status-warning-content">
        A leitura orientada será exibida quando houver ao menos 3 correções revisadas no recorte. Antes disso, os números servem apenas como registro, não como comparação.
      </div>
    )
  }

  const subjects = Object.entries(bySubject)
    .filter(([, stat]) => stat.avg !== null && stat.count >= 3)
    .sort((a, b) => (b[1].avg ?? 0) - (a[1].avg ?? 0))
  const strongest = subjects[0]
  const development = subjects.at(-1)

  return (
    <div className="rounded border border-border bg-surface p-4">
      <p className="text-sm font-semibold text-content-primary">Leitura orientada do recorte</p>
      <p className="mt-1 text-sm text-content-secondary">
        Média geral de {formatPercent(overall.avg)} em {overall.count} correções revisadas.
        {strongest ? ` Maior média com amostra mínima: ${strongest[0]} (${formatPercent(strongest[1].avg)} em ${strongest[1].count} correções).` : ''}
        {development && development !== strongest ? ` Ponto a acompanhar: ${development[0]} (${formatPercent(development[1].avg)} em ${development[1].count} correções).` : ''}
      </p>
      <p className="mt-2 text-xs text-content-secondary">Interpretação automática baseada nas métricas exibidas; não estabelece causa, diagnóstico individual nem tendência sem amostra e períodos comparáveis.</p>
    </div>
  )
}

function GroupBars({ title, data, order }: { title: string; data: GroupStats; order?: string[] }) {
  const entries = order
    ? order.filter((k) => k in data).map((k) => [k, data[k]] as const)
    : Object.entries(data).sort((a, b) => (b[1].avg ?? 0) - (a[1].avg ?? 0))

  if (entries.length === 0) return null

  return (
    <div className="rounded border border-border bg-surface p-4">
      <p className="text-sm font-medium text-content-secondary">{title}</p>
      <div className="mt-3 space-y-2">
        {entries.map(([key, stat]) => (
          <div key={key} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-xs text-content-muted">{BLOOM_LABELS[key] ?? key}</span>
            <div className="h-2 flex-1 rounded-full bg-surface-subtle">
              <div className="h-2 rounded-full bg-harmonia-green" style={{ width: `${((stat.avg ?? 0) / 10) * 100}%` }} />
            </div>
            <span className="w-16 shrink-0 text-right text-xs text-content-secondary">{formatPercent(stat.avg)} ({stat.count})</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Recommendations({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-4 rounded border border-status-info-border bg-status-info-surface p-3">
      <p className="text-sm font-semibold text-status-info-content">{title}</p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-status-info-content">
          {items.map((item) => <li key={item}>• {item}</li>)}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-status-info-content">Não há sinal de intervenção com amostra mínima neste recorte.</p>
      )}
      <p className="mt-2 text-[11px] text-status-info-content">Sugestões pedagógicas, não diagnóstico individual. Revise com o contexto da turma e do estudante.</p>
    </div>
  )
}

function BloomRecommendations({ data }: { data: Record<string, BloomStats> }) {
  const items = BLOOM_ORDER.flatMap((level) => {
    const stat = data[level]
    if (!stat || stat.itemCount < 6 || stat.accuracyPercent === null || stat.accuracyPercent >= 60) return []
    return [`${BLOOM_LABELS[level]} está em ${stat.accuracyPercent}% (${stat.itemCount} itens): retome habilidades desse nível com exemplos guiados e uma nova verificação curta.`]
  })
  return <Recommendations title="Recomendações para Bloom" items={items} />
}

function DokRecommendations({ data }: { data: Record<string, DokStats> }) {
  const items = DOK_ORDER.flatMap((level) => {
    const stat = data[level]
    if (!stat || stat.itemCount < 6 || stat.accuracyPercent === null || stat.accuracyPercent >= 60) return []
    const practice = level === 'DOK_1' ? 'retome fatos e procedimentos essenciais' : 'ofereça problemas graduados, explicitando a estratégia antes da prática autônoma'
    return [`${DOK_LABELS[level]} está em ${stat.accuracyPercent}% (${stat.itemCount} itens): ${practice}.`]
  })
  return <Recommendations title="Recomendações para DOK" items={items} />
}

function BnccRecommendations({ data }: { data: BnccDashboardData }) {
  const items = data.skills
    .filter((skill) => skill.status === 'intervencao')
    .slice(0, 4)
    .map((skill) => `${skill.code} (${skill.accuracyPercent}% em ${skill.itemCount} itens): planeje retomada da habilidade${skill.summary ? `, ${skill.summary}` : ''}, e reavalie com itens equivalentes.`)
  return <Recommendations title="Recomendações para BNCC" items={items} />
}

function BloomDashboard({ data }: { data: Record<string, BloomStats> }) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-content-primary">Dashboard Bloom</p>
          <p className="mt-1 text-xs text-content-muted">
            Percentual por item: objetiva vale 10/0; discursiva usa a nota final em escala 0-10.
          </p>
        </div>
        <span className="text-xs text-content-muted">Amostra mínima recomendada: 6 itens por nível</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {BLOOM_ORDER.map((level) => {
          const stat = data[level] ?? {
            itemCount: 0,
            equivalentCorrect: 0,
            accuracyPercent: null,
            averageScore: null,
            confidence: 'baixa' as const,
            sampleSize: 0,
            insufficientSample: true,
            evolution: [],
          }
          const latest = stat.evolution.slice(-3)

          return (
            <div key={level} className="rounded-lg border border-border bg-surface-subtle p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-content-primary">{BLOOM_LABELS[level]}</p>
                  <p className="mt-1 text-xs text-content-muted">{CONFIDENCE_LABELS[stat.confidence]} · amostra {stat.sampleSize}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-content-primary">
                    {stat.accuracyPercent ?? '—'}{stat.accuracyPercent !== null ? '%' : ''}
                  </p>
                  <p className="text-xs text-content-muted">acerto</p>
                </div>
              </div>

              <div className="mt-3 h-2 rounded-full bg-surface">
                <div className="h-2 rounded-full bg-harmonia-green" style={{ width: `${stat.accuracyPercent ?? 0}%` }} />
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-content-muted">Questões</p>
                  <p className="font-medium text-content-secondary">{stat.itemCount}</p>
                </div>
                <div>
                  <p className="text-content-muted">Acertos eq.</p>
                  <p className="font-medium text-content-secondary">{stat.equivalentCorrect.toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-content-muted">Média</p>
                  <p className="font-medium text-content-secondary">{stat.averageScore?.toFixed(1) ?? '—'}</p>
                </div>
              </div>

              {stat.insufficientSample && (
                <p className="mt-3 rounded bg-status-warning-surface px-2 py-1 text-xs text-status-warning-content">
                  Amostra insuficiente: use como sinal inicial, não como conclusão forte.
                </p>
              )}

              {latest.length > 0 && (
                <p className="mt-3 text-xs text-content-muted">
                  Evolução recente: {latest.map((p) => `${p.period}: ${p.accuracyPercent ?? '—'}% (${p.count})`).join(' · ')}
                </p>
              )}
            </div>
          )
        })}
      </div>
      <BloomRecommendations data={data} />
    </div>
  )
}

function DokDashboard({ data }: { data: Record<string, DokStats> }) {
  const visibleLevels = DOK_ORDER.filter((level) => level !== 'DOK_4' || (data[level]?.itemCount ?? 0) > 0)
  const hasDok4 = (data.DOK_4?.itemCount ?? 0) > 0

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-content-primary">Dashboard DOK</p>
          <p className="mt-1 text-xs text-content-muted">
            DOK mede profundidade de conhecimento exigida pela questão; o desempenho usa a nota/acerto corrigido do aluno.
          </p>
        </div>
        <span className="text-xs text-content-muted">DOK 4 só aparece quando houver itens classificados nesse nível</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {visibleLevels.map((level) => {
          const stat = data[level] ?? {
            itemCount: 0,
            equivalentCorrect: 0,
            accuracyPercent: null,
            confidence: 'baixa' as const,
            sampleSize: 0,
            insufficientSample: true,
            evolution: [],
            subjectDistribution: [],
          }
          const latest = stat.evolution.slice(-3)
          const topSubjects = stat.subjectDistribution.slice(0, 3)

          return (
            <div key={level} className="rounded-lg border border-border bg-surface-subtle p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-content-primary">{DOK_LABELS[level]}</p>
                  <p className="mt-1 text-xs text-content-muted">{CONFIDENCE_LABELS[stat.confidence]} · amostra {stat.sampleSize}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-content-primary">
                    {stat.accuracyPercent ?? '—'}{stat.accuracyPercent !== null ? '%' : ''}
                  </p>
                  <p className="text-xs text-content-muted">acerto</p>
                </div>
              </div>

              <div className="mt-3 h-2 rounded-full bg-surface">
                <div className="h-2 rounded-full bg-harmonia-green" style={{ width: `${stat.accuracyPercent ?? 0}%` }} />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-content-muted">Itens</p>
                  <p className="font-medium text-content-secondary">{stat.itemCount}</p>
                </div>
                <div>
                  <p className="text-content-muted">Acertos eq.</p>
                  <p className="font-medium text-content-secondary">{stat.equivalentCorrect.toFixed(1)}</p>
                </div>
              </div>

              {topSubjects.length > 0 && (
                <p className="mt-3 text-xs text-content-muted">
                  Disciplinas: {topSubjects.map((s) => `${s.subject} (${s.count})`).join(' · ')}
                </p>
              )}

              {stat.insufficientSample && (
                <p className="mt-3 rounded bg-status-warning-surface px-2 py-1 text-xs text-status-warning-content">
                  Amostra insuficiente: não tire conclusão forte deste nível ainda.
                </p>
              )}

              {latest.length > 0 && (
                <p className="mt-3 text-xs text-content-muted">
                  Evolução recente: {latest.map((p) => `${p.period}: ${p.accuracyPercent ?? '—'}% (${p.count})`).join(' · ')}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {!hasDok4 && (
        <p className="mt-4 rounded bg-surface-subtle px-3 py-2 text-xs text-content-muted">
          DOK 4 oculto: não há itens classificados como DOK 4 nesta amostra. Isso é esperado em provas comuns; DOK 4 costuma exigir projeto, investigação ou produção extensa.
        </p>
      )}
      <DokRecommendations data={data} />
    </div>
  )
}

function BnccGroupList({ title, data }: { title: string; data: BnccGroupStats[] }) {
  if (data.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-surface-subtle p-3">
      <p className="text-sm font-semibold text-content-primary">{title}</p>
      <div className="mt-3 space-y-3">
        {data.slice(0, 6).map((group) => (
          <div key={group.name}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-content-secondary">{group.name}</span>
              <span className={`shrink-0 rounded px-2 py-0.5 ${statusBadgeClass(group.status)}`}>{BNCC_STATUS_LABELS[group.status]}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-2 flex-1 rounded-full bg-surface">
                <div className="h-2 rounded-full bg-harmonia-green" style={{ width: `${group.accuracyPercent ?? 0}%` }} />
              </div>
              <span className="w-20 shrink-0 text-right text-xs text-content-muted">
                {group.accuracyPercent ?? '—'}{group.accuracyPercent !== null ? '%' : ''} ({group.itemCount})
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BnccDashboard({ data }: { data: BnccDashboardData }) {
  const visibleSkills = data.skills.slice(0, 12)

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-content-primary">Dashboard BNCC</p>
          <p className="mt-1 text-xs text-content-muted">
            Agrupa desempenho por habilidade BNCC vinculada à questão corrigida. Questões com mais de uma habilidade contam uma vez para cada habilidade.
          </p>
        </div>
        <span className="text-xs text-content-muted">Intervenção: abaixo de 60% com amostra mínima de 3 itens vinculados</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Habilidades mapeadas" value={data.summary.mappedSkillCount} />
        <StatTile label="Itens vinculados" value={data.summary.mappedItemLinks} />
        <StatTile label="Itens sem BNCC" value={data.summary.unmappedItemCount} />
      </div>

      {data.summary.mappedSkillCount === 0 ? (
        <p className="mt-4 rounded bg-surface-subtle px-3 py-2 text-xs text-content-muted">
          Nenhuma habilidade BNCC mapeada nas correções revisadas desta amostra.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <BnccGroupList title="Por componente curricular" data={data.bySubject} />
            <BnccGroupList title="Por ano/série" data={data.byGradeYear} />
          </div>

          <div className="mt-4 space-y-3">
            {visibleSkills.map((skill) => {
              const latest = skill.evolution.slice(-3)

              return (
                <div key={skill.code} className="rounded-lg border border-border bg-surface-subtle p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-sm font-semibold text-content-primary">{skill.code}</p>
                        <span className={`rounded px-2 py-0.5 text-xs ${statusBadgeClass(skill.status)}`}>{BNCC_STATUS_LABELS[skill.status]}</span>
                      </div>
                      <p className="mt-1 text-xs text-content-secondary">{skill.summary ?? 'Sem resumo salvo no payload da questão.'}</p>
                      <p className="mt-1 text-xs text-content-muted">
                        {skill.primarySubject} · {skill.primaryGradeYear} · Unidade temática: {skill.unitTheme ?? 'não informada no payload atual'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-semibold text-content-primary">
                        {skill.accuracyPercent ?? '—'}{skill.accuracyPercent !== null ? '%' : ''}
                      </p>
                      <p className="text-xs text-content-muted">desempenho</p>
                    </div>
                  </div>

                  <div className="mt-3 h-2 rounded-full bg-surface">
                    <div className="h-2 rounded-full bg-harmonia-green" style={{ width: `${skill.accuracyPercent ?? 0}%` }} />
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-content-muted">Itens</p>
                      <p className="font-medium text-content-secondary">{skill.itemCount}</p>
                    </div>
                    <div>
                      <p className="text-content-muted">Acertos eq.</p>
                      <p className="font-medium text-content-secondary">{skill.equivalentCorrect.toFixed(1)}</p>
                    </div>
                    <div>
                      <p className="text-content-muted">Confiança</p>
                      <p className="font-medium text-content-secondary">{CONFIDENCE_LABELS[skill.confidence]}</p>
                    </div>
                  </div>

                  {skill.insufficientSample && (
                    <p className="mt-3 rounded bg-status-warning-surface px-2 py-1 text-xs text-status-warning-content">
                      Amostra insuficiente: esta habilidade ainda não deve orientar intervenção isolada.
                    </p>
                  )}

                  {latest.length > 0 && (
                    <p className="mt-3 text-xs text-content-muted">
                      Evolução recente: {latest.map((p) => `${p.period}: ${p.accuracyPercent ?? '—'}% (${p.count})`).join(' · ')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
      <BnccRecommendations data={data} />
    </div>
  )
}

function InepAxisDashboard({ data }: { data: InepAxisDashboardData }) {
  const axes = INEP_AXIS_ORDER.map((code) => data.axes.find((axis) => axis.code === code) ?? {
    code,
    name: INEP_AXIS_FALLBACK[code]?.name ?? code,
    description: INEP_AXIS_FALLBACK[code]?.description ?? null,
    itemCount: 0,
    equivalentCorrect: 0,
    accuracyPercent: null,
    confidence: 'baixa' as const,
    sampleSize: 0,
    insufficientSample: true,
    subjectDistribution: [],
    evolution: [],
  })

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-content-primary">Dashboard Eixos Cognitivos do INEP</p>
          <p className="mt-1 text-xs text-content-muted">
            Usa somente questões reais do banco ENEM presentes em provas corrigidas, porque elas possuem eixo INEP estruturado.
          </p>
        </div>
        <span className="text-xs text-content-muted">Códigos: DL, CF, SP, CA e EP</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile label="Itens ENEM com eixo" value={data.summary.classifiedItemCount} />
        <StatTile label="Itens ENEM sem eixo" value={data.summary.unclassifiedEnemItemCount} />
      </div>

      {data.summary.classifiedItemCount === 0 ? (
        <p className="mt-4 rounded bg-surface-subtle px-3 py-2 text-xs text-content-muted">
          Nenhuma questão real do banco ENEM com eixo cognitivo apareceu nas correções revisadas desta amostra.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {axes.map((axis) => {
            const latest = axis.evolution.slice(-3)
            const topSubjects = axis.subjectDistribution.slice(0, 3)

            return (
              <div key={axis.code} className="rounded-lg border border-border bg-surface-subtle p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-content-primary">{axis.code}</p>
                    <p className="mt-0.5 text-sm font-medium text-content-primary">{axis.name}</p>
                    <p className="mt-1 text-xs text-content-muted">{axis.description ?? 'Descrição não cadastrada.'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-semibold text-content-primary">
                      {axis.accuracyPercent ?? '—'}{axis.accuracyPercent !== null ? '%' : ''}
                    </p>
                    <p className="text-xs text-content-muted">desempenho</p>
                  </div>
                </div>

                <div className="mt-3 h-2 rounded-full bg-surface">
                  <div className="h-2 rounded-full bg-harmonia-green" style={{ width: `${axis.accuracyPercent ?? 0}%` }} />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-content-muted">Itens</p>
                    <p className="font-medium text-content-secondary">{axis.itemCount}</p>
                  </div>
                  <div>
                    <p className="text-content-muted">Acertos eq.</p>
                    <p className="font-medium text-content-secondary">{axis.equivalentCorrect.toFixed(1)}</p>
                  </div>
                  <div>
                    <p className="text-content-muted">Confiança</p>
                    <p className="font-medium text-content-secondary">{CONFIDENCE_LABELS[axis.confidence]}</p>
                  </div>
                </div>

                {topSubjects.length > 0 && (
                  <p className="mt-3 text-xs text-content-muted">
                    Disciplinas: {topSubjects.map((s) => `${s.subject} (${s.count})`).join(' · ')}
                  </p>
                )}

                {axis.insufficientSample && (
                  <p className="mt-3 rounded bg-status-warning-surface px-2 py-1 text-xs text-status-warning-content">
                    Amostra insuficiente: não tire conclusão forte deste eixo ainda.
                  </p>
                )}

                {latest.length > 0 && (
                  <p className="mt-3 text-xs text-content-muted">
                    Evolução recente: {latest.map((p) => `${p.period}: ${p.accuracyPercent ?? '—'}% (${p.count})`).join(' · ')}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function matrixCellClass(accuracyPercent: number | null, insufficientSample: boolean) {
  if (accuracyPercent === null) return 'bg-surface text-content-muted'
  if (insufficientSample) return 'bg-status-warning-surface text-status-warning-content'
  if (accuracyPercent >= 80) return 'bg-status-success-surface text-status-success-content'
  if (accuracyPercent >= 60) return 'bg-status-info-surface text-status-info-content'
  return 'bg-status-danger-surface text-status-danger-content'
}

function BloomDokMatrix({ data }: { data: BloomDokMatrixData }) {
  const rows = BLOOM_ORDER.map((level) => data.rows.find((row) => row.bloomLevel === level) ?? {
    bloomLevel: level,
    cells: DOK_ORDER.map((dokLevel) => ({
      bloomLevel: level,
      dokLevel,
      itemCount: 0,
      equivalentCorrect: 0,
      accuracyPercent: null,
      sampleSize: 0,
      confidence: 'baixa' as const,
      insufficientSample: true,
    })),
  })

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-content-primary">Matriz Bloom × DOK</p>
          <p className="mt-1 text-xs text-content-muted">
            Cruza processo cognitivo da questão com profundidade DOK; células com menos de 3 itens não geram conclusão.
          </p>
        </div>
        <span className="text-xs text-content-muted">{data.summary.itemCount} itens classificados na matriz</span>
      </div>

      {data.summary.itemCount === 0 ? (
        <p className="mt-4 rounded bg-surface-subtle px-3 py-2 text-xs text-content-muted">
          Nenhum item com Bloom e DOK disponível nas correções revisadas desta amostra.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-1 text-left text-xs">
            <thead>
              <tr>
                <th className="w-32 px-2 py-1 text-content-muted">Bloom</th>
                {DOK_ORDER.map((dokLevel) => (
                  <th key={dokLevel} className="px-2 py-1 text-center font-medium text-content-secondary">{DOK_LABELS[dokLevel]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.bloomLevel}>
                  <th className="rounded bg-surface-subtle px-2 py-2 font-medium text-content-secondary">{BLOOM_LABELS[row.bloomLevel] ?? row.bloomLevel}</th>
                  {DOK_ORDER.map((dokLevel) => {
                    const cell = row.cells.find((candidate) => candidate.dokLevel === dokLevel) ?? {
                      bloomLevel: row.bloomLevel,
                      dokLevel,
                      itemCount: 0,
                      equivalentCorrect: 0,
                      accuracyPercent: null,
                      sampleSize: 0,
                      confidence: 'baixa' as const,
                      insufficientSample: true,
                    }

                    return (
                      <td key={`${row.bloomLevel}-${dokLevel}`} className={`min-w-28 rounded px-2 py-2 text-center ${matrixCellClass(cell.accuracyPercent, cell.insufficientSample)}`}>
                        <p className="text-sm font-semibold">
                          {cell.accuracyPercent ?? '—'}{cell.accuracyPercent !== null ? '%' : ''}
                        </p>
                        <p className="mt-0.5 text-[11px] opacity-80">{cell.itemCount} item(ns)</p>
                        {cell.itemCount > 0 && (
                          <p className="mt-0.5 text-[11px] opacity-70">
                            {cell.insufficientSample ? 'amostra baixa' : CONFIDENCE_LABELS[cell.confidence]}
                          </p>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-content-muted">
        Leitura prática: compare uma mesma linha entre DOKs. Se “Aplicar” cai de DOK 2 para DOK 3 com amostra suficiente, há sinal de dificuldade quando a profundidade aumenta.
      </p>
    </div>
  )
}

function SoloLevelBars({ title, subtitle, levels, order }: { title: string; subtitle: string; levels: SoloLevelStats[]; order: string[] }) {
  const orderedLevels = order.map((level) => levels.find((stat) => stat.level === level) ?? {
    level,
    itemCount: 0,
    equivalentCorrect: 0,
    accuracyPercent: null,
    averageScore: null,
    confidence: 'baixa' as const,
    sampleSize: 0,
    insufficientSample: true,
  })

  return (
    <div className="rounded-lg border border-border bg-surface-subtle p-3">
      <p className="text-sm font-semibold text-content-primary">{title}</p>
      <p className="mt-1 text-xs text-content-muted">{subtitle}</p>
      <div className="mt-3 space-y-3">
        {orderedLevels.map((stat) => (
          <div key={stat.level}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-content-secondary">{SOLO_LABELS[stat.level] ?? stat.level}</span>
              <span className="shrink-0 text-content-muted">
                {stat.accuracyPercent ?? '—'}{stat.accuracyPercent !== null ? '%' : ''} · {stat.itemCount}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-surface">
              <div className="h-2 rounded-full bg-harmonia-green" style={{ width: `${stat.accuracyPercent ?? 0}%` }} />
            </div>
            {stat.itemCount > 0 && (
              <p className="mt-1 text-[11px] text-content-muted">
                Média {stat.averageScore?.toFixed(1) ?? '—'} · {stat.insufficientSample ? 'amostra baixa' : CONFIDENCE_LABELS[stat.confidence]}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function SoloDashboard({ data }: { data: SoloDashboardData }) {
  const hasExpected = data.expected.summary.classifiedItemCount > 0
  const hasObserved = data.observed.summary.classifiedAnswerCount > 0

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-content-primary">Análise SOLO</p>
          <p className="mt-1 text-xs text-content-muted">
            SOLO_EXPECTED descreve a estrutura esperada da atividade; SOLO_OBSERVED descreve somente respostas discursivas analisáveis.
          </p>
        </div>
        <span className="text-xs text-content-muted">Nunca trate SOLO_EXPECTED como desempenho observado</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Atividades com SOLO_EXPECTED" value={data.expected.summary.classifiedItemCount} />
        <StatTile label="Atividades sem SOLO_EXPECTED" value={data.expected.summary.unclassifiedItemCount} />
        <StatTile label="Respostas com SOLO_OBSERVED" value={data.observed.summary.classifiedAnswerCount} />
        <StatTile label="Discursivas sem SOLO_OBSERVED" value={data.observed.summary.unclassifiedDiscursiveAnswerCount} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {hasExpected ? (
          <SoloLevelBars
            title="SOLO_EXPECTED das atividades"
            subtitle="Metadado de design da questão, aplicável a objetivas e discursivas."
            levels={data.expected.levels}
            order={SOLO_EXPECTED_ORDER}
          />
        ) : (
          <p className="rounded bg-surface-subtle px-3 py-2 text-xs text-content-muted">Nenhuma atividade com SOLO_EXPECTED nesta amostra.</p>
        )}

        {hasObserved ? (
          <SoloLevelBars
            title="SOLO_OBSERVED das respostas"
            subtitle="Estrutura real demonstrada em respostas discursivas; objetivas não entram."
            levels={data.observed.levels}
            order={SOLO_OBSERVED_ORDER}
          />
        ) : (
          <p className="rounded bg-surface-subtle px-3 py-2 text-xs text-content-muted">Nenhuma resposta discursiva com SOLO_OBSERVED nesta amostra.</p>
        )}
      </div>
    </div>
  )
}

function CognitiveProfiles({ profiles, studentSearch }: { profiles: CognitiveProfile[]; studentSearch: string }) {
  const normalizedSearch = studentSearch.trim().toLocaleLowerCase('pt-BR')
  const visibleProfiles = normalizedSearch
    ? profiles.filter((profile) => profile.studentName.toLocaleLowerCase('pt-BR').includes(normalizedSearch))
    : profiles

  if (profiles.length === 0) return null

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-content-primary">Perfil cognitivo do aluno</p>
          <p className="mt-1 text-xs text-content-muted">
            Síntese por aluno baseada somente em correções revisadas. Use como leitura de amostra, não como rótulo permanente.
          </p>
        </div>
        <span className="text-xs text-content-muted">{visibleProfiles.length} de {profiles.length} aluno(s) na amostra filtrada</span>
      </div>

      <div className="mt-4 space-y-3">
        {visibleProfiles.map((profile) => (
          <div key={profile.studentName} className="rounded-lg border border-border bg-surface-subtle p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-content-primary">{profile.studentName}</p>
                <p className="mt-1 text-xs text-content-muted">
                  Período: {profile.periods.join(', ') || '—'} · Disciplinas: {profile.subjects.map((s) => s.name).join(', ') || '—'} · {CONFIDENCE_LABELS[profile.confidence]}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold text-content-primary">{formatPercent(profile.overallAverage)}</p>
                <p className="text-xs text-content-muted">{profile.sampleSize} itens · {profile.itemAccuracyPercent ?? '—'}{profile.itemAccuracyPercent !== null ? '%' : ''}</p>
                <Link href={`/desempenho/relatorio?aluno=${encodeURIComponent(profile.studentName)}`} className="mt-2 inline-flex min-h-8 items-center rounded border border-border px-2 text-xs font-medium text-content-primary hover:bg-surface-subtle">
                  Abrir relatório
                </Link>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded bg-surface p-3">
                <p className="text-xs font-medium text-content-secondary">Pontos fortes na amostra</p>
                {profile.strengths.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {profile.strengths.map((item) => <p key={item} className="text-xs text-content-secondary">{item}</p>)}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-content-muted">Sem ponto forte com amostra mínima nesta leitura.</p>
                )}
              </div>

              <div className="rounded bg-surface p-3">
                <p className="text-xs font-medium text-content-secondary">Pontos em desenvolvimento</p>
                {profile.development.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {profile.development.map((item) => <p key={item} className="text-xs text-content-secondary">{item}</p>)}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-content-muted">Sem queda com amostra mínima nesta leitura.</p>
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="rounded bg-surface p-3">
                <p className="text-xs font-medium text-content-secondary">BNCC com maior domínio</p>
                {profile.bnccStrengths.length > 0 ? profile.bnccStrengths.map((skill) => (
                  <p key={skill.code} className="mt-1 text-xs text-content-secondary">{skill.code}: {skill.accuracyPercent}% ({skill.itemCount})</p>
                )) : <p className="mt-1 text-xs text-content-muted">Sem habilidade com amostra mínima.</p>}
              </div>

              <div className="rounded bg-surface p-3">
                <p className="text-xs font-medium text-content-secondary">BNCC para intervenção</p>
                {profile.bnccInterventions.length > 0 ? profile.bnccInterventions.map((skill) => (
                  <p key={skill.code} className="mt-1 text-xs text-content-secondary">{skill.code}: {skill.accuracyPercent}% ({skill.itemCount})</p>
                )) : <p className="mt-1 text-xs text-content-muted">Sem intervenção BNCC com amostra mínima.</p>}
              </div>

              <div className="rounded bg-surface p-3">
                <p className="text-xs font-medium text-content-secondary">Profundidade sustentada</p>
                {profile.sustainedDok ? (
                  <p className="mt-1 text-xs text-content-secondary">{DOK_LABELS[profile.sustainedDok.level] ?? profile.sustainedDok.level}: {profile.sustainedDok.accuracyPercent}% ({profile.sustainedDok.itemCount})</p>
                ) : (
                  <p className="mt-1 text-xs text-content-muted">Sem DOK sustentado com amostra mínima.</p>
                )}
              </div>
            </div>

            {profile.inepHighlights.length > 0 && (
              <p className="mt-3 text-xs text-content-muted">
                Eixos INEP com melhor amostra: {profile.inepHighlights.map((axis) => `${axis.key}: ${axis.accuracyPercent}% (${axis.itemCount})`).join(' · ')}
              </p>
            )}

            {profile.limitations.length > 0 && (
              <p className="mt-3 rounded bg-status-warning-surface px-2 py-1 text-xs text-status-warning-content">
                Limitações: {profile.limitations.join(' ')}
              </p>
            )}
          </div>
        ))}
        {visibleProfiles.length === 0 && <p className="rounded bg-surface-subtle px-3 py-2 text-sm text-content-muted">Nenhum aluno encontrado nesse filtro.</p>}
      </div>
    </div>
  )
}

export default function DesempenhoPanel({ isSuperuser }: { isSuperuser: boolean }) {
  const searchParams = useSearchParams()
  const requestedView = searchParams.get('visao')
  const activeView: ReportView = requestedView === 'bloom' || requestedView === 'dok' || requestedView === 'bncc' || requestedView === 'perfis' ? requestedView : 'geral'
  const [data, setData] = useState<Performance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [professors, setProfessors] = useState<UserOption[]>([])
  const [filters, setFilters] = useState({ subject: '', gradeYear: '', segment: '', assignedTo: '', academicYear: '', bimester: '' })
  const [studentSearch, setStudentSearch] = useState('')
  const deferredSubject = useDeferredValue(filters.subject)

  function exportCsv() {
    if (!data?.overall) return
    const rows = [
      ['Relatório de desempenho', 'Percentual', 'Amostra'],
      ['Geral', String(toPercent(data.overall.avg) ?? ''), String(data.overall.count)],
      ...Object.entries(data.bySubject).map(([subject, stat]) => [subject, String(toPercent(stat.avg) ?? ''), String(stat.count)]),
    ]
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'relatorio-desempenho.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (!isSuperuser) return
    fetch('/api/users')
      .then((r) => r.json())
      .then((body) => !body.error && setProfessors(body.users.filter((u: { role: string }) => u.role === 'professor')))
      .catch(() => {})
  }, [isSuperuser])

  useEffect(() => {
    const params = new URLSearchParams()
    if (isSuperuser) {
      if (deferredSubject) params.set('subject', deferredSubject)
      if (filters.gradeYear) params.set('gradeYear', filters.gradeYear)
      if (filters.segment) params.set('segment', filters.segment)
      if (filters.assignedTo) params.set('assignedTo', filters.assignedTo)
    }
    if (filters.academicYear) params.set('academicYear', filters.academicYear)
    if (filters.bimester) params.set('bimester', filters.bimester)
    const controller = new AbortController()
    setError(null)
    fetch(`/api/analytics/performance?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((body) => (body.error ? setError(body.error) : setData(body)))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setError('Erro ao carregar desempenho.')
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperuser, deferredSubject, filters.gradeYear, filters.segment, filters.assignedTo, filters.academicYear, filters.bimester])

  if (error) return <p role="alert" className="text-sm text-status-danger-content">{error}</p>
  if (!data) return <p role="status" aria-live="polite" className="text-sm text-content-muted">Carregando…</p>

  if (!data.overall) {
    return <p className="text-sm text-content-muted">Nenhuma correção revisada ainda — os números aparecem aqui assim que as primeiras provas forem corrigidas.</p>
  }

  return (
    <div className="space-y-6">
      {isSuperuser && (
        <fieldset className="flex flex-wrap gap-2 rounded border border-border bg-surface p-4">
          <legend className="sr-only">Filtros de desempenho</legend>
          <select aria-label="Segmento" value={filters.segment} onChange={(e) => setFilters((f) => ({ ...f, segment: e.target.value }))} className="rounded border border-border px-2 py-1.5 text-sm">
            <option value="">Todos os segmentos</option>
            <option value="anos-iniciais">Anos Iniciais</option>
            <option value="anos-finais">Anos Finais</option>
            <option value="ensino-medio">Ensino Médio</option>
          </select>
          <input
            aria-label="Disciplina"
            placeholder="Disciplina"
            value={filters.subject}
            onChange={(e) => setFilters((f) => ({ ...f, subject: e.target.value }))}
            className="rounded border border-border px-2 py-1.5 text-sm"
          />
          <select aria-label="Série" value={filters.gradeYear} onChange={(e) => setFilters((f) => ({ ...f, gradeYear: e.target.value }))} className="rounded border border-border px-2 py-1.5 text-sm">
            <option value="">Todas as séries</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((year) => <option key={year} value={year}>{year}º ano</option>)}
          </select>
          <select aria-label="Professor responsável" value={filters.assignedTo} onChange={(e) => setFilters((f) => ({ ...f, assignedTo: e.target.value }))} className="rounded border border-border px-2 py-1.5 text-sm">
            <option value="">Todos os professores</option>
            {professors.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input aria-label="Ano letivo" placeholder="Ano letivo" inputMode="numeric" value={filters.academicYear} onChange={(e) => setFilters((f) => ({ ...f, academicYear: e.target.value }))} className="w-28 rounded border border-border px-2 py-1.5 text-sm" />
          <select aria-label="Bimestre" value={filters.bimester} onChange={(e) => setFilters((f) => ({ ...f, bimester: e.target.value }))} className="rounded border border-border px-2 py-1.5 text-sm"><option value="">Todos os bimestres</option>{[1, 2, 3, 4].map((b) => <option key={b} value={b}>{b}º bimestre</option>)}</select>
        </fieldset>
      )}

      <nav className="flex flex-wrap gap-2 border-b border-border pb-3" aria-label="Visões de desempenho">
        {(Object.keys(VIEW_LABELS) as ReportView[]).map((view) => (
          <Link
            key={view}
            href={view === 'geral' ? '/desempenho' : `/desempenho?visao=${view}`}
            aria-current={activeView === view ? 'page' : undefined}
            className={`min-h-10 rounded px-3 py-2 text-sm font-medium ${activeView === view ? 'bg-harmonia-green text-action-primary-foreground' : 'text-content-secondary hover:bg-surface-subtle hover:text-content-primary'}`}
          >
            {VIEW_LABELS[view]}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface p-4">
        <p className="text-sm text-content-secondary">Percentual de desempenho de 0% a 100%. Referência institucional: 60% ou mais. Amostras pequenas não sustentam comparação ou evolução.</p>
        <button type="button" onClick={exportCsv} className="min-h-10 rounded border border-border px-3 text-sm font-medium text-content-primary">Exportar CSV do recorte</button>
      </div>

      <section id={`performance-view-${activeView}`} tabIndex={-1} aria-label={VIEW_LABELS[activeView]} className="space-y-6">
      {activeView === 'geral' && <ReportReading overall={data.overall} bySubject={data.bySubject} />}

      {activeView === 'geral' && <>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Desempenho geral" value={formatPercent(data.overall.avg)} />
          <StatTile label="Maior desempenho" value={formatPercent(data.overall.max)} />
          <StatTile label="Menor desempenho" value={formatPercent(data.overall.min)} />
          <StatTile label="Correções revisadas" value={data.overall.count} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GroupBars title="Por disciplina" data={data.bySubject} />
          <GroupBars title="Por série" data={data.byGradeYear} />
          {isSuperuser && <GroupBars title="Por professor" data={data.byProfessor} />}
        </div>
      </>}

      {activeView === 'bloom' && <>
        <BloomDashboard data={data.bloomDashboard} />
        <BloomDokMatrix data={data.bloomDokMatrix} />
        <SoloDashboard data={data.soloDashboard} />
      </>}
      {activeView === 'dok' && <DokDashboard data={data.dokDashboard} />}
      {activeView === 'bncc' && <>
        <BnccDashboard data={data.bnccDashboard} />
        <InepAxisDashboard data={data.inepAxisDashboard} />
      </>}
      {activeView === 'perfis' && <>
        <div className="rounded border border-border bg-surface p-4">
          <label htmlFor="student-search" className="text-sm font-medium text-content-primary">Aluno</label>
          <input id="student-search" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Filtrar por nome" className="mt-2 w-full max-w-sm rounded border border-border bg-canvas px-3 py-2 text-sm text-content-primary" />
          <p className="mt-2 text-xs text-content-secondary">Os filtros de segmento, série, ano e bimestre acima também delimitam os perfis exibidos.</p>
        </div>
        <CognitiveProfiles profiles={data.cognitiveProfiles} studentSearch={studentSearch} />
      </>}

      {activeView === 'geral' && data.topMissedQuestions.length > 0 && (
        <div className="rounded border border-border bg-surface p-4">
          <p className="text-sm font-medium text-content-secondary">Questões com mais erro</p>
          <div className="mt-3 space-y-1">
            {data.topMissedQuestions.map((q) => (
              <Link
                key={`${q.examId}-${q.questionNumber}`}
                href={`/gerar/${q.examId}/revisar`}
                className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-surface-subtle"
              >
                <span className="text-content-secondary">{q.subject} — {q.gradeYear}º ano — questão {q.questionNumber}</span>
                <span className="font-medium text-status-danger-content">{q.errorRate}% de erro</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      </section>
    </div>
  )
}
