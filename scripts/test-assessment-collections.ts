import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

function mustInclude(path: string, expected: string) {
  assert.ok(source(path).includes(expected), `${path} deve conter ${expected}`)
}

function mustExclude(path: string, unexpected: string) {
  assert.ok(!source(path).includes(unexpected), `${path} não deve conter ${unexpected}`)
}

// Contratos de separação: Atividades FI/FII usam a infraestrutura de
// avaliação, mas ficam fora de Provas, Reforço ENEM e dos indicadores
// institucionais formais.
mustInclude('src/app/api/exams/route.ts', 'eq(generatedExams.examKind, examKind as')
mustInclude('src/app/api/exams/filters/route.ts', 'eq(generatedExams.examKind, examKind as')
mustInclude('src/app/api/generation-jobs/route.ts', "params.get('jobTypes')")
mustInclude('src/app/api/analytics/performance/route.ts', "eq(generatedExams.examKind, 'prova')")
mustInclude('src/app/(app)/atividades/page.tsx', 'AtividadesTabs')
mustInclude('src/app/(app)/atividades/AtividadesTabs.tsx', 'examKind="atividade"')
mustInclude('src/app/(app)/atividades/AtividadesTabs.tsx', "singleView={activeTab === 'fila' ? 'queue' : 'list'}")
mustInclude('src/app/(app)/status/StatusTabs.tsx', "singleView?: 'list' | 'queue'")
mustInclude('src/app/(app)/atividades/AtividadeForm.tsx', "fetch('/api/activities'")
mustInclude('src/app/api/activities/route.ts', 'gerarAtividadeJobPayloadSchema')
mustInclude('src/lib/queue/handlers.ts', "case 'gerar_atividade'")
mustInclude('src/db/schema.ts', "'atividade'")
mustInclude('src/app/(app)/reforco/ReforcoTabs.tsx', 'examKind="reforco_enem"')
mustInclude('src/app/(app)/status/StatusTabs.tsx', "'Reforços ENEM'")
mustInclude('src/app/(app)/reforco/ReforcoForm.tsx', 'href="/reforco?modo=acompanhar&aba=fila"')
mustInclude('src/components/queue/GenerationJobsProvider.tsx', "'/reforco?modo=acompanhar&aba=fila'")
mustInclude('src/components/layout/AppNavigation.tsx', "href: '/atividades'")
mustInclude('src/app/(app)/turmas/[courseId]/TurmaDetail.tsx', "fetch('/api/exams?examKind=prova')")
mustInclude('src/middleware.ts', "'/atividades/:path*'")
mustInclude('src/auth/auth.config.ts', "'/atividades'")

console.log('Assessment collection contracts passed.')
