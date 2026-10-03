'use client'

import { CONFIDENCE_LABELS, StatTile } from './reportPrimitives'

export type SoloLevelStats = {
  level: string
  itemCount: number
  /** Questões distintas no nível; só existe no SOLO esperado (itemCount conta respostas). */
  questionCount: number | null
  equivalentCorrect: number
  accuracyPercent: number | null
  averageScore: number | null
  confidence: 'baixa' | 'media' | 'alta'
  sampleSize: number
  insufficientSample: boolean
}
export type SoloDashboardData = {
  expected: { summary: { classifiedItemCount: number; unclassifiedItemCount: number; classifiedQuestionCount: number; unclassifiedQuestionCount: number }; levels: SoloLevelStats[] }
  observed: { summary: { classifiedAnswerCount: number; unclassifiedDiscursiveAnswerCount: number }; levels: SoloLevelStats[] }
}
const SOLO_EXPECTED_ORDER = ['UNIESTRUTURAL', 'MULTIESTRUTURAL', 'RELACIONAL', 'ABSTRATO_AMPLIADO']
const SOLO_OBSERVED_ORDER = ['PRE_ESTRUTURAL', 'UNIESTRUTURAL', 'MULTIESTRUTURAL', 'RELACIONAL', 'ABSTRATO_AMPLIADO']
const SOLO_LABELS: Record<string, string> = {
  PRE_ESTRUTURAL: 'Pré-estrutural',
  UNIESTRUTURAL: 'Uniestrutural',
  MULTIESTRUTURAL: 'Multiestrutural',
  RELACIONAL: 'Relacional',
  ABSTRATO_AMPLIADO: 'Abstrato ampliado',
}

function SoloLevelBars({ title, subtitle, levels, order, unit }: { title: string; subtitle: string; levels: SoloLevelStats[]; order: string[]; unit: 'questao' | 'resposta' }) {
  const orderedLevels = order.map((level) => levels.find((stat) => stat.level === level) ?? {
    level,
    itemCount: 0,
    questionCount: null,
    equivalentCorrect: 0,
    accuracyPercent: null,
    averageScore: null,
    confidence: 'baixa' as const,
    sampleSize: 0,
    insufficientSample: true,
  })

  // "questao" conta questões distintas (cada uma uma vez, mesmo respondida por
  // vários alunos); "resposta" conta respostas de alunos.
  const countOf = (stat: SoloLevelStats) => (unit === 'questao' ? stat.questionCount ?? stat.itemCount : stat.itemCount)
  const noun = (count: number) => (unit === 'questao' ? (count === 1 ? 'questão' : 'questões') : (count === 1 ? 'resposta' : 'respostas'))
  const total = orderedLevels.reduce((sum, stat) => sum + countOf(stat), 0)

  return (
    <div className="rounded-lg border border-border bg-surface-subtle p-3">
      <p className="text-sm font-semibold text-content-primary">{title}</p>
      <p className="mt-1 text-xs text-content-muted">{subtitle}</p>
      <p className="mt-1 text-[11px] text-content-muted">
        A barra mostra a participação do nível no total ({total} {noun(total)}); a nota média dos alunos aparece abaixo de cada nível.
      </p>
      <div className="mt-3 space-y-3">
        {orderedLevels.map((stat) => {
          const count = countOf(stat)
          const sharePercent = total > 0 ? Math.round((count / total) * 100) : 0
          return (
            <div key={stat.level}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-content-secondary">{SOLO_LABELS[stat.level] ?? stat.level}</span>
                <span className="shrink-0 text-content-muted">
                  {sharePercent}% · {count} {noun(count)}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-surface">
                <div className="h-2 rounded-full bg-harmonia-green" style={{ width: `${sharePercent}%` }} />
              </div>
              {stat.itemCount > 0 && (
                <p className="mt-1 text-[11px] text-content-muted">
                  Nota média {stat.averageScore?.toFixed(1) ?? '—'}
                  {stat.accuracyPercent !== null ? ` (${stat.accuracyPercent}% da nota máxima)` : ''}
                  {unit === 'questao' ? ` · ${stat.itemCount} ${stat.itemCount === 1 ? 'resposta' : 'respostas'} de alunos` : ''}
                  {' · '}{stat.insufficientSample ? 'amostra baixa' : CONFIDENCE_LABELS[stat.confidence]}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function SoloDashboard({ data }: { data: SoloDashboardData }) {
  const hasExpected = data.expected.summary.classifiedQuestionCount > 0
  const hasObserved = data.observed.summary.classifiedAnswerCount > 0

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-content-primary">Análise SOLO</p>
          <p className="mt-1 text-xs text-content-muted">
            Compara a complexidade de raciocínio planejada nas questões com a estrutura demonstrada pelos alunos nas respostas discursivas.
          </p>
        </div>
        <span className="text-xs text-content-muted">O nível planejado da questão não representa, por si só, aprendizagem observada.</span>
      </div>

      <div className="mt-4 rounded border border-status-info-border bg-status-info-surface p-3 text-sm text-status-info-content">
        <p className="font-semibold">Como interpretar</p>
        <p className="mt-1">Leia primeiro o painel da esquerda para entender o que as questões exigiam. Depois, use o painel da direita para verificar como os alunos organizaram as respostas discursivas. Compare apenas níveis com amostra suficiente.</p>
        <p className="mt-2 text-xs">Pré-estrutural: resposta sem compreensão identificável. Uniestrutural: usa um aspecto relevante. Multiestrutural: reúne vários aspectos ainda separados. Relacional: conecta os aspectos em uma explicação coerente. Abstrato ampliado: generaliza, transfere ou formula novas relações.</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Questões com nível planejado" value={data.expected.summary.classifiedQuestionCount} />
        <StatTile label="Questões sem nível planejado" value={data.expected.summary.unclassifiedQuestionCount} />
        <StatTile label="Respostas discursivas analisadas" value={data.observed.summary.classifiedAnswerCount} />
        <StatTile label="Respostas discursivas sem análise" value={data.observed.summary.unclassifiedDiscursiveAnswerCount} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {hasExpected ? (
          <SoloLevelBars
            title="Complexidade planejada nas questões"
            subtitle="Mostra o nível de organização do conhecimento exigido pela questão, tanto objetiva quanto discursiva."
            levels={data.expected.levels}
            order={SOLO_EXPECTED_ORDER}
            unit="questao"
          />
        ) : (
          <p className="rounded bg-surface-subtle px-3 py-2 text-xs text-content-muted">Nenhuma questão possui nível de complexidade planejado nesta amostra.</p>
        )}

        {hasObserved ? (
          <SoloLevelBars
            title="Complexidade demonstrada nas respostas"
            subtitle="Mostra como o aluno organizou o conhecimento nas respostas discursivas; questões objetivas não entram nesta leitura."
            levels={data.observed.levels}
            order={SOLO_OBSERVED_ORDER}
            unit="resposta"
          />
        ) : (
          <p className="rounded bg-surface-subtle px-3 py-2 text-xs text-content-muted">Nenhuma resposta discursiva possui análise de complexidade nesta amostra.</p>
        )}
      </div>
    </div>
  )
}

