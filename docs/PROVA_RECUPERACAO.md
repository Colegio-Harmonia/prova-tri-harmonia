# Prova de recuperação individualizada

Pedido de 18/11/2026: o professor marca quem ficou de recuperação, o sistema
monta para cada aluno uma prova com as habilidades em que ele não tem
proficiência, e as provas saem numa fila de impressão por sala.

## Decisões confirmadas com o usuário (18/11/2026)

| Tema | Decisão |
|---|---|
| Período | O professor escolhe: um bimestre ou o ano todo. |
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
   como impresso.

## Regras de cálculo

- Fonte: o mesmo domínio individual do relatório (`calculateStudentMastery`,
  `src/lib/curriculum/studentMastery.ts`), lido das correções **revisadas** e
  com **presença** das provas formais (`exam_kind = 'prova'`) da disciplina,
  série e ano letivo do lote. O professor só enxerga a evidência das provas
  atribuídas a ele (mesma regra de `masteryData.ts`).
- Ano todo: as evidências de todos os bimestres somam numa leitura só por
  habilidade (`evidenceForPeriod`).
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
- Sem cartão-resposta com QR na recuperação (a decisão foi PDF simples).
- A aprovação gera os Docs dentro da própria requisição; um lote grande pode
  levar alguns minutos.
- Professor sem login Google não vê o roster nem marca alunos (o roster vem do
  Classroom, nunca do navegador).
