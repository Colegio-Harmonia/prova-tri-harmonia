'use client'

import { useEffect, useState } from 'react'
import AiModelProfilesPanel from './AiModelProfilesPanel'

type Operation = { id: number; operation: string; provider: string; model: string; status: 'succeeded' | 'rejected' | 'failed'; attempt: number; totalTokens: number | null; estimatedCostMicrousd: number | null; durationMs: number | null; errorCode: string | null; createdAt: string }
type Payload = { summary: { total: number; succeeded: number; rejected: number; failed: number; totalTokens: number; estimatedCostMicrousd: number }; operations: Operation[] }

export default function AiOperationsPanel() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/ai-operations').then(async (response) => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível carregar a telemetria.')
      setData(body)
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a telemetria.'))
  }, [])

  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!data) return <p className="text-sm text-content-muted">Carregando telemetria…</p>

  return <div className="space-y-6">
    <header><h1 className="text-lg font-semibold text-content-primary">Operações de IA</h1><p className="mt-1 max-w-3xl text-sm text-content-secondary">Uso técnico das últimas 100 tentativas. Não armazenamos prompts, respostas, notas ou dados de alunos.</p></header>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" aria-label="Resumo da telemetria">
      <Metric label="Tentativas" value={data.summary.total} /><Metric label="Concluídas" value={data.summary.succeeded} /><Metric label="Reparos" value={data.summary.rejected} /><Metric label="Falhas" value={data.summary.failed} /><Metric label="Tokens retornados" value={data.summary.totalTokens.toLocaleString('pt-BR')} /><Metric label="Custo estimado" value={`US$ ${(data.summary.estimatedCostMicrousd / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`} />
    </section>
    {data.operations.length === 0 ? <section className="rounded border border-dashed border-border bg-surface p-5"><h2 className="font-semibold text-content-primary">Ainda não há operações registradas</h2><p className="mt-1 text-sm text-content-secondary">Os registros aparecerão após uma geração, sugestão ou extração de gráfico real.</p></section> : <section className="overflow-x-auto rounded border border-border bg-surface"><table className="w-full text-left text-sm"><thead className="border-b border-border bg-surface-subtle text-content-secondary"><tr><th className="px-4 py-3">Operação</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Modelo</th><th className="px-4 py-3">Tokens</th><th className="px-4 py-3">Custo</th><th className="px-4 py-3">Duração</th><th className="px-4 py-3">Quando</th></tr></thead><tbody>{data.operations.map((operation) => <tr key={operation.id} className="border-b border-border last:border-0"><td className="px-4 py-3 text-content-primary">{operation.operation}<span className="block text-xs text-content-muted">tentativa {operation.attempt}{operation.errorCode ? ` · ${operation.errorCode}` : ''}</span></td><td className="px-4 py-3"><Status status={operation.status} /></td><td className="px-4 py-3 text-content-secondary">{operation.provider} · {operation.model}</td><td className="px-4 py-3 text-content-secondary">{operation.totalTokens?.toLocaleString('pt-BR') ?? '—'}</td><td className="px-4 py-3 text-content-secondary">{operation.estimatedCostMicrousd === null ? 'sem preço' : `US$ ${(operation.estimatedCostMicrousd / 1_000_000).toFixed(4)}`}</td><td className="px-4 py-3 text-content-secondary">{operation.durationMs ? `${(operation.durationMs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : '—'}</td><td className="px-4 py-3 text-content-secondary">{new Date(operation.createdAt).toLocaleString('pt-BR')}</td></tr>)}</tbody></table></section>}
  <AiModelProfilesPanel /></div>
}

function Metric({ label, value }: { label: string; value: string | number }) { return <article className="rounded border border-border bg-surface p-4"><p className="text-sm text-content-secondary">{label}</p><p className="mt-1 text-2xl font-bold text-content-primary">{value}</p></article> }
function Status({ status }: { status: Operation['status'] }) { const labels = { succeeded: 'Concluída', rejected: 'Em reparo', failed: 'Falhou' }; const classes = { succeeded: 'bg-harmonia-green/10 text-harmonia-green', rejected: 'bg-amber-100 text-amber-800', failed: 'bg-red-100 text-red-700' }; return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classes[status]}`}>{labels[status]}</span> }
