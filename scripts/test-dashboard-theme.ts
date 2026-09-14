import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const files: Array<[string, string]> = [
  ['EnemDashboard', 'src/app/(app)/dashboard/EnemDashboard.tsx'],
  ['ProfessorHome', 'src/app/(app)/dashboard/ProfessorHome.tsx'],
  ['DashboardStats', 'src/app/(app)/dashboard/DashboardStats.tsx'],
  ['Tabs', 'src/app/(app)/dashboard/Tabs.tsx'],
  ['dashboard/page', 'src/app/(app)/dashboard/page.tsx'],
]

for (const [label, path] of files) {
  const content = source(path)
  assert.doesNotMatch(content, /bg-white|border-neutral-|text-neutral-/, `${label} deve usar superficies e conteudo semanticos no tema escuro.`)
  assert.doesNotMatch(content, /bg-(amber|red|emerald|sky|blue|teal)-\d|text-(amber|red|emerald|sky|blue|teal)-\d|border-(amber|red|sky)-\d/, `${label} deve usar tokens de status em vez de tints literais.`)
}

const enem = source('src/app/(app)/dashboard/EnemDashboard.tsx')
assert.match(enem, /bg-surface/, 'Cartoes do EnemDashboard devem usar a superficie semantica.')
assert.match(enem, /text-content-primary/, 'Texto do EnemDashboard deve usar contraste semantico.')

const home = source('src/app/(app)/dashboard/ProfessorHome.tsx')
assert.match(home, /text-content-primary/, 'ProfessorHome deve usar contraste semantico.')
assert.match(home, /bg-status-warning-surface/, 'ProfessorHome deve usar tokens de status nas etapas.')

console.log('dashboard theme contract passed')
