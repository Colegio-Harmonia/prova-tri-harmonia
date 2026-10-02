# Gestão de qualidade das questões — juiz Jev e contrato anti-vazamento

**Status:** implementado em branch `fix/qualidade-geracao-jev-juiz` (02/10/2026), ainda não promovido.
**Origem:** prova #391 (Ciências, 7º ano) saiu com ~100% das questões inviáveis.

## O que estava errado (diagnóstico)

Os sintomas da #391 — alternativa correta igual a um título de capítulo,
"Resposta esperada: O capítulo 10 está intitulado…", texto de apoio abrindo com
"10. Combustíveis, tecnologia e sociedade", enunciado repetindo o texto de apoio,
critérios "definidos na revisão docente" — vinham de **três falhas de desenho**,
não de "IA burra":

1. **O contrato de ancoragem forçava a cópia da planilha.** Para
   `fonte_ancorada`/`interpretativa`, o prompt mandava "copie LITERALMENTE um
   trecho do currículo em `sourceEvidence`" e o gate rejeitava a questão se o
   trecho não existisse palavra por palavra na planilha. A planilha só tem títulos
   e tópicos, então a IA citava um título; a alegação (`claim`) virava a resposta
   correta (objetiva) ou a resposta esperada (descritiva). Se falhava 3 vezes,
   `literalEvidenceFallback` impunha o fragmento mais longo da planilha.
   O "10" da Q9 é o número do **capítulo** da planilha, não o da questão.
2. **Os critérios que enxergam esses defeitos nunca bloqueavam.** O auditor LLM
   tinha `linguagem` e `alinhamento` (e `normalizeStoredQualityReport` rebaixa
   ambos para alerta). O relatório da #391 diz "tautológica… revisão recomendada"
   e mesmo assim marca *aprovado*.
3. **Placeholder e auditoria por amostra.** `gradingCriteria` era sempre
   "Critérios definidos na revisão docente."; a auditoria IA rodava em ~15% das
   questões (só sempre com baixa confiança autodeclarada).

## O que mudou

### Contrato de geração (`src/lib/generation/`)
- Currículo = **escopo**, nunca fonte. O prompt proíbe copiar títulos/tópicos
  e linguagem de planejamento.
- A IA escreve o próprio `supportText`; `sourceEvidence` deve ser citação literal
  **do texto de apoio** (`gateAnchoredClaim`), não da planilha. Sem apoio textual,
  não há o que ancorar.
- `literalEvidenceFallback`/`forcedEvidence` removidos.
- Descritivas exigem `expectedAnswer` (resposta-modelo) e `gradingCriteria`
  (3–5 critérios com pesos) escritos pela IA; em calculáveis a resposta continua
  vindo do recálculo por código.
- `curriculumLeakage.ts` (determinístico): bloqueia linguagem de planejamento,
  alternativa/resposta que reproduz título ou tópico, resposta correta
  tautológica com a pergunta, linha do apoio que é título/numeração do currículo;
  e normaliza apresentação (tira do enunciado a cópia do apoio e o rótulo
  "Leia o texto a seguir." de dentro do apoio).

### Juiz de qualidade = Jev (`src/lib/ai/questionQualityDecision.ts`)
Substitui o auditor LLM (`runSelectiveAudit` e o teste de qualidade em texto
livre). Roda em **toda** questão, no pipeline e na aprovação/regeneração/troca.
- 8 perguntas Noul (probabilidade) com limiar por critério: resposta
  substantiva, cópia do escopo curricular, apoio autossuficiente, alternativas
  homogêneas, resposta única, fatos corretos, enunciado coerente, correção objetiva.
- 1 pergunta Choice: o Jev resolve a questão sozinho (sem ver o gabarito) e a
  letra tem de bater — alimenta o `answerKeyAudit` que a aprovação já exige.
- Regra composta: 3+ alertas simultâneos bloqueiam.
- Bloqueio no pipeline → `StageGateError` → o fluxo existente regenera até 3×
  devolvendo o motivo ao gerador.
- Jev indisponível: **falha aberta com alerta** (os gates determinísticos
  continuam); a aprovação final segue bloqueada sem a conferência de gabarito
  — reexecute o teste de qualidade.
- Relatório: `QUALITY_REPORT_VERSION` → `quality-test-v5`; novos critérios entram
  no conjunto bloqueante; novo diagnóstico `CURRICULUM_LEAK`.

## Calibração (02/10/2026, Jev `jev-latest`)
16 questões: as 10 da #391 e 10 controles bons (6 disciplinas), medido com o
código final: **10/10 ruins barradas, 0/10 controles barrados**. Limiares em
`QUALITY_CRITERIA`. Reexecute a calibração ao trocar a versão do Jev ou os
limiares (`QUESTION_QUALITY_VERSION` invalida o cache).

## Limites conhecidos
- Jev é um juiz probabilístico: julga, não gera. A geração continua no LLM de
  texto configurado em `ai_model_profiles`.
- O mesmo vale para fatos: `fatos_corretos` reduz, não elimina, erro factual;
  a revisão docente continua sendo a barreira final.
- Provas já geradas e aprovadas **não** são reauditadas automaticamente.
  Reexecutar o teste de qualidade (`rerun-quality-test`) em cada uma as passa pelo
  juiz novo.
- O pipeline antigo "fragmentado" (`runners.ts`) está desligado e não foi alterado.

## Operação
Sem migration e sem variável nova (usa `TYPESAFE_API_KEY` já existente). Deploy:
`docker compose up -d --build web` e o `worker` (a geração roda no worker).
Rollback: `git revert` do commit, via PR.
