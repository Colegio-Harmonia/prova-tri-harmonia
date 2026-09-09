#!/usr/bin/env tsx
/**
 * Classifica questões do ENEM importadas.
 *
 * Fase 1: Bloom (inferência por verbos no enunciado)
 * Fase 2: Disciplina → Área ENEM (mapeamento direto)
 *
 * Uso:
 *   DATABASE_URL="..." tsx scripts/classify-questions.ts
 *
 * Flags:
 *   DRY_RUN=true   só mostra o que faria
 *   BLOOM_ONLY=true só classifica Bloom (não ENEM)
 */

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL não definida. Configure a variável de ambiente antes de rodar este script.')
}
const DRY_RUN = process.env.DRY_RUN === 'true'
const BLOOM_ONLY = process.env.BLOOM_ONLY === 'true'

// ── Bloom inference ─────────────────────────────────────────────────
// Re-implementação mínima do bloomVerbs.ts (evita import do projeto)
type BloomLevel = 'lembrar' | 'compreender' | 'aplicar' | 'analisar' | 'avaliar' | 'criar'

const BLOOM_VERBS: Record<BloomLevel, string[]> = {
  lembrar: ['identificar', 'listar', 'nomear', 'reconhecer', 'associar', 'definir'],
  compreender: ['explicar', 'descrever', 'compreender', 'interpretar', 'distinguir', 'exemplificar', 'classificar', 'inferir'],
  aplicar: ['aplicar', 'utilizar', 'executar', 'vivenciar', 'praticar', 'calcular', 'dimensionar', 'resolver'],
  analisar: ['comparar', 'diferenciar', 'analisar', 'relacionar', 'confrontar', 'organizar', 'examinar'],
  avaliar: ['avaliar', 'justificar', 'argumentar', 'criticar', 'julgar', 'defender'],
  criar: ['criar', 'elaborar', 'produzir', 'propor', 'planejar', 'construir', 'formular'],
}

const ATTITUDINAL_MARKERS = ['valorizar', 'respeitar', 'conviver', 'apreciar', 'cuidar', 'sensibilizar', 'acolher']

function inferBloom(text: string | null): { level: BloomLevel | null; source: string } {
  if (!text) return { level: null, source: 'pending' }
  const normalized = text.toLowerCase()

  // Check attitudinal first
  for (const marker of ATTITUDINAL_MARKERS) {
    if (normalized.includes(marker)) return { level: 'compreender', source: 'ai' }
  }

  // Find matching verbs, preferring longer matches
  const candidates: { level: BloomLevel; verb: string }[] = []
  for (const [level, verbs] of Object.entries(BLOOM_VERBS) as [BloomLevel, string[]][]) {
    for (const verb of verbs) {
      if (normalized.includes(verb)) candidates.push({ level, verb })
    }
  }

  if (!candidates.length) return { level: null, source: 'pending' }
  candidates.sort((a, b) => b.verb.length - a.verb.length)
  return { level: candidates[0].level, source: 'ai' }
}

// ── Discipline → ENEM Area mapping ──────────────────────────────────
const DISCIPLINE_AREA_MAP: Record<string, string> = {
  'linguagens': 'linguagens',
  'matematica': 'matematica',
  'ciencias-natureza': 'ciencias-natureza',
  'ciencias-humanas': 'ciencias-humanas',
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  🏷️  Classificador de Questões ENEM')
  console.log('═══════════════════════════════════════════')
  const maskedUrl = DATABASE_URL.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')
  console.log(`  DB:  ${maskedUrl}`)
  console.log(`  DRY: ${DRY_RUN ? 'Sim' : 'Não'}`)
  console.log(`  ${BLOOM_ONLY ? 'Só Bloom' : 'Bloom + ENEM'}`)
  console.log('═══════════════════════════════════════════\n')

  const sql = postgres(DATABASE_URL, { ssl: false, connect_timeout: 10 })

  try {
    // Load ENEM matrix refs
    const areas = await sql<{ id: number; code: string }[]>`SELECT id, code FROM enem_areas`
    const areaMap = Object.fromEntries(areas.map(a => [a.code, a.id]))
    console.log(`📚 ${areas.length} áreas carregadas.\n`)

    // Get unclassified questions
    const questions = await sql<{ id: number; year: number; index: number; discipline: string | null; context: string | null; alternatives_introduction: string | null }[]>`
      SELECT q.id, q.year, q.question_index AS "index", q.discipline, q.context, q.alternatives_introduction
      FROM imported_questions q
      LEFT JOIN imported_question_classifications c ON c.question_id = q.id AND c.source = 'enem'
      WHERE c.id IS NULL
      ORDER BY q.year, q.question_index
      LIMIT 3000
    `

    console.log(`📋 ${questions.length} questões para classificar.\n`)

    if (DRY_RUN) {
      for (const q of questions) {
        const textToAnalyze = [q.context, q.alternatives_introduction].filter(Boolean).join(' ')
        const { level } = inferBloom(textToAnalyze)
        const areaId = q.discipline ? areaMap[q.discipline] : null
        console.log(`  [DRY] Q${q.index}/${q.year} | disc=${q.discipline} | bloom=${level} | area=${q.discipline || '?'}`)
      }
      console.log(`\n  🏁 DRY RUN: ${questions.length} questões processadas (sem inserir).`)
      await sql.end()
      return
    }

    let classified = 0
    for (const q of questions) {
      const textToAnalyze = [q.context, q.alternatives_introduction].filter(Boolean).join(' ')
      const { level: bloomLevel, source: bloomSource } = inferBloom(textToAnalyze)
      const areaId = q.discipline ? areaMap[q.discipline] : null

      await sql`
        INSERT INTO imported_question_classifications
          (question_id, source, bloom_level, bloom_level_source,
           enem_area_id, enem_classification_source,
           classified_at)
        VALUES (
          ${q.id}, 'enem',
          ${bloomLevel}, ${bloomSource},
          ${areaId}, ${areaId ? 'ai' : 'pending'},
          NOW()
        )
        ON CONFLICT ON CONSTRAINT uq_classification DO UPDATE SET bloom_level = EXCLUDED.bloom_level, bloom_level_source = EXCLUDED.bloom_level_source, enem_area_id = EXCLUDED.enem_area_id, enem_classification_source = EXCLUDED.enem_classification_source, classified_at = NOW(), updated_at = NOW()
      `

      classified++
      if (classified % 100 === 0) {
        process.stdout.write(`  📊 ${classified}/${questions.length} classificadas...\r`)
      }
    }

    console.log(`  ✅ ${classified} questões classificadas.`)

    // Stats
    const stats = await sql`
      SELECT 
        COALESCE(bloom_level, 'pending') AS level, COUNT(*)::int AS count
      FROM imported_question_classifications
      GROUP BY level
      ORDER BY count DESC
    `
    console.log('\n📊 Bloom:')
    for (const s of stats) {
      console.log(`  ${s.level}: ${s.count}`)
    }

    const areaStats = await sql`
      SELECT COALESCE(a.code, 'sem_area') AS area, COUNT(*)::int AS count
      FROM imported_question_classifications c
      LEFT JOIN enem_areas a ON a.id = c.enem_area_id
      GROUP BY a.code
      ORDER BY count DESC
    `
    console.log('\n📊 Áreas ENEM:')
    for (const s of areaStats) {
      console.log(`  ${s.area}: ${s.count}`)
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`\n❌ Erro: ${msg}`)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

main()
