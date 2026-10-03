'use client'

import { BLOOM_LABELS, BLOOM_ORDER, CONFIDENCE_LABELS, DOK_LABELS, DOK_ORDER } from './reportPrimitives'

// Desempenho de um tipo de resposta numa célula. Objetiva vale 0 ou 10 e discursiva tem nota
// parcial, então os dois nunca são somados numa média única.
export type MatrixTypeStats = {
  itemCount: number
  questionCount: number
  accuracyPercent: number | null
  averageScore: number | null
  confidence: 'baixa' | 'media' | 'alta'
  insufficientSample: boolean
}
export type BloomDokCell = {
  bloomLevel: string
  dokLevel: string
  itemCount: number
  equivalentCorrect: number
  accuracyPercent: number | null
  sampleSize: number
  confidence: 'baixa' | 'media' | 'alta'
  insufficientSample: boolean
  byType: { objetiva: MatrixTypeStats; descritiva: MatrixTypeStats }
}
export type BloomDokMatrixData = {
  summary: { itemCount: number; questionCount: number }
  rows: Array<{ bloomLevel: string; cells: BloomDokCell[] }>
}

const TYPES = [
  { key: 'objetiva', label: 'Objetivas' },
  { key: 'descritiva', label: 'Discursivas' },
] as const

const EMPTY_TYPE: MatrixTypeStats = { itemCount: 0, questionCount: 0, accuracyPercent: null, averageScore: null, confidence: 'baixa', insufficientSample: true }

function matrixCellClass(accuracyPercent: number | null, insufficientSample: boolean) {
  if (accuracyPercent === null) return 'bg-surface text-content-muted'
  if (insufficientSample) return 'bg-status-warning-surface text-status-warning-content'
  if (accuracyPercent >= 80) return 'bg-status-success-surface text-status-success-content'
  if (accuracyPercent >= 60) return 'bg-status-info-surface text-status-info-content'
  return 'bg-status-danger-surface text-status-danger-content'
}

export default function BloomDokMatrix({ data }: { data: BloomDokMatrixData }) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-content-primary">Matriz Bloom × DOK</p>
          <p className="mt-1 text-xs text-content-muted">
            Cruza processo cognitivo da questão com profundidade DOK. Objetivas (acerto vale 0 ou 10) e discursivas (nota parcial) aparecem separadas, porque não se comparam numa média única. Metades com menos de 3 respostas não geram conclusão.
          </p>
        </div>
        <span className="text-xs text-content-muted">{data.summary.questionCount} questões · {data.summary.itemCount} respostas classificadas</span>
      </div>

      {data.summary.itemCount === 0 ? (
        <p className="mt-4 rounded bg-surface-subtle px-3 py-2 text-xs text-content-muted">
          Nenhum item com Bloom e DOK disponível nas correções revisadas desta amostra.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-1 text-left text-xs">
            <thead>
              <tr>
                <th rowSpan={2} className="w-28 px-2 py-1 align-bottom text-content-muted">Bloom</th>
                {DOK_ORDER.map((dokLevel) => (
                  <th key={dokLevel} colSpan={2} className="px-2 py-1 text-center font-medium text-content-secondary">{DOK_LABELS[dokLevel]}</th>
                ))}
              </tr>
              <tr>
                {DOK_ORDER.flatMap((dokLevel) => TYPES.map((type) => (
                  <th key={`${dokLevel}-${type.key}`} className="px-1 py-0.5 text-center text-[11px] font-normal text-content-muted">{type.label}</th>
                )))}
              </tr>
            </thead>
            <tbody>
              {BLOOM_ORDER.map((level) => {
                const row = data.rows.find((candidate) => candidate.bloomLevel === level)
                return (
                  <tr key={level}>
                    <th className="rounded bg-surface-subtle px-2 py-2 font-medium text-content-secondary">{BLOOM_LABELS[level] ?? level}</th>
                    {DOK_ORDER.flatMap((dokLevel) => {
                      const cell = row?.cells.find((candidate) => candidate.dokLevel === dokLevel)
                      return TYPES.map((type) => {
                        const stat = cell?.byType[type.key] ?? EMPTY_TYPE
                        return (
                          <td key={`${level}-${dokLevel}-${type.key}`} className={`min-w-20 rounded px-1.5 py-2 text-center ${matrixCellClass(stat.accuracyPercent, stat.insufficientSample)}`}>
                            <p className="text-sm font-semibold">{stat.accuracyPercent !== null ? `${stat.accuracyPercent}%` : '—'}</p>
                            {stat.itemCount > 0 ? (
                              <>
                                <p className="mt-0.5 text-[11px] opacity-80">{stat.questionCount} {stat.questionCount === 1 ? 'questão' : 'questões'}</p>
                                <p className="text-[11px] opacity-80">{stat.itemCount} {stat.itemCount === 1 ? 'resposta' : 'respostas'}</p>
                                <p className="mt-0.5 text-[11px] opacity-70">{stat.insufficientSample ? 'amostra baixa' : CONFIDENCE_LABELS[stat.confidence]}</p>
                              </>
                            ) : (
                              <p className="mt-0.5 text-[11px] opacity-80">sem respostas</p>
                            )}
                          </td>
                        )
                      })
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-content-muted">
        Leitura prática: compare uma mesma linha entre DOKs, sempre dentro do mesmo tipo. Se “Aplicar” cai de DOK 2 para DOK 3 nas objetivas com amostra suficiente, há sinal de dificuldade quando a profundidade aumenta. Uma diferença grande entre objetivas e discursivas na mesma célula indica que o aluno reconhece a resposta, mas tem dificuldade de construí-la.
      </p>
    </div>
  )
}
