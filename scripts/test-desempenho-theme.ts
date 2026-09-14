import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/app/(app)/desempenho/DesempenhoPanel.tsx'), 'utf8')

assert.doesNotMatch(source, /bg-white|border-neutral-|text-neutral-/, 'Desempenho deve usar superficies e conteudo semanticos no tema escuro.')
assert.doesNotMatch(source, /bg-(amber|red|emerald|sky|blue|teal)-\d|text-(amber|red|emerald|sky|blue|teal)-\d|border-(amber|red|sky)-\d/, 'Faixas e alertas de desempenho devem usar tokens de status.')
assert.match(source, /bg-surface/, 'Cartoes de desempenho devem usar a superficie semantica.')
assert.match(source, /text-content-primary/, 'Texto de desempenho deve usar contraste semantico.')
assert.match(source, /bg-status-warning-surface/, 'Amostra insuficiente deve usar o token de atencao suave.')
assert.match(source, /bg-status-success-surface/, 'Destaque favoravel deve usar o token de sucesso suave.')

console.log('desempenho theme contract passed')
