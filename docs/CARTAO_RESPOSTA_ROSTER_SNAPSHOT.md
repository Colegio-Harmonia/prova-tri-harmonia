# Cartão-resposta — Congelamento do roster

**Status:** implementado localmente; migration pendente de aplicação e
validação em DEV. A emissão de QR/PDF está em rota própria; upload, Drive e
n8n continuam fora deste passo.

## Propósito

Antes da aplicação, o professor vincula a turma do Google Classroom e chama:

```text
POST /api/exams/:examId/sheet-assignments/snapshot
```

A rota só aceita provas `aprovado` ou `impresso`. Ela consulta o roster do
Classroom e cria, para cada aluno ainda sem atribuição ativa:

1. uma `exam_corrections` com respostas vazias, quando ela não existir;
2. uma `exam_sheet_assignments` em estado `pronta`;
3. um `publicId` aleatório, sem nome, e-mail, ID sequencial ou resposta.

Nome e e-mail armazenados em `student_*_snapshot` são a foto exibível do
momento da emissão. O identificador estável é `classroomStudentId`; mudanças
posteriores no Classroom não alteram a linha já criada. A operação é
idempotente para alunos já com atribuição em estado `pronta` ou `emitida`.

```text
vincular turma -> POST snapshot -> atribuições prontas -> POST emit -> ZIP de PDFs
```

`GET /api/exams/:examId/sheet-assignments/snapshot` lista as atribuições para
uma tela futura de conferência. As duas rotas usam a mesma autorização da
correção: professor atribuído, coordenação ou direção.

## Dados e limites desta etapa

`exam_sheet_assignments` ainda não é um arquivo nem uma autorização de acesso
ao scan. `page_count` é calculado conforme as questões da prova (uma página
objetiva e até três discursivas por página). `token_digest` permanece nulo em
`pronta`; na emissão, ele recebe somente o digest do conjunto de QR assinados
e o estado muda para `emitida`.
Reimpressão deverá anular a folha anterior e criar uma nova linha vinculada em
`reprint_of_id`; por isso não há unicidade permanente por aluno, apenas uma
atribuição ativa por prova/aluno.

Aplicar primeiro `drizzle/0020_exam_sheet_assignments.sql` em DEV. A migration
é aditiva e não mexe no JSONB histórico de `exam_corrections.answers`.
