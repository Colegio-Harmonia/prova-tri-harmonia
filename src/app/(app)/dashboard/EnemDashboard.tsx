'use client'

import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { enemStatsQueryOptions } from '@/features/analytics/queries/enem-stats'
import { ApexBarChart } from './charts/ApexBarChart'
import { Tabs } from './Tabs'

const SOURCE_LABELS: Record<string, string> = {
  oficial: 'Oficial (microdados INEP)',
  ai: 'Estimada (heurística)',
  pending: 'Pendente',
  nunca_classificado: 'Nunca classificada',
}
const SOURCE_COLORS: Record<string, string> = {
  oficial: '#008649',
  ai: '#F59E0B',
  pending: '#9CA3AF',
  nunca_classificado: '#D1D5DB',
}

const AREA_LABELS: Record<string, string> = {
  linguagens: 'Linguagens',
  matematica: 'Matemática',
  'ciencias-natureza': 'Ciências da Natureza',
  'ciencias-humanas': 'Ciências Humanas',
}

const BLOOM_ORDER = ['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar']
const BLOOM_LABELS: Record<string, string> = {
  lembrar: 'Lembrar',
  compreender: 'Compreender',
  aplicar: 'Aplicar',
  analisar: 'Analisar',
  avaliar: 'Avaliar',
  criar: 'Criar',
}
const BLOOM_RAMP = ['#c8e6d3', '#a0d1b5', '#6fb98f', '#3fa06a', '#1f8850', '#008649']

const AREA_COLORS: Record<string, string> = {
  'Linguagens': '#E91E63',
  'Matemática': '#2196F3',
  'Ciências da Natureza': '#4CAF50',
  'Ciências Humanas': '#FF9800',
}

const COGNITIVE_AXIS_INFO: Record<string, { code: string; name: string; description: string }> = {
  DL: { code: 'DL', name: 'Dominar Linguagens', description: 'Dominar a norma culta da Língua Portuguesa e fazer uso das linguagens matemática, artística e científica.' },
  CF: { code: 'CF', name: 'Compreender Fenômenos', description: 'Construir e aplicar conceitos das várias áreas do conhecimento para a compreensão de fenômenos naturais, de processos histórico-geográficos, da produção tecnológica e das manifestações artísticas.' },
  SP: { code: 'SP', name: 'Enfrentar Situações-Problema', description: 'Selecionar, organizar, relacionar, interpretar dados e informações representados de diferentes formas, para tomar decisões e enfrentar situações-problema.' },
  CA: { code: 'CA', name: 'Construir Argumentação', description: 'Relacionar informações, representadas em diferentes formas, e conhecimentos disponíveis em situações concretas, para construir argumentação consistente.' },
  EP: { code: 'EP', name: 'Elaborar Propostas', description: 'Recorrer aos conhecimentos desenvolvidos na escola para elaboração de propostas de intervenção solidária na realidade, respeitando valores humanos e considerando a diversidade sociocultural.' },
}

const COGNITIVE_AXIS_COLORS: Record<string, string> = {
  DL: '#6366F1',
  CF: '#8B5CF6',
  SP: '#A78BFA',
  CA: '#C4B5FD',
  EP: '#DDD6FE',
}

function StatTile({ label, value, subtitle }: { label: string; value: string | number; subtitle?: string }) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <p className="text-sm text-content-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-content-primary">{value}</p>
      {subtitle && <p className="mt-0.5 text-xs text-content-muted">{subtitle}</p>}
    </div>
  )
}

// Tooltip que fica visível enquanto o mouse estiver em cima (diferente do
// atributo title nativo do navegador, que some rápido demais pra ler um
// texto longo — reclamação direta do usuário, 16/07/2026).
function HoverTooltip({ tooltip, children, wrapperClassName }: { tooltip: string; children: ReactNode; wrapperClassName?: string }) {
  return (
    <span className={`group/tooltip relative inline-block ${wrapperClassName ?? ''}`}>
      {children}
      <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-72 whitespace-normal rounded border border-border bg-surface p-2 text-xs normal-case text-content-secondary shadow-lg group-hover/tooltip:block">
        {tooltip}
      </span>
    </span>
  )
}

function TruncatedWithTooltip({ text, className }: { text: string; className: string }) {
  return (
    <HoverTooltip tooltip={text} wrapperClassName="shrink-0 align-bottom">
      <span className={`block truncate ${className}`}>{text}</span>
    </HoverTooltip>
  )
}

