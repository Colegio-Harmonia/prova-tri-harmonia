import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ManualExamBuilder from './ManualExamBuilder'
import { examQuestionSchema, type ExamGenerationResult } from '@/lib/gemini/examSchema'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))

let dom: JSDOM
let root: Root
let host: HTMLElement
let reads: Array<{ id: number; resolve: (response: Response) => void }>
const initial: ExamGenerationResult = { metadata: { creationMode: 'manual', segment: 'ensino-medio', gradeYear: 1, academicYear: 2026, bimester: 3, subject: 'Artes', questionCount: 0, objectiveCount: 0, discursiveCount: 0, alternativesCount: 0 }, questions: [] }
function exam(ids: number[]): ExamGenerationResult {
  return { ...initial, metadata: { ...initial.metadata, questionCount: ids.length }, questions: ids.map((id, i) => examQuestionSchema.parse({ number: i + 1, source: 'acervo', type: 'objetiva', statement: `Questão ${id}`, bloomLevel: 'analisar', bnccCodes: [], bnccStatus: 'nao_mapeado', acervoRef: { questionId: id, origin: 'ARCO', externalId: String(id), portalUrl: null, importedAt: '', original: { origem: { banca: 'FUVEST', ano: 2024, criacao: 'STUDOS', acervo: 'ARCO', plataforma: 'sae' } } }, pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 0, justification: '', evidence: '' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 0, justification: '', evidence: '' } }, bloomAssessment: { status: 'classified', source: 'provider', model: 'jev', confidence: 1, classifiedAt: '' }, inepAssessment: { status: 'not_applicable', version: 'v2', matrix: null, source: 'fallback', model: 'jev', confidence: null, classifiedAt: '', area: null, competency: null, skill: null, approximate: false, referenceGrade: null } })) }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
function button(label: string) { return [...host.querySelectorAll('button')].find((button) => button.textContent === label)! }
async function select(frame: HTMLIFrameElement, id: number, origin = 'null') {
  await act(async () => { window.dispatchEvent(new dom.window.MessageEvent('message', { source: frame.contentWindow, origin, data: { type: 'acervo:select', questionId: id } })); await flush() })
}
beforeEach(() => {
  reads = []
  dom = new JSDOM('<div id="root"></div>', { url: 'https://prova.test' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('navigator', dom.window.navigator)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  host = document.getElementById('root')!
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('importação contínua no editor manual', () => {
  it.each([false, true])('mantém o banco aberto e enfileira cliques sem duplicar ou perder respostas (nativo=%s)', async (native) => {
    vi.stubGlobal('fetch', vi.fn((url: string, options?: RequestInit) => {
      if (url.startsWith('/api/exams/manual/browser')) return Promise.resolve(new Response(JSON.stringify(native ? { url: 'https://questoes.colegioharmonia.com.br/?selecionar=1' } : { html: '<p>Banco</p>' })))
      const body = JSON.parse(String(options?.body))
      return new Promise<Response>((resolve) => reads.push({ id: body.questionId, resolve }))
    }))
    await act(async () => { root.render(<ManualExamBuilder examId={571} initialExam={initial} planningGuide={{ plans: [{ id: 1, bimester: 3, units: [{ id: 1, title: 'Arte e cultura', content: 'Conteúdo visível', objectives: 'Analisar a cultura', skills: [] }] }] }} />); await flush() })
    expect(host.querySelector('aside details')?.hasAttribute('open')).toBe(true)
    await act(async () => { button('Buscar no banco de questões').click(); await flush() })
    const frame = host.querySelector('iframe')!
    const origin = native ? 'https://questoes.colegioharmonia.com.br' : 'null'
    await select(frame, 11, origin); await select(frame, 22, origin); await select(frame, 11, origin)
    expect(reads.map((read) => read.id)).toEqual([11])
    expect(host.querySelector('dialog')?.hasAttribute('open')).toBe(true)
    expect(host.querySelector('iframe')).toBe(frame)
    expect(host.querySelector('dialog')?.textContent).toContain('2 na fila')
    await act(async () => { reads[0].resolve(new Response(JSON.stringify({ exam: exam([11]) }))); await flush() })
    expect(reads.map((read) => read.id)).toEqual([11, 22])
    await act(async () => { reads[1].resolve(new Response(JSON.stringify({ exam: exam([11, 22]) }))); await flush() })
    expect(host.querySelector('iframe')).toBe(frame)
    expect(host.querySelector('dialog')?.textContent).toContain('2/30 questões adicionadas')
    expect(host.textContent).toContain('Banca: FUVEST — 2024')
    expect(host.textContent).toContain('Origem: STUDOS')
    expect(host.textContent).toContain('Acervo: ARCO')
  })
  it('continua a próxima importação após uma falha e permite tentar de novo', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, options?: RequestInit) => url.startsWith('/api/exams/manual/browser')
      ? Promise.resolve(new Response(JSON.stringify({ html: '<p>Banco</p>' })))
      : new Promise<Response>((resolve) => reads.push({ id: JSON.parse(String(options?.body)).questionId, resolve }))))
    await act(async () => { root.render(<ManualExamBuilder examId={571} initialExam={initial} />); await flush() })
    await act(async () => { button('Buscar no banco de questões').click(); await flush() })
    const frame = host.querySelector('iframe')!
    await select(frame, 11); await select(frame, 22)
    await act(async () => { reads[0].resolve(new Response(JSON.stringify({ error: 'Falha temporária.' }), { status: 502 })); await flush() })
    expect(reads.map((read) => read.id)).toEqual([11, 22])
    await act(async () => { reads[1].resolve(new Response(JSON.stringify({ exam: exam([22]) }))); await flush() })
    expect(host.querySelector('dialog')?.textContent).toContain('1/30 questões adicionadas')
    expect(host.querySelector('dialog [role="alert"]')?.textContent).toContain('1 importação(ões) não concluída(s)')
    await select(frame, 11)
    expect(reads.map((read) => read.id)).toEqual([11, 22, 11])
    await act(async () => { reads[2].resolve(new Response(JSON.stringify({ exam: exam([22, 11]) }))); await flush() })
    expect(host.querySelector('dialog [role="alert"]')).toBeNull()
  })
})
