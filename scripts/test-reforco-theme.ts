import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/app/(app)/reforco/ReforcoForm.tsx'), 'utf8')

assert.doesNotMatch(source, /bg-white|border-neutral-|text-neutral-/, 'Reforço ENEM deve usar tokens semânticos, inclusive no tema escuro.')
assert.doesNotMatch(source, /<fieldset|<legend/, 'Seções de Reforço não devem usar legendas sobrepostas à borda.')
assert.match(source, /bg-surface/, 'Cartões de Reforço devem usar a superfície semântica.')
assert.match(source, /text-content-primary/, 'Texto de Reforço deve usar contraste semântico.')
assert.match(source, /aria-labelledby="enem-skills-heading"/, 'A seleção de habilidades precisa manter um título programático.')

console.log('Reinforcement theme contract passed.')
