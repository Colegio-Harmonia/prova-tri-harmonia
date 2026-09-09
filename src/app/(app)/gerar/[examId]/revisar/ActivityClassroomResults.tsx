'use client'

import { useCallback, useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'

type Result = { id: number; studentName: string; studentEmail: string | null; submissionState: string | null; assignedGrade: number | null; assignedRubricGrades: unknown | null; importedAt: string }
type Response = { sync: { lastImportedAt: string | null; lastImportError: string | null; rubricId: string | null } | null; results: Result[] }

export default function ActivityClassroomResults({ examId }: { examId: number }) {
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    try { const response = await fetch(`/api/exams/${examId}/activity-classroom-results`); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Erro ao carregar importações.'); setData(body) } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao carregar importações.') } finally { setLoading(false) }
  }, [examId])
  useEffect(() => { load() }, [load])
  async function importResults() {
    setImporting(true); setError(null); setMessage(null)
    try {
      const response = await fetch(`/api/exams/${examId}/activity-classroom-results`, { method: 'POST' }); const body = await response.json()
      if (!response.ok) { if (body.error === 'google_not_connected' || body.error === 'reauth_required') { setError('Conecte novamente sua conta Google para importar.'); return }; throw new Error(body.error ?? 'Erro ao importar correções.') }
      setMessage(`${body.imported} aluno(s) sincronizado(s); ${body.graded} com nota.`); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao importar correções.') } finally { setImporting(false) }
  }
  if (loading) return <p className="text-sm text-content-muted">Carregando resultados do Classroom…</p>
  const results = data?.results ?? []
  const hasRubric = Boolean(data?.sync?.rubricId)
  return <section className="mt-6 rounded-lg border border-border bg-surface p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-content-primary">Correções do Google Classroom</h2><p className="mt-1 text-sm text-content-secondary">{hasRubric ? 'As notas e níveis da rubrica são importados como foram corrigidos pelo professor.' : 'As notas atribuídas pelo professor no Classroom são importadas sem estimativa automática por habilidade.'}</p></div><button type="button" onClick={importResults} disabled={importing} className="min-h-10 rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{importing ? 'Importando…' : 'Importar correções do Classroom'}</button></div>{data?.sync?.lastImportedAt && <p className="mt-3 text-xs text-content-muted">Última importação: {new Date(data.sync.lastImportedAt).toLocaleString('pt-BR')}.</p>}{message && <p className="mt-3 text-sm text-harmonia-green">{message}</p>}{error && <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-red-600">{error}{error.includes('Conecte') && <button type="button" onClick={() => signIn('google', { callbackUrl: `/gerar/${examId}/revisar` })} className="font-medium underline">Conectar Google</button>}</div>}{results.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead className="border-b border-border text-content-secondary"><tr><th className="py-2 pr-3">Aluno</th><th className="py-2 pr-3">Situação</th><th className="py-2 pr-3">Nota</th>{hasRubric && <th className="py-2">Rubrica</th>}</tr></thead><tbody>{results.map((row) => <tr key={row.id} className="border-b border-border/70"><td className="py-2 pr-3"><span className="font-medium text-content-primary">{row.studentName}</span>{row.studentEmail && <span className="block text-xs text-content-muted">{row.studentEmail}</span>}</td><td className="py-2 pr-3 text-content-secondary">{row.submissionState ?? '—'}</td><td className="py-2 pr-3 text-content-primary">{row.assignedGrade ?? '—'}</td>{hasRubric && <td className="py-2 text-content-secondary">{row.assignedRubricGrades ? 'Corrigida no Classroom' : 'Ainda sem rubrica'}</td>}</tr>)}</tbody></table></div>}{!results.length && <p className="mt-4 text-sm text-content-muted">Nenhum resultado importado ainda. Depois de corrigir no Classroom, use o botão acima.</p>}</section>
}
