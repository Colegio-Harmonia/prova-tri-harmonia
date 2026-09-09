# Atividades de reforço ENEM autogeridas

Atividades com `exam_kind = reforco_enem` são geridas pelo professor que as
criou. Elas compartilham a geração de documentos, correção e publicação no
Classroom com as provas, mas não entram na fila formal de atribuição e
aprovação.

## Fluxo

1. A geração registra o professor criador como responsável, sem notificação
   de atribuição.
2. O criador (ou coordenação/direção) revisa o rascunho e usa **Finalizar
   atividade e gerar documentos**: `rascunho → aprovado`.
3. Depois da aplicação, usa **Marcar atividade como aplicada**:
   `aprovado → aplicado`.
4. A correção continua o fluxo compartilhado: `aplicado → corrigido`.

Atividades antigas sem `assigned_to` permanecem visíveis ao criador por
`created_by OR assigned_to`; ao finalizar, o responsável é preenchido. As
ações formais de atribuir, iniciar/concluir revisão, aprovar, imprimir e
marcar aplicação são recusadas pela API para atividades. Provas seguem usando
essas ações sem alteração.

## Verificação

- `npm exec vitest run src/lib/exams/activityWorkflow.test.ts`
- `node --experimental-strip-types --input-type=module` com as regras de
  `activityWorkflow.ts`
- em DEV e produção: `/login` deve retornar `200` e `/atividades` deve
  redirecionar anônimos com `307`.

O deploy segue `develop → DEV (3011) → main → produção (3010)`, com build
concluído antes de reiniciar aplicação e worker.
