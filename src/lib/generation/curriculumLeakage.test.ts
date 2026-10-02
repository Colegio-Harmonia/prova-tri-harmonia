import { describe, expect, it } from 'vitest'
import { curriculumLeakageIssues, normalizeQuestionPresentation } from './curriculumLeakage'

const SCOPE = [
  'Combustíveis e energia (eficiência energética)',
  'Inovações tecnológicas (carro elétrico, internet das coisas, etc.) e qualidade de vida',
  '10. Combustíveis, tecnologia e sociedade',
  'Combustíveis renováveis',
].join('\n')

const alt = (letter: string, text: string) => ({ letter, text })
const objective = (statement: string, texts: string[], correctLetter: string, supportText: string | null = null) => ({
  type: 'objetiva' as const, statement, supportText, correctLetter, expectedAnswer: null,
  alternatives: texts.map((text, index) => alt(String.fromCharCode(65 + index), text)),
})

describe('curriculumLeakageIssues — casos reais da prova #391', () => {
  it('bloqueia alternativa correta que é um tópico da planilha (Q7)', () => {
    const q = objective('Qual é um impacto positivo da adoção de biocombustíveis?', [
      'Inovações tecnológicas (carro elétrico, internet das coisas, etc.) e qualidade de vida',
      'Dependência maior de combustíveis fósseis importados.',
      'Redução imediata do consumo de energia de toda a comunidade.',
    ], 'A')
    expect(curriculumLeakageIssues(q, SCOPE).some((i) => i.code === 'copied_curriculum' && i.severity === 'bloqueante')).toBe(true)
  })

  it('bloqueia linguagem de planejamento na alternativa (Q3)', () => {
    const q = objective('Qual afirmação descreve a transformação de energia?', [
      "O estudo de 'Combustíveis e energia (eficiência energética)' inclui a transformação de energia na combustão.",
      'A combustão produz energia do nada.',
    ], 'A')
    expect(curriculumLeakageIssues(q, SCOPE).some((i) => i.code === 'planning_language')).toBe(true)
  })

  it('bloqueia resposta esperada que descreve o capítulo (Q9)', () => {
    const q = { type: 'descritiva' as const, statement: 'Analise as políticas públicas.', supportText: null, alternatives: null, correctLetter: null, expectedAnswer: 'O capítulo 10 está intitulado "Combustíveis, tecnologia e sociedade" e inclui o tópico "Combustíveis renováveis".' }
    expect(curriculumLeakageIssues(q, SCOPE).some((i) => i.severity === 'bloqueante')).toBe(true)
  })

  it('bloqueia texto de apoio que abre com o título numerado do capítulo (Q9)', () => {
    const q = objective('Com base no texto, escolha a alternativa correta.', ['Alfa', 'Beta'], 'A', '10. Combustíveis, tecnologia e sociedade\nCombustíveis renováveis\n\nOs combustíveis fósseis são fontes de energia não renováveis que liberam gases de efeito estufa.')
    expect(curriculumLeakageIssues(q, SCOPE).some((i) => i.code === 'support_heading')).toBe(true)
  })

  it('bloqueia resposta correta tautológica com a pergunta (Q1)', () => {
    const q = objective('Qual das opções abaixo é um combustível renovável?', ['Gás natural', 'Urânio', 'Carvão mineral', 'Petróleo', 'Combustíveis renováveis'], 'E')
    expect(curriculumLeakageIssues(q, SCOPE).some((i) => i.code === 'tautological_answer')).toBe(true)
  })
})

describe('curriculumLeakageIssues — questões boas não são barradas', () => {
  it('aceita resposta própria que menciona o assunto do capítulo', () => {
    const q = objective('Por que o etanol de cana é considerado renovável?', [
      'A cana absorve CO2 ao crescer e o plantio repõe o carbono liberado na queima.',
      'O etanol não libera gases ao queimar.',
      'O etanol se forma no subsolo em milhões de anos.',
    ], 'A')
    expect(curriculumLeakageIssues(q, SCOPE)).toEqual([])
  })

  it('aceita resposta descritiva com conteúdo da disciplina', () => {
    const q = { type: 'descritiva' as const, statement: 'Explique a vantagem do carro elétrico.', supportText: 'Veículos elétricos não queimam combustível no motor, mas a eletricidade pode vir de fontes renováveis ou fósseis.', alternatives: null, correctLetter: null, expectedAnswer: 'Não emite gases pelo escapamento; a redução total depende de a eletricidade vir de fonte renovável.' }
    expect(curriculumLeakageIssues(q, SCOPE)).toEqual([])
  })
})

describe('normalizeQuestionPresentation', () => {
  const support = 'Dois veículos precisam entregar 60 MJ de energia mecânica às rodas. O veículo A tem rendimento de 25% e o veículo B de 80%.'

  it('remove do enunciado a cópia integral do texto de apoio (Q6)', () => {
    const result = normalizeQuestionPresentation({ statement: `Considere o trecho abaixo e responda: ${support} Qual alternativa está correta?`, supportText: support })
    expect(result.statement).not.toContain('60 MJ')
    expect(result.statement).toContain('Qual alternativa está correta?')
  })

  it('não altera enunciado sem cópia', () => {
    const input = { statement: 'Com base no texto, qual a conclusão?', supportText: support }
    expect(normalizeQuestionPresentation(input).statement).toBe(input.statement)
  })

  it('remove o rótulo "Leia o texto a seguir." de dentro do apoio', () => {
    const result = normalizeQuestionPresentation({ statement: 'Qual a conclusão do texto?', supportText: `Leia o texto a seguir.\n\n${support}` })
    expect(result.supportText?.startsWith('Dois veículos')).toBe(true)
  })
})
