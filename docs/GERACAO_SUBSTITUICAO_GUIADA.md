# Substituição guiada de questão

## Objetivo

Evitar que a ação **Trocar esta questão** apenas reescreva o mesmo assunto.
Uma troca deve ter uma intenção pedagógica explícita, mantendo o tipo da
questão (objetiva ou descritiva) e os limites do planejamento da prova.

## Jornada do professor

Na revisão, o botão **Trocar esta questão** abre um painel com quatro opções:

| Intenção | Efeito exigido da nova questão |
| --- | --- |
| Outro tema do planejamento | É o padrão. A IA deve selecionar outro capítulo, conteúdo ou habilidade entre os itens disponíveis para aquela prova; não basta mudar a redação ou o contexto. |
| Outra abordagem do mesmo tema | Mantém o conteúdo, mas troca recorte, contexto, situação-problema ou habilidade. |
| Mais fácil | Mantém o escopo curricular, usa linguagem e raciocínio mais diretos e deve retornar classificação pedagógica `facil`. |
| Mais difícil | Mantém o escopo curricular, mas exige análise, aplicação ou relação entre conceitos e deve retornar classificação `dificil`. |

O professor pode ainda escrever uma lista separada por vírgulas de **tema,
autor ou conceito a não usar**. Exemplo: `Aristóteles, ética das virtudes`.
O comentário de revisão continua sendo enviado como contexto complementar.

## Contrato da API

`POST /api/exams/:examId/regenerate-question` aceita opcionalmente:

```json
{
  "questionNumber": 1,
  "reviewFeedback": "Prefiro outro conteúdo do planejamento.",
  "replacement": {
    "strategy": "outro_tema_planejamento",
    "excludedTopics": ["Aristóteles", "ética das virtudes"]
  }
}
```

Estratégias válidas:

- `outro_tema_planejamento`
- `mesmo_tema_outra_abordagem`
- `mais_facil`
- `mais_dificil`

O campo é opcional por compatibilidade com chamadas já existentes. A tela de
revisão sempre o envia para novas trocas.

## Garantias e limites

O prompt recebe a intenção, o enunciado original e todos os conteúdos da
planilha curricular já selecionados para a prova. Para a estratégia padrão,
ele exige outro tema dessa lista, em vez de pedir apenas uma questão “diferente”.

Quando há termos bloqueados, o servidor examina enunciado, texto de apoio,
alternativas, resposta esperada e critérios da questão candidata. Se algum
termo ainda aparecer (comparação sem distinção de maiúsculas ou acentos), a
resposta é rejeitada e o mecanismo de reparo tenta outra geração; ela nunca é
salva na prova com o termo proibido.

A diversidade semântica automática é uma regra de prompt, pois identificar o
“tema central” somente por comparação literal não é confiável. Para casos em
que o assunto não pode reaparecer — como Aristóteles — o professor deve usar o
campo de bloqueio, que fornece a garantia verificável.

Questões reais do banco ENEM continuam sem regeneração por IA.

## Validação realizada

- `npm run typecheck`
- `npx vitest run src/lib/gemini/replacementPolicy.test.ts`
- `npx eslint` nos arquivos modificados
- `npm run build`
