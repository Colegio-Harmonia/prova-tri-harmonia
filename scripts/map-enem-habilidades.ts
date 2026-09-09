#!/usr/bin/env tsx
/**
 * Mapeia a habilidade oficial do INEP (H1-H30) para as questões do ENEM já
 * importadas em `imported_questions`, usando os microdados oficiais do INEP
 * (arquivo ITENS_PROVA_AAAA.csv, coluna CO_HABILIDADE).
 *
 * A API pública usada em import-enem.ts (api.enem.dev) não expõe habilidade
 * BNCC/ENEM por questão — só os microdados oficiais têm isso. Como não existe
 * um índice publicado ligando o "question_index" da API pública à posição
 * oficial (CO_POSICAO) dentro de um caderno específico (CO_PROVA), o
 * casamento é feito empiricamente: para cada disciplina/ano, tenta-se cada
 * caderno candidato da área, comparando o gabarito oficial (TX_GABARITO) na
 * mesma posição com o gabarito já salvo (correct_alternative). Um caderno
 * "bate" quando a maior parte das posições coincide — a chance de um
 * gabarito de A-E bater por acaso em dezenas de questões seguidas é
 * desprezível, então uma taxa alta é evidência forte do caderno certo.
 *
 * Sobra sempre um resíduo de questões não resolvidas (rotulagem de
 * disciplina errada na fonte, itens anulados, provas reaplicadas/PPL com
 * outra numeração). Esse resíduo NUNCA é adivinhado — fica sem
 * classificação oficial, disponível para complementar via IA depois se
 * quiser (ver classify-questions.ts), mas sempre marcado como tal.
 *
 * Uso:
 *   DATABASE_URL="..." tsx scripts/map-enem-habilidades.ts
 *
 * Flags:
 *   YEARS=2022,2023   restringe a esses anos (default: todos os anos já
 *                      presentes em imported_questions)
 *   DRY_RUN=true       só mostra a taxa de cobertura, não grava no banco
 *   CACHE_DIR=/path    onde baixar/reaproveitar os zips (default: ./enem-microdados-cache)
 */

import postgres from 'postgres'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL não definida. Configure a variável de ambiente antes de rodar este script.')
}
const DRY_RUN = process.env.DRY_RUN === 'true'
const CACHE_DIR = process.env.CACHE_DIR || './enem-microdados-cache'
const MIN_COVERED = 15 // amostra mínima pra um candidato ser considerado (evita ruído em pools pequenos)
const MIN_PRECISION = 0.85 // taxa mínima de acerto DENTRO do que o candidato cobre — não da pool inteira

const AREA_TO_DISC: Record<string, string> = {
  LC: 'linguagens',
  MT: 'matematica',
  CN: 'ciencias-natureza',
  CH: 'ciencias-humanas',
}

type ItemRow = {
  CO_POSICAO: string
  SG_AREA: string
  TX_GABARITO: string
  CO_HABILIDADE: string
  IN_ITEM_ABAN: string
  CO_PROVA: string
  TP_LINGUA: string
}

type OurQuestion = { id: number; index: number; discipline: string | null; correctAlternative: string }

function sh(cmd: string): string {
  return execSync(cmd, { maxBuffer: 1024 * 1024 * 200 }).toString()
}

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

    // ZIP de microdados é grande (~500MB-2GB) — mantemos só o CSV de itens (poucas centenas de KB).
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
    if (cols.length !== header.length) continue // linha malformada — pula em vez de travar o ano inteiro
    const row = {} as Record<string, string>
    header.forEach((h, idx) => (row[h] = cols[idx]))
    rows.push(row as unknown as ItemRow)
  }
  return rows
}

// 2016 e 2017 confirmaram, via busca exaustiva, que o "question_index" da
// fonte não bate na posição oficial (CO_POSICAO) com deslocamento zero —
// tem um offset fixo por área (achados: LC offset=+90, CH offset=-45,
// CN offset=-45/+90, MT offset=0/+135, variando por ano). Em vez de
// hard-codar isso, a busca testa uma faixa de offsets e aceita o que
// alcançar alta precisão — o mesmo princípio da busca por área/caderno,
// só que numa dimensão a mais. Nos outros 13 anos offset=0 já é o melhor
// caso, então isso não muda nada pra eles, só é mais lento.
const OFFSET_RANGE = Number(process.env.OFFSET_RANGE ?? 0) // 0 = só offset direto (rápido); ex. 200 = testa -200..200

