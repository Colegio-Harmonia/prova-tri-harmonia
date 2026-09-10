'use client'

import { useCallback, useEffect, useState } from 'react'
import AiModelProfilesPanel from './AiModelProfilesPanel'

type Purpose = 'text_generation' | 'image_generation' | 'image_validation' | 'scan_transcription'
type Operation = { id: number; operation: string; provider: string; model: string; status: 'succeeded' | 'rejected' | 'failed'; attempt: number; totalTokens: number | null; effectiveCostMicrousd: number | null; costStatus: 'recorded' | 'recalculated' | 'unpriced'; durationMs: number | null; errorCode: string | null; createdAt: string }
type Payload = { summary: { total: number; succeeded: number; rejected: number; failed: number; totalTokens: number; estimatedCostMicrousd: number; unpriced: number }; operations: Operation[] }
type Budget = { purpose: Purpose; limit: number; used: number; resetAt: string; nextResetAt: string }
const purposeLabel: Record<Purpose, string> = { text_generation: 'Texto e questões', image_generation: 'Geração de imagens', image_validation: 'Validação visual', scan_transcription: 'Leitura de respostas' }
const periods = [{ value: 'today', label: 'Hoje' }, { value: '7d', label: '7 dias' }, { value: '30d', label: '30 dias' }, { value: 'all', label: 'Todo período' }]
const money = (value: number) => `US$ ${(value / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`

export default function AiOperationsPanel() {
  const [data, setData] = useState<Payload | null>(null)
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [period, setPeriod] = useState('today')
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState<Purpose | 'all' | null>(null)
  const load = useCallback(async () => {
    const [operationsResponse, budgetResponse] = await Promise.all([fetch(`/api/admin/ai-operations?period=${period}`), fetch('/api/admin/ai-budget')])
    const operations = await operationsResponse.json(); const budget = await budgetResponse.json()
    if (!operationsResponse.ok) throw new Error(operations.error ?? 'Não foi possível carregar a telemetria.')
    if (!budgetResponse.ok) throw new Error(budget.error ?? 'Não foi possível carregar os limites.')
    setData(operations); setBudgets(budget.budgets)
  }, [period])
  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a telemetria.')) }, [load])
  async function resetBudget(purpose: Purpose | 'all') { setResetting(purpose); setError(null); try { const response = await fetch('/api/admin/ai-budget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose: purpose === 'all' ? null : purpose }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Não foi possível resetar o limite.'); setBudgets(body.budgets) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível resetar o limite.') } finally { setResetting(null) } }
  if (error && !data) return <p className="text-sm text-red-600">{error}</p>
  if (!data) return <p className="text-sm text-content-muted">Carregando telemetria…</p>
  return <div className="space-y-6">
    <header><h1 className="text-lg font-semibold text-content-primary">Operações de IA</h1><p className="mt-1 max-w-3xl text-sm text-content-secondary">Consumo, custo e limites operacionais. Preços sem configuração são identificados claramente, nunca apresentados como custo zero.</p></header>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <section className="rounded border border-border bg-surface p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Limites de IA de hoje</h2><p className="mt-1 text-sm text-content-secondary">O reset não remove histórico: apenas reinicia a cota a partir deste momento.</p></div><button onClick={() => void resetBudget('all')} disabled={resetting !== null} className="rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50">{resetting === 'all' ? 'Resetando…' : 'Resetar todos os limites'}</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{budgets.map((budget) => <article key={budget.purpose} className="rounded border border-border p-3"><p className="text-sm font-medium">{purposeLabel[budget.purpose]}</p><p className="mt-1 text-2xl font-bold">{budget.used}{budget.limit ? ` / ${budget.limit}` : ' / sem teto'}</p><p className="mt-1 text-xs text-content-secondary">Reset automático: {new Date(budget.nextResetAt).toLocaleString('pt-BR')}</p><button onClick={() => void resetBudget(budget.purpose)} disabled={resetting !== null} className="mt-3 text-xs font-medium text-harmonia-green disabled:opacity-50">{resetting === budget.purpose ? 'Resetando…' : 'Resetar esta cota'}</button></article>)}</div></section>
    <section className="flex flex-wrap gap-2" aria-label="Período de consumo">{periods.map((item) => <button key={item.value} onClick={() => setPeriod(item.value)} className={`rounded px-3 py-2 text-sm font-medium ${period === item.value ? 'bg-harmonia-green text-white' : 'border border-border bg-surface text-content-primary'}`}>{item.label}</button>)}</section>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" aria-label="Resumo da telemetria"><Metric label="Tentativas" value={data.summary.total} /><Metric label="Concluídas" value={data.summary.succeeded} /><Metric label="Reparos" value={data.summary.rejected} /><Metric label="Falhas" value={data.summary.failed} /><Metric label="Tokens" value={data.summary.totalTokens.toLocaleString('pt-BR')} /><Metric label="Custo calculado" value={money(data.summary.estimatedCostMicrousd)} /></section>
    {data.summary.unpriced > 0 && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{data.summary.unpriced} operação(ões) sem tarifa configurada. Elas não entram no total; configure os preços do modelo abaixo para que o custo seja calculado com precisão.</p>}
    <section className="overflow-x-auto rounded border border-border bg-surface"><table className="w-full text-left text-sm"><thead className="border-b border-border bg-surface-subtle text-content-secondary"><tr><th className="px-4 py-3">Operação</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Modelo</th><th className="px-4 py-3">Tokens</th><th className="px-4 py-3">Custo</th><th className="px-4 py-3">Duração</th><th className="px-4 py-3">Quando</th></tr></thead><tbody>{data.operations.map((operation) => <tr key={operation.id} className="border-b border-border last:border-0"><td className="px-4 py-3 text-content-primary">{operation.operation}<span className="block text-xs text-content-muted">tentativa {operation.attempt}{operation.errorCode ? ` · ${operation.errorCode}` : ''}</span></td><td className="px-4 py-3"><Status status={operation.status} /></td><td className="px-4 py-3 text-content-secondary">{operation.provider} · {operation.model}</td><td className="px-4 py-3 text-content-secondary">{operation.totalTokens?.toLocaleString('pt-BR') ?? 'não informado'}</td><td className="px-4 py-3 text-content-secondary">{operation.effectiveCostMicrousd === null ? 'Tarifa não configurada' : <>{money(operation.effectiveCostMicrousd)}{operation.costStatus === 'recalculated' && <span className="block text-xs text-content-muted">recalculado pelo perfil</span>}</>}</td><td className="px-4 py-3 text-content-secondary">{operation.durationMs ? `${(operation.durationMs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : '—'}</td><td className="px-4 py-3 text-content-secondary">{new Date(operation.createdAt).toLocaleString('pt-BR')}</td></tr>)}</tbody></table></section>
    <AiModelProfilesPanel />
  </div>
}
function Metric({ label, value }: { label: string; value: string | number }) { return <article className="rounded border border-border bg-surface p-4"><p className="text-sm text-content-secondary">{label}</p><p className="mt-1 text-2xl font-bold text-content-primary">{value}</p></article> }
function Status({ status }: { status: Operation['status'] }) { const labels = { succeeded: 'Concluída', rejected: 'Em reparo', failed: 'Falhou' }; const classes = { succeeded: 'bg-harmonia-green/10 text-harmonia-green', rejected: 'bg-amber-100 text-amber-800', failed: 'bg-red-100 text-red-700' }; return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classes[status]}`}>{labels[status]}</span> }
