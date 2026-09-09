'use client'

import { useState } from 'react'
import EnemSaeImport from './enem-sae-import'

type Area = 'linguagens' | 'matematica' | 'natureza' | 'humanas' | 'redacao'
type StudentResult = { name: string; email: string; scores: Partial<Record<Area, number>>; average: number | null }

const AREA_LABELS: Record<Area, string> = {
  linguagens: 'Linguagens', matematica: 'Matemática', natureza: 'Ciências da Natureza', humanas: 'Ciências Humanas', redacao: 'Redação',
}
const AREA_ALIASES: Record<Area, string[]> = {
  linguagens: ['linguagens', 'lc'], matematica: ['matematica', 'matemática', 'mt'], natureza: ['natureza', 'ciencias natureza', 'ciências natureza', 'cn'], humanas: ['humanas', 'ciencias humanas', 'ciências humanas', 'ch'], redacao: ['redacao', 'redação'],
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function parseCsv(text: string) {
  const delimiter = text.split('\n')[0]?.includes(';') ? ';' : ','
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map((line) => {
    const cells: string[] = []
    let cell = ''
    let quoted = false
    for (let index = 0; index < line.length; index++) {
      const char = line[index]
      if (char === '"') {
        if (quoted && line[index + 1] === '"') { cell += '"'; index++ } else quoted = !quoted
      } else if (char === delimiter && !quoted) { cells.push(cell.trim()); cell = '' } else cell += char
    }
    cells.push(cell.trim())
    return cells
  })
}

function toPercent(raw: string) {
  const value = Number(raw.replace(',', '.').trim())
  if (!Number.isFinite(value) || value < 0 || value > 1000) return null
  return value > 100 ? value / 10 : value
}

function downloadTemplate() {
  const content = 'nome;email;linguagens;matematica;natureza;humanas;redacao\nAluno exemplo;aluno@colegioharmonia.com.br;620;580;610;640;700\n'
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'modelo-simulado-enem.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function EnemSimulatorImport() {
  const [results, setResults] = useState<StudentResult[]>([])
  const [error, setError] = useState<string | null>(null)

  function handleFile(file: File | null) {
    if (!file) return
    setError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCsv(String(reader.result ?? ''))
      const header = rows.shift()?.map(normalize) ?? []
      const nameIndex = header.findIndex((value) => value === 'nome' || value === 'aluno' || value === 'student_name')
      const emailIndex = header.findIndex((value) => value === 'email' || value === 'e-mail')
      const indexes = Object.fromEntries((Object.keys(AREA_ALIASES) as Area[]).map((area) => [area, header.findIndex((value) => AREA_ALIASES[area].map(normalize).includes(value))])) as Record<Area, number>
      if (nameIndex < 0 || Object.values(indexes).every((index) => index < 0)) {
        setResults([])
        setError('Use o modelo: a coluna nome e ao menos uma área ENEM são obrigatórias.')
        return
      }
      const parsed = rows.flatMap((row) => {
        const name = row[nameIndex]?.trim()
        if (!name) return []
        const scores = Object.fromEntries((Object.keys(indexes) as Area[]).flatMap((area) => {
          const score = indexes[area] >= 0 ? toPercent(row[indexes[area]] ?? '') : null
          return score === null ? [] : [[area, score]]
        })) as Partial<Record<Area, number>>
        const values = Object.values(scores)
        return [{ name, email: emailIndex >= 0 ? row[emailIndex]?.trim() ?? '' : '', scores, average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null }]
      })
      if (!parsed.length) setError('Nenhuma linha válida foi encontrada no arquivo.')
      setResults(parsed)
    }
    reader.readAsText(file, 'utf-8')
  }

  const areaAverages = Object.fromEntries((Object.keys(AREA_LABELS) as Area[]).map((area) => {
    const scores = results.flatMap((student) => student.scores[area] === undefined ? [] : [student.scores[area]!])
    return [area, scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null]
  })) as Record<Area, number | null>

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-content-primary">Análise de simulado ENEM</h1>
        <p className="mt-2 max-w-3xl text-sm text-content-secondary">Importe um CSV externo para analisar a turma. Os dados são processados apenas neste navegador e não são enviados nem gravados no Prova-TRI.</p>
      </header>

      <section className="rounded border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold text-content-primary">Importar arquivo</h2><p className="mt-1 text-sm text-content-secondary">Notas de 0 a 100 ou 0 a 1000. Valores acima de 100 são convertidos para percentual.</p></div>
          <button type="button" onClick={downloadTemplate} className="min-h-10 rounded border border-border px-3 text-sm font-medium text-content-primary hover:bg-surface-subtle">Baixar modelo CSV</button>
        </div>
        <label htmlFor="enem-simulator-file" className="mt-4 block text-sm font-medium text-content-primary">Arquivo CSV do simulado</label>
        <input id="enem-simulator-file" type="file" accept=".csv,text/csv" onChange={(event) => handleFile(event.target.files?.[0] ?? null)} className="mt-2 block w-full text-sm text-content-secondary" />
        <p className="mt-3 text-xs text-content-secondary">Colunas aceitas: `nome`, `email` (opcional), `linguagens`, `matematica`, `natureza`, `humanas`, `redacao`. Também aceita LC, MT, CN, CH e notas com vírgula decimal.</p>
        {error && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </section>

      {results.length > 0 && <>
        <section className="rounded border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-content-primary">Leitura da turma</h2><p className="mt-1 text-sm text-content-secondary">Referência institucional convertida: 60%.</p></div><button type="button" onClick={() => window.print()} className="min-h-10 rounded bg-harmonia-green px-3 text-sm font-semibold text-white">Imprimir / Salvar em PDF</button></div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-5">{(Object.keys(AREA_LABELS) as Area[]).map((area) => <div key={area} className="rounded border border-border bg-canvas p-3"><p className="text-xs text-content-secondary">{AREA_LABELS[area]}</p><p className="mt-1 text-xl font-semibold text-content-primary">{areaAverages[area] === null ? '—' : `${Math.round(areaAverages[area]!)}%`}</p></div>)}</div>
          <ul className="mt-4 space-y-2 text-sm text-content-secondary">{(Object.keys(AREA_LABELS) as Area[]).filter((area) => areaAverages[area] !== null && areaAverages[area]! < 60).map((area) => <li key={area}>• {AREA_LABELS[area]} abaixo de 60%: planeje retomada por habilidade e aplique novo conjunto de itens equivalentes.</li>)}</ul>
        </section>
        <section className="overflow-x-auto rounded border border-border bg-surface"><table className="min-w-full text-left text-sm"><thead className="border-b border-border text-content-secondary"><tr><th className="p-3">Aluno</th>{(Object.keys(AREA_LABELS) as Area[]).map((area) => <th key={area} className="p-3">{AREA_LABELS[area]}</th>)}<th className="p-3">Média</th></tr></thead><tbody>{results.map((student) => <tr key={`${student.name}-${student.email}`} className="border-b border-border last:border-0"><td className="p-3 font-medium text-content-primary">{student.name}</td>{(Object.keys(AREA_LABELS) as Area[]).map((area) => <td key={area} className="p-3 text-content-secondary">{student.scores[area] === undefined ? '—' : `${Math.round(student.scores[area]!)}%`}</td>)}<td className="p-3 font-semibold text-content-primary">{student.average === null ? '—' : `${Math.round(student.average)}%`}</td></tr>)}</tbody></table></section>
      </>}

      <EnemSaeImport />
    </div>
  )
}
