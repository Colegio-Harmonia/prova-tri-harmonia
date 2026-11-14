// Fica fora de `db/schema.ts` para que telas do navegador possam importar os
// estados sem carregar o schema (que usa criptografia do Node). O ciclo de
// vida de cada estado está documentado em `db/schema.ts`.
export const EXAM_STATUSES = ['rascunho', 'atribuido', 'em_andamento', 'revisao_concluida', 'em_revisao', 'aprovado', 'impresso', 'aplicado', 'parcialmente_corrigida', 'corrigido'] as const
