'use client'

import { useState } from 'react'
import { SEGMENT_GRADES, SEGMENT_LABELS, SEGMENT_SUBJECTS } from '@/config/subjects'
import type { CurriculumSelection, ParsedHabilidade, Segment } from '@/types/exam'
import { descriptionCheckKey, type DescriptionCheck, type DescriptionCheckStatus } from '@/lib/curriculum/skillDescriptionTypes'
import CoveragePanel from './coverage-panel'

type PlanningPreview = CurriculumSelection & { descriptionChecks: DescriptionCheck[] }

const CHECK_BADGE: Record<DescriptionCheckStatus, { label: string; className: string } | null> = {
  confere: { label: 'Confere com a BNCC', className: 'border-status-success-border bg-status-success-surface text-status-success-content' },
  revisar: { label: 'Conferir', className: 'border-status-warning-border bg-status-warning-surface text-status-warning-content' },
  diverge: { label: 'Não confere com o código', className: 'border-status-danger-border bg-status-danger-surface text-status-danger-content' },
  nao_verificado: null,
}

function SkillRow({ skill, check }: { skill: ParsedHabilidade; check?: DescriptionCheck }) {
  const badge = check ? CHECK_BADGE[check.status] : null
  const showOfficial = check && (check.status === 'diverge' || check.status === 'revisar') && check.officialDescription
  return <li className="text-sm">
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="font-mono text-xs font-semibold text-content-primary">{skill.code}</span>
      {badge && <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>}
    </div>
    <p className="mt-0.5 text-content-secondary">{skill.description?.trim() || 'Sem descrição na planilha; será usado o texto oficial da BNCC.'}</p>
    {showOfficial && <p className="mt-1 border-l-2 border-border pl-2 text-xs text-content-muted"><span className="font-semibold">Texto oficial de {check.code}:</span> {check.officialDescription}</p>}
  </li>
}

