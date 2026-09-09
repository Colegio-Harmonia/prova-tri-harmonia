# SOLO_OBSERVED em Respostas Discursivas

**Data:** 17/07/2026
**Subtarefa:** 16

Este documento descreve a integração de `SOLO_OBSERVED` no fluxo de correção.

## Regra de aplicação

`SOLO_OBSERVED` só é gerado para respostas discursivas analisáveis:

- `exam_corrections.answers[].type === "descritiva"`;
- `transcribedAnswer.trim()` não vazio;
- correção salva como `status:"revisado"`;
- somente na transição `pendente → revisado`.

Questões objetivas são sempre ignoradas, mesmo quando há alternativa marcada.

## Persistência

Cada classificação é gravada no motor pedagógico como:

```text
classifiable_type = exam_correction_answer
classifiable_id = exam_corrections.id
classifiable_sub_id = answers[].questionNumber
taxonomy_code = SOLO_OBSERVED
source = AI
status = sugerida
```

O serviço usa `suggest()` de `classificationService.ts`, então mantém as
mesmas regras de versionamento, precedência, `is_current` e auditoria já
existentes.

## Arquivo principal

```text
src/lib/pedagogical/soloObservedClassificationService.ts
```

O serviço:

- ignora questões objetivas;
- ignora respostas discursivas vazias;
- preserva classificações correntes `aprovada` ou `em_revisao`;
- chama IA com prompt específico de SOLO_OBSERVED;
- valida/repara a resposta via `generateValidatedStructuredContent()`;
- persiste a sugestão em `pedagogical_classifications`.

## Prompt e categorias

Categorias permitidas:

- `PRE_ESTRUTURAL`;
- `UNIESTRUTURAL`;
- `MULTIESTRUTURAL`;
- `RELACIONAL`;
- `ABSTRATO_AMPLIADO`.

O prompt reforça que `SOLO_OBSERVED` mede a estrutura real da resposta do
aluno, não é nota, não usa `SOLO_EXPECTED` como atalho, e nunca se aplica a
questão objetiva.

## Comportamento da rota de correção

`PATCH /api/exams/[examId]/corrections/[correctionId]` agora retorna:

```json
{
  "correction": {},
  "warnings": [],
  "soloObservedClassificationsCreated": 0
}
```

Se a classificação falhar, a correção continua salva. A falha é registrada no
log do servidor e retornada em `warnings`, porque `SOLO_OBSERVED` é camada
analítica adicional e não deve bloquear a correção do professor.

## Fora do escopo

- UI para revisar/aprovar `SOLO_OBSERVED`.
- Dashboard de SOLO.
- Perfil cognitivo do aluno.
- Classificação de questões objetivas.
- Reclassificação automática quando uma resposta já revisada é editada.
