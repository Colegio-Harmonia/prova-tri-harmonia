#!/usr/bin/env tsx
/**
 * Captura os parâmetros TRI oficiais (modelo 3PL: NU_PARAM_A/B/C dos
 * microdados do INEP, arquivo ITENS_PROVA_AAAA.csv) para as questões do
 * ENEM já importadas em `imported_questions` — Subtarefa 2 da Expansão
 * do Sistema de Avaliação (spec seção 1.4, regra de honestidade: TRI só
 * com calibração oficial, nunca estimada por conta própria).
 *
 * O casamento questão↔item oficial usa a MESMA estratégia empírica do
 * map-enem-habilidades.ts (busca gulosa de caderno/offset por taxa de
 * acerto do gabarito). Os helpers de download/matching são DUPLICADOS
 * deliberadamente daquele script: ele é um one-off provado em produção e
 * não dá pra re-testar um refactor sem baixar os ZIPs do INEP de novo —
 * consolidar em módulo compartilhado só quando houver como validar os
 * dois lados.
 *
 * Escala do parâmetro b: o INEP publica os parâmetros em métricas
 * diferentes conforme o ano/documentação (métrica padrão N(0,1) ou a
 * escala ENEM 500/100). O motor de pontuação (triScorer.ts) trabalha
 * SEMPRE em N(0,1), então este script detecta a escala pelo perfil dos
 * valores de b do ano (mediana de |b| > 10 ⇒ escala ENEM) e normaliza na
 * gravação: b' = (b-500)/100, a' = a*100. A decisão fica logada por ano.
 *
 * Uso:
 *   npm run import-tri-params              (dry-run: só mostra cobertura)
 *   APPLY=true npm run import-tri-params   (grava no banco)
 *
 * Flags: YEARS=2022,2023 | CACHE_DIR=/path | OFFSET_RANGE=200
 * (mesmos significados do map-enem-habilidades.ts; o cache de CSV é
 * compartilhado com ele por padrão).
 */

import postgres from 'postgres'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'

function loadDatabaseUrlFromLocalEnv() {
  if (process.env.DATABASE_URL) return
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('DATABASE_URL='))
  if (!line) return
  process.env.DATABASE_URL = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}
loadDatabaseUrlFromLocalEnv()

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL não definida (nem no ambiente, nem em .env.local).')
}
const APPLY = process.env.APPLY === 'true'
const CACHE_DIR = process.env.CACHE_DIR || './enem-microdados-cache'
const MIN_COVERED = 15
const MIN_PRECISION = 0.85
const OFFSET_RANGE = Number(process.env.OFFSET_RANGE ?? 0)

type ItemRow = {
  CO_POSICAO: string
  SG_AREA: string
  TX_GABARITO: string
  IN_ITEM_ABAN: string
  CO_PROVA: string
  TP_LINGUA: string
  NU_PARAM_A: string
  NU_PARAM_B: string
  NU_PARAM_C: string
}

type OurQuestion = { id: number; index: number; correctAlternative: string }

function sh(cmd: string): string {
  return execSync(cmd, { maxBuffer: 1024 * 1024 * 200 }).toString()
}

