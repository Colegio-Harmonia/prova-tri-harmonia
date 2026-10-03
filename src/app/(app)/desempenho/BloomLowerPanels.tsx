'use client'

import BloomDokMatrix, { type BloomDokMatrixData } from './BloomDokMatrix'
import SoloDashboard, { type SoloDashboardData } from './SoloDashboard'

// Matriz Bloom × DOK e análise SOLO ficam no mesmo chunk sob demanda (só aparecem na visão
// Bloom): um chunk novo soma bytes ao runtime do webpack de toda rota, e o orçamento de
// bundle de /desempenho/relatorio não tem folga.
export default function BloomLowerPanels({ matrix, solo }: { matrix: BloomDokMatrixData; solo: SoloDashboardData }) {
  return (
    <>
      <BloomDokMatrix data={matrix} />
      <SoloDashboard data={solo} />
    </>
  )
}
