/**
 * Load 4o ano curriculum enrichment from JSON into PostgreSQL.
 * Run: npx tsx scripts/02_load_enrichment_4ano.ts
 */
import fs from "fs"
import path from "path"
import postgres from "postgres"

const connectionString = process.env.DATABASE_URL
if (!connectionString) { console.error("DATABASE_URL obrigatorio"); process.exit(1) }

const sql = postgres(connectionString)
const SEGMENT = "anos-iniciais"

interface EnrichmentEntry {
  grade: number
  subjects: string[]
  bimester: number
  chapter: string
  enriched_conteudo: string
  skills: string
  objectives: string
}

async function main() {
  const jsonPath = path.join(__dirname, "curriculum_enrichment_4ano.json")
  const entries: EnrichmentEntry[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"))
  console.log("Entries:", entries.length)

  let inserted = 0, updated = 0
  for (const entry of entries) {
    const chapterClean = entry.chapter.replace(/^\d+\.\s*/, "").trim()
    for (const subject of entry.subjects) {
      try {
        const existing = await sql`
          SELECT id FROM curriculum_enrichment 
          WHERE segment = ${SEGMENT} AND grade_year = ${entry.grade} 
            AND subject = ${subject} AND chapter_title = ${chapterClean}
            AND bimester = ${entry.bimester}
        `
        const payload = {
          segment: SEGMENT, grade_year: entry.grade, subject,
          chapter_title: chapterClean, bimester: entry.bimester,
          enriched_content: entry.enriched_conteudo.substring(0, 2000),
          detailed_objectives: entry.objectives.substring(0, 2000),
          pedagogical_notes: null, source: "programacao_trimestral",
        }
        if (existing.length > 0) {
          await sql`UPDATE curriculum_enrichment SET enriched_content = ${payload.enriched_content}, detailed_objectives = ${payload.detailed_objectives}, source = ${payload.source} WHERE id = ${existing[0].id}`
          updated++
        } else {
          await sql`INSERT INTO curriculum_enrichment ${sql(payload)}`
          inserted++
        }
      } catch (err) {
        console.error("Error:", err instanceof Error ? err.message : String(err))
      }
    }
  }
  console.log("Done! Inserted:", inserted, "Updated:", updated)
  await sql.end()
}
main().catch(console.error)
