import { ADAPTATION_LIBRARIES, type AdaptationLibrary } from '@/config/adaptationLibraries'
import type { AdaptationProfileId } from '@/db/schema'

// Harmonização de laudos múltiplos (spec 4.1 e 6.3) — DETERMINÍSTICA, em
// código, nunca deixada pra IA decidir:
// - regras numéricas de layout: vence a MAIOR (fonte, espaçamento);
// - booleanas: OR;
// - visualSupports: conflito real TEA('add') × TDAH('remove_nonessential')
//   resolve pra 'essential_only' — mantém/adiciona só apoio visual com
//   função pedagógica direta, remove todo decorativo;
// - diretrizes de conteúdo: concatenadas em ordem de conflictPriority
//   (TEA primeiro), com bloco de harmonização no prompt.

export type MergedVisualSupports = 'add' | 'remove_nonessential' | 'keep' | 'essential_only'

export type MergedLayoutRules = {
  minFontPt: number | null
  headingFontPt: number | null
  fontFamily: 'sans-serif' | null
  lineSpacing: number | null
  boldCommandKeywords: boolean
  extraAnswerSpace: boolean
  highContrast: boolean
  formulaSupportHeader: boolean
  visualSupports: MergedVisualSupports
}

export type MergedAdaptation = {
  profiles: AdaptationProfileId[]
  libraries: AdaptationLibrary[] // ordenadas por conflictPriority
  libraryVersions: Record<string, string>
  layout: MergedLayoutRules
}

export function mergeAdaptationLibraries(profiles: AdaptationProfileId[]): MergedAdaptation {
  const unique = [...new Set(profiles)]
  if (!unique.length) throw new Error('Selecione pelo menos um perfil de adaptação.')

  const libraries = unique
    .map((id) => {
      const library = ADAPTATION_LIBRARIES[id]
      if (!library) throw new Error(`Perfil de adaptação desconhecido: ${id}`)
      return library
    })
    .sort((a, b) => a.conflictPriority - b.conflictPriority)

  const maxOrNull = (values: Array<number | undefined>): number | null => {
    const present = values.filter((v): v is number => typeof v === 'number')
    return present.length ? Math.max(...present) : null
  }

  const visualValues = new Set(libraries.map((l) => l.layoutRules.visualSupports).filter(Boolean))
  let visualSupports: MergedVisualSupports = 'keep'
  if (visualValues.has('add') && visualValues.has('remove_nonessential')) visualSupports = 'essential_only'
  else if (visualValues.has('add')) visualSupports = 'add'
  else if (visualValues.has('remove_nonessential')) visualSupports = 'remove_nonessential'

  return {
    profiles: libraries.map((l) => l.id),
    libraries,
    libraryVersions: Object.fromEntries(libraries.map((l) => [l.id, l.version])),
    layout: {
      minFontPt: maxOrNull(libraries.map((l) => l.layoutRules.minFontPt)),
      headingFontPt: maxOrNull(libraries.map((l) => l.layoutRules.headingFontPt)),
      fontFamily: libraries.some((l) => l.layoutRules.fontFamily === 'sans-serif') ? 'sans-serif' : null,
      lineSpacing: maxOrNull(libraries.map((l) => l.layoutRules.lineSpacing)),
      boldCommandKeywords: libraries.some((l) => l.layoutRules.boldCommandKeywords),
      extraAnswerSpace: libraries.some((l) => l.layoutRules.extraAnswerSpace),
      highContrast: libraries.some((l) => l.layoutRules.highContrast),
      formulaSupportHeader: libraries.some((l) => l.layoutRules.formulaSupportHeader),
      visualSupports,
    },
  }
}
