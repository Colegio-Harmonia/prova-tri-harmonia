# Resposta esperada obrigatória + verbos de comando em negrito (05/10/2026)

## 1. Resposta esperada obrigatória nas descritivas

**Problema**: `expectedAnswer`/`gradingCriteria` eram opcionais no schema e nenhuma
camada exigia o preenchimento. Descritivas saíam sem resposta de referência e a
correção (gabarito do professor + nota sugerida por IA) ficava sem base.

**Regra**: toda questão `type: "descritiva"` precisa de `expectedAnswer` concreta
(mínimo 15 caracteres, `MIN_REFERENCE_ANSWER_LENGTH`). `gradingCriteria` é
esperado, mas sua ausência é só aviso. Helper único:
`src/lib/exams/referenceAnswer.ts`.

Onde é aplicada:

| Camada | Arquivo | Efeito |
|---|---|---|
| Prompt (prova inteira e troca de 1 questão) | `promptBuilder.ts` (`buildReferenceAnswerInstruction`) | IA recebe a exigência, inclusive resposta por parte (a, b, c) |
| Schema Gemini | `examSchema.ts` | descrição "OBRIGATÓRIO para descritiva" |
| Validador | `examValidator.ts` (`correctSingleQuestion`) | vira `issue` → dispara o reparo (`structuredRepair`); cobre geração, regeneração e troca de questão |
| Revisão | `RevisarExam.tsx` | alerta vermelho na descritiva sem resposta (provas antigas) |
| Fluxo de status | `status/route.ts` | `concluir_revisao`, `aprovar` e `finalizar_atividade` retornam 422 `missing_reference_answer` listando as questões |
| Correção | `corrections/[id]/suggest/route.ts` | recusa sugerir nota por IA sem resposta esperada (422), em vez de inventar a base |
| Gabarito | `gabaritoDocBuilder.ts` | em vez de "—", imprime "NÃO CADASTRADA — definir antes de corrigir" |

Provas **antigas** sem resposta esperada não são alteradas automaticamente: ficam
bloqueadas para concluir/aprovar até o revisor usar "Trocar só essa questão".

## 2. Verbos de comando em negrito (Google Docs, Fundamental 1 e 2)

**Regra**: no documento da **Prova** (e da Prova Adaptada), os verbos de comando do
**enunciado** (`statement`) saem em negrito; todo o resto do texto permanece como
está. Ensino Médio não recebe o destaque.

- Não é negrito em: texto de apoio, alternativas, número da questão, linhas de resposta.
- Implementação: `src/lib/docs/commandVerbs.ts` (`splitCommandVerbs`,
  `shouldBoldCommandVerbs`), plugado em `provaDocBuilder.ts` via o `bold` por trecho
  que o `ProvaOp` já suportava.
- Detecção **determinística** (lista fechada de imperativos: explique, analise, cite,
  justifique, descreva, calcule, assinale, leia, responda…). Não depende da IA, então
  vale também para provas já geradas.
- Acentos são respeitados no match: "analise" (verbo) ≠ "análise" (substantivo).
- Formas que também são substantivo (`escolha`, `informe`, `destaque`) só viram
  negrito no início de frase.
- Disciplina Inglês: reconhece também comandos em inglês (Read, Write, Choose…), só
  em início de frase.

**Limites conhecidos**: verbo fora da lista não é destacado (basta incluí-lo em
`COMMAND_VERBS_PT`); imperativo usado em outro sentido dentro do enunciado (ex.:
subjuntivo "para que ele determine") pode ser negritado. A tela de revisão do
sistema não mostra o negrito — só o documento final.

Testes: `commandVerbs.test.ts`, `provaDocBuilder.test.ts`, `examValidator.test.ts`.
