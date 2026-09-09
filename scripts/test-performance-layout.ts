import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const panelPath = resolve(process.cwd(), 'src/app/(app)/desempenho/DesempenhoPanel.tsx')
const panel = readFileSync(panelPath, 'utf8')

assert.match(
  panel,
  /<section id=\{`performance-view-\$\{activeView\}`\}[\s\S]*?className="space-y-6">/,
  'Todas as visões de desempenho devem manter espaçamento vertical entre blocos.',
)

console.log('Performance dashboard spacing contract passed.')
