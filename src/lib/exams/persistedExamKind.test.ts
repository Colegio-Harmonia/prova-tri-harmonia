import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Regressão do teste de 18/11/2026: o motor whole-exam tinha um insert próprio
// que gravava a prova de recuperação como 'atividade'. Todo insert de
// generated_exams em generateExamCore precisa passar por persistedExamKind.
const source = readFileSync(join(process.cwd(), 'src/lib/exams/generateExamCore.ts'), 'utf8')

describe('exam_kind gravado pela geração', () => {
  it('todo insert de generated_exams usa persistedExamKind', () => {
    const inserts = source.match(/\.insert\(generatedExams\)/g) ?? []
    const uses = source.match(/examKind: persistedExamKind\(/g) ?? []
    expect(inserts.length).toBeGreaterThan(0)
    expect(uses.length).toBe(inserts.length)
  })

  it('recuperação só troca o tipo quando a geração é de atividade', async () => {
    const { persistedExamKind } = await import('./generateExamCore')
    expect(persistedExamKind('atividade', 'recuperacao')).toBe('recuperacao')
    expect(persistedExamKind('atividade')).toBe('atividade')
    expect(persistedExamKind('prova', 'recuperacao')).toBe('prova')
  })
})