function toChartData(
  data: Record<string, number>,
  order?: string[],
): { categories: string[]; values: number[] } {
  const entries = order
    ? order.filter((k) => k in data).map((k) => [k, data[k]] as const)
    : Object.entries(data).sort((a, b) => b[1] - a[1])
  return { categories: entries.map(([k]) => k), values: entries.map(([, v]) => v) }
}

export default function EnemDashboard() {
  const { data: stats, error, isPending } = useQuery(enemStatsQueryOptions)
  const [expandedCompetency, setExpandedCompetency] = useState<string | null>(null)

  if (error) return <p className="text-sm text-status-danger-content">Falha ao carregar estatísticas do ENEM.</p>
  if (isPending || !stats) return <p className="text-sm text-content-muted">Carregando…</p>

  if (stats.total === 0) {
    return (
      <div className="rounded border border-border bg-surface p-8 text-center text-sm text-content-muted">
        Nenhuma questão do ENEM importada ainda.
      </div>
    )
  }

  const presentBloomLevels = BLOOM_ORDER.filter((l) => (stats.bloomCounts[l] ?? 0) > 0)
  const sourceRows = Object.entries(stats.classificationSource).sort((a, b) => b[1] - a[1])
  const competencyByArea = stats.byCompetency.reduce<Record<string, typeof stats.byCompetency>>((acc, row) => {
    ;(acc[row.area] ??= []).push(row)
    return acc
  }, {})
  const skillsByCompetencyKey = stats.bySkillInCompetency.reduce<Record<string, typeof stats.bySkillInCompetency>>((acc, row) => {
    const key = `${row.area}-${row.competencyNumber}`
    ;(acc[key] ??= []).push(row)
    return acc
  }, {})
  const cognitiveAxisEntries = Object.entries(stats.cognitiveAxes)
  const cognitiveAxisMax = Math.max(1, ...cognitiveAxisEntries.map(([, v]) => v))

  const visaoGeral = (
    <div className="space-y-3">
      <p className="text-sm text-content-muted">
        Cobertura do banco real do ENEM por área de conhecimento e por ano de prova — visão rápida antes de entrar nos detalhes nas outras abas.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(() => {
          const { categories, values } = toChartData(stats.byArea)
          return <ApexBarChart title="Questões por Área" categories={categories} values={values} colors={categories.map((c) => AREA_COLORS[c] ?? '#008649')} />
        })()}
        <ApexBarChart title="Distribuição por Ano" colors="#008649" {...toChartData(stats.byYear)} />
      </div>
    </div>
  )

  const bloomTab = (
    <ApexBarChart
      title="Distribuição de Bloom"
      subtitle="Nível cognitivo (Taxonomia de Bloom) de cada questão, classificado por IA a partir da demanda real da pergunta — mostra se o banco está concentrado em níveis mais baixos (Lembrar/Compreender) ou espalhado até os mais altos (Analisar/Avaliar/Criar)."
      categories={presentBloomLevels.map((l) => BLOOM_LABELS[l])}
      values={presentBloomLevels.map((l) => stats.bloomCounts[l] ?? 0)}
      colors={presentBloomLevels.map((l) => BLOOM_RAMP[BLOOM_ORDER.indexOf(l)])}
    />
  )

  const fonteTab = sourceRows.length > 0 && (
    <ApexBarChart
      title="Fonte da classificação de habilidade"
      subtitle='De onde vem a habilidade H1-H30 de cada questão: "Oficial" veio direto dos microdados do INEP (mais confiável), "Estimada" foi inferida por heurística, "Pendente"/"Nunca classificada" ainda falta processar.'
      categories={sourceRows.map(([k]) => SOURCE_LABELS[k] ?? k)}
      values={sourceRows.map(([, v]) => v)}
      colors={sourceRows.map(([k]) => SOURCE_COLORS[k] ?? '#9CA3AF')}
    />
  )

  const habilidadesTab = stats.topSkills.length > 0 && (
    <div className="rounded border border-border bg-surface p-4">
      <p className="text-sm font-medium text-content-secondary">Habilidades mais frequentes</p>
      <p className="mt-0.5 text-xs text-content-muted">
        As habilidades oficiais do ENEM (H1-H30) mais recorrentes no banco importado — ajuda a ver quais competências têm mais questões disponíveis pra puxar numa prova. Passe o mouse pra ver a descrição completa.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {stats.topSkills.map((s) => (
          <HoverTooltip key={s.skillCode ?? 'null'} tooltip={s.skillDescription ?? 'sem descrição'}>
            <span className="inline-block rounded-full bg-surface-subtle px-3 py-1 text-xs text-content-secondary">
              {s.skillCode ?? 'sem habilidade'}
              <span className="ml-1 font-medium text-content-primary">{s.count}</span>
            </span>
          </HoverTooltip>
        ))}
      </div>
    </div>
  )

  const competenciaTab = stats.byCompetency.length > 0 && (
    <div className="rounded border border-border bg-surface p-4">
      <p className="text-sm font-medium text-content-secondary">Distribuição por Competência (INEP)</p>
      <p className="mt-0.5 text-xs text-content-muted">
        Agrupa as habilidades H1-H30 nas Competências oficiais (C1-C9 por área) da Matriz de Referência do ENEM. Clique numa competência pra ver como as questões dela se dividem entre as habilidades específicas — útil pra saber se dá pra puxar várias questões diferentes da mesma H ou se o banco está concentrado numa só.
      </p>
      <div className="mt-3 space-y-4">
        {Object.entries(competencyByArea).map(([area, rows]) => (
          <div key={area}>
            <p className="text-xs font-medium text-content-muted">{AREA_LABELS[area] ?? area}</p>
            <div className="mt-1.5 space-y-1.5">
              {rows.map((r) => {
                const max = Math.max(1, ...rows.map((x) => x.count))
                const key = `${area}-${r.number}`
                const isOpen = expandedCompetency === key
                const areaColor = AREA_COLORS[AREA_LABELS[area] ?? area] ?? '#008649'
                const skills = skillsByCompetencyKey[key] ?? []
                return (
                  <div key={r.number}>
                    <button
                      onClick={() => setExpandedCompetency(isOpen ? null : key)}
                      disabled={!skills.length}
                      className="flex w-full items-center gap-2 rounded py-0.5 text-left text-xs disabled:cursor-default"
                    >
                      <span className={`w-3 shrink-0 text-content-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}>{skills.length ? '›' : ''}</span>
                      <span className="w-8 shrink-0 font-medium text-content-secondary">C{r.number}</span>
                      <TruncatedWithTooltip text={r.description} className="w-60 text-content-muted" />
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-subtle">
                        <div className="h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, backgroundColor: areaColor }} />
                      </div>
                      <span className="w-6 shrink-0 text-right font-medium text-content-secondary">{r.count}</span>
                    </button>

                    {isOpen && skills.length > 0 && (
                      <div className="ml-9 mt-1 space-y-1 border-l-2 py-1 pl-3" style={{ borderColor: `${areaColor}40` }}>
                        {skills
                          .slice()
                          .sort((a, b) => b.count - a.count)
                          .map((s) => {
                            const skillMax = Math.max(1, ...skills.map((x) => x.count))
                            return (
                              <div key={s.skillCode} className="flex items-center gap-2 text-xs">
                                <span className="w-14 shrink-0 font-medium text-content-muted">{s.skillCode}</span>
                                <TruncatedWithTooltip text={s.skillDescription ?? '—'} className="w-52 text-content-muted" />
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-subtle">
                                  <div className="h-full rounded-full opacity-70" style={{ width: `${(s.count / skillMax) * 100}%`, backgroundColor: areaColor }} />
                                </div>
                                <span className="w-6 shrink-0 text-right font-medium text-content-secondary">{s.count}</span>
                              </div>
                            )
                          })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  const matrizTab = stats.matrixStats.length > 0 && (
    <div className="rounded border border-border bg-surface p-4">
      <p className="text-sm font-medium text-content-secondary">Matriz de Referência ENEM — Distribuição</p>
      <p className="mt-0.5 text-xs text-content-muted">
        Cruzamento entre Área de conhecimento e nível de Bloom — mostra, por exemplo, se Matemática está concentrada em &quot;Aplicar&quot; e Linguagens em &quot;Analisar&quot;, útil pra calibrar o equilíbrio de uma prova.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="py-1 pr-4 text-left font-medium text-content-muted">Área</th>
              {BLOOM_ORDER.map((l) => (
                <th key={l} className="px-2 py-1 text-right font-medium text-content-muted">{BLOOM_LABELS[l]}</th>
              ))}
              <th className="pl-2 py-1 text-right font-medium text-content-muted">Total</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(stats.byArea).map(([area, areaTotal]) => {
              const areaRows = stats.matrixStats.filter((m) => m.area === area)
              return (
                <tr key={area} className="border-b border-border">
                  <td className="py-1.5 pr-4 font-medium text-content-secondary">{area}</td>
                  {BLOOM_ORDER.map((l) => {
                    const cell = areaRows?.find((r) => r.level === l)
                    return (
                      <td key={l} className="px-2 py-1.5 text-right text-content-secondary">
                        {cell?.count ?? '-'}
                      </td>
                    )
                  })}
                  <td className="pl-2 py-1.5 text-right font-medium text-content-primary">{areaTotal}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )

  const eixosTab = cognitiveAxisEntries.length > 0 && (
    <div className="rounded border border-border bg-surface p-4">
      <p className="text-sm font-medium text-content-secondary">Eixos Cognitivos (comuns a todas as áreas)</p>
      <p className="mb-3 mt-0.5 text-xs text-content-muted">
        Os 5 eixos cognitivos estruturam toda a Matriz do ENEM — cada questão mobiliza um ou mais eixos. Passe o mouse sobre cada um pra ver a descrição oficial.
      </p>
      <div className="space-y-2">
        {cognitiveAxisEntries.map(([code, count]) => {
          const info = COGNITIVE_AXIS_INFO[code]
          return (
            <div key={code} className="group relative flex items-center gap-2 text-xs">
              <span className="flex w-24 shrink-0 items-center gap-1.5 font-medium">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COGNITIVE_AXIS_COLORS[code] ?? '#6366F1' }} />
                <span className="text-content-secondary">{code}</span>
              </span>
              <span className="w-44 shrink-0 truncate text-content-muted">{info?.name ?? code}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-subtle">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(count / cognitiveAxisMax) * 100}%`, backgroundColor: COGNITIVE_AXIS_COLORS[code] ?? '#6366F1' }}
                />
              </div>
              <span className="w-6 shrink-0 text-right font-medium text-content-secondary">{count}</span>
              {info && (
                <div className="absolute bottom-full left-0 z-10 mb-1 hidden w-72 rounded border border-border bg-surface p-2 shadow-lg group-hover:block">
                  <p className="text-xs font-medium text-content-secondary">{info.code} — {info.name}</p>
                  <p className="mt-1 text-xs leading-relaxed text-content-muted">{info.description}</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Título da seção */}
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-status-success-surface text-sm font-bold text-status-success-content">
          E
        </div>
        <div>
          <h2 className="text-base font-semibold">Banco de Questões ENEM</h2>
          <p className="text-xs text-content-muted">Importadas da API pública enem.dev</p>
        </div>
      </div>

      {/* Cartões de totais — sempre visíveis, fora das abas */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Total de questões" value={stats.total} />
        <StatTile label="Classificadas (Bloom)" value={stats.bloomClassified} subtitle={`${stats.bloomPending} pendentes`} />
        <StatTile
          label="Anos"
          value={Object.keys(stats.byYear).length}
          subtitle={`${Math.min(...Object.keys(stats.byYear).map(Number))}–${Math.max(...Object.keys(stats.byYear).map(Number))}`}
        />
        <StatTile label="Áreas" value={Object.keys(stats.byArea).length} subtitle="Matriz de Referência ENEM" />
      </div>

      <Tabs
        tabs={[
          { id: 'geral', label: 'Visão Geral', content: visaoGeral },
          { id: 'bloom', label: 'Distribuição de Bloom', content: bloomTab },
          ...(fonteTab ? [{ id: 'fonte', label: 'Fonte da Classificação', content: fonteTab }] : []),
          ...(habilidadesTab ? [{ id: 'habilidades', label: 'Habilidades Frequentes', content: habilidadesTab }] : []),
          ...(competenciaTab ? [{ id: 'competencia', label: 'Por Competência', content: competenciaTab }] : []),
          ...(matrizTab ? [{ id: 'matriz', label: 'Matriz Área × Bloom', content: matrizTab }] : []),
          ...(eixosTab ? [{ id: 'eixos', label: 'Eixos Cognitivos', content: eixosTab }] : []),
        ]}
      />
    </div>
  )
}
