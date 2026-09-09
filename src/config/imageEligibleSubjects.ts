// Subjects where the user explicitly asked for image support in questions.
// Matemática/Artes/Educação Física/Filosofia/Sociologia/Literatura are
// deliberately excluded for now — easy to extend later, not assumed.
const IMAGE_ELIGIBLE_ALIASES = [
  'ciências',
  'ciencias',
  'biologia',
  'química',
  'quimica',
  'física',
  'fisica',
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
