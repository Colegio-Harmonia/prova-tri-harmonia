# Relatório transparente: geração de provas e revisão do Jev

**Data:** 05/10/2026  
**Finalidade:** compartilhar com outra IA o fluxo implementado, o comportamento observado em produção e os bloqueios ainda sem solução comprovada.  
**Escopo:** geração das questões de prova, validações locais, auditoria Jev, correção automática e decisão de interromper ou concluir o job.

## Resumo executivo

O sistema já gera as questões em paralelo, usa o planejamento curricular selecionado como fonte escolar, inclui contexto oficial de habilidades BNCC e executa uma auditoria final do Jev. Se houver reprovação, envia uma correção da questão em JSON completo, limita a duas intervenções por questão e reavalia o resultado.

Isso **não garante** que a questão será aprovada. No job mais recente observado (#23912), a geração produziu 12 posições. Q5, Q6, Q7, Q9 e Q11 terminaram reprovadas depois de consumirem o limite de duas correções. A prova não foi entregue porque a barreira final impede concluir com questões reprovadas pelo Jev.

O bloqueio central é a diferença entre **decidir que existe um defeito** e **descrever evidência suficiente para corrigi-lo**. O Jev retorna decisões tipadas por critério, mas várias instruções exibidas e enviadas à correção são mensagens padronizadas do próprio código. Em casos como “supportText ou statement induz a resposta”, o diagnóstico não identifica necessariamente a frase exata que contém a pista. A IA corretora recebe a questão e uma instrução ampla, precisa inferir o que deve mudar e pode devolver uma versão que o Jev reprova pelo mesmo critério.

Há também uma decisão de produto que precisa ser explícita: **não entregar questão reprovada** e **nunca terminar a geração com erro** não podem ser garantidos ao mesmo tempo quando Jev e gerador podem discordar ou falhar. Se o limite de correções acaba sem aprovação, as opções reais são bloquear a prova, aceitar a questão sem aprovação, pedir ação humana ou permitir novas tentativas com custo e duração maiores. Hoje o sistema escolhe bloquear.

## O que acontece hoje, do pedido ao resultado

### 1. Entrada e fonte curricular

O pedido de geração carrega a etapa, série, turma, disciplina, quantidade de questões, distribuição e recorte curricular escolhido. No fluxo atual, a fonte de ensino é o **planejamento curricular da turma**; o material de planejamento fornece tema, conteúdo, objetivos e fatos de ensino.

O código BNCC é resolvido localmente com `@bncc/dados` por `getOfficialBnccSkill`. Quando o registro é encontrado, o sistema pode fornecer ao gerador/Jev código, descrição oficial e contexto relacionado (componente, ano, organização, objeto de conhecimento/eixo e fonte/versão dos dados). Esse pacote oficial esclarece a habilidade; ele **não substitui o planejamento como fonte do conteúdo específico da turma**.

Referências: [planCurriculum.ts](/home/eduardo/prova-tri/src/lib/curriculum/planCurriculum.ts), [officialBncc.ts](/home/eduardo/prova-tri/src/lib/curriculum/officialBncc.ts), [curriculumService.ts](/home/eduardo/prova-tri/src/lib/sheets/curriculumService.ts).

### 2. Planejamento da prova e geração das questões

O sistema constrói slots por questão, com unidade curricular, tipo e orientação visual; gera um blueprint para os slots; e então chama o pipeline unificado por questão. O código atual usa `Promise.all` para processar em paralelo as questões independentes, de modo que a espera principal é a latência e a cota do provedor externo, não CPU local.

Cada questão gerada passa por validações locais e normalização estrutural, incluindo coerência matemática disponível, campos requeridos e compatibilidade com o esquema. Essas validações podem rejeitar uma resposta da IA antes do Jev; elas não são a decisão semântica final de qualidade.

Referências: [generateExamCore.ts](/home/eduardo/prova-tri/src/lib/exams/generateExamCore.ts), [unifiedQuestionGeneration.ts](/home/eduardo/prova-tri/src/lib/exams/unifiedQuestionGeneration.ts), [examValidator.ts](/home/eduardo/prova-tri/src/lib/gemini/examValidator.ts), [examSchema.ts](/home/eduardo/prova-tri/src/lib/gemini/examSchema.ts).

### 3. Auditoria final do Jev

Depois de montar as questões, o sistema envia uma auditoria final por questão. As avaliações independentes são feitas em paralelo. O contexto inclui, conforme aplicável, disciplina, etapa, ano, turma, habilidade oficial, escopo curricular, enunciado, texto de apoio, alternativas, gabarito e evidências auxiliares produzidas por verificações locais.

O Jev avalia critérios tipados — por exemplo, adequação à turma, alinhamento à habilidade, suficiência de informação, resposta induzida, qualidade factual, cálculo/dados, resposta única, completude e padrão das alternativas. Em questões objetivas ele também resolve a questão independentemente para conferir o gabarito. Para matemática e algumas ciências há ainda uma verificação específica sobre alternativas que revelam fórmula, conta ou etapas quando o aluno deveria selecionar o resultado.

As verificações locais são evidências de contexto. O código declara que a reprovação semântica final pertence ao Jev; regras locais também podem rejeitar defeitos estruturais durante geração e fornecem evidência para a auditoria.

O cliente do Jev usa o serviço TypeSafe/SystemOne, com cache por conteúdo e versão da avaliação. O retorno é analisado como respostas tipadas (`noul`, `choice` ou `score`), não como um relatório livre necessariamente contendo uma explicação textual detalhada.

Referências: [questionQualityDecision.ts](/home/eduardo/prova-tri/src/lib/ai/questionQualityDecision.ts), [jevClient.ts](/home/eduardo/prova-tri/src/lib/ai/jevClient.ts), [questionQualityTest.ts](/home/eduardo/prova-tri/src/lib/exams/questionQualityTest.ts).

### 4. Conversão da reprovação em diagnóstico

O código transforma os critérios reprovados em um contrato de diagnóstico com código, gravidade, ação sugerida, campos autorizados, campos protegidos, localização, evidência e condição de resolução.

Parte do diagnóstico é realmente específica, como “alternativa B destoa” com localização `alternatives.B`. Em outros casos, o campo `evidence` é preenchido com o texto completo de apoio ou enunciado, não com a frase exata que motivou a decisão. As frases “Retire a conclusão antecipada” e “Há possível erro factual” são instruções produzidas pelo mapeamento do código, e não necessariamente explicações novas escritas pelo Jev.

No critério `resposta_induzida`, por exemplo, o mapeamento atual usa `supportText ou statement` quando há texto de apoio e inclui o texto de apoio inteiro como evidência. Isso não afirma qual frase é a conclusão antecipada. Para `calculo_ou_dados` e `fatos_corretos`, o sistema pode autorizar vários campos de uma vez e usar o motivo do critério como correção exigida. A correção recebe portanto um diagnóstico estruturado, mas nem sempre um diagnóstico **cirúrgico, demonstrável e localizável**.

Quando três ou mais sinais são alertas, o Jev pode produzir uma reprovação composta. O código atual substitui o diagnóstico composto genérico pelos critérios componentes, promovendo-os a bloqueantes, para não perder as causas individuais. Isso melhora a instrução, mas não cria evidência textual que o Jev não tenha fornecido.

Referências: [qualityDiagnostics.ts](/home/eduardo/prova-tri/src/lib/exams/qualityDiagnostics.ts), [questionQualityTest.ts](/home/eduardo/prova-tri/src/lib/exams/questionQualityTest.ts), [questionQualityDecision.ts](/home/eduardo/prova-tri/src/lib/ai/questionQualityDecision.ts).

### 5. Correção automática

Para uma questão reprovada com diagnóstico acionável, o sistema:

1. envia à IA corretora o planejamento curricular, a etapa/série/turma, as habilidades oficiais disponíveis, os diagnósticos e a questão completa;
2. instrui a IA a fazer a menor alteração possível e devolver o JSON completo;
3. declara quais campos podem mudar e quais devem permanecer protegidos;
4. normaliza alguns formatos de resposta de alternativas e restaura campos protegidos;
5. valida a questão corrigida estruturalmente e aplica verificações locais;
6. envia a questão alterada novamente à auditoria Jev.

O objetivo implementado é correção direcionada, não recriar a prova inteira. Dependendo do diagnóstico, o escopo permitido pode, contudo, ser mais amplo: diversos critérios são mapeados para mais de um campo, e várias reprovações simultâneas unem esses campos num mesmo pedido de correção.

O “reparo cirúrgico” ainda não é garantido pelo contrato atual: o prompt pode identificar o critério e o campo sem identificar a passagem defeituosa e o teste objetivo que provaria que o defeito desapareceu.

Referências: [repairQuestion.ts](/home/eduardo/prova-tri/src/lib/exams/repairQuestion.ts), [structuredRepair.ts](/home/eduardo/prova-tri/src/lib/gemini/structuredRepair.ts), [generateExamCore.ts](/home/eduardo/prova-tri/src/lib/exams/generateExamCore.ts).

### 6. Limites de tentativas e bloqueio da entrega

O pipeline final admite até duas intervenções de qualidade por questão/job. A reserva desse orçamento fica em `generation_job_items.quality_repair_attempts`. Cada intervenção é seguida de uma nova auditoria; se ainda houver reprovações, as questões permanecem em erro e o job não salva/entrega a prova final.

Há outro contador separado: o job da fila pode ter até duas execuções. Esse contador não é o mesmo que as duas correções de qualidade. O worker usa heartbeat, retoma slots e pode reexecutar o job; isso não significa que a questão tenha sido aprovada.

A mensagem “A geração foi interrompida para não entregar questões pendentes do Jev” é, portanto, um **bloqueio intencional de qualidade**. No caso analisado, não é a falha SQL de inserção de slots que ocorreu no job #292 anterior.

Referências: [jobProgress.ts](/home/eduardo/prova-tri/src/lib/queue/jobProgress.ts), [schema.ts](/home/eduardo/prova-tri/src/db/schema.ts), [generation-worker.ts](/home/eduardo/prova-tri/scripts/generation-worker.ts), [generateExamCore.ts](/home/eduardo/prova-tri/src/lib/exams/generateExamCore.ts).

## Evidência de produção analisada

O job mais recente compatível com o texto enviado é o **#23912**, tipo `gerar_prova`, status `erro`, tentativa de job `2/2`. Os timestamps registrados no banco são 05/10/2026 19:40:31–19:43:36 UTC, correspondentes a aproximadamente 16:40–16:43 em São Paulo. A captura informa fila de 2min39s e geração de 3min04s.

O banco registra 12 posições. Q5, Q6, Q7, Q9 e Q11 estão em erro e cada uma consumiu `quality_repair_attempts=2`. O erro final registra:

| Questão | Diagnóstico visível após as correções | O que a evidência permite concluir |
|---|---|---|
| Q5 | Enunciado/apoio induz a resposta | A reprovação continuou no critério após o orçamento de duas correções. A mensagem não revela o trecho exato da pista. |
| Q6 | Resposta induzida e alternativa B fora do padrão | Dois defeitos diferentes pedem mudanças em campos diferentes; o sistema os corrigiu dentro do mesmo orçamento por questão e o resultado ainda não foi aprovado. |
| Q7 | Divergência entre cálculo/dados e resposta esperada; possível erro factual | O diagnóstico amplo não expõe na mensagem o valor recalculado, qual dado é confiável ou qual afirmação factual está errada. |
| Q9 | Alternativa C fora do padrão | O alvo é localizado, mas o relato não mostra o texto original, a resposta devolvida nem a justificativa final do Jev. |
| Q11 | A questão precisa ser refeita a partir da fonte curricular | A instrução é ampla; não identifica qual afirmação precisa ser substituída. |

Os registros de itens confirmam o consumo do orçamento e armazenam payload/diagnósticos finais. Essa evidência prova que o fluxo tentou corrigir e reavaliar; **não prova que a correção enviada resolveu o defeito**. Para reconstruir cada ciclo com precisão, é necessário correlacionar a questão antes/depois, o prompt e resposta da correção e o resultado bruto/normalizado do Jev. O resumo exibido na fila não contém essa trilha completa.

## O que já foi corrigido e o que isso resolveu

1. **Falha de inserção dos slots no banco:** a migration 0048 adicionou `quality_repair_attempts`; a coluna está presente no banco atual. Isso resolveu a falha SQL de inserção em lote observada anteriormente, não a qualidade semântica.
2. **Limite contra ciclo infinito:** há no máximo duas correções de qualidade por questão/job, contabilizadas no banco. Isso limita custo e duração, mas pode terminar com questões não aprovadas.
3. **Prompt de correção com questão inteira:** a IA recebe instruções para devolver o JSON completo, com campos autorizados/protegidos. Isso evita depender de patches parciais em muitos casos, mas não garante que a instrução descreva exatamente a causa.
4. **Normalização da resposta do modelo:** há tratamento para formatos alternativos de objeto de alternativas e restauração de campos não autorizados. Isso trata erros de forma/estrutura vistos em logs anteriores, não os erros pedagógicos repetidos.
5. **Discordância do gabarito com confiança baixa:** divergências abaixo de 60% passaram a ser alerta inconclusivo, em vez de reprovação automática. A mudança não elimina os demais critérios que barraram o job #23912.
6. **Diagnóstico composto:** critérios constituintes são expostos separadamente no diagnóstico. Ainda assim, cada componente pode não conter citação ou dado verificável.
7. **Geração paralela:** as questões independentes são processadas em paralelo. Reduz espera; não melhora, por si só, precisão das respostas nem convergência da auditoria.

O build com essas mudanças foi executado para `web` e `worker` diretamente da árvore da VPS, e o job #23912 ocorreu depois desse rebuild. Portanto, a falha mais recente não pode ser explicada simplesmente por aquele código ainda não ter sido implantado. A árvore de trabalho permanece com alterações não commitadas; o deploy foi feito da imagem construída localmente na VPS.

## Bloqueios que ainda precisam ser resolvidos

### A. A decisão do Jev não é necessariamente um diagnóstico reparável

Uma classificação como “resposta induzida” é uma decisão útil para triagem, mas para correção automática confiável precisa vir acompanhada da passagem exata, do campo, do motivo verificável e do critério que o reparo deve satisfazer. Hoje algumas instruções são templates gerais criados pelo conversor local.

### B. Falta uma prova de que cada reparo corrigiu a causa

O fluxo reavalia a nova questão, mas o relatório final pode somente dizer que o mesmo critério continua reprovado. Não há evidência visível ao professor ou no resumo do job de uma comparação “passagem apontada antes → passagem removida/alterada depois → teste determinístico ou decisão Jev que confirmou”.

### C. Problemas simultâneos aumentam o escopo permitido

Se uma questão tem problemas em texto de apoio, enunciado, cálculo, fatos e alternativas, a união dos campos autorizados pode deixar de ser uma edição pequena. A IA pode alterar conteúdo válido junto com conteúdo defeituoso; o Jev então avalia o novo conjunto e pode apontar outra falha ou repetir a anterior.

### D. Cálculos/fatos precisam de referência objetiva

“Corrija o cálculo” só é acionável com os dados usados, operação, resultado calculado independentemente, alternativa/resposta comparada e regra de arredondamento. “Refaça a partir da fonte curricular” não substitui essa conferência: o planejamento pode fornecer o conteúdo didático, mas não necessariamente uma solução matemática calculada.

### E. Existe conflito de requisitos no caso de falha persistente

Com tentativas limitadas, resultados externos imperfeitos e um Jev que pode reprovar novamente, o sistema precisa de um resultado terminal definido. Sem banco reserva de questões (preferência expressa do usuário), as alternativas são: uma tentativa adicional controlada de regeneração da mesma posição; revisão humana; ou erro do job. Entregar questão pendente seria uma quarta opção, mas contradiz a exigência de não deixar questões do Jev pendentes.

### F. Observabilidade ainda é insuficiente para afirmar causalidade por questão

O status e o resumo preservam o diagnóstico final e a contagem de correções. Para descobrir por que Q5/Q6/Q7 repetiram, é preciso inspecionar os registros completos de geração/telemetria do job: entrada do Jev, resposta tipada, diagnóstico convertido, prompt de reparo, JSON recebido, campos alterados, validações locais e nova resposta Jev. Sem esses pares, não se sabe se o modelo ignorou a instrução, se a instrução era ambígua, se o teste Jev interpretou a questão de maneira diferente ou se o mapeamento do diagnóstico apontou o campo errado.

## O que a próxima análise externa deve responder

Peça à IA consultora que examine este relatório e o código indicado, e responda com evidência, não apenas sugestões de prompt:

1. O contrato atual do Jev consegue devolver evidência textual localizada e confiança por critério, ou somente classificação/score? Se consegue, onde essa evidência se perde no código?
2. Em Q5/Q6/Q7/Q9/Q11 do job #23912, como correlacionar os dados persistidos para reconstruir cada versão, cada chamada de correção e cada decisão Jev? Quais eventos faltam registrar?
3. Como transformar cada bloqueio em um objeto verificável com `criterion`, `fieldPath`, `quotedEvidence`, `expectedChange`, `protectedFields` e `passCondition`, sem inferir a correção a partir de mensagem livre?
4. Quais verificações matemáticas/factuais podem ser determinísticas e quais precisam ficar explicitamente sob decisão do Jev?
5. Como impedir repetir uma questão que foi reprovada pelo mesmo critério sem deixar a prova em loop, preservando o planejamento curricular como fonte, sem banco reserva e sem entregar questão pendente?
6. Qual política final é coerente quando a questão continua reprovada após o orçamento: bloquear, revisão humana ou regeneração da mesma posição? Explicite impacto em qualidade, tempo e taxa de jobs com erro.
7. Proponha testes de regressão com casos concretos para cada diagnóstico, incluindo respostas de reparo que repetem a falha e reparos que corrigem somente o campo autorizado.

## Referências principais no código

- Orquestração, paralelismo, auditoria final, duas rodadas e bloqueio de prova: [generateExamCore.ts](/home/eduardo/prova-tri/src/lib/exams/generateExamCore.ts).
- Critérios e saída tipada do Jev, contexto BNCC/turma e conferência do gabarito: [questionQualityDecision.ts](/home/eduardo/prova-tri/src/lib/ai/questionQualityDecision.ts).
- Cliente e cache do Jev: [jevClient.ts](/home/eduardo/prova-tri/src/lib/ai/jevClient.ts).
- Conversão de decisões em campos e instruções de reparo: [qualityDiagnostics.ts](/home/eduardo/prova-tri/src/lib/exams/qualityDiagnostics.ts).
- Prompt, restauração de campos protegidos e validação da resposta corrigida: [repairQuestion.ts](/home/eduardo/prova-tri/src/lib/exams/repairQuestion.ts).
- Aprovação/reprovação final e relatório: [questionQualityTest.ts](/home/eduardo/prova-tri/src/lib/exams/questionQualityTest.ts).
- Contadores e progresso da fila: [jobProgress.ts](/home/eduardo/prova-tri/src/lib/queue/jobProgress.ts), [schema.ts](/home/eduardo/prova-tri/src/db/schema.ts).
- Fonte oficial das habilidades: [officialBncc.ts](/home/eduardo/prova-tri/src/lib/curriculum/officialBncc.ts).

## Limitações desta análise

Este relatório foi elaborado a partir da implementação presente na árvore da VPS e dos registros de status/itens do job #23912. A mensagem da fila não expõe todas as respostas brutas do Jev nem cada prompt/resposta da correção. Por isso, o documento distingue o mecanismo confirmado do motivo exato pelo qual o modelo não corrigiu cada questão. Determinar esse motivo exige reconstruir a telemetria completa por questão.
