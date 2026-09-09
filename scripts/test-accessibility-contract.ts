import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

function expectMatch(content: string, pattern: RegExp, message: string) {
  assert.match(content, pattern, message)
}

const globalCss = source('src/app/globals.css')
expectMatch(globalCss, /:focus-visible\s*\{[\s\S]*outline:/, 'O foco visível global deve permanecer definido.')
expectMatch(globalCss, /prefers-reduced-motion:\s*reduce/, 'A redução de movimento deve permanecer respeitada.')

const performance = source('src/app/(app)/desempenho/DesempenhoPanel.tsx')
expectMatch(performance, /<fieldset[\s\S]*<legend className="sr-only">Filtros de desempenho/, 'Os filtros de desempenho precisam ter grupo nomeado.')
expectMatch(performance, /aria-label="Disciplina"/, 'O filtro textual de disciplina precisa ter nome programático.')
expectMatch(performance, /<nav[\s\S]*aria-label="Visões de desempenho"/, 'As visões de desempenho precisam usar navegação semântica.')
expectMatch(performance, /aria-current=\{activeView === view \? 'page' : undefined\}/, 'A visão ativa precisa ser anunciada.')
expectMatch(performance, /role="status" aria-live="polite"/, 'O carregamento de desempenho precisa ser anunciado.')

const correction = source('src/app/(app)/gerar/[examId]/corrigir/CorrigirExam.tsx')
expectMatch(correction, /htmlFor="classroom-course"/, 'A turma do Classroom precisa ter rótulo associado.')
expectMatch(correction, /aria-expanded=\{isExpanded\}/, 'O cartão de correção precisa informar seu estado expandido.')
expectMatch(correction, /htmlFor=\{`transcribed-answer-\$\{correction\.id\}-\$\{q\.number\}`\}/, 'A resposta discursiva precisa ter rótulo associado.')

const aiProfiles = source('src/app/(app)/ia/AiModelProfilesPanel.tsx')
expectMatch(aiProfiles, /const selectId = `ai-model-\$\{section\.purpose\}`/, 'O seletor de modelo precisa ter ID estável.')
expectMatch(aiProfiles, /htmlFor=\{selectId\}/, 'O seletor de modelo precisa ter rótulo associado.')
expectMatch(aiProfiles, /aria-busy=\{saving !== null\}/, 'O painel de modelos precisa anunciar atualização em andamento.')

const status = source('src/app/(app)/status/StatusList.tsx')
expectMatch(status, /<caption className="sr-only">\{collectionLabel\[0\]\.toUpperCase\(\) \+ collectionLabel\.slice\(1\)\} encontradas no recorte selecionado<\/caption>/, 'A tabela de status precisa ter legenda acessível para as duas coleções.')
expectMatch(status, /<th scope="col"/, 'Os cabeçalhos da tabela de status precisam declarar escopo.')

const simulator = source('src/app/(app)/desempenho/simulado-enem/simulator-import.tsx')
expectMatch(simulator, /<label htmlFor="enem-simulator-file"/, 'O arquivo CSV precisa ter rótulo associado.')

console.log('accessibility contract tests passed')
