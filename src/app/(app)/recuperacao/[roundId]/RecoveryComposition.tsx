'use client'

import { ArrowDownToLine, Check, Minus, Plus, Sparkles } from 'lucide-react'
import { RECOVERY_RULES } from '@/lib/recovery/recoveryPlan'

// Composição do lote: os mesmos controles da etapa "Composição" da tela
// Gerar prova (origem, total e formato), aplicados a todas as provas do lote.

export type Composition = { questionSource: 'acervo' | 'ia'; questionCount: number; objectivePercentage: number }

const SOURCES = [
  { value: 'acervo' as const, title: 'Importar do acervo', subtitle: 'Questões originais pela habilidade BNCC', icon: ArrowDownToLine },
  { value: 'ia' as const, title: 'Gerar com IA', subtitle: 'Questões novas a partir do planejamento', icon: Sparkles },
]
const PRESETS = [10, 12, 15, 20, 30]

export default function RecoveryComposition({ value, onChange, disabled, dirty, saving, onSave }: { value: Composition; onChange: (next: Composition) => void; disabled: boolean; dirty: boolean; saving: boolean; onSave: () => void }) {
  const set = (patch: Partial<Composition>) => onChange({ ...value, ...patch })
  const clamp = (count: number) => Math.min(RECOVERY_RULES.maxQuestions, Math.max(RECOVERY_RULES.minQuestions, count))
  const objectives = Math.round((value.questionCount * value.objectivePercentage) / 100)
  return <section className="rounded-xl border border-border bg-surface">
    <div className="border-b border-border px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-harmonia-green">Composição da prova</p>
      <h2 className="mt-1 font-semibold text-content-primary">De onde vêm as questões?</h2>
      <p className="mt-1 text-sm text-content-secondary">Vale para todas as provas do lote. Os capítulos de cada aluno (Matriz) saem das habilidades em que ele ficou abaixo de 60%, e as questões de cada capítulo cobram só essas habilidades.</p>
    </div>
    <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="grid gap-3 sm:grid-cols-2">
        {SOURCES.map((source) => {
          const active = value.questionSource === source.value
          const Icon = source.icon
          return <button key={source.value} type="button" disabled={disabled} aria-pressed={active} onClick={() => set({ questionSource: source.value })}
            className={`relative rounded-xl border-2 p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${active ? 'border-harmonia-green bg-harmonia-green/[0.06]' : 'border-border bg-surface hover:border-border-strong'}`}>
            {active && <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-action-primary text-action-primary-foreground"><Check className="h-4 w-4" aria-hidden="true" /></span>}
            <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${active ? 'bg-action-primary text-action-primary-foreground' : 'bg-harmonia-green/10 text-harmonia-green'}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
            <p className="mt-3 font-semibold text-content-primary">{source.title}</p>
            <p className="mt-1 text-sm text-content-secondary">{source.subtitle}</p>
          </button>
        })}
        <p className="text-xs text-content-muted sm:col-span-2">{value.questionSource === 'acervo' ? 'Buscaremos questões sem repetição no acervo. Se não houver item compatível, a IA completa a prova. A origem fica identificada em cada questão.' : 'A IA gera as questões a partir do capítulo e das habilidades fracas do aluno.'}</p>
      </div>
      <div className="rounded-xl bg-harmonia-green/[0.06] p-4">
        <div className="flex items-baseline justify-between"><p className="text-sm font-semibold text-content-primary">Total de questões por aluno</p><span className="text-xs text-content-muted">{RECOVERY_RULES.minQuestions}–{RECOVERY_RULES.maxQuestions}</span></div>
        <div className="mt-3 flex items-center justify-between rounded-lg bg-surface p-2 ring-1 ring-border">
          <button type="button" disabled={disabled || value.questionCount <= RECOVERY_RULES.minQuestions} aria-label="Menos uma questão" onClick={() => set({ questionCount: clamp(value.questionCount - 1) })} className="flex h-10 w-10 items-center justify-center rounded-md border border-border disabled:opacity-40"><Minus className="h-4 w-4" aria-hidden="true" /></button>
          <div className="text-center"><p className="text-3xl font-bold text-content-primary">{value.questionCount}</p><p className="text-xs text-content-muted">por prova</p></div>
          <button type="button" disabled={disabled || value.questionCount >= RECOVERY_RULES.maxQuestions} aria-label="Mais uma questão" onClick={() => set({ questionCount: clamp(value.questionCount + 1) })} className="flex h-10 w-10 items-center justify-center rounded-md bg-action-primary text-action-primary-foreground disabled:opacity-40"><Plus className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1.5">{PRESETS.map((preset) => <button key={preset} type="button" disabled={disabled} onClick={() => set({ questionCount: preset })} className={`rounded-md py-1.5 text-sm font-semibold disabled:opacity-60 ${value.questionCount === preset ? 'bg-action-primary text-action-primary-foreground' : 'bg-surface text-content-primary ring-1 ring-border'}`}>{preset}</button>)}</div>
      </div>
    </div>
    <div className="border-t border-border px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div><h3 className="text-sm font-semibold text-content-primary">Formato das questões</h3><p className="mt-0.5 text-xs text-content-muted">Deslize para definir a proporção da prova. À esquerda, mais alternativas; à direita, mais dissertativas.</p></div>
        <span className="rounded-full bg-action-primary px-3 py-1 text-xs font-semibold text-action-primary-foreground">{value.objectivePercentage}% alternativas</span>
      </div>
      <input type="range" min={0} max={100} step={5} value={100 - value.objectivePercentage} disabled={disabled} onChange={(event) => set({ objectivePercentage: 100 - Number(event.target.value) })}
        aria-label="Percentual de questões alternativas" aria-valuetext={`${value.objectivePercentage}% alternativas e ${100 - value.objectivePercentage}% dissertativas`}
        className="mt-5 h-2 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-harmonia-green via-harmonia-green/55 to-surface-muted accent-harmonia-green disabled:cursor-not-allowed" style={{ direction: 'ltr' }} />
      <div className="mt-2 flex justify-between text-[11px] font-medium text-content-muted"><span>← 100% alternativas</span><span>50% / 50%</span><span>100% dissertativas →</span></div>
      <p className="mt-3 text-xs text-content-secondary">Em cada prova: <span className="font-semibold text-harmonia-green">{objectives} alternativa(s)</span> e <span className="font-semibold text-content-primary">{value.questionCount - objectives} dissertativa(s)</span>.</p>
      {!disabled && <div className="mt-4 flex items-center justify-end gap-3">
        {dirty && <span className="text-xs text-content-muted">Alterações não salvas. Mudar o total refaz a matriz sugerida de quem ainda não foi gerado.</span>}
        <button type="button" disabled={!dirty || saving} onClick={onSave} className="rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar composição'}</button>
      </div>}
    </div>
  </section>
}
