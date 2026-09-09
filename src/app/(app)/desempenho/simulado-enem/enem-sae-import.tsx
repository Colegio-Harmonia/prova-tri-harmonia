'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { EnemSaeAnalysis, EnemSaeArea, EnemSaeQuestion, EnemSaeStudent } from '@/lib/analytics/enemSae'

const AREA_LABELS: Record<EnemSaeArea, string> = {
  LC: 'Linguagens', CH: 'Ciências Humanas', CN: 'Ciências da Natureza', MT: 'Matemática',
}

type Bimester = '1' | '2' | '3' | '4'
const BIMESTERS: readonly Bimester[] = ['1', '2', '3', '4']
type Taxonomy = 'competence' | 'skill' | 'topic' | 'discipline'
type ImportFiles = { responses: File | null; questionMatrix: File | null }
type Diagnostic = { label: string; correct: number; answered: number; accuracy: number | null; classAccuracy: number | null }
type EnemSaeImportProps = { initialImports?: Partial<Record<Bimester, EnemSaeAnalysis>>; academicYear?: number; readOnly?: boolean }

function normalizeName(name: string) {
  return name.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
}

function delta(value: number | null, previous: number | null) {
  if (value === null || previous === null) return null
  return value - previous
}

function formatDelta(value: number | null) {
  return value === null ? '—' : `${value > 0 ? '+' : ''}${value} p.p.`
}

function percentage(correct: number, answered: number) {
  return answered === 0 ? null : Math.round((correct / answered) * 100)
}

function studentDiagnostics(analysis: EnemSaeAnalysis | undefined, student: EnemSaeStudent | undefined, taxonomy: Taxonomy) {
  if (!analysis || !student) return [] as Diagnostic[]
  const groups = new Map<string, { correct: number; answered: number; classCorrect: number; classAnswered: number }>()
  for (const question of analysis.questions) {
    const label = question[taxonomy]
    const answer = student.answers[question.id]
    if (!label || answer === null || answer === undefined) continue
    const group = groups.get(label) ?? { correct: 0, answered: 0, classCorrect: 0, classAnswered: 0 }
    group.answered++
    if (answer) group.correct++
    group.classCorrect += question.correct
    group.classAnswered += question.answered
    groups.set(label, group)
  }
  return [...groups.entries()].map(([label, group]) => ({
    label,
    correct: group.correct,
    answered: group.answered,
    accuracy: percentage(group.correct, group.answered),
    classAccuracy: percentage(group.classCorrect, group.classAnswered),
  })).sort((left, right) => (left.accuracy ?? 101) - (right.accuracy ?? 101) || left.label.localeCompare(right.label))
}

function recommendation(diagnostic: Diagnostic) {
  if ((diagnostic.accuracy ?? 100) >= 60) return 'Manter prática e monitorar em novas aplicações.'
  if (diagnostic.answered === 1) return 'Sinal inicial: confirmar com novos itens antes de concluir uma lacuna.'
  if ((diagnostic.classAccuracy ?? 0) >= (diagnostic.accuracy ?? 0) + 15) return 'Prioridade individual: o desempenho ficou abaixo da turma.'
  return 'Prioridade de retomada: revisar o conteúdo e praticar itens equivalentes.'
}

function comparison(first: Diagnostic[], second: Diagnostic[]) {
  const previous = new Map(first.map((item) => [item.label, item]))
  return second.map((item) => ({ ...item, previous: previous.get(item.label)?.accuracy ?? null, change: delta(item.accuracy, previous.get(item.label)?.accuracy ?? null) }))
    .filter((item) => item.previous !== null)
    .sort((left, right) => (left.change ?? 999) - (right.change ?? 999) || left.label.localeCompare(right.label))
}

function selectStudent(analysis: EnemSaeAnalysis | undefined, selectedName: string) {
  return analysis?.students.find((student) => normalizeName(student.name) === selectedName)
}

