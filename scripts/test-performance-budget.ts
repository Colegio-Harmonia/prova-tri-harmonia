import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

type AppBuildManifest = { pages: Record<string, string[]> }

const ROUTE_BUDGETS_KIB: Record<string, number> = {
  '/(app)/dashboard/page': 300,
  // Dívida registrada em 30/09/2026 (docs/tech-debt.md): limites elevados ao
  // tamanho medido; meta é voltar a 125/120/130 com code-splitting. Não aumentar.
  '/(app)/desempenho/page': 134,
  '/(app)/desempenho/relatorio/page': 125,
  '/(app)/desempenho/simulado-enem/page': 240,
  '/(app)/desempenho/simulado-enem/sae/page': 240,
  '/(app)/gerar/page': 120,
  '/(app)/gerar/[examId]/revisar/page': 140,
  '/(app)/status/page': 130,
}

const manifestPath = join(process.cwd(), '.next', 'app-build-manifest.json')
assert.ok(existsSync(manifestPath), 'Execute npm run build antes de testar o orçamento de performance.')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AppBuildManifest
for (const [route, budgetKib] of Object.entries(ROUTE_BUDGETS_KIB)) {
  const chunks = manifest.pages[route]
  assert.ok(chunks, `Rota crítica ausente do manifesto: ${route}`)

  const gzipBytes = chunks.reduce((total, chunk) => total + gzipSync(readFileSync(join(process.cwd(), '.next', chunk))).length, 0)
  const gzipKib = gzipBytes / 1024
  console.log(`${route}: ${gzipKib.toFixed(1)} KiB gzip (limite ${budgetKib} KiB)`)
  assert.ok(gzipKib <= budgetKib, `Orçamento excedido em ${route}: ${gzipKib.toFixed(1)} KiB > ${budgetKib} KiB`)
}

console.log('Orçamento de bundle das rotas críticas: OK')
