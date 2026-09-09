'use client'

import dynamic from 'next/dynamic'
import type { ApexOptions } from 'apexcharts'

// ApexCharts toca `window`/DOM direto — precisa ficar fora do SSR do Next.js
// (App Router ainda tenta renderizar client components no servidor na
// primeira passada) ou quebra o build com "window is not defined".
const ReactApexChart = dynamic(() => import('react-apexcharts'), { ssr: false })

export type ApexBarChartProps = {
  title: string
  /** Rótulo de cada barra, na ordem em que devem aparecer. */
  categories: string[]
  /** Valor de cada barra, mesma ordem/tamanho de `categories`. */
  values: number[]
  /**
   * Cor por barra (mesmo tamanho de `categories`) ou uma cor única pra
   * todas — nunca uma paleta genérica gerada, sempre as cores de marca já
   * definidas no dashboard (verde Harmonia, rampa de Bloom, cores por
   * área ENEM etc.), passadas pelo chamador.
   */
  colors: string[] | string
  subtitle?: string
  height?: number
}

export function ApexBarChart({ title, categories, values, colors, subtitle, height }: ApexBarChartProps) {
  if (!categories.length) return null

  const resolvedColors = Array.isArray(colors) ? colors : [colors]
  const distributed = Array.isArray(colors)

  const options: ApexOptions = {
    chart: { toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: true, speed: 300 } },
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 4,
        borderRadiusApplication: 'end',
        distributed,
        barHeight: '65%',
      },
    },
    colors: resolvedColors,
    dataLabels: { enabled: true, style: { fontSize: '11px', colors: ['#374151'] }, offsetX: 20 },
    xaxis: { categories, labels: { style: { fontSize: '11px' } } },
    yaxis: { labels: { style: { fontSize: '11px' } } },
    grid: { borderColor: '#f0f0f0', xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
    legend: { show: false },
    tooltip: { theme: 'light' },
  }

  return (
    <div className="rounded border border-neutral-200 bg-white p-4">
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      {subtitle && <p className="text-xs text-neutral-400">{subtitle}</p>}
      <div className="mt-2">
        <ReactApexChart
          type="bar"
          height={height ?? Math.max(160, categories.length * 34)}
          series={[{ name: title, data: values }]}
          options={options}
        />
      </div>
    </div>
  )
}
