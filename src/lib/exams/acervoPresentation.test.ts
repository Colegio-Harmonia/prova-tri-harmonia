import { describe, expect, it } from 'vitest'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { acervoHtmlToText, acervoSourceText, presentAcervoQuestion } from './acervoPresentation'

const original = {
  texto: 'O dióxido (NO 2 ) é um gás. Identifique V ou F: ( ) N é +5. ( ) Carga é 0. Assinale a alternativa.',
  html: '<p>O dióxido (NO<sub>2</sub>) é um gás.</p><p>Identifique V ou F:</p><p>( ) N é +5.<br/>( ) Carga é 0.</p><p>Assinale a alternativa.</p>',
}
const question: ExamQuestion = {
  number: 3, source: 'acervo', type: 'objetiva', bloomLevel: 'compreender', statement: original.texto,
  bnccCodes: [], bnccStatus: 'nao_mapeado', needsImage: false, saeb: { applicable: false, approximate: false },
  pedagogicalClassification: {
    dok: { categoryCode: 'DOK_1', confidence: 0, justification: '', evidence: '' },
    soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 0, justification: '', evidence: '' },
  },
  acervoRef: { questionId: 1, origin: 'ARCO', externalId: null, portalUrl: null, importedAt: '', original: { enunciado: original } },
}