export default function EnemSaeImport({ initialImports = {}, academicYear: initialAcademicYear = new Date().getFullYear(), readOnly = false }: EnemSaeImportProps) {
  const [imports, setImports] = useState<Partial<Record<Bimester, EnemSaeAnalysis>>>(initialImports)
  const [academicYear, setAcademicYear] = useState(initialAcademicYear)
  const [files, setFiles] = useState<Record<Bimester, ImportFiles>>({
    '1': { responses: null, questionMatrix: null },
    '2': { responses: null, questionMatrix: null },
    '3': { responses: null, questionMatrix: null },
    '4': { responses: null, questionMatrix: null },
  })
  const [loading, setLoading] = useState<Bimester | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState('')
  const [individualView, setIndividualView] = useState(false)

  async function loadBimester(bimester: Bimester) {
    const currentFiles = files[bimester]
    if (!currentFiles.responses || !currentFiles.questionMatrix) {
      setError(`Selecione as respostas e a matriz de questões do ${bimester}º bimestre.`)
      return
    }
    setLoading(bimester)
    setError(null)
    try {
      const formData = new FormData()
      formData.set('responses', currentFiles.responses)
      formData.set('questionMatrix', currentFiles.questionMatrix)
      formData.set('academicYear', String(academicYear))
      formData.set('bimester', bimester)
      const response = await fetch('/api/analytics/enem-sae/import', { method: 'POST', body: formData })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error ?? 'Falha ao ler as planilhas.')
      setImports((current) => ({ ...current, [bimester]: body.analysis }))
      setSelectedName((current) => current || normalizeName(body.analysis.students[0]?.name ?? ''))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao ler as planilhas.')
    } finally {
      setLoading(null)
    }
  }

  const first = imports['1']
  const second = imports['2']
  const availableBimesters = BIMESTERS.filter((bimester) => Boolean(imports[bimester]))
  const currentBimester = availableBimesters.at(-1)
  const previousBimester = availableBimesters.at(-2)
  const currentAnalysis = currentBimester ? imports[currentBimester] : undefined
  const previousAnalysis = previousBimester ? imports[previousBimester] : undefined
  useEffect(() => {
    if (!selectedName && currentAnalysis?.students[0]) setSelectedName(normalizeName(currentAnalysis.students[0].name))
  }, [currentAnalysis, selectedName])
  const selectedStudent = selectStudent(currentAnalysis, selectedName)
  const previousStudent = selectStudent(previousAnalysis, selectedName)
  const currentSkillDiagnostics = studentDiagnostics(currentAnalysis, selectedStudent, 'skill')
  const currentCompetenceDiagnostics = studentDiagnostics(currentAnalysis, selectedStudent, 'competence')
  const currentTopicDiagnostics = studentDiagnostics(currentAnalysis, selectedStudent, 'topic')
  const currentPerformance = selectedStudent?.overallPercent ?? null
  const previousPerformance = previousStudent?.overallPercent ?? null
  const performanceChange = delta(currentPerformance, previousPerformance)
  const performanceGap = currentPerformance === null ? null : Math.max(0, 60 - currentPerformance)
  const performanceRecommendation = currentPerformance === null ? '' : currentPerformance >= 60
    ? 'Mantenha a regularidade: revise os erros das habilidades prioritárias e pratique novos itens para ganhar consistência.'
    : `Faltam ${performanceGap} p.p. para a referência de 60%. Priorize ${currentSkillDiagnostics.slice(0, 2).map((item) => item.label).join(' e ') || 'as habilidades com menor desempenho'} e refaça os itens errados antes de aumentar a dificuldade.`
  const individualRecommendation = selectedStudent?.overallPercent != null
    ? selectedStudent.overallPercent >= 60
      ? `${selectedStudent.name} está acima da referência. Mantenha a prática nas habilidades com menor desempenho para ganhar consistência.`
      : `${selectedStudent.name} deve priorizar ${currentSkillDiagnostics.slice(0, 2).map((item) => item.label).join(' e ') || 'as habilidades com menor desempenho'} para alcançar a referência de 60%.`
    : ''
  const skillEvolution = comparison(studentDiagnostics(previousAnalysis, previousStudent, 'skill'), studentDiagnostics(currentAnalysis, selectedStudent, 'skill'))
  const previousStudents = new Map(previousAnalysis?.students.map((student) => [normalizeName(student.name), student]) ?? [])
  const evolution = (second?.students ?? []).map((student) => {
    const previous = first?.students.find((candidate) => normalizeName(candidate.name) === normalizeName(student.name))
    return { name: student.name, first: previous?.overallPercent ?? null, second: student.overallPercent, delta: delta(student.overallPercent, previous?.overallPercent ?? null) }
  }).sort((left, right) => (right.delta ?? -999) - (left.delta ?? -999) || left.name.localeCompare(right.name))
  const annualStudents = new Map<string, { name: string; scores: Partial<Record<Bimester, number>> }>()
  for (const bimester of availableBimesters) {
    for (const student of imports[bimester]?.students ?? []) {
      const key = normalizeName(student.name)
      const annualStudent = annualStudents.get(key) ?? { name: student.name, scores: {} }
      if (student.overallPercent !== null) annualStudent.scores[bimester] = student.overallPercent
      annualStudents.set(key, annualStudent)
    }
  }
  const annualEvolution = [...annualStudents.values()]
    .map((student) => ({
      ...student,
      change: delta(
        currentBimester ? student.scores[currentBimester] ?? null : null,
        previousBimester ? student.scores[previousBimester] ?? null : null,
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const areaEvolution = availableBimesters.map((bimester) => ({
    bimester: `${bimester}º bim.`,
    reference: 60,
    ...Object.fromEntries((['LC', 'CH', 'CN', 'MT'] as EnemSaeArea[]).map((area) => [area, imports[bimester]?.areas[area].accuracyPercent ?? null])),
  }))

  return (
    <section className="space-y-6 rounded border border-border bg-surface p-5">
      <div>
        <h1 className="text-xl font-bold text-content-primary">{readOnly ? 'Simulado ENEM - Resultados SAE' : 'Importar Simulado ENEM - SAE'}</h1>
        <p className="mt-1 max-w-3xl text-sm text-content-secondary">{readOnly ? `Resultados persistidos do 3º ano do Ensino Médio em ${academicYear}.` : 'Para cada bimestre, envie as respostas “Alunos X Questões” e a matriz “Questões por simulado”. O vínculo é validado antes de salvar o diagnóstico; os arquivos XLSX são descartados após a leitura.'}</p>
      </div>

      {readOnly && availableBimesters.length === 0 && <div className="rounded border border-dashed border-border bg-canvas p-5"><p className="font-semibold text-content-primary">Nenhum SAE importado para {academicYear}</p><p className="mt-1 text-sm text-content-secondary">Importe os resultados por bimestre para disponibilizar o painel à coordenação e direção.</p><Link href="/desempenho/simulado-enem/sae" className="mt-4 inline-flex min-h-10 items-center rounded bg-harmonia-green px-3 text-sm font-semibold text-white">Abrir importação SAE</Link></div>}

      {!readOnly && <><div className="flex flex-wrap items-end justify-between gap-3"><label className="block text-sm text-content-secondary" htmlFor="enem-sae-year">Ano letivo<input id="enem-sae-year" type="number" min="2000" max="2100" value={academicYear} onChange={(event) => setAcademicYear(Number(event.target.value))} className="mt-2 block min-h-10 w-32 rounded border border-border bg-canvas px-3 text-content-primary" /></label><Link href="/desempenho/simulado-enem" className="min-h-10 rounded border border-border px-3 py-2 text-sm font-medium text-content-primary hover:bg-surface-subtle">Ver resultados salvos</Link></div>

      <div className="grid gap-4 md:grid-cols-2">
        {BIMESTERS.map((bimester) => {
          const analysis = imports[bimester]
          return (
            <div key={bimester} className="rounded border border-border bg-canvas p-4">
              <p className="font-semibold text-content-primary">{bimester}º bimestre</p>
              <label className="mt-3 block text-sm text-content-secondary" htmlFor={`enem-sae-responses-${bimester}`}>Respostas dos alunos</label>
              <input id={`enem-sae-responses-${bimester}`} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFiles((current) => ({ ...current, [bimester]: { ...current[bimester], responses: event.target.files?.[0] ?? null } }))} className="mt-2 block w-full text-sm text-content-secondary" />
              <label className="mt-3 block text-sm text-content-secondary" htmlFor={`enem-sae-matrix-${bimester}`}>Matriz de questões</label>
              <input id={`enem-sae-matrix-${bimester}`} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFiles((current) => ({ ...current, [bimester]: { ...current[bimester], questionMatrix: event.target.files?.[0] ?? null } }))} className="mt-2 block w-full text-sm text-content-secondary" />
              <button type="button" onClick={() => loadBimester(bimester)} disabled={loading !== null} className="mt-4 min-h-10 rounded bg-harmonia-green px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{loading === bimester ? 'Validando e analisando…' : `Analisar ${bimester}º bimestre`}</button>
              {analysis && <p className="mt-3 text-sm text-content-primary">{analysis.summary.studentCount} alunos · {analysis.summary.overallPercent}% geral · {analysis.summary.belowReferenceCount} abaixo de 60%</p>}
            </div>
          )
        })}
      </div></>}

      {error && <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">{error}</p>}

      {!individualView && (first || second) && <>
        <section>
          <h3 className="text-lg font-semibold text-content-primary">Desempenho por área</h3>
          <div className="mt-3 overflow-x-auto rounded border border-border"><table className="min-w-full text-left text-sm"><thead className="border-b border-border text-content-secondary"><tr><th className="p-3">Área</th><th className="p-3">1º bim.</th><th className="p-3">2º bim.</th><th className="p-3">Variação</th><th className="p-3">Leitura</th></tr></thead><tbody>{(['LC', 'CH', 'CN', 'MT'] as EnemSaeArea[]).map((area) => { const firstValue = first?.areas[area].accuracyPercent ?? null; const secondValue = second?.areas[area].accuracyPercent ?? null; const change = delta(secondValue, firstValue); const current = secondValue ?? firstValue; return <tr key={area} className="border-b border-border last:border-0"><td className="p-3 font-medium text-content-primary">{AREA_LABELS[area]}</td><td className="p-3 text-content-secondary">{firstValue === null ? '—' : `${firstValue}%`}</td><td className="p-3 text-content-secondary">{secondValue === null ? '—' : `${secondValue}%`}</td><td className={`p-3 font-medium ${change !== null && change < 0 ? 'text-red-700 dark:text-red-300' : 'text-content-primary'}`}>{formatDelta(change)}</td><td className="p-3 text-content-secondary">{current !== null && current < 60 ? 'Priorizar habilidades e tópicos abaixo de 60%.' : 'Sem sinal abaixo de 60% nesta área.'}</td></tr> })}</tbody></table></div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {[first, second].filter((analysis): analysis is EnemSaeAnalysis => Boolean(analysis)).map((analysis, index) => {
            const weakest = [...analysis.questions].filter((question) => question.answered >= 3 && question.skill).sort((left, right) => (left.accuracyPercent ?? 101) - (right.accuracyPercent ?? 101)).slice(0, 6)
            return <div key={index} className="rounded border border-border bg-canvas p-4"><h3 className="font-semibold text-content-primary">Itens críticos {first === analysis ? '1º bimestre' : '2º bimestre'}</h3><ol className="mt-3 space-y-3 text-sm text-content-secondary">{weakest.map((question: EnemSaeQuestion) => <li key={question.id}><p><strong className="text-content-primary">{question.id}: {question.accuracyPercent}%</strong> · {question.topic}</p><p className="mt-1">{question.skill}</p></li>)}</ol></div>
          })}
        </section>
      </>}

      {currentAnalysis && selectedStudent && <section className="sae-student-report rounded border border-harmonia-green/40 bg-harmonia-green/5 p-4 print:border-black print:bg-white">
        <header className="mb-4 border-b border-border pb-3"><p className="text-xs font-semibold uppercase tracking-wide text-content-secondary">Relatório individual SAE-ENEM</p><h2 className="mt-1 text-2xl font-bold text-content-primary">{selectedStudent.name}</h2><p className="mt-1 text-sm text-content-secondary">Referência pedagógica: 60% de aproveitamento.</p></header>
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-lg font-semibold text-content-primary">Perfil de aprendizagem do aluno</h3><p className="mt-1 text-sm text-content-secondary">Diagnóstico do {currentBimester}º bimestre, com referência de 60%.</p></div><div className="sae-print-hide flex flex-wrap gap-2"><label className="sr-only" htmlFor="enem-student">Aluno</label><select id="enem-student" value={selectedName} onChange={(event) => { setSelectedName(event.target.value); setIndividualView(true) }} className="min-h-10 max-w-full rounded border border-border bg-canvas px-3 text-sm text-content-primary">{currentAnalysis.students.map((student) => <option key={student.name} value={normalizeName(student.name)}>{student.name}</option>)}</select>{individualView && <button type="button" onClick={() => setIndividualView(false)} className="min-h-10 rounded border border-border px-3 text-sm font-medium text-content-primary">Visão da turma</button>}<button type="button" onClick={() => window.print()} className="min-h-10 rounded border border-border px-3 text-sm font-medium text-content-primary hover:bg-surface-subtle">Imprimir / Salvar em PDF</button></div></div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4"><div className="rounded border border-border bg-canvas p-3"><p className="text-xs font-semibold uppercase tracking-wide text-content-secondary">Aproveitamento</p><p className="mt-1 text-2xl font-bold text-content-primary">{selectedStudent.overallPercent}%</p></div><div className="rounded border border-border bg-canvas p-3"><p className="text-xs font-semibold uppercase tracking-wide text-content-secondary">Referência</p><p className="mt-1 text-2xl font-bold text-content-primary">60%</p></div><div className="rounded border border-border bg-canvas p-3"><p className="text-xs font-semibold uppercase tracking-wide text-content-secondary">Distância da referência</p><p className="mt-1 text-2xl font-bold text-content-primary">{performanceGap === null ? '—' : performanceGap === 0 ? 'Atingiu' : `${performanceGap} p.p.`}</p></div><div className="rounded border border-border bg-canvas p-3"><p className="text-xs font-semibold uppercase tracking-wide text-content-secondary">Evolução</p><p className={`mt-1 text-2xl font-bold ${(performanceChange ?? 0) < 0 ? 'text-red-700 dark:text-red-300' : 'text-harmonia-green'}`}>{performanceChange === null ? '—' : `${performanceChange > 0 ? '+' : ''}${performanceChange} p.p.`}</p></div></div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2"><DiagnosticTable title="Prioridades por habilidade" diagnostics={currentSkillDiagnostics.slice(0, 8)} showRecommendation /><DiagnosticTable title="Domínio por competência" diagnostics={currentCompetenceDiagnostics} /></div>
        <div className="mt-4"><DiagnosticTable title="Focos por tópico" diagnostics={currentTopicDiagnostics.slice(0, 10)} showRecommendation /></div>
        <aside className="mt-4 rounded border border-harmonia-green/30 bg-canvas p-4"><h4 className="font-semibold text-content-primary">Plano de estudo</h4><p className="mt-1 text-sm text-content-secondary">{performanceRecommendation}</p><p className="mt-2 text-xs text-content-muted">Este painel é descritivo: ele analisa os dados importados e não calcula TRI.</p></aside>
        <aside className="mt-4 rounded border border-harmonia-green/30 bg-canvas p-4"><h4 className="font-semibold text-content-primary">Recomendação individual</h4><p className="mt-1 text-sm text-content-secondary">{individualRecommendation}</p></aside>
        {skillEvolution.length > 0 && <div className="mt-4"><h4 className="font-semibold text-content-primary">Evolução por habilidade entre bimestres</h4><div className="mt-2 overflow-x-auto rounded border border-border bg-canvas"><table className="min-w-full text-left text-sm"><thead className="border-b border-border text-content-secondary"><tr><th className="p-3">Habilidade</th><th className="p-3">{previousBimester}º bim.</th><th className="p-3">{currentBimester}º bim.</th><th className="p-3">Variação</th></tr></thead><tbody>{skillEvolution.slice(0, 12).map((item) => <tr key={item.label} className="border-b border-border last:border-0"><td className="max-w-xl p-3 text-content-primary">{item.label}</td><td className="p-3 text-content-secondary">{item.previous}%</td><td className="p-3 text-content-secondary">{item.accuracy}%</td><td className={`p-3 font-medium ${(item.change ?? 0) < 0 ? 'text-red-700 dark:text-red-300' : 'text-harmonia-green'}`}>{formatDelta(item.change)}</td></tr>)}</tbody></table></div></div>}
        <p className="mt-4 text-xs text-content-secondary">Eixo cognitivo e códigos BNCC não constam na matriz fornecida; por transparência, eles não são inferidos. O diagnóstico usa apenas a classificação declarada pelo simulador: competência, habilidade, tópico e disciplina.</p>
      </section>}

      {!individualView && first && second && <section>
        <h3 className="text-lg font-semibold text-content-primary">Evolução por aluno</h3>
        <p className="mt-1 text-sm text-content-secondary">Compara o percentual geral dos dois simulados. A leitura pedagógica detalhada está no perfil individual acima.</p>
        <div className="mt-3 overflow-x-auto rounded border border-border"><table className="min-w-full text-left text-sm"><thead className="border-b border-border text-content-secondary"><tr><th className="p-3">Aluno</th><th className="p-3">1º bim.</th><th className="p-3">2º bim.</th><th className="p-3">Variação</th><th className="p-3">Referência 60%</th></tr></thead><tbody>{evolution.map((student) => <tr key={student.name} className="border-b border-border last:border-0"><td className="p-3 font-medium text-content-primary">{student.name}</td><td className="p-3 text-content-secondary">{student.first === null ? '—' : `${student.first}%`}</td><td className="p-3 text-content-secondary">{student.second === null ? '—' : `${student.second}%`}</td><td className={`p-3 font-medium ${student.delta !== null && student.delta < 0 ? 'text-red-700 dark:text-red-300' : 'text-harmonia-green'}`}>{formatDelta(student.delta)}</td><td className="p-3 text-content-secondary">{(student.second ?? 0) >= 60 ? 'Atingiu' : 'Acompanhar'}</td></tr>)}</tbody></table></div>
      </section>}

      {!individualView && areaEvolution.length > 0 && <section className="rounded border border-border bg-canvas p-4">
        <h3 className="text-lg font-semibold text-content-primary">Evolução anual por área de conhecimento</h3>
        <p className="mt-1 text-sm text-content-secondary">Percentual médio da turma em cada simulado. A linha de referência indica a média de aprovação de 60%.</p>
        <div role="img" aria-label="Gráfico de evolução anual por área de conhecimento" className="mt-4 h-80 min-w-[34rem] overflow-x-auto">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={areaEvolution} margin={{ top: 8, right: 24, left: -16, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
              <XAxis dataKey="bimester" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => `${value}%`} />
              <Legend />
              <Line type="monotone" dataKey="LC" name="Linguagens" stroke="#008649" strokeWidth={3} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="CH" name="Humanas" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="CN" name="Natureza" stroke="#d97706" strokeWidth={3} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="MT" name="Matemática" stroke="#7c3aed" strokeWidth={3} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="reference" name="Referência 60%" stroke="#6b7280" strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>}

      {!individualView && availableBimesters.length > 0 && <section>
        <h3 className="text-lg font-semibold text-content-primary">Evolução anual por aluno</h3>
        <p className="mt-1 text-sm text-content-secondary">Mantém o histórico dos simulados aplicados no ano. A variação compara os dois períodos mais recentes disponíveis.</p>
        <div className="mt-3 overflow-x-auto rounded border border-border"><table className="min-w-full text-left text-sm"><thead className="border-b border-border text-content-secondary"><tr><th className="p-3">Aluno</th>{availableBimesters.map((bimester) => <th key={bimester} className="p-3">{bimester}º bim.</th>)}<th className="p-3">Variação recente</th><th className="p-3">Referência 60%</th></tr></thead><tbody>{annualEvolution.map((student) => <tr key={student.name} className="border-b border-border last:border-0"><td className="p-3 font-medium text-content-primary">{student.name}</td>{availableBimesters.map((bimester) => <td key={bimester} className="p-3 text-content-secondary">{student.scores[bimester] === undefined ? '—' : `${student.scores[bimester]}%`}</td>)}<td className={`p-3 font-medium ${student.change !== null && student.change < 0 ? 'text-red-700 dark:text-red-300' : 'text-harmonia-green'}`}>{formatDelta(student.change)}</td><td className="p-3 text-content-secondary">{currentBimester && (student.scores[currentBimester] ?? 0) >= 60 ? 'Atingiu' : 'Acompanhar'}</td></tr>)}</tbody></table></div>
      </section>}
    </section>
  )
}

function DiagnosticTable({ title, diagnostics, showRecommendation = false }: { title: string; diagnostics: Diagnostic[]; showRecommendation?: boolean }) {
  return <div><h4 className="font-semibold text-content-primary">{title}</h4><div className="mt-2 overflow-x-auto rounded border border-border bg-canvas"><table className="min-w-full text-left text-sm"><thead className="border-b border-border text-content-secondary"><tr><th className="p-3">Classificação</th><th className="p-3">Aluno</th><th className="p-3">Turma</th><th className="p-3">Base</th>{showRecommendation && <th className="p-3">Orientação</th>}</tr></thead><tbody>{diagnostics.map((item) => <tr key={item.label} className="border-b border-border last:border-0"><td className="max-w-md p-3 text-content-primary">{item.label}</td><td className={`p-3 font-semibold ${(item.accuracy ?? 0) < 60 ? 'text-red-700 dark:text-red-300' : 'text-harmonia-green'}`}>{item.accuracy}%</td><td className="p-3 text-content-secondary">{item.classAccuracy}%</td><td className="p-3 text-content-secondary">{item.answered} {item.answered === 1 ? 'item' : 'itens'}</td>{showRecommendation && <td className="min-w-56 p-3 text-content-secondary">{recommendation(item)}</td>}</tr>)}</tbody></table></div></div>
}
