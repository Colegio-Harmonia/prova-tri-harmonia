# Geração de Questões — Metadados Pedagógicos

**Data:** 17/07/2026
**Subtarefa:** 14

Este documento descreve como a geração de novas questões passa a produzir
metadados pedagógicos estruturados para o Motor de Classificações Pedagógicas.

## 1. Campo estruturado no payload

Cada `ExamQuestion` gerada deve conter:

```ts
pedagogicalClassification: {
  dok: {
    categoryCode: 'DOK_1' | 'DOK_2' | 'DOK_3' | 'DOK_4'
    confidence: number
    justification: string
    evidence: string
  }
  soloExpected: {
    categoryCode: 'UNIESTRUTURAL' | 'MULTIESTRUTURAL' | 'RELACIONAL' | 'ABSTRATO_AMPLIADO'
    confidence: number
    justification: string
    evidence: string
  }
  estimatedTimeMinutes?: number | null
  difficulty?: 'facil' | 'media' | 'dificil' | null
}
```

`DOK` e `SOLO_EXPECTED` têm confiança, justificativa e evidência próprias.
Não existe confiança única compartilhada.

## 2. Validação de schema

O campo foi adicionado em `src/lib/gemini/examSchema.ts` e é obrigatório para
novas respostas da IA, tanto na geração da prova inteira quanto na troca de
uma questão.

O schema enviado ao DeepSeek também exige esse bloco, então a resposta é
validada antes de salvar o payload.

## 3. Prompt

`src/lib/gemini/promptBuilder.ts` passou a instruir explicitamente:

- `DOK` mede profundidade de raciocínio, não dificuldade.
- `SOLO_EXPECTED` mede estrutura esperada da questão, não desempenho observado.
- Cada classificação precisa ter evidência curta retirada da própria questão.
- `SOLO_OBSERVED` não é gerado aqui.

## 4. Persistência no motor

Após salvar a prova, a rota `POST /api/exams/generate` chama:

```ts
persistGeneratedQuestionClassifications()
```

Arquivo:

```text
src/lib/pedagogical/generatedQuestionClassificationService.ts
```

O serviço grava sugestões em `pedagogical_classifications` com:

```text
classifiable_type = generated_exam_question
classifiable_id = generated_exams.id
classifiable_sub_id = question.number
source = AI
```

Cada questão gerada por IA cria até duas sugestões:

- `DOK`;
- `SOLO_EXPECTED`.

Classificações correntes existentes são preservadas. Na troca de uma questão,
o serviço permite nova sugestão para o mesmo endereço; se houver classificação
humana aprovada, a regra de precedência do `classificationService` impede
sobrescrita automática.

## 5. Questões do banco ENEM dentro da prova

Questões `source:"enem_bank"` também recebem `pedagogicalClassification` no
payload para manter o schema consistente, mas a rota de geração não grava essas
classificações como `generated_exam_question` no motor. A integração própria
do ENEM permanece a da Subtarefa 12.

## 6. Validação e reparo de resposta da IA

A Subtarefa 15 adicionou um gate central em:

```text
src/lib/gemini/structuredRepair.ts
```

Esse helper valida a resposta com Zod, executa validação semântica quando o
call site fornece uma função, faz uma tentativa limitada de reparo por prompt
e descarta a resposta se ela continuar inválida. As rotas de geração não devem
persistir prova ou questão gerada por IA quando esse gate falhar.

Detalhes operacionais:

```text
docs/AI_RESPONSE_VALIDATION_REPAIR.md
```

## 7. Fora do escopo

- Registro estruturado de falhas de IA em tabela própria.
- `SOLO_OBSERVED`.
- Dashboards.

Esses pontos começam em subtarefas posteriores.

## 8. Gate de fidelidade posterior

Gerações novas podem ser submetidas ao gate reversível descrito em
`docs/GATE_FIDELIDADE_PEDAGOGICA.md`. Quando `PEDAGOGICAL_QUALITY_GATE_ENABLED=true`,
a segunda revisão recebe o artefato sem os rótulos da geração e precisa
confirmar DOK/SOLO com evidência literal antes da persistência.
