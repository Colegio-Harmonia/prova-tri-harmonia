import { porCodigo, versao } from '@bncc/dados'

export type OfficialBnccSkill = {
  code: string
  text: string
  context: string[]
  source: string
  dataVersion: string
}

/** Local, versioned BNCC lookup. Curriculum topics and facts still come from the school's spreadsheet. */
export function getOfficialBnccSkill(code: string): OfficialBnccSkill | null {
  const normalizedCode = code.trim().toUpperCase()
  if (!normalizedCode) return null
  try {
    const skill = porCodigo(normalizedCode)
    const context = [
      skill.componente?.nome,
      ...Object.values(skill.organizacao?.nomes ?? {}).flatMap((value) => Array.isArray(value) ? value : [value]),
      ...(skill.objetosConhecimento ?? []).map((item) => item.nome),
      skill.eixo?.nome,
    ].filter((value): value is string => Boolean(value?.trim()))
    return {
      code: skill.codigo,
      text: skill.texto,
      context: [...new Set(context)],
      source: skill.fonte.localizador_pdf ?? skill.fonte.localizador ?? '',
      dataVersion: versao().data_version,
    }
  } catch {
    return null
  }
}