// Duplicado de map-enem-habilidades.ts (ver cabeçalho).
function downloadAndExtractItens(year: number): ItemRow[] | null {
  mkdirSync(CACHE_DIR, { recursive: true })
  const zipPath = `${CACHE_DIR}/enem_${year}.zip`
  const csvPath = `${CACHE_DIR}/ITENS_PROVA_${year}.csv`

  if (!existsSync(csvPath)) {
    if (!existsSync(zipPath)) {
      console.log(`  ⬇️  Baixando microdados ${year}...`)
      try {
        sh(`curl -sk -o "${zipPath}" "https://download.inep.gov.br/microdados/microdados_enem_${year}.zip"`)
      } catch (err) {
        console.log(`  ⚠️  Falha ao baixar ${year}: ${err instanceof Error ? err.message : err}`)
        return null
      }
    }

    let listing: string
    try {
      listing = sh(`unzip -l "${zipPath}"`)
    } catch {
      console.log(`  ⚠️  ZIP inválido/corrompido para ${year}, pulando.`)
      return null
    }

    const match = listing.split('\n').find((l) => /ITENS_PROV.*\.csv\s*$/i.test(l))
    if (!match) {
      console.log(`  ⚠️  Arquivo de itens não encontrado no ZIP de ${year}, pulando.`)
      return null
    }
    const innerPath = match.trim().split(/\s+/).slice(3).join(' ')

    try {
      sh(`unzip -p "${zipPath}" "${innerPath}" > "${csvPath}"`)
    } catch (err) {
      console.log(`  ⚠️  Falha ao extrair itens de ${year}: ${err instanceof Error ? err.message : err}`)
      return null
    }

    if (existsSync(zipPath)) unlinkSync(zipPath)
  }

  const raw = readFileSync(csvPath, 'latin1')
  const delimiter = raw.slice(0, 200).includes(';') ? ';' : ','
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) {
    console.log(`  ⚠️  CSV de itens de ${year} vazio/inválido.`)
    return null
  }

  const header = lines[0].split(delimiter).map((h) => h.trim())
  const rows: ItemRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter)
    if (cols.length !== header.length) continue
    const row = {} as Record<string, string>
    header.forEach((h, idx) => (row[h] = cols[idx]))
    rows.push(row as unknown as ItemRow)
  }
  return rows
}

// Duplicado de map-enem-habilidades.ts (ver cabeçalho).
function greedyMatch(itemsByAreaProva: Map<string, ItemRow[]>, questions: OurQuestion[], minCovered = MIN_COVERED) {
  const remaining = new Map(questions.map((q) => [q.index, q]))
  const assigned = new Map<number, ItemRow>()
  const offsets = OFFSET_RANGE > 0 ? Array.from({ length: OFFSET_RANGE * 2 + 1 }, (_, i) => i - OFFSET_RANGE) : [0]

  while (remaining.size > 0) {
    let best: { hits: Map<number, ItemRow>; covered: number } | null = null

    for (const [, items] of itemsByAreaProva) {
      const posMap = new Map(items.map((r) => [Number(r.CO_POSICAO), r]))

      for (const offset of offsets) {
        const hits = new Map<number, ItemRow>()
        let covered = 0
        for (const [idx, q] of remaining) {
          const r = posMap.get(idx - offset)
          if (!r) continue
          covered++
          if (r.TX_GABARITO === q.correctAlternative) hits.set(idx, r)
        }
        if (covered < minCovered || hits.size / covered < MIN_PRECISION) continue
        if (!best || hits.size > best.hits.size) best = { hits, covered }
      }
    }

    if (!best) break
    for (const [idx, r] of best.hits) {
      assigned.set(idx, r)
      remaining.delete(idx)
    }
  }

  return { assigned, unresolved: [...remaining.keys()] }
}

