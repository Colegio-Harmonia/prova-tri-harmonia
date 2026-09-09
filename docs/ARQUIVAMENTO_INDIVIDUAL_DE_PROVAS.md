# Arquivamento individual de provas

## Decisão

Uma prova pode ser arquivada **somente para o usuário que a arquivou**. Esse
ato é de organização pessoal e não representa uma etapa do fluxo pedagógico.

Por isso, a implementação não adiciona um novo `status` a `generated_exams`.
O status continua representando o ciclo real (`rascunho`, `aplicado`,
`corrigido` etc.), enquanto a tabela `exam_user_archives` registra a
preferência individual.

## Comportamento

- Na tela **Provas**, a listagem normal exclui as provas arquivadas pelo
  usuário logado.
- **Mostrar somente as arquivadas por mim** troca a visão para as provas que
  aquele mesmo usuário ocultou.
- O botão alterna entre **Arquivar** e **Restaurar**.
- Arquivar não apaga prova, correções, documentos, scans, arquivos do Drive,
  notas nem auditoria.
- Outro professor e a coordenação continuam vendo a prova normalmente, a menos
  que a arquivem nas próprias contas.
- A mesma autorização da prova é exigida na API: professor só pode arquivar
  prova que criou ou que lhe foi atribuída; coordenação e direção podem usar a
  ação nas provas a que já têm acesso.

## Banco e API

Migration: `drizzle/0026_exam_user_archives.sql`.

`exam_user_archives` tem unicidade em `(user_id, exam_id)`, portanto arquivar
repetidamente é idempotente.

- `POST /api/exams/:examId/archive`: arquiva para o usuário autenticado.
- `DELETE /api/exams/:examId/archive`: restaura para o usuário autenticado.
- `GET /api/exams?...&archived=true`: retorna somente as provas arquivadas
  pelo usuário autenticado. Sem esse parâmetro, retorna somente as não
  arquivadas por ele.

Nenhuma dessas ações muda `generated_exams.status`.

## Correção de listagem (31/07/2026)

A consulta da tela de provas usa uma subconsulta correlacionada para aplicar a
preferência individual de arquivamento. Ela deve usar `generated_exams` sem
alias na consulta externa; caso contrário, o PostgreSQL rejeita a referência
ao identificador da prova e a interface pode parecer vazia. A rota foi
implementada com `db.select().from(generatedExams)` justamente para preservar
essa correlação.

## Rollback

O rollback de código remove a interface e as consultas. A migration é
aditiva; para remover dados de preferência apenas se houver decisão explícita,
excluir a tabela em uma migration reversa planejada. Nunca apagar provas para
“desarquivar”.
