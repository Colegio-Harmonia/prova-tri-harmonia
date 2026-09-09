type GenerationStep = 1 | 2 | 3

const STEPS = ['Contexto', 'Composição', 'Conferência']

export function GenerationStepper({ currentStep }: { currentStep: GenerationStep }) {
  return (
    <ol aria-label="Etapas para gerar prova" className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-surface p-3">
      {STEPS.map((label, index) => {
        const step = (index + 1) as GenerationStep
        const active = step === currentStep
        const complete = step < currentStep
        return (
          <li key={label} aria-current={active ? 'step' : undefined} className="flex items-center gap-2 text-sm">
            <span className={`grid size-7 place-items-center rounded-full text-xs font-semibold ${active ? 'bg-action-primary text-action-primary-foreground' : complete ? 'bg-status-success text-content-inverse' : 'bg-surface-muted text-content-muted'}`}>
              {step}
            </span>
            <span className={active ? 'font-semibold text-content-primary' : 'text-content-secondary'}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}
