'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { DataTable, type DataTableFeatures } from '@/components/ui/data-table'
import type { MasteryConsolidation, MasteryLevel, StudentMasteryRow } from '@/lib/curriculum/studentMastery'

type AssessmentRow = { examId: number; subject: string; period: string; grade: number; evaluatedItems: number; pendingItems: number }
type MasteryResponse = {
  rows: StudentMasteryRow[]
  consolidated: { bySubjectBimester: MasteryConsolidation[]; bySubject: MasteryConsolidation[] }
  summary: { plannedSkillCount: number; observedSkillCount: number; outsidePlanCount: number; limitedBySampleCount: number; levelCounts: Record<MasteryLevel, number> }
  rules: { minItemsForReading: number; minItemsForMastery: number; minAssessmentsForMastery: number; masteryPercent: number; nearMasteryPercent: number }
}

type Profile = {
  studentId: string | null
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
  priorities: Array<{ code: string; summary: string | null; accuracyPercent: number | null; itemCount: number; action: string }>
  assessments: AssessmentRow[]
  evidence: { assessmentCount: number; subjectCount: number; periodCount: number; evaluatedItemCount: number; pendingItemCount: number }
  limitations: string[]
}

function formatPercent(score: number | null) {
  return score === null ? '—' : `${Math.round(score * 10)}%`
}

const assessmentColumnHelper = createColumnHelper<DataTableFeatures, AssessmentRow>()
const assessmentColumns = [
  assessmentColumnHelper.accessor('period', { header: 'Período' }),
  assessmentColumnHelper.accessor('subject', { header: 'Disciplina' }),
  assessmentColumnHelper.accessor('grade', { header: 'Desempenho', cell: ({ getValue }) => formatPercent(getValue()) }),
  assessmentColumnHelper.accessor('evaluatedItems', { header: 'Itens avaliados' }),
  assessmentColumnHelper.accessor('pendingItems', { header: 'Itens pendentes' }),
]

const MASTERY_LEVEL_LABELS: Record<MasteryLevel, string> = {
  dominio: 'Domínio',
  proximo_do_dominio: 'Próximo do domínio',
  em_desenvolvimento: 'Em desenvolvimento',
  evidencia_insuficiente: 'Evidência insuficiente',
  sem_evidencia: 'Sem evidência',
}

function masteryBadge(level: MasteryLevel) {
  if (level === 'dominio') return 'bg-status-success-surface text-status-success-content'
  if (level === 'proximo_do_dominio') return 'bg-status-info-surface text-status-info-content'
  if (level === 'em_desenvolvimento') return 'bg-status-danger-surface text-status-danger-content'
  return 'bg-status-warning-surface text-status-warning-content'
}

function formatMastery(value: number | null) { return value === null ? '—' : `${value.toLocaleString('pt-BR')}%` }

