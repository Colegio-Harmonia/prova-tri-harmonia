import { MASTERY_RULES } from '@/lib/curriculum/studentMastery'

// Lembrete fixo da regra de domínio (decisão pedagógica de 30/09/2026: manter
// a regra rigorosa e deixar explícito "no bimestre"). Sempre visível, para
// todos os perfis, e sai na impressão. O texto vem de MASTERY_RULES: se a
// regra mudar, o lembrete acompanha.
export default function MasteryRuleReminder({ className = '' }: { className?: string }) {
  const r = MASTERY_RULES
  return <aside role="note" aria-label="Como ler o domínio das habilidades" className={`rounded border border-status-info-border bg-status-info-surface p-3 text-sm text-status-info-content print-avoid-break ${className}`}>
    <p className="font-semibold">Lembrete: como ler “Domínio no bimestre”</p>
    <ul className="mt-1 list-disc space-y-0.5 pl-5">
      <li>Exige ao menos <strong>{r.masteryPercent}% de aproveitamento</strong> em pelo menos <strong>{r.minItemsForMastery} questões</strong>, vindas de <strong>{r.minAssessmentsForMastery} avaliações diferentes do mesmo bimestre</strong>.</li>
      <li>Com {r.masteryPercent}% ou mais sem essa base, a habilidade aparece como <strong>“Próximo do domínio — limitado pela amostra”</strong>: o resultado é bom, mas uma avaliação só não basta para afirmar domínio.</li>
      <li>Com menos de {r.minItemsForReading} questões, a leitura é <strong>preliminar</strong> e não deve ser usada para conclusões.</li>
      <li>Na visão anual, as avaliações dos bimestres se somam e a leitura passa a ser <strong>“Domínio no ano”</strong>.</li>
    </ul>
  </aside>
}
