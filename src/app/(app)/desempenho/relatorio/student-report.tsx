'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

type Profile = {
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
  limitations: string[]
}

function formatPercent(score: number | null) {
  return score === null ? '—' : `${Math.round(score * 10)}%`
}

export default function StudentReport() {
  const searchParams = useSearchParams()
  const student = searchParams.get('aluno')?.trim() ?? ''
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!student) return
    fetch(`/api/analytics/performance?student=${encodeURIComponent(student)}`)
      .then((response) => response.json())
      .then((body) => {
        if (body.error) throw new Error(body.error)
        setProfile(body.cognitiveProfiles?.[0] ?? null)
      })
      .catch(() => setError('Não foi possível carregar este relatório dentro do seu escopo de acesso.'))
  }, [student])

  if (!student) return <p className="text-sm text-content-secondary">Selecione um aluno em Perfis cognitivos para abrir o relatório.</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!profile) return <p className="text-sm text-content-secondary">Carregando relatório…</p>

  return (
    <article className="mx-auto max-w-3xl space-y-6 print:max-w-none">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/desempenho?visao=perfis" className="min-h-10 rounded border border-border px-3 py-2 text-sm font-medium text-content-primary hover:bg-surface-subtle">Voltar aos perfis</Link>
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
        <div className="rounded border border-border bg-surface p-4"><p className="text-xs text-content-secondary">Confiabilidade</p><p className="mt-1 text-2xl font-semibold capitalize text-content-primary">{profile.confidence}</p></div>
      </section>

      <section className="rounded border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-content-primary">Contexto da amostra</h2>
        <p className="mt-2 text-sm text-content-secondary">Períodos: {profile.periods.join(', ') || '—'}</p>
        <p className="mt-1 text-sm text-content-secondary">Disciplinas: {profile.subjects.map((subject) => `${subject.name} (${subject.count})`).join(', ') || '—'}</p>
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

      {profile.limitations.length > 0 && <p className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Limitações da leitura: {profile.limitations.join(' ')}</p>}
    </article>
  )
}
