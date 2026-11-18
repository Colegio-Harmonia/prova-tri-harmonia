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

Desde 18/11/2026 (pedido do usuário: "a tela de Composição da prova, Matriz da
avaliação, é muito importante") a recuperação segue o fluxo validado da tela
**Gerar prova**: Composição → Matriz por capítulo → Conferência, gerando pelo
**Planejamento aprovado** (nunca pela planilha). Decisões: uma composição por
lote e uma matriz por aluno; dentro de cada capítulo, as questões cobram **só**
as habilidades fracas do aluno.

1. **Turmas › [turma] › Prova de recuperação**: disciplina e período. Há um
   lote por turma + disciplina + período; abrir de novo retoma o mesmo.
2. **Composição** (`/recuperacao/[id]`), igual à da Gerar prova: origem
   (Importar do acervo ou Gerar com IA), total de questões por aluno (10 a 30)
   e Formato das questões (barra alternativas × dissertativas). Vale para o
   lote inteiro; mudar o total refaz a matriz sugerida de quem ainda está na
   conferência.
3. **Marcar alunos**: o roster do Classroom com as habilidades abaixo de 60% de
   cada aluno. Marcar monta a **matriz por capítulo** do aluno (status
   `planejado`); nada vai para a fila ainda. Quem não tem habilidade fraca em
   nenhum capítulo do período fica "sem habilidades".
4. **Conferência**: a "Distribuição planejada por capítulo" de cada aluno, com
   a mesma barra arrastável, mostrando as habilidades fracas que cada capítulo
   trabalha. A soma precisa dar o total do lote. "Restaurar sugestão" volta à
   matriz automática. **Gerar provas** enfileira um job `gerar_prova` por aluno.
5. **Revisar**: cada prova abre na tela de revisão de sempre (troca de questão
   por questão). "Gerar de novo" arquiva a prova e devolve o aluno à
   conferência; "Remover" tira o aluno do lote.
6. **Enviar para a coordenação**: só com todas as provas prontas.
7. **Aprovar lote** (coordenação/direção): gera prova, gabarito e mapa de cada
   aluno no Google Docs. Idempotente: aprovar de novo gera só o que faltou.
8. **Fila de impressão** (`/recuperacao`, aba Fila): lotes aprovados agrupados
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
- Matriz sugerida (`buildRecoveryContentPlan`): entram os capítulos do
  período que trabalham alguma habilidade fraca; o peso do capítulo é a soma
  dos déficits (distância até 60%) das fracas que ele tem, e uma habilidade
  presente em dois capítulos divide o peso. No mínimo uma questão por
  capítulo, o resto proporcional (maior resto). Fracas que nenhum capítulo do
  período planeja não entram.
- Planejamento do período (`roundCurriculum`): os planejamentos aprovados dos
  bimestres do período. Semestre e ano juntam vários
  (`getCurriculumFromPlans`, rowIndex deslocado em 1000 por planejamento) e a
  prova grava `metadata.curriculumPlanIds`; troca de questão, regenerar,
  questão adicional e reteste reabrem todos (`planScopeFromExamPayload`).
- Geração: job `gerar_prova` (motor whole-exam da prova formal) com
  `contentPlan`, `questionSource`, `objectivePercentage`, `focusBnccCodes`
  (as fracas: `pickTargetSkills` restringe o rodízio do capítulo a elas) e
  `recoveryStudentId`. Gravada como `exam_kind = 'recuperacao'`, sem
  atribuição formal (responsável = quem gerou). O worker só liga a prova se o
  job ainda for o vigente do aluno.
- Lotes gerados antes de 18/11 (motor de atividades, `bncc_plan`) continuam
  sendo ligados pelo worker; "Gerar de novo" os traz para o fluxo novo.

## LGPD

O nome do aluno **não** vai para o Google Doc (o título leva só "nº <id da
prova>"). Ele é carimbado no topo de cada página apenas no PDF montado na hora
do download (`src/lib/recovery/roomPdf.ts`), mesma linha da prova adaptada.
No PDF, cada aluno começa numa folha nova (página em branco quando a prova tem
número ímpar de páginas), para impressão frente e verso.

## Arquivos

- Migrations (aditivas, aplicar em ordem): `0057_recovery_exams.sql`
  (tabelas), `0058_recovery_semester.sql` (semestre), `0059_recovery_composition.sql`
  (composição do lote, matriz por aluno, status `planejado`). Reversão no
  cabeçalho de cada arquivo.
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
- (Resolvido no mesmo dia) objetivas × descritivas: o lote ganhou a
  Composição da Gerar prova (0059).

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
