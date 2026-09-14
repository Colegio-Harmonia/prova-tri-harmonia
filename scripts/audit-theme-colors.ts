import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = join(process.cwd(), 'src', 'app')
const HARDCODED = /(?:bg|text|border)-(?:white|black|neutral-\d+|red-\d+|amber-\d+|emerald-\d+|sky-\d+|blue-\d+|teal-\d+|green-\d+|slate-\d+|zinc-\d+)/

// Arquivos ainda pendentes da migracao de tema (Fases D-F). A catraca so
// encolhe: ao migrar uma tela, remova o caminho daqui — se ela voltar a usar
// cor fixa, o contrato da tela ou este auditor falham.
const pending = new Set<string>([
  'src/app/(app)/arquivadas/page.tsx',
  'src/app/(app)/desempenho/page.tsx',
  'src/app/(app)/desempenho/relatorio/student-report.tsx',
  'src/app/(app)/desempenho/simulado-enem/enem-sae-import.tsx',
  'src/app/(app)/desempenho/simulado-enem/simulator-import.tsx',
  'src/app/(app)/gerar/CurriculumPreview.tsx',
  'src/app/(app)/gerar/[examId]/corrigir/CorrigirExam.tsx',
  'src/app/(app)/gerar/[examId]/corrigir/ScanAttentionModal.tsx',
  'src/app/(app)/gerar/[examId]/corrigir/scans/[correctionId]/scanCorrectionReview.tsx',
  'src/app/(app)/gerar/[examId]/corrigir/scans/scanReviewQueue.tsx',
  'src/app/(app)/gerar/[examId]/revisar/ActivityClassroomResults.tsx',
  'src/app/(app)/gerar/[examId]/revisar/PublishToClassroom.tsx',
  'src/app/(app)/gerar/[examId]/revisar/RevisarExam.tsx',
  'src/app/(app)/gerar/[examId]/revisar/SheetAssignmentsPanel.tsx',
  'src/app/(app)/ia/AiModelProfilesPanel.tsx',
  'src/app/(app)/ia/AiOperationsPanel.tsx',
  'src/app/(app)/status/page.tsx',
  'src/app/(app)/status/QueueList.tsx',
  'src/app/(app)/status/StatusList.tsx',
  'src/app/(app)/turmas/[courseId]/TurmaDetail.tsx',
  'src/app/(app)/turmas/MinhasTurmas.tsx',
  'src/app/(app)/turmas/page.tsx',
  'src/app/(app)/usuarios/page.tsx',
  'src/app/(app)/usuarios/UsuariosList.tsx',
  'src/app/login/page.tsx',
])

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : []
  })
}

const offenders = walk(ROOT)
  .filter((file) => HARDCODED.test(readFileSync(file, 'utf8')))
  .map((file) => relative(process.cwd(), file).split(sep).join('/'))
  .sort()

const unexpected = offenders.filter((file) => !pending.has(file))
assert.deepEqual(unexpected, [], `Arquivos fora da lista de migracao usam cores fixas:\n${unexpected.join('\n')}`)

console.log(`theme color audit passed (${pending.size} arquivos pendentes; ${offenders.length} ainda com cores fixas)`)