function parseParam(raw: string | undefined): number | null {
  if (!raw) return null
  const value = Number(raw.trim().replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  📐 Parâmetros TRI oficiais (microdados INEP → imported_questions)')
  console.log(`  Modo: ${APPLY ? 'GRAVAÇÃO' : 'dry-run (use APPLY=true pra gravar)'}`)
  console.log('═══════════════════════════════════════════\n')

  const sql = postgres(DATABASE_URL!, { ssl: false, connect_timeout: 10 })

  try {
    const yearsEnv = process.env.YEARS
    const years = yearsEnv
      ? yearsEnv.split(',').map((y) => parseInt(y.trim(), 10))
      : (await sql<{ year: number }[]>`SELECT DISTINCT year FROM imported_questions ORDER BY year`).map((r) => r.year)

    console.log(`📋 Anos a processar: ${years.join(', ')}\n`)

    let totalQuestions = 0
    let totalWithParams = 0

    for (const year of years) {
      console.log(`\n── ${year} ──`)
      const itemRows = downloadAndExtractItens(year)
      if (!itemRows) {
        console.log(`  ❌ Sem dados de itens oficiais pra ${year} — ano pulado.`)
        continue
      }

      const itemsByAreaProva = new Map<string, ItemRow[]>()
      for (const row of itemRows) {
        const key = `${row.SG_AREA}::${row.CO_PROVA}`
        if (!itemsByAreaProva.has(key)) itemsByAreaProva.set(key, [])
        itemsByAreaProva.get(key)!.push(row)
      }

      const ourQuestions = await sql<{ id: number; question_index: number; correct_alternative: string }[]>`
        SELECT id, question_index, correct_alternative
        FROM imported_questions
        WHERE year = ${year} AND (language IS NULL OR language = '')
      `
      const pool: OurQuestion[] = ourQuestions.map((q) => ({
        id: q.id,
        index: q.question_index,
        correctAlternative: q.correct_alternative,
      }))
      totalQuestions += pool.length

      const { assigned } = greedyMatch(itemsByAreaProva, pool)

      // Coleta (questão, a, b, c) na escala BRUTA do CSV, pra detectar a
      // métrica do ano antes de normalizar.
      const raw: Array<{ id: number; a: number; b: number; c: number }> = []
      let abandoned = 0
      let missingParams = 0
      for (const [idx, item] of assigned) {
        const q = pool.find((g) => g.index === idx)!
        if (item.IN_ITEM_ABAN === '1') {
          abandoned++
          continue
        }
        const a = parseParam(item.NU_PARAM_A)
        const b = parseParam(item.NU_PARAM_B)
        const c = parseParam(item.NU_PARAM_C)
        if (a === null || b === null || c === null || a <= 0) {
          missingParams++
          continue
        }
        raw.push({ id: q.id, a, b, c })
      }

      if (!raw.length) {
        console.log(`  ⚠️  Nenhum item casado com parâmetros válidos em ${year}.`)
        continue
      }

      // Detecção de escala do ano: b em N(0,1) fica tipicamente em [-4, 4];
      // na escala ENEM (500/100) fica na casa das centenas.
      const medianAbsB = median(raw.map((r) => Math.abs(r.b)))
      const enemScale = medianAbsB > 10
      console.log(`  Escala detectada pro parâmetro b: ${enemScale ? 'ENEM (500/100) — normalizando pra N(0,1)' : 'N(0,1) — sem conversão'} (mediana |b| = ${medianAbsB.toFixed(2)})`)

      const normalized = raw.map((r) => ({
        id: r.id,
        a: enemScale ? r.a * 100 : r.a,
        b: enemScale ? (r.b - 500) / 100 : r.b,
        c: r.c,
      }))

      if (APPLY) {
        for (const item of normalized) {
          await sql`
            UPDATE imported_questions
            SET tri_param_a = ${item.a}, tri_param_b = ${item.b}, tri_param_c = ${item.c},
                tri_param_source = 'inep_microdados'
            WHERE id = ${item.id}
          `
        }
      }

      totalWithParams += normalized.length
      console.log(`  ✅ ${normalized.length}/${pool.length} questões com parâmetros oficiais${APPLY ? ' gravados' : ' (dry-run)'} — ${abandoned} anulada(s), ${missingParams} sem parâmetro no CSV.`)
    }

    console.log('\n═══════════════════════════════════════════')
    console.log(`  Cobertura total: ${totalWithParams}/${totalQuestions} questões com calibração oficial.`)
    if (!APPLY) console.log('  Nada foi gravado (dry-run). Rode com APPLY=true pra gravar.')
    console.log('  Lembrete: rodar também em produção (mesma migration 0016 aplicada lá antes).')
    console.log('═══════════════════════════════════════════')
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('Falha na importação de parâmetros TRI:', err)
  process.exit(1)
})
