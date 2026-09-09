/**
 * Smoke test da seleção de questões do reforço ENEM (Módulo 3) contra o
 * banco local: busca candidatas reais por habilidade e valida a
 * distribuição — sem chamar IA nenhuma (a resolução comentada é testada
 * só em produção de verdade, porque custa crédito DeepSeek).
 *
 * Rodar: npm run test:reinforcement (precisa do prova-tri-postgres up).
 * Se o banco local não tiver questões classificadas, o teste reporta e
 * sai com sucesso (SKIP) — não é falha, é ausência de massa de dados.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'

function loadDatabaseUrlFromLocalEnv() {
  if (process.env.DATABASE_URL) return
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('DATABASE_URL='))
  if (!line) return
  process.env.DATABASE_URL = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

async function main() {
  loadDatabaseUrlFromLocalEnv()
  const { db } = await import('../src/db/client')
  const { selectReinforcementQuestions } = await import('../src/lib/reinforcement/selectQuestions')

  // Acha uma área e 2 habilidades com questões elegíveis de verdade no
  // banco local, em vez de assumir códigos fixos.
  const rows = (await db.execute(sql`
    SELECT ea.code AS area, s.code AS skill, count(*)::int AS n
    FROM imported_questions q
    JOIN imported_question_classifications c ON c.question_id = q.id AND c.source = 'enem'
    JOIN enem_skills s ON s.id = c.enem_skill_id
    JOIN enem_competencies ec ON ec.id = s.competency_id
    JOIN enem_areas ea ON ea.id = ec.area_id
    WHERE (q.language IS NULL OR q.language = '')
      AND (q.files IS NULL OR q.files = '[]'::jsonb)
      AND q.context NOT LIKE '%![%'
    GROUP BY 1, 2
    HAVING count(*) >= 3
    ORDER BY 3 DESC
    LIMIT 2
  `)) as unknown as Array<{ area: string; skill: string; n: number }>

  if (rows.length < 2 || rows[0].area !== rows[1].area) {
    console.log('SKIP: banco local sem 2 habilidades da mesma área com 3+ questões elegíveis — nada a testar aqui.')
    process.exit(0)
  }

  const area = rows[0].area
  const skills = [rows[0].skill, rows[1].skill]
  console.log(`Testando com área ${area}, habilidades ${skills.join(', ')} (${rows[0].n}/${rows[1].n} candidatas)`)

  const result = await selectReinforcementQuestions({ area, skillCodes: skills, count: 6 })

  assert.equal(result.selected.length, 6, 'deve selecionar as 6 pedidas (banco tem 3+ por habilidade)')
  assert.ok(result.perSkill[skills[0]] >= 2 && result.perSkill[skills[1]] >= 2, 'distribuição equilibrada entre as 2 habilidades')
  const ids = result.selected.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length, 'sem questão repetida')
  assert.ok(result.selected.every((c) => skills.includes(c.skillCode)), 'só habilidades pedidas')
  console.log(`✓ seleção: ${JSON.stringify(result.perSkill)} — ${result.warnings.length} aviso(s)`)

  // Habilidade inexistente na área: sai com avisos e zero seleção dela.
  const missing = await selectReinforcementQuestions({ area, skillCodes: ['H99'], count: 5 })
  assert.equal(missing.selected.length, 0)
  assert.ok(missing.warnings.length > 0, 'habilidade sem questão gera aviso')
  console.log('✓ habilidade sem candidatas: 0 selecionadas + aviso (nunca inventa)')

  console.log('\nSmoke test do reforço: TUDO OK ✅')
  process.exit(0)
}

main().catch((err) => {
  console.error('Smoke test do reforço FALHOU:', err)
  process.exit(1)
})
