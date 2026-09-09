# API Interna — Motor de Classificações Pedagógicas

**Data:** 17/07/2026
**Subtarefa:** 08; atualizado nas Subtarefas 09, 10 e 11

Este documento registra os contratos internos criados para expor a camada de
serviço do Motor de Classificações Pedagógicas.

Todas as rotas abaixo exigem sessão autenticada na plataforma. Nesta subtarefa,
as rotas delegam regras de domínio para
`src/lib/pedagogical/classificationService.ts`; handlers não devem duplicar
regras de status, versionamento, `is_current` ou auditoria.

## 1. Criar sugestão

`POST /api/pedagogical/classifications`

Body:

```json
{
  "classifiableType": "generated_exam_question",
  "classifiableId": 21,
  "classifiableSubId": 2,
  "taxonomyCode": "DOK",
  "categoryCode": "DOK_2",
  "confidence": 0.8,
  "source": "AI",
  "explanation": "Múltiplas etapas, caminho único.",
  "evidence": "Trecho usado como evidência.",
  "manualVersion": "1.0",
  "modelProvider": "deepseek",
  "modelName": "deepseek-v4-flash",
  "promptVersion": "pedagogical-v1",
  "isPrimary": true
}
```

Validações:

- `classifiableType`: `imported_question`, `generated_exam_question` ou `exam_correction_answer`.
- `classifiableId`: inteiro positivo.
- `classifiableSubId`: inteiro positivo opcional ou `null`.
- `taxonomyCode` e `categoryCode`: strings obrigatórias.
- `confidence`: número entre `0` e `1`, opcional ou `null`.
- `source`: `AI`, `TEACHER`, `PEDAGOGICAL_REVIEW`, `ENEM_IMPORT`, `MANUAL_IMPORT`, `SYSTEM_RULE` ou `OFFICIAL_SOURCE`.

Resposta:

```json
{
  "classification": {}
}
```

## 2. Consultar classificação corrente

`GET /api/pedagogical/classifications?classifiableType=generated_exam_question&classifiableId=21&classifiableSubId=2&taxonomyCode=DOK`

Retorna a classificação corrente para uma taxonomia específica:

```json
{
  "classification": {}
}
```

Se `taxonomyCode` for omitido, retorna todas as classificações correntes do
item, indexadas por código de taxonomia:

```json
{
  "classifications": {
    "DOK": {},
    "SOLO_EXPECTED": {}
  }
}
```

## 3. Aprovar classificação

`POST /api/pedagogical/classifications/:classificationId/approve`

Sem body.

Efeito:

- marca a classificação como `aprovada`;
- torna a classificação corrente;
- substitui outras correntes do mesmo item/taxonomia;
- grava auditoria.

Validação de estado:

- só aceita classificações `sugerida` ou `em_revisao`;
- classificações `aprovada`, `rejeitada`, `substituida` ou `desatualizada`
  não podem ser aprovadas novamente por esta rota.

## 4. Rejeitar classificação

`POST /api/pedagogical/classifications/:classificationId/reject`

Body:

```json
{
  "reason": "Categoria não sustentada pela evidência."
}
```

Efeito:

- marca a classificação como `rejeitada`;
- remove a classificação da corrente;
- grava auditoria.

Validação de estado:

- só aceita classificações `sugerida` ou `em_revisao`;
- uma classificação já aprovada deve ser substituída por nova versão, não
  rejeitada diretamente.

## 5. Substituir classificação

`POST /api/pedagogical/classifications/:classificationId/supersede`

Body: mesmo contrato de criação de sugestão, mais `reason` opcional.

Efeito:

- cria nova classificação `aprovada`;
- aponta `supersedes_id` para a classificação substituída;
- torna a nova classificação corrente;
- marca classificações correntes anteriores como `substituida`;
- grava auditoria.

## 6. Histórico

`GET /api/pedagogical/classifications/:classificationId/history`

Resposta:

```json
{
  "history": [],
  "versionChain": []
}
```

`history` traz os eventos de auditoria da classificação solicitada.
`versionChain` traz a classificação solicitada e as versões anteriores ligadas
por `supersedes_id`, da mais nova para a mais antiga.

## 7. Marcar classificações desatualizadas por versão do manual

`POST /api/pedagogical/classifications/outdated`

Body:

```json
{
  "taxonomyCode": "DOK",
  "fromManualVersion": "1.0",
  "toManualVersion": "1.1",
  "reason": "Manual pedagógico atualizado."
}
```

Validações:

- `taxonomyCode`: opcional; se omitido, aplica a todas as taxonomias do motor.
- `fromManualVersion`: versão atual das classificações que devem ser marcadas.
- `toManualVersion`: nova versão do manual que motivou a desatualização.
- `reason`: motivo opcional para auditoria.

Efeito:

- seleciona classificações correntes com `manual_version = fromManualVersion`;
- restringe por taxonomia quando `taxonomyCode` é informado;
- marca essas classificações como `desatualizada`;
- define `is_current:false`;
- grava auditoria com action `outdated`;
- não cria nova classificação automaticamente.

## 8. Fora do escopo desta subtarefa

- UI de revisão humana.
- Integração automática com geração de prova.
- Integração automática com correção.
- Dashboard/relatórios.
- Políticas finas de autorização por papel ou por disciplina.

## 9. Auditoria centralizada

Atualizado na Subtarefa 10: toda gravação de auditoria do motor deve passar
por `src/lib/pedagogical/auditService.ts`.

Funções:

- `recordClassificationAudit(client, params)`: registra evento em
  `pedagogical_classification_audit`.
- `getClassificationAuditHistory(classificationId)`: retorna histórico de uma
  classificação.

Eventos cobertos no serviço de classificação:

- `created`: criação de sugestão ou nova versão.
- `approved`: aprovação humana.
- `rejected`: rejeição humana.
- `edited`: mudança operacional de estado, como entrada em revisão humana.
- `superseded`: substituição de versão corrente.
- `outdated`: desatualização por mudança de versão do manual.

Handlers de API não devem inserir auditoria diretamente nem duplicar regras de
auditoria; devem chamar `classificationService.ts`.

## 10. Revisão humana e precedência

Atualizado na Subtarefa 11: a revisão humana tem dois contratos internos novos.

### 10.1 Iniciar revisão

`POST /api/pedagogical/classifications/:classificationId/review`

Body opcional:

```json
{
  "reason": "Baixa confiança ou ambiguidade pedagógica."
}
```

Efeito:

- muda `status` de `sugerida` para `em_revisao`;
- mantém `is_current` inalterado;
- grava auditoria com action `edited`;
- chamada repetida em item já `em_revisao` é idempotente.

Validação de estado:

- só aceita `sugerida` ou `em_revisao`;
- estados finais não voltam para revisão por esta rota.

### 10.2 Fila de revisão

`GET /api/pedagogical/classifications/review-queue`

Query params opcionais:

- `classifiableType`: restringe a `imported_question`, `generated_exam_question`
  ou `exam_correction_answer`.
- `taxonomyCode`: restringe por taxonomia.
- `status`: `sugerida` ou `em_revisao`.
- `requiresHumanReviewOnly`: `true` ou `false`.
- `limit`: inteiro positivo até `200`.

Resposta:

```json
{
  "classifications": [
    {
      "id": 1,
      "status": "em_revisao",
      "confidenceBand": "review_required",
      "requiresHumanReview": true,
      "precedence": {
        "code": "automatic_unreviewed",
        "rank": 4,
        "label": "Classificacao automatica ainda nao revisada"
      }
    }
  ]
}
```

### 10.3 Ordem de precedência

Implementada em `getClassificationPrecedence()`:

1. `human_approved`: classificação aprovada por `TEACHER` ou
   `PEDAGOGICAL_REVIEW`.
2. `official_validated`: classificação aprovada por `ENEM_IMPORT`,
   `MANUAL_IMPORT` ou `OFFICIAL_SOURCE`.
3. `reviewed_ai`: classificação aprovada de outra fonte, como IA revisada.
4. `automatic_unreviewed`: classificação automática ainda não revisada.

Nova sugestão automática não substitui classificação corrente `aprovada` nem
`em_revisao`; nesses casos ela é criada isolada, com `is_current:false`, até
uma revisão humana decidir aprovar/substituir explicitamente.

## 11. Integração com correções discursivas

Atualizado na Subtarefa 16: quando uma correção muda de `pendente` para
`revisado`, a rota:

```text
PATCH /api/exams/[examId]/corrections/[correctionId]
```

gera sugestões `SOLO_OBSERVED` para cada resposta discursiva com texto
transcrito. O endereço usado no motor é:

```text
classifiableType = exam_correction_answer
classifiableId = exam_corrections.id
classifiableSubId = answers[].questionNumber
taxonomyCode = SOLO_OBSERVED
```

Questões objetivas e respostas discursivas vazias são ignoradas. Falha na
classificação não desfaz a correção; a rota retorna `warnings` e
`soloObservedClassificationsCreated`.
