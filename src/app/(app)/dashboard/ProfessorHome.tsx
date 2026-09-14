'use client'

import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import Link from 'next/link'
import { ArrowRight, ClipboardCheck } from 'lucide-react'
import MinhasTurmas from '../turmas/MinhasTurmas'

type Exam = { id: number; subject: string; gradeYear: number; bimester: number | null; status: string }

const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho',
  atribuido: 'Atribuído',
  em_andamento: 'Em andamento',
  revisao_concluida: 'Revisão concluída',
  aprovado: 'Aprovado',
  impresso: 'Impresso',
  aplicado: 'Aplicado',
  corrigido: 'Corrigido',
}
const STATUS_COLORS: Record<string, string> = {
  atribuido: 'bg-status-warning-surface text-status-warning-content',
  em_andamento: 'bg-status-info-surface text-status-info-content',
  revisao_concluida: 'bg-status-success-surface text-status-success-content',
  aprovado: 'bg-status-success-surface text-status-success-content',
  impresso: 'bg-content-muted text-content-inverse',
  aplicado: 'bg-violet-50 text-violet-700',
  corrigido: 'bg-harmonia-green/10 text-harmonia-green',
}

// Dashboard do professor (Subtarefa 7, 17/07/2026): ao logar, mostra
// apenas as turmas do Classroom dele e as provas atribuídas ao e-mail
// dele — nunca as métricas do colégio inteiro, que é o que a coordenação/
// direção vê nessa mesma rota (ver page.tsx, decisão de role feita lá).
export default function ProfessorHome() {
  const [exams, setExams] = useState<Exam[] | null>(null)
  const shouldReduceMotion = useReducedMotion()

  useEffect(() => {
    fetch('/api/exams?examKind=prova')
      .then((r) => r.json())
      .then((body) => setExams(body.error ? [] : body.exams))
      .catch(() => setExams([]))
  }, [])

  const pending = (exams ?? []).filter((e) => !['corrigido'].includes(e.status))

  return (
    <div className="space-y-8">
      <motion.section
        initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <p className="text-xs font-bold uppercase tracking-wider text-content-muted">Próximas ações</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content-primary">Minhas provas</h1>
        <p className="mt-1 text-sm text-content-muted">Somente provas atribuídas a você, ordenadas para revisão.</p>

        {!exams ? (
          <p className="mt-4 text-sm text-content-muted">Carregando…</p>
        ) : pending.length === 0 ? (
          <p className="mt-4 text-sm text-content-muted">Nenhuma prova pendente atribuída a você no momento.</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {pending.map((e) => (
              <Link
                key={e.id}
                href={`/gerar/${e.id}/revisar`}
                className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-harmonia-green focus-visible:outline-none"
              >
                <div className="flex items-start justify-between gap-3"><ClipboardCheck aria-hidden="true" className="h-5 w-5 text-harmonia-green" /><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[e.status] ?? 'bg-surface-subtle text-content-secondary'}`}>{STATUS_LABELS[e.status] ?? e.status}</span></div>
                <p className="mt-4 text-base font-semibold text-content-primary">{e.subject}</p>
                <p className="mt-1 text-sm text-content-muted">{e.gradeYear}º ano{e.bimester ? ` · ${e.bimester}º bimestre` : ''}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-harmonia-green">Revisar prova <ArrowRight aria-hidden="true" size={16} /></span>
              </Link>
            ))}
          </div>
        )}
        <Link href="/status" className="mt-3 inline-flex items-center gap-1 text-sm text-harmonia-green underline">
          Ver todas (inclusive já corrigidas)
          <ArrowRight aria-hidden="true" size={16} strokeWidth={2} />
        </Link>
      </motion.section>

      <div>
        <h2 className="text-lg font-semibold">Minhas Turmas</h2>
        <div className="mt-4">
          <MinhasTurmas />
        </div>
      </div>
    </div>
  )
}
