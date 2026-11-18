# Prova de recuperação individualizada

Pedido de 18/11/2026: o professor marca quem ficou de recuperação, o sistema
monta para cada aluno uma prova com as habilidades em que ele não tem
proficiência, e as provas saem numa fila de impressão por sala.

## Decisões confirmadas com o usuário (18/11/2026)

| Tema | Decisão |
|---|---|
| Período | O professor escolhe: um bimestre, um semestre (1º = bimestres 1-2, 2º = 3-4; o colégio é semestral, ajuste de 18/11/2026, migration 0058) ou o ano todo. |
| Habilidades que entram | Só "em desenvolvimento": aproveitamento **abaixo de 60%** com pelo menos 3 questões avaliadas. Habilidade com menos de 3 questões ("evidência insuficiente") fica fora e aparece como aviso. |
| Revisão | Em lote: o professor revisa as provas da turma e envia; a coordenação/direção aprova o lote inteiro. |
| Impressão | Um PDF por sala com as provas de todos os alunos, em ordem alfabética, e outro com os gabaritos. |

## Fluxo

1. **Turmas › [turma] › Prova de recuperação**: escolher disciplina, período e
   questões por aluno (3 a 20, padrão 10) e abrir o lote. Há um lote por
   turma + disciplina + período; abrir de novo retoma o mesmo.
2. **Marcar alunos** (`/recuperacao/[id]`): a tela lista o roster do Classroom
   com as habilidades abaixo de 60% de cada aluno. Ao marcar, cada aluno com
   habilidade fraca vai para a fila de geração; quem não tem fica como "sem
   habilidade abaixo de 60%" e não ganha prova.
3. **Revisar**: cada prova abre na tela de revisão de sempre, onde dá para
   trocar questão por questão. "Gerar de novo" refaz a prova do aluno com a
   mesma matriz e arquiva a anterior; "Remover" tira o aluno do lote.
4. **Enviar para a coordenação**: só com todas as provas prontas (nenhuma na
   fila ou com erro).
5. **Aprovar lote** (coordenação/direção): gera prova, gabarito e mapa de cada
   aluno no Google Docs. A aprovação é idempotente: se o Google falhar no meio,
   aprovar de novo gera só o que faltou. "Devolver ao professor" reabre.
6. **Fila de impressão** (`/recuperacao`, aba Fila): lotes aprovados agrupados
   por sala. "Baixar provas" monta o PDF único e marca o lote (e as provas)
   como impresso. Cada prova vem seguida do **cartão-resposta com QR** do
   aluno (pedido no teste de 18/11/2026), sem carimbo por cima, em folha nova.
   O primeiro download cria a correção pendente e emite a ficha
   (`exam_sheet_assignments`); os seguintes regeneram o mesmo QR a partir do
   digest, então baixar de novo não invalida o cartão
   (`src/lib/recovery/recoverySheets.ts`). O gabarito não leva cartão.

## Regras de cálculo

- Fonte: o mesmo domínio individual do relatório (`calculateStudentMastery`,
  `src/lib/curriculum/studentMastery.ts`), lido das correções **revisadas** e
  com **presença** das provas formais (`exam_kind = 'prova'`) da disciplina,
  série e ano letivo do lote. O professor só enxerga a evidência das provas
  atribuídas a ele (mesma regra de `masteryData.ts`).
- Semestre e ano todo: as evidências dos bimestres do período somam numa
  leitura só por habilidade (`evidenceForPeriod`, `periodBimesters`). Na
  geração, o semestre usa o planejamento de todos os bimestres, restrito às
  habilidades fracas do aluno.
- Distribuição das questões (`distributeRecoveryQuestions`): no mínimo uma por
  habilidade; o restante proporcional à distância até 60% (maior resto). Com
  mais habilidades que questões, ficam as de menor aproveitamento. A soma é
  sempre a quantidade do lote.
- A prova é gerada pelo motor de **atividades** (job `gerar_atividade`, matriz
  `bnccPlan`, intenção `recuperacao`) e gravada como
  `generated_exams.exam_kind = 'recuperacao'`. Por isso não segue a regra
  12–15 / 60-40 das provas formais. O vínculo é `recoveryStudentId` no payload
  do job; o worker só liga a prova se o job ainda for o vigente do aluno.

## LGPD

