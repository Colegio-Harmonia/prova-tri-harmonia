import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// As rotas protegidas vivem em duas listas irmãs (matcher do middleware e
// PROTECTED_PATHS do auth.config). Em 18/11/2026 /recuperacao e /api/recovery
// foram publicadas fora das duas; este teste impede a divergência.
const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

function listBetween(source: string, start: RegExp) {
  const block = source.slice(source.search(start))
  return [...block.slice(0, block.indexOf(']')).matchAll(/'([^']+)'/g)].map((match) => match[1]!)
}

describe('rotas protegidas', () => {
  const matcher = listBetween(read('src/middleware.ts'), /matcher:\s*\[/).map((path) => path.replace(/\/:path\*$/, ''))
  const protectedPaths = listBetween(read('src/auth/auth.config.ts'), /PROTECTED_PATHS\s*=\s*\[/)

  it('middleware e auth.config listam as mesmas rotas', () => {
    expect([...matcher].sort()).toEqual([...protectedPaths].sort())
  })

  it('inclui a recuperação (tela e API)', () => {
    expect(protectedPaths).toEqual(expect.arrayContaining(['/recuperacao', '/api/recovery']))
  })
})
