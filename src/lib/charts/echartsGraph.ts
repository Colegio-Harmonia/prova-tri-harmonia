// ECharts só com o necessário para a teia (grafo + tooltip + legenda + texto),
// num único módulo para virar um único chunk carregado sob demanda: cada chunk
// a mais pesa no runtime do webpack de todas as rotas (ver orçamento de bundle).
import { init, use as registerEcharts } from 'echarts/core'
import { GraphChart } from 'echarts/charts'
import { GraphicComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

registerEcharts([GraphChart, TooltipComponent, LegendComponent, GraphicComponent, CanvasRenderer])

export { init }
