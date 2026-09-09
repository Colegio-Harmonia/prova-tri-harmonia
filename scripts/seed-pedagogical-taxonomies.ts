/**
 * Idempotent seed for the initial Pedagogical Classification Engine catalog.
 *
 * Run after migration 0007. It upserts taxonomies and categories from
 * PEDAGOGICAL_CLASSIFICATION.md v1.0 without creating duplicates.
 */
import fs from 'node:fs'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import {
  pedagogicalCategories,
  pedagogicalTaxonomies,
} from '../src/db/schema'
import { PEDAGOGICAL_TAXONOMY_CATALOG } from '../src/lib/pedagogical/catalog'

function loadDatabaseUrlFromLocalEnv() {
  if (process.env.DATABASE_URL) return

  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return

  const databaseUrlLine = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('DATABASE_URL='))

  if (!databaseUrlLine) return

  const value = databaseUrlLine.slice(databaseUrlLine.indexOf('=') + 1).trim()
  process.env.DATABASE_URL = value.replace(/^['"]|['"]$/g, '')
}

async function upsertTaxonomy(taxonomy: (typeof PEDAGOGICAL_TAXONOMY_CATALOG)[number]) {
  const [row] = await db
    .insert(pedagogicalTaxonomies)
    .values({
      code: taxonomy.code,
      name: taxonomy.name,
      description: taxonomy.description,
      manualVersion: taxonomy.manualVersion,
      isActive: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: pedagogicalTaxonomies.code,
      set: {
        name: taxonomy.name,
        description: taxonomy.description,
        manualVersion: taxonomy.manualVersion,
        isActive: true,
        updatedAt: new Date(),
      },
    })
    .returning({ id: pedagogicalTaxonomies.id })

  if (!row) {
    throw new Error(`Falha ao criar/atualizar taxonomia ${taxonomy.code}`)
  }

  return row.id
}

async function upsertCategory(
  taxonomyId: number,
  category: (typeof PEDAGOGICAL_TAXONOMY_CATALOG)[number]['categories'][number],
) {
  await db
    .insert(pedagogicalCategories)
    .values({
      taxonomyId,
      code: category.code,
      name: category.name,
      description: category.description,
      order: category.order,
      metadata: category.metadata,
      isActive: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [pedagogicalCategories.taxonomyId, pedagogicalCategories.code],
      set: {
        name: category.name,
        description: category.description,
        order: category.order,
        metadata: category.metadata,
        isActive: true,
        updatedAt: new Date(),
      },
    })
}

async function main() {
  loadDatabaseUrlFromLocalEnv()

  for (const taxonomy of PEDAGOGICAL_TAXONOMY_CATALOG) {
    const taxonomyId = await upsertTaxonomy(taxonomy)

    for (const category of taxonomy.categories) {
      await upsertCategory(taxonomyId, category)
    }

    const categories = await db.query.pedagogicalCategories.findMany({
      where: and(
        eq(pedagogicalCategories.taxonomyId, taxonomyId),
        eq(pedagogicalCategories.isActive, true),
      ),
      orderBy: (table, { asc }) => [asc(table.order)],
    })

    console.log(`${taxonomy.code}: ${categories.length} categorias ativas`)
  }

  console.log('Catalogo pedagogico inicial sincronizado.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
