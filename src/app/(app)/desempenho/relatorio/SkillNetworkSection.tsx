'use client'

// Sinapse — teia de habilidades do aluno (aba "Teia" do relatório individual).
// O ECharts é carregado só quando a aba abre, num chunk próprio, para não pesar
// no bundle inicial do relatório. As regras do cálculo estão em
// src/lib/curriculum/skillNetwork.ts.

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EChartsType } from 'echarts/core'
import type { NetworkEdge, NetworkNode, NetworkNodeState, NetworkRoot } from '@/lib/curriculum/skillNetwork'
import { recoveryUrl } from './MasterySection'

type NetworkResponse = {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  roots: NetworkRoot[]
  summary: { peerStudentCount: number; correlationEdgeCount: number; recurrenceEdgeCount: number; assessedNodeCount: number; atRiskNodeCount: number }
  rules: { network: { minSharedStudents: number; minCorrelation: number } }
}

type Layout = 'teia' | 'tempo'

// Cor de cada estado vem dos tokens do tema (globals.css), lidos na hora de desenhar.
const STATES: Array<{ id: NetworkNodeState; label: string; token: string }> = [
  { id: 'dominio', label: 'Domínio', token: '--color-status-success' },
  { id: 'proximo_do_dominio', label: 'Próximo do domínio', token: '--color-status-info' },
  { id: 'em_desenvolvimento', label: 'Em desenvolvimento', token: '--color-status-danger' },
  { id: 'evidencia_insuficiente', label: 'Evidência insuficiente', token: '--color-content-muted' },
  { id: 'risco_alto', label: 'Risco alto (ainda não avaliada)', token: '--color-status-warning' },
  { id: 'risco_moderado', label: 'Risco moderado (ainda não avaliada)', token: '--color-status-warning-border' },
  { id: 'sem_evidencia', label: 'Ainda não avaliada', token: '--color-border' },
]
const STATE_INDEX = Object.fromEntries(STATES.map((state, index) => [state.id, index])) as Record<NetworkNodeState, number>
const stateLabel = (state: NetworkNodeState) => STATES[STATE_INDEX[state]].label

