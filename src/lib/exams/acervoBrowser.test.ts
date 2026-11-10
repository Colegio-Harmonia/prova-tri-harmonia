import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { acervoBrowserDocument, acervoBrowserPath, acervoBrowserSubject } from './acervoBrowser'

describe('janela incorporada do banco', () => {
  it('usa os nomes das disciplinas do catálogo externo', () => {
    expect(acervoBrowserSubject('Artes')).toBe('Arte')
    expect(acervoBrowserSubject('Inglês')).toBe('Língua Inglesa')
    expect(acervoBrowserSubject('Português')).toBe('Língua Portuguesa')
    expect(acervoBrowserSubject('Matemática')).toBe('Matemática')
  })
  it('permite somente leitura de caminhos conhecidos no banco', () => {
    expect(acervoBrowserPath('/api/painel/questions?disciplina=Filosofia')).toBe('/api/painel/questions?disciplina=Filosofia')
    expect(acervoBrowserPath('/api/painel/questions/1000000343841')).toBe('/api/painel/questions/1000000343841')
    for (const path of ['https://example.com', '//evil.test/api/painel/stats', '/api/exams/1', '/api/painel/questions/../admin', '/api/media/12', '/api/painel/questions/1/delete']) expect(acervoBrowserPath(path)).toBeNull()
  })
  it('remove scripts remotos, limita a conexão e aplica o filtro da disciplina', () => {
    const html = acervoBrowserDocument('<html><head><script src="/panel.js"></script></head><body></body></html>', 'const state = new URLSearchParams(location.search)', 'Educação Física')
    expect(html).not.toContain('src="/panel.js"')
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain('disciplina=Educa%C3%A7%C3%A3o+F%C3%ADsica')
  })
  it('oferece importação na página original e comunica apenas o ID escolhido', async () => {
    const html = acervoBrowserDocument('<html><head></head><body><div id="results"><article class="question-card"><button class="open-question" data-id="123">Ver completa</button></article></div><dialog id="detail"></dialog></body></html>', '')
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test' })
    await new Promise<void>((resolve) => dom.window.document.addEventListener('DOMContentLoaded', () => resolve()))
    const received = new Promise<MessageEvent>((resolve) => dom.window.addEventListener('message', resolve, { once: true }))
    const button = dom.window.document.querySelector<HTMLButtonElement>('[data-import-question]')!
    expect(button.textContent).toBe('Importar esta questão')
    button.click()
    expect((await received).data).toEqual({ type: 'acervo:select', questionId: 123 })
    dom.window.close()
  })
  it('reflete andamento e falha de importação no botão do seletor anterior', async () => {
    const html = acervoBrowserDocument('<html><head></head><body><div id="results"><article class="question-card"><button class="open-question" data-id="123">Ver completa</button></article></div></body></html>', '')
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test' })
    await new Promise<void>((resolve) => dom.window.document.addEventListener('DOMContentLoaded', () => resolve()))
    const button = dom.window.document.querySelector<HTMLButtonElement>('[data-import-question]')!
    const status = (value: string) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as Window, data: { type: 'acervo:import-status', questionId: 123, status: value } }))
    status('importing')
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('Importando…')
    status('error')
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Tentar novamente')
    status('imported')
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('✓ Adicionada à prova')
    dom.window.close()
  })
})
