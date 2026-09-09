import axios from 'axios'
import { generateStructuredContent } from '@/lib/gemini/llmClient'

const QUICKCHART_BASE = 'https://quickchart.io/chart'

type ChartExtraction = {
  shouldChart: boolean
  chartType: 'bar' | 'line' | 'pie' | null
  title: string | null
  labels: string[] | null
  values: number[] | null
}

const CHART_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    shouldChart: { type: 'boolean', description: 'true só quando existem dados numéricos claros (na questão ou no pedido) pra plotar um gráfico real — false para pedidos de foto/mapa/ilustração sem dados numéricos.' },
    chartType: { type: 'string', enum: ['bar', 'line', 'pie'], nullable: true },
    title: { type: 'string', nullable: true },
    labels: { type: 'array', items: { type: 'string' }, nullable: true },
    values: { type: 'array', items: { type: 'number' }, nullable: true },
  },
  required: ['shouldChart'],
}

async function extractChartData(query: string, questionContext: string): Promise<ChartExtraction | null> {
  const prompt = `Um professor pediu uma imagem de apoio para uma questão de prova. Decida se dá pra renderizar um GRÁFICO REAL com dados numéricos, ou se é melhor buscar/gerar uma foto/mapa/ilustração (nesse caso shouldChart:false).

Pedido do professor: "${query}"
Texto da questão (pode conter os dados numéricos): "${questionContext.slice(0, 800)}"

Se shouldChart:true, extraia os dados EXATOS presentes no texto (nunca invente números que não estão lá) — labels (rótulos do eixo/categorias) e values (valores numéricos correspondentes, mesma ordem/quantidade que labels). Escolha chartType: "bar" pra comparação entre categorias, "line" pra evolução/série temporal, "pie" pra proporção de um total.

Responda ESTRITAMENTE em JSON válido, sem markdown, seguindo esta estrutura:
${JSON.stringify(CHART_EXTRACTION_SCHEMA)}`

  const raw = await generateStructuredContent(prompt, CHART_EXTRACTION_SCHEMA, 'images/extract-chart-data')
  const parsed = raw as ChartExtraction
  if (typeof parsed?.shouldChart !== 'boolean') return null
  return parsed
}

/**
 * Tenta renderizar um gráfico DETERMINÍSTICO (QuickChart, gratuito, sem
 * chave de API) a partir dos dados numéricos já presentes na questão —
 * sempre correto, ao contrário de pedir pra uma IA "desenhar" um gráfico
 * (que pode inventar números errados). Só se aplica quando o pedido do
 * professor é claramente sobre dados/gráfico ("gráfico com as notas...",
 * "gráfico de barras da pesquisa..."); pedidos de foto/mapa/ilustração
 * caem para o pipeline existente (Wikimedia → geração por IA), retornando
 * null aqui sem custo.
 */
export async function tryRenderChart(query: string, questionContext: string): Promise<Buffer | null> {
  let extraction: ChartExtraction | null
  try {
    extraction = await extractChartData(query, questionContext)
  } catch (err) {
    console.warn('[chartRender] extração de dados falhou:', err instanceof Error ? err.message : err)
    return null
  }

  if (!extraction?.shouldChart || !extraction.labels?.length || !extraction.values?.length) return null
  if (extraction.labels.length !== extraction.values.length || extraction.labels.length < 2) return null

  const chartConfig = {
    type: extraction.chartType ?? 'bar',
    data: {
      labels: extraction.labels,
      datasets: [
        {
          label: extraction.title ?? '',
          data: extraction.values,
          backgroundColor: ['#008649', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#4CAF50', '#795548', '#607D8B'],
        },
      ],
    },
    options: {
      // QuickChart aceita configs de Chart.js v2 e v3 — o caminho de v2
      // (legend/title direto em options) é o que a instância pública deles
      // resolve por padrão; duplicar em plugins cobre v3 também, sem custo.
      legend: { display: false },
      title: { display: Boolean(extraction.title), text: extraction.title ?? '' },
      plugins: {
        legend: { display: false },
        title: { display: Boolean(extraction.title), text: extraction.title ?? '' },
      },
    },
  }

  try {
    const { data } = await axios.get<ArrayBuffer>(QUICKCHART_BASE, {
      params: { c: JSON.stringify(chartConfig), width: 700, height: 450, backgroundColor: 'white', format: 'png' },
      responseType: 'arraybuffer',
      timeout: 15_000,
    })
    return Buffer.from(data)
  } catch (err) {
    console.warn('[chartRender] QuickChart falhou:', err instanceof Error ? err.message : err)
    return null
  }
}
