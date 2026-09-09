/**
 * Schema ENEM — Matriz de Referência e Classificação de Questões
 *
 * Define a estrutura da Matriz de Referência do ENEM (áreas, competências,
 * habilidades) e as colunas de classificação para as questões importadas.
 */

import { pgTable, serial, text, boolean, timestamp, integer, jsonb, smallint, varchar, uniqueIndex } from 'drizzle-orm/pg-core'

// ── Matriz de Referência ────────────────────────────────────────────

/** Áreas de conhecimento do ENEM */
export const enemAreas = pgTable('enem_areas', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 16 }).notNull().unique(),
  name: text('name').notNull(),
  order: smallint('order').notNull(),
})

/** Competências por área */
export const enemCompetencies = pgTable('enem_competencies', {
  id: serial('id').primaryKey(),
  areaId: integer('area_id').references(() => enemAreas.id).notNull(),
  number: smallint('number').notNull(), // 1-9
  description: text('description').notNull(),
})

/** Habilidades (H1-H30 por área) */
export const enemSkills = pgTable('enem_skills', {
  id: serial('id').primaryKey(),
  competencyId: integer('competency_id').references(() => enemCompetencies.id).notNull(),
  code: varchar('code', { length: 8 }).notNull(), // ex: "H1", "H5"
  description: text('description').notNull(),
})

/** Eixos Cognitivos comuns a todas as áreas */
export const enemCognitiveAxes = pgTable('enem_cognitive_axes', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 4 }).notNull().unique(), // DL, CF, SP, CA, EP
  name: text('name').notNull(),
  description: text('description').notNull(),
})

// ── Classificação das Questões Importadas ──────────────────────────

export const importedQuestions = pgTable('imported_questions', {
  id: serial('id').primaryKey(),
  source: varchar('source', { length: 16 }).notNull().default('enem'),
  year: smallint('year').notNull(),
  questionIndex: smallint('question_index').notNull(),
  discipline: varchar('discipline', { length: 64 }),
  language: varchar('language', { length: 32 }).default(''),
  title: text('title').notNull(),
  context: text('context'),
  files: jsonb('files').default([]),
  correctAlternative: varchar('correct_alternative', { length: 1 }).notNull(),
  alternativesIntroduction: text('alternatives_introduction'),
  alternatives: jsonb('alternatives').notNull(),
  rawJson: jsonb('raw_json'),

  // ── Classificação Bloom ──
  bloomLevel: varchar('bloom_level', { length: 16 }),
  bloomLevelSource: varchar('bloom_level_source', { length: 16 }).default('pending'), // 'ai', 'manual', 'pending'

  // ── Classificação ENEM ──
  enemAreaId: integer('enem_area_id').references(() => enemAreas.id),
  enemCompetencyId: integer('enem_competency_id').references(() => enemCompetencies.id),
  enemSkillId: integer('enem_skill_id').references(() => enemSkills.id),
  enemCognitiveAxisId: integer('enem_cognitive_axis_id').references(() => enemCognitiveAxes.id),
  enemClassificationSource: varchar('enem_classification_source', { length: 16 }).default('pending'),

  // Controle
  classifiedAt: timestamp('classified_at'),
  classifiedBy: integer('classified_by').references(() => { return { tableName: 'users', schema: 'public' } as any }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  uqQuestion: uniqueIndex('uq_imported_question').on(table.source, table.year, table.questionIndex, table.language),
}))