describe('estrutura original das questões do acervo', () => {
  const inlineSource = { texto: 'Gasta do salário com alimentação e com moradia.', html: '<p>Gasta <img src="/api/media/10" style="width:13px"/> do salário com alimentação e <img src="/api/media/11"/> com moradia.</p>' }
  const inlineQuestion: ExamQuestion = { ...question, statement: acervoSourceText(inlineSource), acervoRef: { ...question.acervoRef!, original: { enunciado: inlineSource, midias: [{ id: 10, local: 'enunciado' }, { id: 11, local: 'enunciado' }, { id: 12, local: 'resolucao' }] } } }
  it('preserva a posição das frações em imagem no meio do enunciado', () => {
    const result = presentAcervoQuestion(inlineQuestion)
    expect(result.acervoInlineContent?.statement).toEqual([
      { type: 'text', text: 'Gasta ' }, { type: 'image', mediaId: 10, alt: 'Fórmula original', width: 13 },
      { type: 'text', text: ' do salário com alimentação e ' }, { type: 'image', mediaId: 11, alt: 'Fórmula original' },
      { type: 'text', text: ' com moradia.' },
    ])
    expect(presentAcervoQuestion(result)).toEqual(result)
  })
  it('não sobrepõe texto editado nem aceita imagem da resolução como parte do enunciado', () => {
    expect(presentAcervoQuestion({ ...inlineQuestion, statement: 'Novo enunciado do professor.' }).acervoInlineContent).toBeUndefined()
    const source = { texto: 'Calcule agora.', html: '<p>Calcule <img src="/api/media/12"/> agora.</p>' }
    const result = presentAcervoQuestion({ ...inlineQuestion, statement: acervoSourceText(source), acervoRef: { ...inlineQuestion.acervoRef!, original: { ...inlineQuestion.acervoRef!.original, enunciado: source } } })
    expect(result.acervoInlineContent).toBeUndefined()
  })
  it('restaura a alternativa-imagem legada sem trocar o gabarito', () => {
    const result = presentAcervoQuestion({ ...inlineQuestion, alternatives: [{ letter: 'A', text: 'Figura A' }], correctLetter: 'A', acervoRef: { ...inlineQuestion.acervoRef!, original: { alternativas: [{ posicao: 0, texto: '', html: '<p><img src="/api/media/14"/></p>' }], midias: [{ id: 14, local: 'alternativa' }] } } })
    expect(result.acervoInlineContent?.alternatives?.A).toEqual([{ type: 'image', mediaId: 14, alt: 'Fórmula original' }])
    expect(result.correctLetter).toBe('A')
  })
  it('recupera expoentes e índices expressos pelo estilo do HTML', () => {
    const source = { texto: 'f(x2 - 1) = 3x2 - 2; a1', html: '<p>f(x<span style="vertical-align:super">2</span> - 1) = 3x<span style="vertical-align: super;">2</span> - 2; a<span style="vertical-align:sub">1</span></p>' }
    expect(acervoSourceText(source)).toBe('f(x$^{2}$ - 1) = 3x$^{2}$ - 2; a$_{1}$')
    expect(presentAcervoQuestion({ ...question, statement: source.texto, acervoRef: { ...question.acervoRef!, original: { enunciado: source } } }).statement).toBe(acervoSourceText(source))
  })
  it('restaura expoentes que importações antigas juntaram ao x, preservando edições', () => {
    const source = { texto: 'f(x 2) = 3x 2', html: '<p>f(x<span style="vertical-align:super">2</span>) = 3x<span style="vertical-align:super">2</span></p>' }
    const imported = { ...question, statement: 'f(x2) = 3x2', acervoRef: { ...question.acervoRef!, original: { enunciado: source } } }
    expect(presentAcervoQuestion(imported).statement).toBe('f(x$^{2}$) = 3x$^{2}$')
    expect(presentAcervoQuestion({ ...imported, statement: 'f(x3) = 3x3' }).statement).toBe('f(x3) = 3x3')
  })
  it('recupera parágrafos, subscritos e cada afirmativa em sua própria linha', () => {
    expect(acervoSourceText(original)).toBe('O dióxido (NO$_{2}$) é um gás.\n\nIdentifique V ou F:\n\n( ) N é +5.\n( ) Carga é 0.\n\nAssinale a alternativa.')
  })
  it('usa a anotação LaTeX e remove a cópia visual da fórmula', () => {
    const html = String.raw`<p>Constante <span><span><math><semantics><mi>v</mi><annotation>v_{\text {som }}=340 \mathrm{m}/\mathrm{s}</annotation></semantics></math></span><span>v som = 340 m/s</span></span>;<br/>Use <span><math><semantics><mi>x</mi><annotation>(1+\alpha)^{n} \approx 1+n\alpha</annotation></semantics></math><span>fórmula visual duplicada</span></span>.</p>`
    expect(acervoHtmlToText(html)).toBe(String.raw`Constante $v_{\text {som }}=340 \mathrm{m}/\mathrm{s}$;` + '\n' + String.raw`Use $(1+\alpha)^{n} \approx 1+n\alpha$.`)
  })
  it('não executa nem imprime conteúdo ativo do HTML', () => {
    expect(acervoHtmlToText('<script>throw 1</script><p>Texto</p><img src="invalid" onerror="throw 1"/>')).toBe('Texto')
  })
  it('restaura questões antigas na apresentação sem alterar o objeto salvo', () => {
    expect(presentAcervoQuestion(question).statement).toContain('\n( ) Carga')
    expect(question.statement).toBe(original.texto)
  })
  it('preserva edições feitas pelo professor', () => {
    const edited = { ...question, statement: 'Enunciado revisado pelo professor.' }
    expect(presentAcervoQuestion(edited).statement).toBe(edited.statement)
  })
  it('preserva quebras feitas pelo professor e rejeita HTML que diverge do texto', () => {
    const edited = { ...question, statement: original.texto.replace(' Identifique', '\nIdentifique') }
    expect(presentAcervoQuestion(edited).statement).toBe(edited.statement)
    expect(acervoSourceText({ texto: 'Texto integral', html: '<p>Outro enunciado</p>' })).toBe('Texto integral')
  })
  const formula = String.raw`T = 0,050 \times (60)^2 = 180\text{ N}`
  const resolution = {
    texto: `A tração é ${formula}.`,
    html: `<p>A tração é <span><math><semantics><annotation>${formula}</annotation></semantics></math><span>cópia visual</span></span>.</p>`,
  }
  const discursive: ExamQuestion = {
    ...question, type: 'descritiva', expectedAnswer: resolution.texto,
    gradingCriteria: `Avaliar a resposta em relação ao gabarito original: ${resolution.texto}`,
    commentedResolution: resolution.texto,
    acervoRef: { ...question.acervoRef!, original: { resolucao: resolution, gabarito: { resposta_discursiva: resolution.texto } } },
  }
  it('restaura fórmulas completas na resposta, critérios e resolução de importações antigas', () => {
    const presented = presentAcervoQuestion(discursive)
    expect(presented.expectedAnswer).toBe(`A tração é $${formula}$.`)
    expect(presented.commentedResolution).toBe(presented.expectedAnswer)
    expect(presented.gradingCriteria).toBe(`Avaliar a resposta em relação ao gabarito original: ${presented.expectedAnswer}`)
    expect(discursive.expectedAnswer).toBe(resolution.texto)
    expect(presentAcervoQuestion(presented)).toEqual(presented)
  })
  it('preserva respostas e critérios revisados pelo professor', () => {
    const edited = { ...discursive, expectedAnswer: '180 N, com cálculo explicado.', gradingCriteria: 'Exigir unidade.', commentedResolution: 'Resolução revisada.' }
    const presented = presentAcervoQuestion(edited)
    expect(presented.expectedAnswer).toBe(edited.expectedAnswer)
    expect(presented.gradingCriteria).toBe(edited.gradingCriteria)
    expect(presented.commentedResolution).toBe(edited.commentedResolution)
  })
  it('não substitui uma resposta distinta pelo HTML da resolução', () => {
    const q = { ...discursive, expectedAnswer: 'Outra resposta original.', acervoRef: { ...discursive.acervoRef!, original: { resolucao: resolution, gabarito: { resposta_discursiva: 'Outra resposta original.' } } } }
    expect(presentAcervoQuestion(q).expectedAnswer).toBe('Outra resposta original.')
  })
})
