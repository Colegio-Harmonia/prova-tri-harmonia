/**
 * Roda a análise determinística do Assistente de Planejamento sobre um CSV
 * exportado de UMA aba da planilha (Arquivo → Fazer download → CSV), sem
 * banco, sem credencial do Google e sem IA. Serve para conferir o que o
 * assistente aponta antes de olhar a tela.
 *
 *   npx tsx scripts/planning-advisor-csv.ts <arquivo.csv> <segmento> <série> "<disciplina>"
 *   npx tsx scripts/planning-advisor-csv.ts soc.csv ensino-medio 1 "Sociologia"
 */
import { readFileSync } from 'node:fs'
import { resolveColumnRoles } from '../src/lib/sheets/headerResolver'
import { parseCurriculumRows } from '../src/lib/sheets/rowParser'
import { analyzePlanning } from '../src/lib/planningAdvisor/analyzePlanning'
import type { CurriculumSelection, Segment } from '../src/types/exam'

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const [file, segment, grade, subject] = process.argv.slice(2)
if (!file || !segment || !grade || !subject) {
  console.error('Uso: npx tsx scripts/planning-advisor-csv.ts <arquivo.csv> <anos-iniciais|anos-finais|ensino-medio> <série> "<disciplina>"')
  process.exit(1)
}

const [header, ...rows] = parseCsv(readFileSync(file, 'utf8'))
const units = parseCurriculumRows(rows, resolveColumnRoles(header), segment as Segment, subject)
const selection: CurriculumSelection = { segment: segment as Segment, gradeYear: Number(grade), subject, tabName: file, units, unmappedWarnings: [] }
const analysis = analyzePlanning(selection)

console.log(`\n${analysis.subject} · ${analysis.gradeYear}º ano · ${analysis.chapters.length} capítulos · análise ${analysis.framework === 'enem' ? 'pela Matriz do ENEM' : 'BNCC × Bloom'}`)
console.log('\nRECOMENDAÇÕES')
for (const finding of analysis.findings) console.log(`  [${finding.severity}] ${finding.title}\n      ${finding.detail}`)
if (analysis.enem) {
  console.log(`\nCOBERTURA ENEM — ${analysis.enem.scope.areaLabel}: ${analysis.enem.coveredCount}/${analysis.enem.rows.length}`)
  console.log(`  Sem cobertura: ${analysis.enem.rows.filter((row) => !row.covered).map((row) => row.code).join(', ') || '—'}`)
}
console.log('\nCAPÍTULOS')
for (const chapter of analysis.chapters) {
  console.log(`  ${chapter.bimestre ?? '-'} | ${chapter.title} | ENEM: ${chapter.enemSkills.map((skill) => skill.code).join(', ') || '—'} | BNCC: ${chapter.bnccCodes.join(', ') || '—'}`)
  for (const issue of chapter.issues.filter((item) => item.severity !== 'info')) console.log(`      [${issue.severity}] ${issue.message}`)
}
console.log(`\n${analysis.saeb.note}`)