function cssColor(token: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  return value ? `rgb(${value.split(/\s+/).join(',')})` : '#888'
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

const contextOf = (node: NetworkNode) => `${node.academicYear}:${node.gradeYear}:${node.subject}`
const period = (node: Pick<NetworkNode, 'bimester' | 'academicYear'>) => `${node.bimester}º bim. / ${node.academicYear}`
const symbolSize = (node: NetworkNode) => 12 + Math.sqrt(node.reach) * 6
const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`)

type Positions = Record<string, { x: number; y: number }>

function timelinePositions(nodes: NetworkNode[]): { positions: Positions; columns: Array<{ key: number; label: string; x: number }> } {
  const keys = [...new Set(nodes.map((node) => node.academicYear * 10 + node.bimester))].sort((a, b) => a - b)
  const positions: Positions = {}
  const columns = keys.map((key, column) => {
    const inColumn = nodes.filter((node) => node.academicYear * 10 + node.bimester === key).sort((a, b) => a.code.localeCompare(b.code))
    inColumn.forEach((node, row) => { positions[node.id] = { x: column * 190, y: (row - (inColumn.length - 1) / 2) * 64 } })
    return { key, label: `${key % 10}º bimestre`, x: column * 190 }
  })
  return { positions, columns }
}

export default function SkillNetworkSection({ query, studentName, classroomCourseId }: { query: string; studentName: string; classroomCourseId?: string }) {
  const [data, setData] = useState<NetworkResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [context, setContext] = useState<string | null>(null)
  const [chosenLayout, setLayout] = useState<Layout | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [themeTick, setThemeTick] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)
  const echartsRef = useRef<typeof import('@/lib/charts/echartsGraph') | null>(null)
  const webPositions = useRef<Map<string, Positions>>(new Map())

  useEffect(() => {
    let cancelled = false
    fetch(`/api/curriculum/skill-network?${query}`)
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (cancelled) return
        if (!response.ok || body.error) { setError(body.error ?? 'Não foi possível montar a teia deste aluno.'); return }
        setData(body)
      })
      .catch(() => { if (!cancelled) setError('Não foi possível montar a teia deste aluno.') })
    return () => { cancelled = true }
  }, [query])

  const contexts = useMemo(() => {
    if (!data) return []
    const counts = new Map<string, { key: string; label: string; count: number }>()
    for (const node of data.nodes) {
      const key = contextOf(node)
      const current = counts.get(key) ?? { key, label: `${node.subject} · ${node.gradeYear}º ano · ${node.academicYear}`, count: 0 }
      current.count += 1
      counts.set(key, current)
    }
    return [...counts.values()].sort((a, b) => b.count - a.count)
  }, [data])
  const activeContext = context && contexts.some((item) => item.key === context) ? context : contexts[0]?.key ?? null

  const view = useMemo(() => {
    if (!data || !activeContext) return null
    const nodes = data.nodes.filter((node) => contextOf(node) === activeContext)
    const ids = new Set(nodes.map((node) => node.id))
    const edges = data.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    const roots = data.roots.filter((root) => ids.has(root.id))
    return { nodes, edges, roots, byId: new Map(nodes.map((node) => [node.id, node])) }
  }, [data, activeContext])

  // Com poucas ligações a teia vira pontos soltos; a linha do tempo lê melhor.
  const layout: Layout = chosenLayout ?? (view && view.edges.length >= view.nodes.length / 2 ? 'teia' : 'tempo')

  const selectedNode = view && selected ? view.byId.get(selected) ?? null : null
  const defaultSelection = view?.roots[0]?.id ?? view?.nodes.find((node) => node.state === 'risco_alto')?.id ?? null
  useEffect(() => { setSelected(defaultSelection) }, [defaultSelection])

  // Tema claro/escuro: redesenha quando o atributo do <html> muda.
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((tick) => tick + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!view || !containerRef.current) return
    let disposed = false
    const container = containerRef.current

    async function draw() {
      if (!echartsRef.current) echartsRef.current = await import('@/lib/charts/echartsGraph')
      if (disposed || !view) return
      const echarts = echartsRef.current
      const chart = chartRef.current ?? echarts.init(container)
      chartRef.current = chart
      chart.resize()

      // Teia: o layout de força roda uma vez, fora da tela; o gráfico visível
      // usa posições fixas encaixadas no quadro com a mesma escala em x e y.
      let positions: Positions
      let columns: Array<{ key: number; label: string; x: number }> = []
      if (layout === 'tempo') ({ positions, columns } = timelinePositions(view.nodes))
      else {
        const cacheKey = activeContext!
        if (!webPositions.current.has(cacheKey)) {
          const offscreen = document.createElement('div')
          offscreen.style.cssText = 'position:absolute;left:-10000px;top:0;width:900px;height:640px'
          document.body.appendChild(offscreen)
          const scratch = echarts.init(offscreen)
          const seed = timelinePositions(view.nodes).positions
          scratch.setOption({ animation: false, series: [{ type: 'graph', layout: 'force',
            data: view.nodes.map((node) => ({ id: node.id, name: node.id, x: seed[node.id].x * 0.5, y: seed[node.id].y, symbolSize: symbolSize(node) })),
            links: view.edges.map((edge) => ({ source: edge.source, target: edge.target })),
            force: { initLayout: 'none', repulsion: 280, edgeLength: [50, 120], gravity: 0.12, friction: 0.6, layoutAnimation: false } }] })
          const layoutData = (scratch as unknown as { getModel(): { getSeriesByIndex(i: number): { getData(): { getItemLayout(i: number): number[] | null } } } }).getModel().getSeriesByIndex(0).getData()
          const computed: Positions = {}
          view.nodes.forEach((node, index) => { const point = layoutData.getItemLayout(index) ?? [seed[node.id].x, seed[node.id].y]; computed[node.id] = { x: point[0], y: point[1] } })
          scratch.dispose(); offscreen.remove()
          webPositions.current.set(cacheKey, computed)
        }
        positions = webPositions.current.get(cacheKey)!
      }

      const width = chart.getWidth(), height = chart.getHeight()
      const padTop = (width < 900 ? 90 : 60) + (layout === 'tempo' ? 26 : 0), padLeft = layout === 'tempo' ? 56 : 24, padRight = width < 600 ? 90 : 120, padBottom = 24
      const xs = view.nodes.map((node) => positions[node.id].x), ys = view.nodes.map((node) => positions[node.id].y)
      const minX = Math.min(...xs), minY = Math.min(...ys)
      const spanX = Math.max(...xs) - minX || 1, spanY = Math.max(...ys) - minY || 1
      const availW = Math.max(80, width - padLeft - padRight), availH = Math.max(80, height - padTop - padBottom)
      let boxW = availW, boxH = (boxW * spanY) / spanX
      if (boxH > availH) { boxH = availH; boxW = (boxH * spanX) / spanY }
      // Um único nó ou uma só coluna: não estica para a largura toda.
      if (spanX === 1) boxW = Math.min(boxW, 40)
      if (spanY === 1) boxH = Math.min(boxH, 40)
      const box = { left: padLeft + (availW - boxW) / 2, top: padTop + (availH - boxH) / 2, width: boxW, height: boxH }

      const fg = cssColor('--color-content-primary'), muted = cssColor('--color-content-secondary'), surface = cssColor('--color-surface'), border = cssColor('--color-border')
      const colors = STATES.map((state) => cssColor(state.token))
      const presentStates = STATES.filter((state) => view.nodes.some((node) => node.state === state.id))
      chart.setOption({
        animationDurationUpdate: 500,
        color: colors,
        graphic: columns.map((column) => ({ type: 'text', silent: true, x: box.left + ((column.x - minX) / spanX) * boxW, y: padTop - 24, style: { text: column.label, fill: muted, font: '600 12px Roboto, sans-serif', textAlign: 'center' } })),
        legend: [{ data: presentStates.map((state) => state.label), top: 8, left: 'center', icon: 'circle', itemWidth: 10, itemHeight: 10, itemGap: 14, textStyle: { color: muted, fontSize: 12 }, inactiveColor: border }],
        tooltip: {
          confine: true, backgroundColor: surface, borderColor: border, textStyle: { color: fg },
          formatter: (params: { dataType?: string; data?: { id?: string } }) => {
            if (params.dataType !== 'node' || !params.data?.id) return ''
            const node = view.byId.get(params.data.id)
            if (!node) return ''
            const detail = node.itemCount > 0 ? `aproveitamento ${node.masteryPercent ?? '—'}% em ${node.itemCount} itens` : node.risk !== null ? `risco ${pct(node.risk)}` : ''
            return `<b>${escapeHtml(node.code)}</b> · ${escapeHtml(period(node))}<br>${escapeHtml(stateLabel(node.state))}${detail ? ` · ${escapeHtml(detail)}` : ''}${node.description ? `<br><span style="color:${muted}">${escapeHtml(node.description.slice(0, 140))}${node.description.length > 140 ? '…' : ''}</span>` : ''}`
          },
        },
        series: [{
          type: 'graph', layout: 'none', roam: layout === 'teia', ...box,
          categories: STATES.map((state, index) => ({ name: state.label, itemStyle: { color: colors[index] } })),
          data: view.nodes.map((node) => ({
            id: node.id, name: node.code, category: STATE_INDEX[node.state], x: positions[node.id].x, y: positions[node.id].y,
            symbolSize: symbolSize(node),
            itemStyle: node.itemCount === 0 ? { borderColor: colors[STATE_INDEX[node.state]], borderType: 'dashed', borderWidth: 2 } : { borderColor: surface, borderWidth: 1.5 },
            label: { show: true, position: 'right', color: fg, fontSize: 11, formatter: '{b}' },
          })),
          links: view.edges.map((edge) => {
            const source = view.byId.get(edge.source)
            const carries = (source?.weakness ?? 0) * edge.weight > 0.15
            return { source: edge.source, target: edge.target, symbol: edge.directed ? ['none', 'arrow'] : ['none', 'none'],
              lineStyle: { width: carries ? 1.5 + edge.weight * 2.5 : 0.8 + edge.weight * 1.2, opacity: carries ? 0.85 : 0.4, type: edge.kind === 'correlacao' ? 'dashed' : 'solid' } }
          }),
          edgeSymbolSize: [0, 7],
          lineStyle: { color: 'source', curveness: 0.3 },
          emphasis: { focus: 'adjacency', lineStyle: { width: 4, opacity: 1 } },
          blur: { itemStyle: { opacity: 0.18 }, lineStyle: { opacity: 0.06 }, label: { opacity: 0.25 } },
          labelLayout: { hideOverlap: true },
          scaleLimit: { min: 0.4, max: 3 },
        }],
      }, true)
      chart.off('click')
      chart.on('click', (params) => { const id = (params.data as { id?: string } | undefined)?.id; if (params.dataType === 'node' && id) setSelected(id) })
    }
    draw()

    let timer: ReturnType<typeof setTimeout> | undefined
    const onResize = () => { chartRef.current?.resize(); clearTimeout(timer); timer = setTimeout(draw, 120) }
    window.addEventListener('resize', onResize)
    return () => { disposed = true; window.removeEventListener('resize', onResize); clearTimeout(timer) }
  }, [view, layout, activeContext, themeTick])

  useEffect(() => () => { chartRef.current?.dispose(); chartRef.current = null }, [])

  function focus(id: string) {
    setSelected(id)
    const chart = chartRef.current
    if (!chart || !view) return
    chart.dispatchAction({ type: 'downplay', seriesIndex: 0 })
    const index = view.nodes.findIndex((node) => node.id === id)
    if (index >= 0) chart.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: index })
  }

  if (error) return <p className="text-sm text-status-danger-content">{error}</p>
  if (!data) return <p className="text-sm text-content-secondary">Montando a teia…</p>
  if (!view || !view.nodes.length) return <p className="rounded border border-border bg-surface p-5 text-sm text-content-secondary">Ainda não há habilidades BNCC avaliadas ou planejadas para montar a teia deste aluno.</p>

  const atRisk = view.nodes.filter((node) => node.state === 'risco_alto' || node.state === 'risco_moderado').sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0))
  const learned = view.edges.filter((edge) => edge.kind === 'correlacao').length
  const recurrences = view.edges.length - learned
  const chip = (id: string, extra?: string) => {
    const node = view.byId.get(id)
    if (!node) return null
    return <button key={id + (extra ?? '')} type="button" onClick={() => focus(id)} className="inline-flex min-h-8 items-center gap-1.5 rounded border border-border bg-canvas px-2 py-1 text-xs text-content-primary hover:bg-surface-subtle">
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: `rgb(var(${STATES[STATE_INDEX[node.state]].token}))` }} />{node.code} · {node.bimester}º bim.{extra ? ` · ${extra}` : ''}</button>
  }
  const incoming = selectedNode ? view.edges.filter((edge) => edge.target === selectedNode.id || (!edge.directed && edge.source === selectedNode.id)) : []
  const outgoing = selectedNode ? view.edges.filter((edge) => edge.source === selectedNode.id || (!edge.directed && edge.target === selectedNode.id)) : []
  const other = (edge: NetworkEdge) => (edge.source === selectedNode?.id ? edge.target : edge.source)

  return <div className="space-y-4">
    <section className="rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-content-primary">Teia de habilidades</h2>
          <p className="mt-1 max-w-2xl text-sm text-content-secondary">Cada ponto é uma habilidade BNCC num bimestre. As ligações mostram o que costuma vir junto: a retomada do mesmo código e, quando há colegas suficientes, habilidades cujo desempenho anda junto. Uma dificuldade atravessa as ligações e acende o risco no que ainda não foi avaliado.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {contexts.length > 1 && <select aria-label="Disciplina" value={activeContext ?? ''} onChange={(event) => setContext(event.target.value)} className="min-h-10 rounded border border-border bg-surface px-2 text-sm text-content-primary">
            {contexts.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>}
          <div role="group" aria-label="Disposição" className="inline-flex overflow-hidden rounded border border-border">
            {(['teia', 'tempo'] as const).map((item) => <button key={item} type="button" aria-pressed={layout === item} onClick={() => setLayout(item)}
              className={`min-h-10 px-3 text-sm ${layout === item ? 'bg-action-primary font-semibold text-action-primary-foreground' : 'bg-surface text-content-secondary hover:text-content-primary'}`}>{item === 'teia' ? 'Teia' : 'Linha do tempo'}</button>)}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-content-muted">{view.nodes.length} habilidades · {view.nodes.filter((node) => node.itemCount > 0).length} avaliadas · {recurrences} retomadas · {learned} ligações aprendidas de {data.summary.peerStudentCount} alunos do recorte · contorno tracejado = ainda não avaliada · linha tracejada = ligação aprendida</p>
    </section>

    {/* O relatório é estreito (max-w-3xl): gráfico na largura toda e o detalhe logo abaixo. */}
    <div className="space-y-4">
      {/* Em tela estreita o gráfico rola dentro do próprio quadro, sem empurrar a página. */}
      <div className="min-w-0 overflow-x-auto rounded border border-border bg-surface">
        <div ref={containerRef} className="h-[560px] w-full" style={{ minWidth: layout === 'tempo' ? new Set(view.nodes.map((node) => node.academicYear * 10 + node.bimester)).size * 150 + 100 : 520 }} role="img" aria-label={`Teia de habilidades de ${studentName}. As listas abaixo trazem o mesmo conteúdo em texto.`} />
      </div>
      <aside className="space-y-4 rounded border border-border bg-surface p-5" aria-live="polite">
        {selectedNode ? <>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{period(selectedNode)} · {selectedNode.planned ? 'planejada' : 'fora do planejamento'}</p>
            <h3 className="mt-1 text-lg font-semibold text-content-primary">{selectedNode.code}</h3>
            <p className="mt-1 text-sm text-content-secondary">{selectedNode.description ?? 'Descrição não informada no planejamento.'}</p>
          </div>
          <p className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-medium text-content-primary"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: `rgb(var(${STATES[STATE_INDEX[selectedNode.state]].token}))` }} />{stateLabel(selectedNode.state)}</p>
          {selectedNode.itemCount > 0
            ? <dl className="grid grid-cols-2 gap-2 text-sm"><dt className="text-content-secondary">Aproveitamento</dt><dd className="text-content-primary">{selectedNode.masteryPercent ?? '—'}%{selectedNode.level === 'evidencia_insuficiente' ? ' (preliminar)' : ''}</dd><dt className="text-content-secondary">Itens / avaliações</dt><dd className="text-content-primary">{selectedNode.itemCount} / {selectedNode.assessmentCount}</dd></dl>
            : <div className="text-sm"><p className="text-content-secondary">Ainda não avaliada. Risco herdado: <span className="font-semibold text-content-primary">{pct(selectedNode.risk)}</span></p>
              {selectedNode.riskSources.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{selectedNode.riskSources.map((source) => chip(source.id, source.kind === 'retomada' ? 'retomada' : 'correlação'))}</div> : <p className="mt-1 text-xs text-content-muted">Nenhuma ligação traz dificuldade até aqui.</p>}</div>}
          {incoming.length > 0 && <div><p className="text-xs font-medium uppercase tracking-wide text-content-muted">Vem de</p><div className="mt-2 flex flex-wrap gap-1.5">{incoming.map((edge) => chip(other(edge), edge.kind === 'retomada' ? 'retomada' : `r=${edge.weight}`))}</div></div>}
          {outgoing.length > 0 && <div><p className="text-xs font-medium uppercase tracking-wide text-content-muted">Leva a</p><div className="mt-2 flex flex-wrap gap-1.5">{outgoing.map((edge) => chip(other(edge), edge.kind === 'retomada' ? 'retomada' : `r=${edge.weight}`))}</div></div>}
          {selectedNode.state === 'em_desenvolvimento' && <Link href={recoveryUrl(selectedNode, studentName, classroomCourseId)} className="inline-flex min-h-9 items-center rounded border border-action-primary px-3 py-1.5 text-xs font-semibold text-action-primary hover:bg-action-primary/10">Criar atividade de recuperação</Link>}
        </> : <p className="text-sm text-content-secondary">Clique numa habilidade da teia para ver o detalhe.</p>}
      </aside>
    </div>

    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded border border-border bg-surface p-5">
        <h3 className="font-semibold text-content-primary">Raízes para atacar primeiro</h3>
        <p className="mt-1 text-sm text-content-secondary">Habilidades em desenvolvimento que não são explicadas por outra dificuldade anterior ligada a elas.</p>
        {view.roots.length ? <ul className="mt-3 divide-y divide-border">{view.roots.slice(0, 5).map((root) => { const node = view.byId.get(root.id)!; return <li key={root.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <button type="button" onClick={() => focus(root.id)} className="min-w-0 text-left text-content-primary hover:underline"><span className="font-medium">{node.code}</span> <span className="text-content-secondary">· {period(node)} · {node.masteryPercent}%</span></button>
          <span className="shrink-0 text-xs text-content-muted">{root.affected ? `${root.affected} adiante` : 'sem efeito adiante'}</span></li> })}</ul>
          : <p className="mt-3 text-sm text-content-secondary">Nenhuma habilidade em desenvolvimento com amostra mínima.</p>}
      </section>
      <section className="rounded border border-border bg-surface p-5">
        <h3 className="font-semibold text-content-primary">Em risco no que ainda vem</h3>
        <p className="mt-1 text-sm text-content-secondary">Habilidades planejadas e ainda não avaliadas, com o risco herdado das ligações.</p>
        {atRisk.length ? <ul className="mt-3 divide-y divide-border">{atRisk.slice(0, 6).map((node) => <li key={node.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <button type="button" onClick={() => focus(node.id)} className="min-w-0 text-left text-content-primary hover:underline"><span className="font-medium">{node.code}</span> <span className="text-content-secondary">· {period(node)}</span></button>
          <span className="shrink-0 font-medium text-content-primary">{pct(node.risk)}</span></li>)}</ul>
          : <p className="mt-3 text-sm text-content-secondary">Nenhuma ligação leva dificuldade para o que ainda não foi avaliado.</p>}
      </section>
    </div>
    <p className="text-xs text-content-muted">Leitura de apoio, não diagnóstico. Ligação aprendida exige {data.rules.network.minSharedStudents} alunos em comum e correlação de pelo menos {data.rules.network.minCorrelation} já descontado o nível geral de cada aluno. Pré-requisitos curriculares declarados ainda não fazem parte da teia.</p>
  </div>
}
