// Disciplinas onde o problema real (2026-07-16, pedido direto do usuário)
// é a IA gerar questões diretas demais nos níveis mais altos de Bloom —
// "o que é X" em vez de "com base no texto/situação, o que se pode
// concluir sobre X". Aplica nos 3 segmentos (não só Ensino Médio); a
// injeção de exemplares reais do banco ENEM (ver enemExemplars.ts) é que
// fica restrita ao Ensino Médio, por ser o único banco real disponível.
const INTERPRETIVE_SUBJECT_ALIASES = [
  'história',
  'historia',
  'geografia',
  'filosofia',
  'sociologia',
  'língua portuguesa',
  'lingua portuguesa',
  'português',
  'portugues',
  'literatura',
]

export function isInterpretiveSubject(subject: string): boolean {
  return INTERPRETIVE_SUBJECT_ALIASES.includes(subject.trim().toLowerCase())
}
