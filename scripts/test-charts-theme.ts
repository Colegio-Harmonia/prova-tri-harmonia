import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const recharts = source('src/app/(app)/dashboard/charts/RechartsBarChart.tsx')
const apex = source('src/app/(app)/dashboard/charts/ApexBarChart.tsx')
const curriculum = source('src/app/(app)/gerar/CurriculumPreview.tsx')

for (const [label, content] of [['RechartsBarChart', recharts], ['ApexBarChart', apex]] as const) {
  assert.doesNotMatch(content, /bg-white|border-neutral-|text-neutral-/, `${label} deve usar superficies e conteudo semanticos no tema escuro.`)
  assert.match(content, /bg-surface/, `${label} deve usar a superficie semantica.`)
  assert.match(content, /text-content-primary/, `${label} deve usar contraste semantico.`)
  assert.match(content, /var\(--color-/, `${label} deve derivar cores de graficos dos tokens.`)
}

assert.doesNotMatch(recharts, /#374151|rgb\(0 134 73/, 'Eixos e tooltip do Recharts nao devem ter cor fixa.')
assert.match(recharts, /backgroundColor: 'rgb\(var\(--color-surface-raised\)\)'/, 'O tooltip do Recharts deve seguir o tema.')
assert.match(apex, /useResolvedTheme/, 'O ApexCharts precisa resolver o tema em runtime.')
assert.match(apex, /tooltip: \{ theme \}/, 'O tooltip do ApexCharts deve seguir o tema resolvido.')

assert.doesNotMatch(curriculum, /#008B53|#CBD5E1/, 'O grafico de planejamento nao deve ter cor fixa.')
assert.match(curriculum, /rgb\(var\(--color-action-primary\)\)/, 'O grafico de planejamento deve usar a acao primaria do token.')
assert.doesNotMatch(curriculum, /from 'recharts'/, 'A matriz de /gerar nao deve voltar a carregar recharts (TD-016).')
assert.match(curriculum, /balanceChapterCounts/, 'A matriz deve oferecer a acao de equilibrar as questoes entre os capitulos.')
assert.match(curriculum, /evenQuestionCounts/, 'O equilibrio deve acontecer apenas pela acao explicita, nunca ao arrastar.')

console.log('charts theme contract passed')
