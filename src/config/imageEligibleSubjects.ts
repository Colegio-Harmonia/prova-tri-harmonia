// Matemática é habilitada para que o roteador técnico possa gerar figuras
// verificáveis (plano cartesiano, vetores e geometria) sem recorrer à IA.
const IMAGE_ELIGIBLE_ALIASES = [
  'ciências',
  'ciencias',
  'biologia',
  'química',
  'quimica',
  'física',
  'fisica',
  'matemática',
  'matematica',
  'geografia',
  'história',
  'historia',
  'português',
  'portugues',
  'língua portuguesa',
  'lingua portuguesa',
  'inglês',
  'ingles',
]

export function isImageEligibleSubject(subject: string): boolean {
  return IMAGE_ELIGIBLE_ALIASES.includes(subject.trim().toLowerCase())
}
