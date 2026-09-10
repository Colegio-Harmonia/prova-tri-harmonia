import type { ExamKind } from '@/db/schema'

const PROOF_STEPS = ['Atribuída', 'Em revisão', 'Aprovada', 'Impressa', 'Aplicada', 'Correção']
const PROOF_STATUSES = ['atribuido', 'em_revisao', 'aprovado', 'impresso', 'aplicado', 'parcialmente_corrigida', 'corrigido']
const ACTIVITY_STEPS = ['Rascunho', 'Finalizada', 'Aplicada', 'Corrigida']
const ACTIVITY_STATUSES = ['rascunho', 'aprovado', 'aplicado', 'corrigido']

export function ReviewProgress({ status, examKind = 'prova' }: { status: string; examKind?: ExamKind }) {
  const isActivity = examKind === 'reforco_enem' || examKind === 'atividade'
  const steps = isActivity ? ACTIVITY_STEPS : PROOF_STEPS
  const statuses = isActivity ? ACTIVITY_STATUSES : PROOF_STATUSES
  const current = Math.max(0, statuses.indexOf(status))
  return <ol aria-label="Andamento da avaliação" className={`grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 ${isActivity ? '' : 'lg:grid-cols-6'}`}>{steps.map((label, index) => <li key={label} aria-current={index === current ? 'step' : undefined} className={index <= current ? 'font-medium text-harmonia-green' : 'text-content-muted'}>{index + 1}. {label}</li>)}</ol>
}