export default function PlanningImport() {
  const [segment, setSegment] = useState<Segment>('anos-iniciais')
  const [gradeYear, setGradeYear] = useState(5)
  const [subject, setSubject] = useState('Língua Portuguesa')
  const [bimester, setBimester] = useState(1)
  const [academicYear, setAcademicYear] = useState(2026)
  const [preview, setPreview] = useState<PlanningPreview | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [coverageRefresh, setCoverageRefresh] = useState(0)

  function payload() { return { academicYear, segment, gradeYear, subject, bimester } }
  function changeSegment(value: Segment) { setSegment(value); setGradeYear(SEGMENT_GRADES[value][0]); setSubject(SEGMENT_SUBJECTS[value][0]); setPreview(null) }
  async function loadPreview() {
    setLoading(true); setMessage('')
    const response = await fetch('/api/curriculum/plans/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) })
    const body = await response.json(); setLoading(false)
    if (!response.ok) { setMessage(body.error ?? 'Não foi possível ler a planilha.'); return }
    setPreview(body)
  }
  async function importSnapshot() {
    setLoading(true); setMessage('')
    const response = await fetch('/api/curriculum/plans/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) })
    const body = await response.json(); setLoading(false)
    if (!response.ok) { setMessage([body.error, ...(body.invalidCodes ?? []), ...(body.duplicateCodes ?? [])].filter(Boolean).join(' · ')); return }
    setMessage(body.unchanged ? `A planilha não mudou; mantida a versão ${body.versionNumber}.` : `Versão ${body.versionNumber} salva: ${body.unitCount} unidades e ${body.skillCount} habilidades.`)
    setCoverageRefresh((value) => value + 1)
  }

  const checksByKey = new Map((preview?.descriptionChecks ?? []).map((check) => [descriptionCheckKey(check.code, check.spreadsheetDescription), check]))

  return <div className="mt-6 space-y-5">
    <div className="grid gap-3 rounded border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
      <input aria-label="Ano letivo" type="number" value={academicYear} onChange={(e) => { setAcademicYear(Number(e.target.value)); setPreview(null) }} className="rounded border border-border bg-canvas px-3 py-2" />
      <select aria-label="Segmento" value={segment} onChange={(e) => changeSegment(e.target.value as Segment)} className="rounded border border-border bg-canvas px-3 py-2">{Object.entries(SEGMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="Série" value={gradeYear} onChange={(e) => { setGradeYear(Number(e.target.value)); setPreview(null) }} className="rounded border border-border bg-canvas px-3 py-2">{SEGMENT_GRADES[segment].map((grade) => <option key={grade} value={grade}>{grade}º ano</option>)}</select>
      <select aria-label="Disciplina" value={subject} onChange={(e) => { setSubject(e.target.value); setPreview(null) }} className="rounded border border-border bg-canvas px-3 py-2">{SEGMENT_SUBJECTS[segment].map((item) => <option key={item}>{item}</option>)}</select>
      <select aria-label="Bimestre" value={bimester} onChange={(e) => { setBimester(Number(e.target.value)); setPreview(null) }} className="rounded border border-border bg-canvas px-3 py-2">{[1,2,3,4].map((item) => <option key={item} value={item}>{item}º bimestre</option>)}</select>
      <button type="button" disabled={loading} onClick={loadPreview} className="rounded bg-harmonia-green px-4 py-2 font-semibold text-action-primary-foreground disabled:opacity-50">{loading ? 'Carregando…' : 'Conferir planilha'}</button>
    </div>
    {message && <p role="status" className="rounded border border-border bg-surface p-3 text-sm text-content-secondary">{message}</p>}
    {preview && <section className="rounded border border-border bg-surface p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Planejamento encontrado na planilha</h2><p className="text-sm text-content-secondary">Origem: {preview.tabName} · {preview.units.length} unidades · {preview.units.reduce((sum, unit) => sum + unit.habilidades.skills.length, 0)} habilidades</p></div><div className="max-w-sm text-right"><button type="button" disabled={loading} onClick={importSnapshot} className="rounded bg-harmonia-green px-4 py-2 text-sm font-semibold text-action-primary-foreground disabled:opacity-50">Importar planejamento do {bimester}º bimestre</button><p className="mt-2 text-xs text-content-muted">Salva no Prova TRI uma versão deste planejamento para comparar habilidades planejadas e avaliadas. A planilha original não será alterada.</p></div></div>
      {preview.unmappedWarnings.length > 0 && <div className="mt-4 rounded bg-status-warning-surface p-3 text-sm text-status-warning-content"><p className="font-semibold">Pendências encontradas ({preview.unmappedWarnings.length})</p><ul className="mt-2 space-y-1">{preview.unmappedWarnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul></div>}
      <DescriptionCheckSummary checks={preview.descriptionChecks} />
      <div className="mt-4 space-y-2">{preview.units.map((unit) => <div key={unit.rowIndex} className="rounded border border-border p-3"><p className="font-medium">{unit.tituloCapitulo || 'Sem título'}</p><p className="mt-1 text-sm text-content-secondary">{unit.conteudo || 'Conteúdo não informado'}</p>{unit.habilidades.skills.length ? <ul className="mt-3 space-y-2">{unit.habilidades.skills.map((skill, index) => <SkillRow key={`${skill.code}-${index}`} skill={skill} check={skill.description?.trim() ? checksByKey.get(descriptionCheckKey(skill.code, skill.description)) : undefined} />)}</ul> : <p className="mt-2 text-xs text-content-muted">BNCC não mapeada</p>}</div>)}</div>
    </section>}
    <CoveragePanel scope={{ academicYear, segment, gradeYear, subject, bimester }} refreshToken={coverageRefresh} />
  </div>
}

function DescriptionCheckSummary({ checks }: { checks: DescriptionCheck[] }) {
  if (!checks.length) return null
  const diverge = checks.filter((check) => check.status === 'diverge').length
  const revisar = checks.filter((check) => check.status === 'revisar').length
  const naoVerificado = checks.filter((check) => check.status === 'nao_verificado').length
  if (naoVerificado === checks.length) return <p className="mt-4 rounded border border-border bg-surface-subtle p-3 text-sm text-content-secondary">A conferência automática das descrições está indisponível agora. A importação continua funcionando normalmente.</p>
  if (!diverge && !revisar) return <p className="mt-4 rounded border border-status-success-border bg-status-success-surface p-3 text-sm text-status-success-content">As {checks.length - naoVerificado} descrições da planilha conferem com os códigos BNCC informados.</p>
  return <div className="mt-4 rounded border border-status-warning-border bg-status-warning-surface p-3 text-sm text-status-warning-content">
    <p className="font-semibold">Descrições para a coordenação conferir na planilha</p>
    <p className="mt-1">{diverge > 0 && `${diverge} não ${diverge === 1 ? 'confere' : 'conferem'} com o código informado`}{diverge > 0 && revisar > 0 && ' · '}{revisar > 0 && `${revisar} com correspondência duvidosa`}. A importação não é bloqueada; corrija a planilha na origem se o código ou o texto estiver trocado.</p>
  </div>
}