/**
 * Casamento guloso, em rounds: acha o caderno (área+CO_PROVA) e o
 * deslocamento de posição que melhor explicam o pool de questões restante
 * DE TODO O ANO — não filtra pela disciplina que a fonte declarou, porque
 * anos como 2016 mostraram rótulos de disciplina errados/trocados na base
 * importada. A confiança vem da PRECISÃO dentro do que o candidato cobre
 * (posições onde ele tem item), não da fração da pool inteira — um
 * candidato certo cobre só uma área por vez (~40-50 de ~170 itens do ano),
 * então medir contra a pool toda derrubaria o próprio candidato certo.
 */
function greedyMatch(itemsByAreaProva: Map<string, ItemRow[]>, questions: OurQuestion[], minCovered = MIN_COVERED) {
  const remaining = new Map(questions.map((q) => [q.index, q]))
  const assigned = new Map<number, { item: ItemRow; matchedArea: string }>()
  const offsets = OFFSET_RANGE > 0 ? Array.from({ length: OFFSET_RANGE * 2 + 1 }, (_, i) => i - OFFSET_RANGE) : [0]

  while (remaining.size > 0) {
    let best: { hits: Map<number, ItemRow>; covered: number; area: string; prova: string; offset: number } | null = null

    for (const [key, items] of itemsByAreaProva) {
      const [area, prova] = key.split('::')
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
        if (!best || hits.size > best.hits.size) best = { hits, covered, area, prova, offset }
      }
    }

    if (!best) break

    for (const [idx, r] of best.hits) {
      assigned.set(idx, { item: r, matchedArea: best.area })
      remaining.delete(idx)
    }
  }

  return { assigned, unresolved: [...remaining.keys()] }
}

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  🎯 Mapeamento de Habilidades ENEM (microdados oficiais)')
  console.log('═══════════════════════════════════════════')
  console.log(`  DRY_RUN: ${DRY_RUN ? 'Sim' : 'Não'}`)
  console.log('═══════════════════════════════════════════\n')

  const sql = postgres(DATABASE_URL, { ssl: false, connect_timeout: 10 })

  try {
    const areas = await sql<{ id: number; code: string }[]>`SELECT id, code FROM enem_areas`
    const areaByCode = new Map(areas.map((a) => [a.code, a.id]))

    const skills = await sql<{ id: number; competency_id: number; code: string; area_code: string }[]>`
      SELECT es.id, es.competency_id, es.code, ea.code AS area_code
      FROM enem_skills es
      JOIN enem_competencies ec ON ec.id = es.competency_id
      JOIN enem_areas ea ON ea.id = ec.area_id
    `
    const skillByAreaCode = new Map(skills.map((s) => [`${s.area_code}::${s.code}`, s]))

    const yearsEnv = process.env.YEARS
    const years = yearsEnv
      ? yearsEnv.split(',').map((y) => parseInt(y.trim(), 10))
      : (await sql<{ year: number }[]>`SELECT DISTINCT year FROM imported_questions ORDER BY year`).map((r) => r.year)

    console.log(`📋 Anos a processar: ${years.join(', ')}\n`)

    let totalQuestions = 0
    let totalMapped = 0

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

      const ourQuestions = await sql<{ id: number; question_index: number; discipline: string | null; correct_alternative: string }[]>`
        SELECT id, question_index, discipline, correct_alternative
        FROM imported_questions
        WHERE year = ${year} AND (language IS NULL OR language = '')
      `

      const pool: OurQuestion[] = ourQuestions.map((q) => ({
        id: q.id,
        index: q.question_index,
        discipline: q.discipline,
        correctAlternative: q.correct_alternative,
      }))

      const { assigned, unresolved } = greedyMatch(itemsByAreaProva, pool)
      const updates: { id: number; skillId: number; competencyId: number; areaId: number }[] = []
      let mismatchedDiscipline = 0

      for (const [idx, { item, matchedArea }] of assigned) {
        const q = pool.find((g) => g.index === idx)!
        const matchedDiscipline = AREA_TO_DISC[matchedArea]
        const areaId = areaByCode.get(matchedDiscipline)
        const skillCode = `H${item.CO_HABILIDADE}`.trim()
        const skill = skillByAreaCode.get(`${matchedDiscipline}::${skillCode}`)
        if (!skill || !areaId || !item.CO_HABILIDADE) continue // item anulado (sem habilidade) ou código não reconhecido — não força
        if (q.discipline !== matchedDiscipline) mismatchedDiscipline++
        updates.push({ id: q.id, skillId: skill.id, competencyId: skill.competency_id, areaId })
      }

      const byDiscipline = new Map<string, { total: number; mapped: number }>()
      for (const q of pool) {
        const key = q.discipline ?? '(sem disciplina)'
        const entry = byDiscipline.get(key) ?? { total: 0, mapped: 0 }
        entry.total++
        if (assigned.has(q.index)) entry.mapped++
        byDiscipline.set(key, entry)
      }
      for (const [disc, { total, mapped }] of byDiscipline) {
        console.log(`  ${disc}: ${mapped}/${total} mapeadas`)
      }
      if (mismatchedDiscipline > 0) {
        console.log(`  ⚠️  ${mismatchedDiscipline} questões tinham "discipline" divergente da área oficial casada (rótulo da fonte parece errado nesse ano) — classificadas pela área correta mesmo assim.`)
      }
      if (unresolved.length) {
        console.log(`  ${unresolved.length} não resolvidas: índices ${unresolved.slice(0, 15).join(',')}${unresolved.length > 15 ? '…' : ''}`)
      }

      totalQuestions += ourQuestions.length
      totalMapped += assigned.size

      // ── Variantes em espanhol ────────────────────────────────────
      // Ocupam a MESMA posição (1-5) que a variante em inglês dentro do
      // caderno de Linguagens — só dá pra diferenciar pelo TP_LINGUA do
      // arquivo oficial (1 = espanhol). Índice separado, filtrado só pra
      // essas linhas, pra não confundir com o pool principal.
      const ourEspanhol = await sql<{ id: number; question_index: number; correct_alternative: string }[]>`
        SELECT id, question_index, correct_alternative
        FROM imported_questions
        WHERE year = ${year} AND language = 'espanhol'
      `
      if (ourEspanhol.length) {
        const espanholPool: OurQuestion[] = ourEspanhol.map((q) => ({
          id: q.id,
          index: q.question_index,
          discipline: 'linguagens',
          correctAlternative: q.correct_alternative,
        }))
        const itemsByAreaProvaEspanhol = new Map<string, ItemRow[]>()
        for (const [key, items] of itemsByAreaProva) {
          if (!key.startsWith('LC::')) continue
          const filtered = items.filter((r) => r.TP_LINGUA === '1')
          if (filtered.length) itemsByAreaProvaEspanhol.set(key, filtered)
        }
        // pool de espanhol é sempre pequena (~5/ano) — MIN_COVERED=15 nunca
        // bateria; 3 já é seguro o bastante (chance de 3 gabaritos A-E
        // baterem por acaso é ~0,8%) mantendo MIN_PRECISION alto.
        const { assigned: assignedEsp, unresolved: unresolvedEsp } = greedyMatch(itemsByAreaProvaEspanhol, espanholPool, 3)
        const areaId = areaByCode.get('linguagens')
        for (const [idx, { item }] of assignedEsp) {
          const q = espanholPool.find((g) => g.index === idx)!
          const skillCode = `H${item.CO_HABILIDADE}`.trim()
          const skill = skillByAreaCode.get(`linguagens::${skillCode}`)
          if (!skill || !areaId || !item.CO_HABILIDADE) continue
          updates.push({ id: q.id, skillId: skill.id, competencyId: skill.competency_id, areaId })
        }
        console.log(`  linguagens/espanhol: ${assignedEsp.size}/${espanholPool.length} mapeadas${unresolvedEsp.length ? ` (${unresolvedEsp.length} não resolvidas)` : ''}`)
        totalQuestions += ourEspanhol.length
        totalMapped += assignedEsp.size
      }

      if (!DRY_RUN && updates.length) {
        for (const u of updates) {
          await sql`
            INSERT INTO imported_question_classifications
              (question_id, source, enem_area_id, enem_competency_id, enem_skill_id, enem_classification_source, classified_at)
            VALUES (${u.id}, 'enem', ${u.areaId}, ${u.competencyId}, ${u.skillId}, 'oficial', NOW())
            ON CONFLICT ON CONSTRAINT uq_classification DO UPDATE SET
              enem_area_id = EXCLUDED.enem_area_id,
              enem_competency_id = EXCLUDED.enem_competency_id,
              enem_skill_id = EXCLUDED.enem_skill_id,
              enem_classification_source = 'oficial',
              classified_at = NOW(),
              updated_at = NOW()
          `
        }
        console.log(`  💾 ${updates.length} classificações oficiais gravadas.`)
      }
    }

    console.log('\n═══════════════════════════════════════════')
    console.log(`  📊 Total: ${totalMapped}/${totalQuestions} questões mapeadas com habilidade oficial (${((totalMapped / totalQuestions) * 100).toFixed(1)}%)`)
    if (DRY_RUN) console.log('  ⚠️  DRY_RUN — nada foi gravado.')
    console.log('═══════════════════════════════════════════')
  } finally {
    await sql.end()
  }
}

main()
