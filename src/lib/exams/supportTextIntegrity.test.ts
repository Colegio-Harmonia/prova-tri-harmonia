import { describe, expect, it } from 'vitest'
import { missingRequiredSupportTextReason } from './supportTextIntegrity'

describe('integridade do texto de apoio', () => {
  it('reprova referência a texto quando só há um título', () => {
    expect(missingRequiredSupportTextReason({ statement: 'De acordo com o texto, qual é a ideia principal?', supportText: 'A era do selfie' })).toContain('texto de apoio')
  })
  it('reprova referência ao material didático sem texto disponível', () => {
    expect(missingRequiredSupportTextReason({ statement: 'De acordo com o capítulo do material didático, explique a ideia central.', supportText: null })).toContain('texto de apoio')
  })
  it('aceita questão de leitura quando a fonte é substancial', () => {
    expect(missingRequiredSupportTextReason({ statement: 'Com base no texto, indique a consequência descrita.', supportText: 'As redes sociais ampliaram a circulação de imagens pessoais e alteraram a forma como muitas pessoas constroem e apresentam sua identidade.' })).toBeNull()
  })
  it('não confunde produção de texto com referência a uma leitura externa', () => {
    expect(missingRequiredSupportTextReason({ statement: 'Escreva um texto descritivo sobre uma experiência da comunidade.', supportText: null })).toBeNull()
  })
})
