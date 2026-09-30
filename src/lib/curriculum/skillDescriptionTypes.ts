export type DescriptionCheckStatus = 'confere' | 'revisar' | 'diverge' | 'nao_verificado'

export type DescriptionCheck = {
  code: string
  spreadsheetDescription: string
  officialDescription: string | null
  status: DescriptionCheckStatus
  /** Probabilidade (0–1) de a planilha descrever a mesma habilidade; null quando não verificado. */
  probability: number | null
}

export function normalizeSkillCode(code: string) {
  return code.trim().toUpperCase()
}

/** Chave estável de uma linha verificada: o mesmo código pode vir com textos diferentes. */
export function descriptionCheckKey(code: string, description: string) {
  return `${normalizeSkillCode(code)}::${description.trim()}`
}