const masteryColumnHelper = createColumnHelper<DataTableFeatures, StudentMasteryRow>()
const masteryColumns = [
  masteryColumnHelper.accessor((row) => `${row.code} ${row.description ?? ''} ${row.subject} ${MASTERY_LEVEL_LABELS[row.level]}`, {
    id: 'habilidade', header: 'Habilidade', cell: ({ row }) => <div><p className="font-medium">{row.original.code}</p><p className="max-w-md text-xs text-content-secondary">{row.original.description ?? 'Descrição não informada no planejamento'}</p></div>,
  }),
  masteryColumnHelper.accessor('subject', { header: 'Disciplina' }),
  masteryColumnHelper.accessor((row) => `${row.academicYear}.${row.bimester}`, { id: 'periodo', header: 'Período', cell: ({ row }) => `${row.original.bimester}º bim. / ${row.original.academicYear}` }),
  masteryColumnHelper.accessor('masteryPercent', { header: 'Aproveitamento', cell: ({ row }) => <span>{formatMastery(row.original.masteryPercent)}{row.original.level === 'evidencia_insuficiente' && <span className="block text-xs text-content-muted">preliminar</span>}</span> }),
  masteryColumnHelper.accessor('itemCount', { header: 'Itens / avaliações', cell: ({ row }) => `${row.original.itemCount} / ${row.original.assessmentCount}` }),
  masteryColumnHelper.accessor('level', { header: 'Leitura', cell: ({ row }) => <span><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${masteryBadge(row.original.level)}`}>{MASTERY_LEVEL_LABELS[row.original.level]}</span>{row.original.limitedBySample && <span className="mt-1 block text-xs text-content-muted">limitado pela amostra</span>}</span> }),
  masteryColumnHelper.accessor('planned', { header: 'Planejada', cell: ({ getValue }) => getValue() ? 'Sim' : 'Não' }),
]

export default function StudentReport() {
  const searchParams = useSearchParams()
  const student = searchParams.get('aluno')?.trim() ?? ''
  const studentId = searchParams.get('studentId')?.trim() ?? ''
  const rawQuery = searchParams.toString()
  const preservedQuery = useMemo(() => {
    const source = new URLSearchParams(rawQuery)
    const preserved = new URLSearchParams()
    for (const key of ['subject', 'gradeYear', 'segment', 'assignedTo', 'academicYear', 'bimester', 'classroomCourseId', 'examId']) {
      const value = source.get(key)
      if (value) preserved.set(key, value)
    }
    return preserved.toString()
  }, [rawQuery])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mastery, setMastery] = useState<MasteryResponse | null>(null)
  const [masteryError, setMasteryError] = useState<string | null>(null)

  useEffect(() => {
    if (!student) return
    const params = new URLSearchParams(preservedQuery)
    if (studentId) params.set('studentId', studentId)
    else params.set('student', student)
    const query = params.toString()
    async function load() {
      const [profileResult, masteryResult] = await Promise.allSettled([
        fetch(`/api/analytics/performance?${query}`).then(async (response) => ({ response, body: await response.json() })),
        fetch(`/api/curriculum/student-mastery?${query}`).then(async (response) => ({ response, body: await response.json() })),
      ])
      if (profileResult.status === 'fulfilled' && profileResult.value.response.ok && !profileResult.value.body.error) setProfile(profileResult.value.body.cognitiveProfiles?.[0] ?? null)
      else setError('Não foi possível carregar este relatório dentro do seu escopo de acesso.')
      if (masteryResult.status === 'fulfilled' && masteryResult.value.response.ok && !masteryResult.value.body.error) setMastery(masteryResult.value.body)
      else setMasteryError('Não foi possível cruzar o desempenho com o planejamento deste recorte.')
    }
    load()
  }, [student, studentId, preservedQuery])

  if (!student) return <p className="text-sm text-content-secondary">Selecione um aluno em Perfis cognitivos para abrir o relatório.</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!profile) return <p className="text-sm text-content-secondary">Carregando relatório…</p>

  return (
    <article className="mx-auto max-w-3xl space-y-6 print:max-w-none">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/desempenho?visao=perfis${preservedQuery ? `&${preservedQuery}` : ''}`} className="min-h-10 rounded border border-border px-3 py-2 text-sm font-medium text-content-primary hover:bg-surface-subtle">Voltar aos perfis</Link>
        <button type="button" onClick={() => window.print()} className="min-h-10 rounded bg-harmonia-green px-3 py-2 text-sm font-semibold text-white">Imprimir / Salvar em PDF</button>
      </div>

      <header className="rounded border border-border bg-surface p-6">
        <p className="text-sm font-semibold text-harmonia-green">Relatório individual de desempenho</p>
        <h1 className="mt-2 text-3xl font-bold text-content-primary">{profile.studentName}</h1>
        <p className="mt-2 text-sm text-content-secondary">Baseado apenas em correções revisadas no recorte autorizado. Este documento não é um diagnóstico nem substitui a conversa pedagógica.</p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-border bg-surface p-4"><p className="text-xs text-content-secondary">Desempenho</p><p className="mt-1 text-2xl font-semibold text-content-primary">{formatPercent(profile.overallAverage)}</p></div>
        <div className="rounded border border-border bg-surface p-4"><p className="text-xs text-content-secondary">Referência</p><p className="mt-1 text-2xl font-semibold text-content-primary">60%</p></div>
        <div className="rounded border border-border bg-surface p-4"><p className="text-xs text-content-secondary">Itens</p><p className="mt-1 text-2xl font-semibold text-content-primary">{profile.sampleSize}</p></div>
        <div className="rounded border border-border bg-surface p-4"><p className="text-xs text-content-secondary">Avaliações</p><p className="mt-1 text-2xl font-semibold text-content-primary">{profile.evidence.assessmentCount}</p></div>
      </section>

      <section className="rounded border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-content-primary">Contexto da amostra</h2>
        <p className="mt-2 text-sm text-content-secondary">Períodos: {profile.periods.join(', ') || '—'}</p>
        <p className="mt-1 text-sm text-content-secondary">Disciplinas: {profile.subjects.map((subject) => `${subject.name} (${subject.count})`).join(', ') || '—'}</p>
      </section>

      <section className="rounded border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-content-primary">Evidência disponível</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><p className="text-xs text-content-secondary">Disciplinas</p><p className="text-xl font-semibold">{profile.evidence.subjectCount}</p></div>
          <div><p className="text-xs text-content-secondary">Períodos</p><p className="text-xl font-semibold">{profile.evidence.periodCount}</p></div>
          <div><p className="text-xs text-content-secondary">Itens avaliados</p><p className="text-xl font-semibold">{profile.evidence.evaluatedItemCount}</p></div>
          <div><p className="text-xs text-content-secondary">Itens pendentes</p><p className="text-xl font-semibold">{profile.evidence.pendingItemCount}</p></div>
        </div>
      </section>

      <section className="rounded border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-content-primary">Trajetória por avaliação</h2>
        <DataTable className="mt-3" columns={assessmentColumns} data={profile.assessments} searchableColumnId="subject" searchPlaceholder="Filtrar por disciplina..." />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded border border-border bg-surface p-5"><h2 className="font-semibold text-content-primary">Pontos fortes observados</h2>{profile.strengths.length ? <ul className="mt-3 space-y-2 text-sm text-content-secondary">{profile.strengths.map((item) => <li key={item}>• {item}</li>)}</ul> : <p className="mt-3 text-sm text-content-secondary">Ainda não há evidência suficiente para destacar um ponto forte.</p>}</div>
        <div className="rounded border border-border bg-surface p-5"><h2 className="font-semibold text-content-primary">Pontos para acompanhar</h2>{profile.development.length ? <ul className="mt-3 space-y-2 text-sm text-content-secondary">{profile.development.map((item) => <li key={item}>• {item}</li>)}</ul> : <p className="mt-3 text-sm text-content-secondary">Não há sinal abaixo de 60% com amostra mínima neste recorte.</p>}</div>
      </section>

      <section className="rounded border border-border bg-surface p-5">
        <h2 className="font-semibold text-content-primary">Habilidades BNCC</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><p className="text-sm font-medium text-content-primary">Maior domínio</p>{profile.bnccStrengths.length ? profile.bnccStrengths.map((skill) => <p key={skill.code} className="mt-2 text-sm text-content-secondary">{skill.code}: {skill.accuracyPercent}% em {skill.itemCount} itens</p>) : <p className="mt-2 text-sm text-content-secondary">Sem habilidade com amostra mínima.</p>}</div>
          <div><p className="text-sm font-medium text-content-primary">Para retomada</p>{profile.bnccInterventions.length ? profile.bnccInterventions.map((skill) => <p key={skill.code} className="mt-2 text-sm text-content-secondary">{skill.code}: {skill.accuracyPercent}% em {skill.itemCount} itens</p>) : <p className="mt-2 text-sm text-content-secondary">Sem habilidade abaixo de 60% com amostra mínima.</p>}</div>
        </div>
        {profile.sustainedDok && <p className="mt-4 text-sm text-content-secondary">Profundidade sustentada: {profile.sustainedDok.level}, {profile.sustainedDok.accuracyPercent}% em {profile.sustainedDok.itemCount} itens.</p>}
      </section>

      <section className="rounded border border-border bg-surface p-5">
        <h2 className="font-semibold text-content-primary">Domínio das habilidades planejadas</h2>
        <p className="mt-2 text-sm text-content-secondary">Aproveitamento = pontos obtidos ÷ pontos possíveis nas questões revisadas da habilidade, respeitando o peso de cada questão e a nota parcial das discursivas.{mastery && ` Com menos de ${mastery.rules.minItemsForReading} itens a leitura fica como evidência insuficiente; domínio exige ao menos ${mastery.rules.minItemsForMastery} itens em ${mastery.rules.minAssessmentsForMastery} avaliações e ${mastery.rules.masteryPercent}% de aproveitamento.`}</p>
        {masteryError ? <p className="mt-3 rounded bg-status-warning-surface p-3 text-sm text-status-warning-content">{masteryError}</p> : mastery ? <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div><p className="text-xs text-content-secondary">Planejadas</p><p className="text-xl font-semibold">{mastery.summary.plannedSkillCount}</p></div>
            <div><p className="text-xs text-content-secondary">Domínio</p><p className="text-xl font-semibold">{mastery.summary.levelCounts.dominio}</p></div>
            <div><p className="text-xs text-content-secondary">Próximo do domínio</p><p className="text-xl font-semibold">{mastery.summary.levelCounts.proximo_do_dominio}</p></div>
            <div><p className="text-xs text-content-secondary">Em desenvolvimento</p><p className="text-xl font-semibold">{mastery.summary.levelCounts.em_desenvolvimento}</p></div>
            <div><p className="text-xs text-content-secondary">Sem evidência suficiente</p><p className="text-xl font-semibold">{mastery.summary.levelCounts.sem_evidencia + mastery.summary.levelCounts.evidencia_insuficiente}</p></div>
          </div>
          {mastery.summary.limitedBySampleCount > 0 && <p className="rounded bg-status-warning-surface p-3 text-sm text-status-warning-content">{mastery.summary.limitedBySampleCount} {mastery.summary.limitedBySampleCount === 1 ? 'habilidade tem' : 'habilidades têm'} aproveitamento alto, mas ainda sem itens ou avaliações suficientes para afirmar domínio.</p>}
          {mastery.consolidated.bySubjectBimester.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Domínio consolidado por disciplina e bimestre</caption><thead><tr className="text-left text-xs text-content-secondary"><th scope="col" className="py-1 pr-3">Disciplina</th><th scope="col" className="py-1 pr-3">Período</th><th scope="col" className="py-1 pr-3">Aproveitamento</th><th scope="col" className="py-1 pr-3">Itens / avaliações</th><th scope="col" className="py-1">Habilidades (domínio · próximo · em desenv. · sem evidência suficiente)</th></tr></thead><tbody>{[...mastery.consolidated.bySubjectBimester, ...mastery.consolidated.bySubject].map((group) => <tr key={`${group.academicYear}-${group.segment}-${group.gradeYear}-${group.subject}-${group.bimester ?? 'ano'}`} className={`border-t border-border ${group.bimester === null ? 'font-semibold' : ''}`}><td className="py-1 pr-3">{group.subject}</td><td className="py-1 pr-3">{group.bimester === null ? `Ano ${group.academicYear}` : `${group.bimester}º bim. / ${group.academicYear}`}</td><td className="py-1 pr-3">{formatMastery(group.masteryPercent)}</td><td className="py-1 pr-3">{group.itemCount} / {group.assessmentCount}</td><td className="py-1">{group.levelCounts.dominio} · {group.levelCounts.proximo_do_dominio} · {group.levelCounts.em_desenvolvimento} · {group.levelCounts.sem_evidencia + group.levelCounts.evidencia_insuficiente}</td></tr>)}</tbody></table></div>}
          {mastery.summary.outsidePlanCount > 0 && <p className="rounded bg-status-info-surface p-3 text-sm text-status-info-content">Há {mastery.summary.outsidePlanCount} {mastery.summary.outsidePlanCount === 1 ? 'habilidade avaliada' : 'habilidades avaliadas'} fora da fotografia do planejamento. Elas aparecem na tabela para conferência.</p>}
          <DataTable columns={masteryColumns} data={mastery.rows} searchableColumnId="habilidade" searchPlaceholder="Filtrar por habilidade, disciplina ou situação..." emptyMessage="Ainda não há planejamento ou evidência BNCC para este recorte." />
        </div> : <p className="mt-3 text-sm text-content-secondary">Carregando domínio por habilidade…</p>}
      </section>

      <section className="rounded border border-border bg-surface p-5">
        <h2 className="font-semibold text-content-primary">Próximos passos</h2>
        {profile.priorities.length ? <ol className="mt-3 space-y-3">{profile.priorities.map((priority, index) => <li key={priority.code} className="rounded bg-surface-subtle p-3 text-sm"><span className="font-semibold text-content-primary">{index + 1}. {priority.code}</span><p className="mt-1 text-content-secondary">{priority.summary ?? priority.action}</p><p className="mt-1 text-xs text-content-secondary">{priority.accuracyPercent}% em {priority.itemCount} itens · {priority.action}</p></li>)}</ol> : <p className="mt-3 text-sm text-content-secondary">Ainda não há uma prioridade com amostra mínima neste recorte.</p>}
      </section>

      {profile.limitations.length > 0 && <p className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Limitações da leitura: {profile.limitations.join(' ')}</p>}
    </article>
  )
}
