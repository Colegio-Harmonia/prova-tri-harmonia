import { ATTITUDINAL_LEAD_VERBS, BLOOM_LEVEL_ORDER } from '@/config/bloomVerbs'
import { BLOOM_GUIDE } from '@/config/bloomGuide'
import { getBloomVerbUsage, type BloomVerbRow } from '@/lib/curriculum/bloomVerbUsage'

// Guia "Bloom e verbos" para a equipe pedagógica: a mesma tabela que o
// sistema usa para ler o nível de Bloom de objetivos e habilidades, com o
// uso real de cada verbo nos planejamentos da escola. Só leitura.

const byUse = (a: BloomVerbRow, b: BloomVerbRow) => (b.skills + b.objectives) - (a.skills + a.objectives) || a.verb.localeCompare(b.verb, 'pt-BR')

function VerbTable({ rows }: { rows: BloomVerbRow[] }) {
  return <div className="mt-3 overflow-x-auto">
    <table className="w-full min-w-[28rem] text-left text-sm">
      <thead className="text-xs text-content-secondary">
        <tr className="border-b border-border">
          <th scope="col" className="py-2 pr-3 font-semibold">Verbo</th>
          <th scope="col" className="py-2 pr-3 font-semibold">Origem</th>
          <th scope="col" className="py-2 pr-3 text-right font-semibold">Habilidades BNCC</th>
          <th scope="col" className="py-2 text-right font-semibold">Objetivos</th>
        </tr>
      </thead>
      <tbody>{rows.map((row) => <tr key={row.verb} className="border-b border-border last:border-0">
        <th scope="row" className="py-1.5 pr-3 font-medium text-content-primary">{row.verb}</th>
        <td className="py-1.5 pr-3 text-content-secondary">{row.base ? 'Manual do projeto' : 'Ampliação'}</td>
        <td className="py-1.5 pr-3 text-right tabular-nums">{row.skills}</td>
        <td className="py-1.5 text-right tabular-nums">{row.objectives}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

export default async function BloomGuide() {
  const usage = await getBloomVerbUsage().catch((error) => { console.error('[planejamento/bloom] uso indisponível:', error); return null })
  const rows = usage?.rows ?? []
  const total = rows.length
  const unused = rows.filter((row) => row.skills + row.objectives === 0).length

  return <div className="mt-6 space-y-5">
    <section className="rounded border border-border bg-surface p-4">
      <h2 className="font-semibold">Como o Prova TRI lê o nível de Bloom</h2>
      <p className="mt-1 text-sm text-content-secondary">O nível de um objetivo ou de uma habilidade vem do verbo que abre a frase. Esta é a tabela que o sistema usa: ela define o nível mostrado no Assistente de planejamento, os objetivos que a IA sugere e a indicação de nível enviada à IA ao gerar uma questão.</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-content-secondary">
        <li><span className="font-medium text-content-primary">Vale o primeiro verbo.</span> “Analisar o texto, identificando…” é Analisar, não Lembrar.</li>
        <li><span className="font-medium text-content-primary">Dois verbos no início: vale o nível mais alto.</span> “Resolver e elaborar problemas” é Criar.</li>
        <li><span className="font-medium text-content-primary">Escreva no infinitivo.</span> “O aluno deve identificar…” ou “Identificação de…” não são lidos como objetivo.</li>
        <li><span className="font-medium text-content-primary">Verbos de atitude ficam sem nível, de propósito.</span> Descrevem valores e convivência, que não são avaliados por nível cognitivo: {ATTITUDINAL_LEAD_VERBS.join(', ')}.</li>
      </ul>
      {usage
        ? <p className="mt-3 text-xs text-content-muted">A tabela tem {total} verbos; {unused} ainda não abrem nenhuma frase nos planejamentos. As colunas de uso contam, nos planejamentos da escola, {usage.skillSentences.toLocaleString('pt-BR')} descrições de habilidades BNCC e {usage.objectiveSentences.toLocaleString('pt-BR')} frases de objetivos que começam por cada verbo.</p>
        : <p role="status" className="mt-3 rounded border border-status-warning-border bg-status-warning-surface p-2 text-xs text-status-warning-content">Não foi possível carregar a tabela agora. Recarregue a página em instantes.</p>}
      <p className="mt-1 text-xs text-content-muted">Os verbos marcados “Manual do projeto” são os da tabela original; os de “Ampliação” são escolhas pedagógicas que a coordenação pode rever. Para mudar um verbo de nível, acrescentar ou retirar, fale com a coordenação.</p>
    </section>

    {BLOOM_LEVEL_ORDER.map((level, index) => {
      const guide = BLOOM_GUIDE[level]
      const ofLevel = rows.filter((row) => row.level === level)
      const used = ofLevel.filter((row) => row.skills + row.objectives > 0).sort(byUse)
      const idle = ofLevel.filter((row) => row.skills + row.objectives === 0).sort(byUse)
      return <section key={level} aria-labelledby={`bloom-${level}`} className="rounded border border-border bg-surface p-4">
        <h2 id={`bloom-${level}`} className="font-semibold">{index + 1}. {guide.label}</h2>
        <p className="mt-1 text-sm text-content-secondary">{guide.summary} {guide.studentDoes}</p>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-semibold text-content-primary">Exemplo de objetivo</dt><dd className="mt-0.5 text-content-secondary">{guide.objectiveExample}</dd></div>
          <div><dt className="text-xs font-semibold text-content-primary">Exemplo de tarefa de avaliação</dt><dd className="mt-0.5 text-content-secondary">{guide.questionExample}</dd></div>
        </dl>
        {used.length > 0 && <VerbTable rows={used} />}
        {idle.length > 0 && <p className="mt-3 text-sm text-content-secondary"><span className="font-medium text-content-primary">{used.length > 0 ? 'Também aceitos, ainda sem uso nos planejamentos' : 'Verbos aceitos'} ({idle.length}):</span> {idle.map((row) => row.verb).join(', ')}.</p>}
      </section>
    })}
  </div>
}
