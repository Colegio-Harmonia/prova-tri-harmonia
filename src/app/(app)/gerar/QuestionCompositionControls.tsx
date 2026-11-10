'use client'

import { ArrowDownToLine, Check, Minus, Plus, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

type Props = {
  source: 'acervo' | 'ia'
  onSourceChange: (source: 'acervo' | 'ia') => void
  count: number
  onCountChange: (count: number) => void
  bankCount: number
  bankEnabled: boolean
  bankLoading: boolean
  onBankCountChange: (count: number) => void
  onBankDraftChange: (pending: boolean) => void
  academicYear: number
  onYearChange: (year: number) => void
}

export default function QuestionCompositionControls({ source, onSourceChange, count, onCountChange, bankCount, bankEnabled, bankLoading, onBankCountChange, onBankDraftChange, academicYear, onYearChange }: Props) {
  const [bankDraft, setBankDraft] = useState(String(bankCount))
  useEffect(() => {
    if (!bankLoading) { setBankDraft(String(bankCount)); onBankDraftChange(false) }
  }, [bankCount, bankLoading, count, onBankDraftChange])
  const desiredBankCount = Number(bankDraft)
  const validBankDraft = bankDraft !== '' && Number.isInteger(desiredBankCount) && desiredBankCount >= 0 && desiredBankCount <= count
  const min = 10
  const max = 30
  const options = [
    { value: 'acervo' as const, title: 'Importar do acervo', subtitle: 'Questões originais pela habilidade BNCC', icon: ArrowDownToLine },
    { value: 'ia' as const, title: 'Gerar com IA', subtitle: 'Questões novas a partir do planejamento', icon: Sparkles },
  ]
  return (
    <section aria-labelledby="question-composition-title" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-harmonia-green">Composição da prova</p>
        <h2 id="question-composition-title" className="mt-1 text-lg font-semibold text-content-primary">De onde vêm as questões?</h2>
        <p className="mt-1 text-sm text-content-secondary">{bankEnabled ? 'Escolha o total da prova, quantas questões virão do ENEM e a origem das restantes.' : 'Escolha a origem e a quantidade.'} Os capítulos abaixo definem as habilidades das questões {source === 'acervo' ? 'buscadas no acervo' : 'criadas com IA'}.</p>
      </div>
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div role="radiogroup" aria-label={bankCount ? 'Origem das questões restantes' : 'Origem das questões'} className="grid gap-3 sm:grid-cols-2">
            {options.map(({ value, title, subtitle, icon: Icon }) => {
              const selected = source === value
              return (
                <button key={value} type="button" role="radio" aria-checked={selected} onClick={() => onSourceChange(value)} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 'acervo' : event.key === 'End' ? 'ia' : value === 'acervo' ? 'ia' : 'acervo'; onSourceChange(next); const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=radio]'); radios?.[next === 'acervo' ? 0 : 1]?.focus() }} className={`relative flex min-h-36 flex-col items-start rounded-xl border-2 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-harmonia-green focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${selected ? 'border-harmonia-green bg-harmonia-green/10' : 'border-border bg-surface hover:border-harmonia-green/50 hover:bg-surface-subtle'}`}>
                  <span className={`mb-4 flex h-9 w-9 items-center justify-center rounded-lg ${selected ? 'bg-harmonia-green text-white' : 'bg-surface-subtle text-content-secondary'}`}><Icon size={19} aria-hidden="true" /></span>
                  <span className="text-sm font-semibold text-content-primary">{title}</span>
                  <span className="mt-1 text-xs leading-relaxed text-content-secondary">{subtitle}</span>
                  <span className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border ${selected ? 'border-harmonia-green bg-harmonia-green text-white' : 'border-border'}`}>{selected && <Check size={13} aria-hidden="true" />}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-content-secondary">
            {source === 'acervo' ? 'Buscaremos questões sem repetição no acervo. Se não houver um item disponível e compatível, a IA completará a prova. A origem será identificada em cada questão.' : 'Todas as questões desta seleção serão criadas com IA e identificadas como GERADO POR IA.'}
          </p>
        </div>
        <div className="rounded-xl bg-surface-subtle p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 id="question-count-label" className="text-sm font-semibold text-content-primary">Total de questões da prova</h3>
            <span className="text-xs text-content-muted">{min}–{max}</span>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-2">
            <button type="button" aria-label="Diminuir quantidade de questões" disabled={count <= min} onClick={() => onCountChange(Math.max(min, count - 1))} className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-content-primary transition-colors hover:bg-harmonia-green/10 focus-visible:ring-2 focus-visible:ring-harmonia-green disabled:cursor-not-allowed disabled:opacity-30"><Minus size={18} /></button>
            <output aria-labelledby="question-count-label" aria-live="polite" className="flex flex-col items-center"><span className="text-4xl font-semibold tabular-nums tracking-tight text-content-primary">{count}</span><span className="text-[11px] text-content-muted">por prova</span></output>
            <button type="button" aria-label="Aumentar quantidade de questões" disabled={count >= max} onClick={() => onCountChange(Math.min(max, count + 1))} className="flex h-11 w-11 items-center justify-center rounded-lg bg-harmonia-green text-white transition-colors hover:brightness-110 focus-visible:ring-2 focus-visible:ring-harmonia-green disabled:cursor-not-allowed disabled:opacity-30"><Plus size={18} /></button>
          </div>
          <div aria-label="Quantidades sugeridas" className="mt-3 flex flex-wrap gap-2">
            {[10, 12, 15, 20, 30].filter((value) => value >= min && value <= max).map((value) => <button key={value} type="button" aria-label={`Selecionar ${value} questões`} aria-pressed={count === value} onClick={() => onCountChange(value)} className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-semibold tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-harmonia-green ${count === value ? 'bg-harmonia-green text-white' : 'border border-border bg-surface text-content-secondary hover:border-harmonia-green'}`}>{value}</button>)}
          </div>
          {bankEnabled && <div className="mt-4 border-t border-border pt-4">
            <label htmlFor="composition-enem-count" className="block text-sm font-semibold text-content-primary">Quantas do total serão do ENEM?</label>
            <input id="composition-enem-count" type="number" min={0} max={count} step={1} value={bankDraft} disabled={bankLoading}
              onChange={(event) => { setBankDraft(event.target.value); onBankDraftChange(event.target.value === '' || Number(event.target.value) !== bankCount) }} aria-describedby="composition-enem-help"
              className="mt-2 min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-content-primary disabled:opacity-50" />
            <button type="button" disabled={bankLoading || !validBankDraft || desiredBankCount === bankCount} onClick={() => onBankCountChange(desiredBankCount)}
              className="mt-2 min-h-10 rounded-lg bg-harmonia-green px-3 text-xs font-semibold text-white disabled:opacity-50">{bankLoading ? 'Selecionando…' : 'Aplicar quantidade do ENEM'}</button>
            <p id="composition-enem-help" className="mt-2 text-xs text-content-secondary">{bankLoading ? 'Buscando questões do ENEM…' : 'Busca pelo planejamento aprovado, considerando conteúdo e habilidades. A quantidade faz parte do total da prova. Use 0 para não importar do ENEM.'}</p>
          </div>}
          <p aria-live="polite" className="mt-3 text-sm text-content-secondary"><strong>{bankCount} do ENEM</strong> + <strong>{count - bankCount} {source === 'acervo' ? 'do acervo, com complemento por IA' : 'com IA'}</strong> = <strong>{count} no total</strong></p>
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <label htmlFor="composition-academic-year" className="text-xs font-medium text-content-secondary">Ano letivo</label>
            <select id="composition-academic-year" value={academicYear} onChange={(event) => onYearChange(Number(event.target.value))} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-content-primary focus:ring-harmonia-green">
              {[...new Set([academicYear, new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1])].sort().map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </div>
        </div>
      </div>
    </section>
  )
}
