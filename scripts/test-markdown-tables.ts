import assert from 'node:assert/strict'
import { buildProvaOps } from '@/lib/docs/provaDocBuilder'
import { renderMarkdownTableToPng, splitMarkdownTables } from '@/lib/docs/markdownTableImageCache'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

async function run() {
  const supportText = `Observe os dados:
| País | Setor Primário | Setor Terciário |
| --- | --- | --- |
| Alemanha | 1,5% | 73,9% |
| Albânia | 41,8% | 46,8% |`

  const blocks = splitMarkdownTables(supportText)
  const table = blocks.find((block) => block.kind === 'table')
  assert.ok(table && table.kind === 'table', 'A tabela Markdown completa deve ser reconhecida.')
  assert.equal(table.table.header.length, 3)
  assert.equal(table.table.rows.length, 2)

  const dividerless = `País | Setor Primário | Setor Secundário | Setor Terciário
Alemanha | 1,5% | 24,6% | 73,9%
Polônia | 11,5% | 30,4% | 58,1%
Albânia | 41,8% | 11,4% | 46,8%`
  const dividerlessTable = splitMarkdownTables(dividerless).find((block) => block.kind === 'table')
  assert.ok(dividerlessTable && dividerlessTable.kind === 'table', 'Tabela sem divisor, mas com duas linhas de dados, deve ser reconhecida.')
  assert.equal(dividerlessTable.table.rows.length, 3)

  const rendered = await renderMarkdownTableToPng(table.table)
  assert.equal(rendered.png.subarray(1, 4).toString('ascii'), 'PNG', 'A tabela deve ser rasterizada em PNG.')
  assert.ok(rendered.width > 0 && rendered.height > 0, 'A imagem da tabela precisa ter dimensoes validas.')

  const exam = {
  metadata: { segment: 'anos-finais', gradeYear: 9, subject: 'Geografia', questionCount: 1, objectiveCount: 1, discursiveCount: 0, alternativesCount: 4 },
  questions: [{
    number: 1,
    type: 'objetiva',
    bloomLevel: 'analisar',
    statement: 'Com base na tabela, responda.',
    supportText,
    alternatives: [{ letter: 'A', text: 'Albânia.' }, { letter: 'B', text: 'Alemanha.' }, { letter: 'C', text: 'Polônia.' }, { letter: 'D', text: 'Itália.' }],
    correctLetter: 'A',
    bnccCodes: [],
    bnccStatus: 'nao_mapeado',
    pedagogicalClassification: { dok: { categoryCode: 'DOK_2', confidence: 0.8, justification: 'Compara dados.', evidence: 'tabela' }, soloExpected: { categoryCode: 'RELACIONAL', confidence: 0.8, justification: 'Relaciona setores.', evidence: 'dados' } },
    saeb: { applicable: false, source: null, value: null },
  }],
  } as ExamGenerationResult

  const ops = buildProvaOps(exam, new Map(), new Map([[table.table.raw, { driveFileId: 'table-file', widthPt: 420, heightPt: 180 }]]))
  assert.ok(ops.some((op) => op.kind === 'image' && op.driveFileId === 'table-file'), 'A tabela precisa virar uma imagem inline.')
  assert.ok(!ops.some((op) => op.kind === 'text' && op.text.includes('| País |')), 'O Markdown bruto nao pode chegar ao documento.')

  console.log('markdown table contract tests passed')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