O nome do aluno **não** vai para o Google Doc (o título leva só "nº <id da
prova>"). Ele é carimbado no topo de cada página apenas no PDF montado na hora
do download (`src/lib/recovery/roomPdf.ts`), mesma linha da prova adaptada.
No PDF, cada aluno começa numa folha nova (página em branco quando a prova tem
número ímpar de páginas), para impressão frente e verso.

## Arquivos

- Migration `drizzle/0057_recovery_exams.sql` (aditiva: `recovery_rounds`,
  `recovery_students`). **Não aplicada em nenhum banco.**
- Regras puras: `src/lib/recovery/recoveryPlan.ts`; serviço:
  `recoveryService.ts`; PDF da sala: `roomPdf.ts`.
- API: `/api/recovery` (+ `/[roundId]`, `/students`, `/students/[studentId]`,
  `/actions`, `/pdf`).
- Telas: `/recuperacao`, `/recuperacao/[roundId]`, cartão na página da turma
  (`RecoveryLauncher.tsx`).
- Provas `recuperacao` não aceitam ações individuais de status nem
  "Regenerar" pela rota da prova (422): tudo passa pelo lote.

## Limites conhecidos

- A nota da prova de recuperação **não** volta para o domínio por habilidade
  (o cálculo só lê `exam_kind = 'prova'`). Correção e lançamento de nota da
  recuperação não foram construídos.
- A aprovação gera os Docs dentro da própria requisição; um lote grande pode
  levar alguns minutos.
- Professor sem login Google não vê o roster nem marca alunos (o roster vem do
  Classroom, nunca do navegador).

## Achados do teste com cópia da produção (18/11/2026)

- O motor de atividades tem dois inserts de prova (whole-exam e por questão);
  só um gravava `recuperacao`. Os dois agora passam por `persistedExamKind`,
  com teste que falha se surgir um terceiro insert sem a regra.
- A fila mostra "Recuperação · <disciplina>" para esses jobs.
- O lote ainda não deixa escolher objetivas × descritivas: a proporção sai do
  motor de atividades (a prova de teste teve 6 objetivas e 9 descritivas).
  O motor já aceita `objectivePercentage`; falta o campo no lote.

## Publicação e rollback

Publicado em produção em 18/11/2026, a pedido do usuário, durante o período de
provas. Estado anterior, para voltar:

| Item | Antes | Depois |
|---|---|---|
| Código (`main`) | `181df77` | merge do PR #69 |
| Imagem Docker | `prova-tri:181df771ead48f4af6e6b593ac891249862fcd0f` (preservada) | `prova-tri:<commit do merge>` |
| Banco | sem `recovery_rounds`/`recovery_students` | migration 0057 aplicada |
| Backup do banco | `/home/eduardo/backups/prova_tri-pre-recuperacao-20261118-140118.dump` (pg_dump -Fc antes da 0057, 60 MB) | — |

### Voltar só o código (rápido, sem perder dado)

No servidor, em `/home/eduardo/prova-tri`:

```bash
export PROVA_TRI_IMAGE=prova-tri:181df771ead48f4af6e6b593ac891249862fcd0f
docker compose --env-file .env.local up -d --no-build --no-deps --wait --wait-timeout 180 web worker scan-worker ocr-worker
docker compose --env-file .env.local ps
```

Isso não mexe no banco. As tabelas da 0057 ficam paradas e o código antigo as
ignora. Provas com `exam_kind = 'recuperacao'` deixam de aparecer nas listas
(o código antigo só lista prova/atividade/reforço); para tirá-las de vista de
vez: `UPDATE generated_exams SET archived_at = now() WHERE exam_kind = 'recuperacao' AND archived_at IS NULL;`.
Depois, voltar o `main` com um PR de revert do merge (não usar push forçado:
o script de deploy exige `HEAD == origin/main`).

### Voltar também o banco (só se a 0057 der problema)

Sem perder o resto do banco, só desfazer a 0057:

```sql
BEGIN;
DROP TABLE IF EXISTS recovery_students;
DROP TABLE IF EXISTS recovery_rounds;
COMMIT;
```

(Os cartões emitidos e correções pendentes das provas de recuperação ficam em
`exam_sheet_assignments`/`exam_corrections`, tabelas que já existiam.)
Restaurar o dump inteiro só em último caso: apaga tudo que foi gravado depois
do backup (correções, notas, scans do dia).
