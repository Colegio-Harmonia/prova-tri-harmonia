import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/gerar/[examId]/adaptar/AdaptarExam.tsx'),
  'utf8',
)

assert.doesNotMatch(source, /bg-white|border-neutral-|text-neutral-/)
assert.doesNotMatch(source, /<fieldset|<legend/)
assert.match(source, /aria-labelledby="adaptation-profiles-heading"/)
assert.match(source, /bg-surface/)
assert.match(source, /text-content-primary/)

console.log('Adaptacao theme contract passed.')
