# Plano de correção da geração de respostas e da validação Jev

Data: 06/10/2026.

Status: implementação concluída no código local; migration criada. Build, testes e publicação ficam para o usuário executar.

## Registro da implementação

- O enunciado aprovado é persistido em `stage_checkpoints` e reutilizado na retomada. A etapa de respostas não precisa devolver `statement` nem `supportText`; quando devolvidos, esses valores não substituem a versão aprovada. O contrato exige resposta correta e quatro distratores na objetiva, ou resposta esperada e critérios na discursiva.
- O contrato de `solutionBlueprint` agora tenta decodificar JSON serializado como texto antes da validação. Conteúdo textual que não seja JSON continua inválido e recebe a correção estruturada.
- O segundo Jev opera em modo `answers`: recebe enunciado aprovado, apoio e respostas; avalia gabarito de forma independente e não recebe código BNCC, turma ou notas pedagógicas como critérios dessa etapa.
- Correções pós-Jev aceitam escopo `answers`. Objetivas alteram alternativas/gabarito autorizados; discursivas alteram resposta esperada/critérios autorizados. O enunciado aprovado e os metadados permanecem preservados.
- O pool de geração mantém até três questões em processamento por vez e continua as demais após a falha isolada de uma questão. A questão só sai da vaga após concluir sua finalização ou registrar erro.
- A contagem de alternativas está centralizada em cinco opções A–E para todos os segmentos.
- O modal mostra as etapas de enunciado, validação Jev, decisão visual, geração e validação de respostas, imagem, formato e conclusão. Progresso concluído conta apenas itens aprovados; respostas produzidas são exibidas separadamente.
- Migration criada em `drizzle/0051_generation_question_stage_checkpoints.sql` para preservar checkpoints por questão.

Limite desta entrega: não foram executados build, testes nem geração real, conforme solicitado para execução pelo usuário.

## 1. Objetivo e decisões do produto

Corrigir a falha `solutionBlueprint: Expected object, received string`, separar a elaboração do enunciado da elaboração das respostas e processar até **três questões simultaneamente**. Cada questão deve percorrer seu próprio fluxo completo até aprovação ou erro identificado, sem esperar a geração das respostas das demais.

Decisões solicitadas:

1. O primeiro Jev valida o enunciado: habilidade BNCC e adequação à turma, com notas separadas e mínimo de 70% em cada dimensão aplicável.
2. Depois da aprovação, a IA gera **somente as respostas** necessárias para aquele enunciado.
3. O segundo Jev valida **as respostas em relação ao enunciado aprovado**. Não deve repetir a avaliação pedagógica geral nem julgar a prova como conjunto.
4. Questões objetivas usam cinco alternativas, A a E, conforme a preferência já informada pelo usuário. A quantidade deve ser uma única configuração compartilhada.
5. Até três questões podem estar em processamento ao mesmo tempo. Uma vaga acompanha uma questão por todas as etapas, inclusive seus reparos, antes de receber outra.
6. Questões aprovadas são preservadas na retomada. Uma falha de formato ou de provedor não justifica gerar novamente o enunciado aprovado.

## 2. Termos e nomes das etapas

**Enunciado** é o texto que o aluno recebe para compreender a tarefa: contexto, dados, texto-base e comando. Quando há uma figura necessária, ela integra as informações usadas para responder.

**Questão** é o item completo de avaliação: enunciado, recurso visual quando necessário, alternativas e gabarito ou resposta esperada e critérios de correção, além dos metadados internos.

**Gerar respostas** significa completar a questão cujo enunciado já foi aprovado. Na objetiva, produzir a resposta correta, quatro distratores e o gabarito; na discursiva, produzir resposta esperada e critérios de correção.

Trocar na interface o rótulo `Criando questão` por `Gerando respostas`. Usar `Validando respostas com Jev` na segunda validação. Reservar `Gerada` para uma questão com todos os artefatos obrigatórios presentes e todas as validações aprovadas.

## 3. Diagnóstico confirmado pelo código

Arquivos principais:

- `src/lib/exams/generateExamCore.ts`: coordena a geração, finalização, imagens, reparos e persistência por questão.
- `src/lib/exams/questionGenerationStages.ts`: cria o enunciado, valida BNCC/turma e recebe a decisão visual do Jev.
- `src/lib/generation/unifiedRunner.ts`: gera respostas para o enunciado aprovado; ainda recebe instruções e campos de um contrato mais amplo.
- `src/lib/generation/finalize.ts`: monta a questão e cria `solutionBlueprint` a partir dos dados de solução.
- `src/lib/gemini/examSchema.ts`: define `solutionBlueprint` como objeto estruturado, `null` ou ausente; texto livre não é válido.
- `src/lib/exams/repairQuestion.ts`: pede atualmente o JSON completo da questão no reparo, mesmo quando apenas algumas respostas precisam mudar.
- `src/lib/exams/questionQualityTest.ts` e `src/lib/ai/questionQualityDecision.ts`: fazem a avaliação posterior; ainda incluem critérios pedagógicos e do enunciado.
- `src/lib/exams/questionConcurrency.ts`: define atualmente concorrência padrão de uma questão. O caminho unificado também usa um laço sequencial explícito.
- `src/app/(app)/status/QueueList.tsx`: apresenta etapas e estados no modal.

### 3.1 O que o erro significa

`Expected object, received string` significa incompatibilidade entre o JSON recebido e o contrato de dados. Não demonstra que a resposta matemática está errada e não é, por si só, uma reprovação do Jev.

O erro apresentado não informa o contexto da chamada que falhou. Não é possível afirmar só pela mensagem se ocorreu na geração das respostas ou no reparo posterior. No gerador unificado atual, a IA retorna dados de solução e a aplicação constrói `solutionBlueprint` por código; o JSON completo da questão reaparece no prompt de reparo. Portanto, o reparo é um caminho a investigar, sem tratá-lo como causa confirmada da execução relatada.

O código local de `repairQuestion.ts` já contém uma proteção que restaura os campos não autorizados antes de validar o objeto completo. Isso é uma mitigação existente no checkout, não evidência de que a execução relatada usou essa versão. Também não elimina todos os problemas de campos autorizados com tipo inválido, especialmente quando o valor original é `null` ou ausente.

### 3.2 Problemas adicionais encontrados

- O segundo Jev ainda avalia BNCC, turma, informações do enunciado e outros critérios gerais. Seu escopo excede a validação de respostas solicitada.
- O prompt de respostas contém instruções de estratégias que ainda mandam escrever texto de apoio, apesar de outra instrução exigir preservação literal do enunciado aprovado.
- Os Anos Iniciais ainda configuram quatro alternativas em pontos do código, enquanto o padrão solicitado é cinco.
- Alterar apenas a constante de concorrência não resolve o fluxo principal, porque ele tem seu próprio laço sequencial.
- A mensagem `validação local` reúne erros de formato e falhas de conteúdo. Isso impede o usuário de identificar qual etapa realmente falhou.

## 4. Fluxo proposto por questão

```text
Preparar contexto e habilidade-alvo
  → Gerar enunciado
  → Validar enunciado com Jev: BNCC e turma
  → Confirmar necessidade visual com Jev
  → Preparar/renderizar/validar visual necessário para resolver
  → Gerar respostas para o enunciado e visual aprovados
  → Validar o JSON das respostas por código
  → Validar respostas com Jev
  → Salvar questão aprovada como Gerada
```

Se o recurso visual fornece dados necessários à solução, ele deve estar aprovado antes de gerar as respostas. Uma ilustração apenas decorativa pode ser produzida depois, sem mudar o conteúdo usado para resolver.

Uma decisão visual do Jev acima de 80% pode indicar necessidade de imagem. Uma exigência explícita do planejamento ou uma dependência objetiva dos dados visuais também precisa ser respeitada: uma probabilidade menor não autoriza remover uma figura indispensável. Registrar decisão, confiança, motivo e dados utilizados.

Cada etapa recebe somente seu contexto necessário e grava um checkpoint validado. Se uma etapa falhar, a retomada começa nesse ponto, mantendo os artefatos anteriores compatíveis.

## 5. Corrigir o contrato de respostas e `solutionBlueprint`

### 5.1 Separar entrada e saída

Criar contratos específicos para geração de respostas objetivas e discursivas. Não usar o contrato da questão inteira como contrato de saída dessa etapa.

Entrada comum:

- Identificador e versão do enunciado aprovado.
- Tipo da questão, disciplina e nível da turma.
- Texto-base e comando, preservados literalmente.
- Dados e representação do visual aprovado, quando fizer parte da solução.
- Restrições de resposta: cinco alternativas na objetiva; critérios observáveis na discursiva.

Saída objetiva:

- Resposta correta proposta.
- Quatro distratores distintos.
- Justificativa interna da resposta correta.
- Justificativas internas dos distratores, sem comentários de correção no texto entregue ao aluno.
- Dados de solução tipados quando houver cálculo.

Montar e embaralhar A a E por código, associando corretamente o gabarito. A auditoria deve conferir as alternativas já montadas e as letras finais.

Saída discursiva:

- Resposta esperada.
- Critérios de correção com descrições observáveis e pesos que somem 100%, quando a rubrica usar pesos.
- Dados de solução tipados quando houver cálculo.

As justificativas dos distratores e a resolução interna são conteúdo de bastidor. Não devem aparecer dentro das alternativas.

### 5.2 Tornar a ficha técnica responsabilidade do sistema

`solutionBlueprint` é uma ficha técnica interna da solução, não o enunciado nem a resposta apresentada ao aluno.

Preferir sua construção por código a partir dos dados tipados e do motor de cálculo, como já ocorre no fluxo unificado. A geração de alternativas não precisa devolver essa ficha completa. O reparo de uma alternativa também não deve devolvê-la.

Quando uma correção legítima alterar dados de cálculo, reconstruir a ficha e recalcular a solução; não preservar uma ficha que ficou incompatível com o enunciado ou com as respostas.

Caso algum caminho realmente precise receber uma ficha da IA, usar o mesmo schema canônico tanto na restrição de saída do provedor quanto na validação local. Rejeitar texto livre. Não converter uma frase em uma ficha, remover o campo necessário ou aceitar `null` apenas para desbloquear a questão.

### 5.3 Reparos como alterações de campos específicos

Substituir o pedido de JSON completo por um contrato de alteração restrito aos campos autorizados:

- Distrator incorreto: alterar apenas a alternativa identificada.
- Gabarito divergente: corrigir gabarito e, se necessário, a alternativa da resposta correta.
- Mais de uma resposta defensável: corrigir as alternativas responsáveis pela ambiguidade.
- Discursiva: corrigir resposta esperada e/ou critérios de correção.

Aplicar a alteração por código sobre a questão original; depois validar o objeto completo e a integridade dos campos protegidos.

Enunciado, texto-base, BNCC, turma, tipo, número, vínculo curricular e visual aprovado ficam protegidos nessa etapa. Se a correção exigir mudar o enunciado, invalidar os checkpoints dependentes e encaminhar o item de volta à geração/validação de enunciado. Não modificar o enunciado dentro de um reparo de respostas.

### 5.4 Recuperação de erro de formato

Permitir uma tentativa adicional de correção de formato na mesma etapa. Ela recebe o JSON inválido, os caminhos exatos dos campos e os tipos exigidos. Não deve alterar o objetivo pedagógico nem gerar outro enunciado.

Separar contadores de tentativas de conteúdo, de formato e de provedor. Um erro de formato não consome a tentativa de adequação BNCC/turma. Um 429 ou timeout não consome tentativa de conteúdo.

Se a correção de formato também falhar, marcar o item com erro nessa etapa, preservar os checkpoints anteriores e permitir retomada. Limitar tentativas explicitamente, sem loops indefinidos.

## 6. Segundo Jev: somente respostas comparadas ao enunciado

Criar uma função e um contrato próprios para essa responsabilidade, por exemplo `judgeQuestionAnswers`. Manter a revisão geral existente como uma operação distinta, quando ela for necessária em outros fluxos. A geração não deve chamar inadvertidamente a revisão geral no lugar da auditoria de respostas.

### 6.1 Objetivas

O Jev recebe enunciado, texto-base, informações necessárias do visual e alternativas A a E. Verifica:

1. Qual alternativa responde ao comando, resolvendo independentemente sem receber o gabarito declarado nessa decisão.
2. Se existe exatamente uma alternativa correta; aceitar também resultados tipados de nenhuma correta ou mais de uma correta.
3. Se os distratores são realmente incorretos e não há uma interpretação que os torne defensáveis.
4. Se cada alternativa cobre os componentes solicitados, usa unidades compatíveis e possui apresentação equivalente às demais.
5. Se os valores e resultados das respostas correspondem aos dados fornecidos.

Após a decisão independente, a aplicação compara a letra encontrada com o gabarito declarado. As justificativas do gerador não devem ser entregues como verdade ao juiz que resolve independentemente.

### 6.2 Discursivas

O Jev recebe enunciado, apoio, informações necessárias do visual, resposta esperada e critérios. Verifica se a resposta atende a todos os componentes do comando, se os fatos/cálculos estão corretos e se os critérios permitem avaliar respostas equivalentes sem exigir detalhes que o comando não pediu.

Para reduzir confirmação, quando houver cálculo usar a solução determinística como referência independente. Para respostas abertas que exigem referência textual independente, produzir essa referência em uma etapa de resolução que recebe apenas enunciado e apoio, sem a resposta esperada do gerador. O Jev compara a proposta com essa referência e com os dados disponíveis; não tratar concordância entre modelos como prova absoluta de correção.

O Jev é usado para decisões e avaliações tipadas. Não pressupor que sua API produzirá uma redação livre de solução independente.

### 6.3 O que excluir dessa auditoria

Não repetir notas de aderência BNCC, adequação à turma, dificuldade pedagógica ou qualidade editorial geral do enunciado. Esses aspectos pertencem à primeira validação.

O enunciado continua sendo a referência da correção. Se estiver impossível responder por falta de dado, contradição ou visual ausente, a auditoria deve retornar um diagnóstico de insumo inválido, com evidência, e encaminhar ao estágio responsável. Ela não deve reabrir automaticamente todos os critérios pedagógicos.

### 6.4 Saída tipada e reparo

O resultado deve conter status de aprovação, versão/fingerprint da questão auditada e diagnósticos por alternativa ou campo: código, evidência, defeito, correção necessária e campos autorizados.

Permitir uma correção de conteúdo de respostas e uma nova auditoria por execução. Corrigir somente os campos indicados. Se a nova versão continuar reprovada, manter o item em erro com os dois pareceres registrados.

Salvar `Gerada` apenas com parecer aprovado para a versão atual. Não reutilizar um parecer cuja versão de enunciado, visual ou respostas mudou.

## 7. Três questões simultâneas, cada uma até o final

Implementar um conjunto de três vagas para tarefas completas de questão. A tarefa de uma vaga inclui geração, validação, visual, respostas, correção limitada e persistência final.

Exemplo: Q1, Q2 e Q3 começam. Quando Q2 termina, Q4 ocupa essa vaga enquanto Q1 e Q3 continuam. Q4 não precisa esperar o lote inteiro terminar. A montagem e a exibição continuam ordenadas pelo número da questão.

Não criar primeiro todas as respostas para só depois auditar todas. Não usar três tarefas de geração mais três de auditoria para questões diferentes, excedendo o limite de três questões ativas.

Implementação:

1. Substituir o laço sequencial principal de `generateExamCore.ts` por um executor com limite de três tarefas completas.
2. Ajustar a configuração compartilhada para três, evitando números dispersos.
3. Fazer o executor obter a próxima posição quando uma vaga for liberada, em vez de esperar lotes fixos.
4. Usar a mesma regra nos caminhos alternativos e na retomada.
5. Não cancelar questões saudáveis porque outra falhou. Registrar a falha individual, concluir as demais e reunir o resultado ao final.
6. A prova só fica concluída quando todos os itens exigidos estiverem aprovados. Se houver itens com erro, mostrar a contagem e permitir retomar apenas esses itens.
7. Manter concorrência de jobs como configuração distinta. O pedido é de três questões por vez, não de três provas simultâneas.
8. Conferir limitadores de imagem/Jev/IA para que não multipliquem a concorrência de tarefas por dentro. Prever backoff e `Retry-After` para falhas de provedor, sem presumir que o erro relatado seja limitação de taxa.

## 8. Persistência, retomada e invalidação

Os campos atuais `current_stage`, `question_payload`, `issues` e o checkpoint de parecer aprovado já ajudam, mas não bastam para garantir a retomada da etapa de respostas se o enunciado aprovado ainda não foi persistido separadamente.

Adicionar uma estrutura durável de checkpoints por etapa. Proposta: coluna JSON `stage_checkpoints` com versão do fluxo, enunciado aprovado e seu parecer, decisão visual, referência do visual, respostas aprovadas por schema e auditoria de respostas. Usar contadores de tentativas separados por etapa/categoria; avaliar coluna JSON `stage_attempts` ou estrutura equivalente.

O dev deve conferir o schema atual antes de criar a migration. Se não houver armazenamento equivalente, criar migration aditiva e compatível com jobs antigos; não confiar apenas em memória do worker.

Regras de invalidação:

- Mudou enunciado ou apoio: invalidar solução, respostas, visual dependente e auditoria de respostas.
- Mudaram dados do visual necessário: invalidar solução, respostas e auditoria de respostas.
- Mudaram alternativas/gabarito/resposta esperada: invalidar apenas o parecer de respostas e os artefatos de solução afetados.
- Mudou apenas estado do job: preservar checkpoints compatíveis.

Na retomada, carregar checkpoints e executar a primeira etapa ausente ou inválida. Questões aprovadas não devem ser regeneradas. Evitar duas execuções simultâneas do mesmo item por meio do controle de posse do job/item existente ou de um mecanismo equivalente.

## 9. Acompanhamento transparente e diagnóstico

No modal, apresentar por número da questão:

1. Gerando enunciado.
2. Validando enunciado com Jev.
3. Preparando visual, quando aplicável; caso contrário, `Não necessário`.
4. Gerando respostas.
5. Validando formato das respostas.
6. Validando respostas com Jev.
7. Gerada.

Durante uma correção, exibir `Corrigindo respostas` e, depois, `Revalidando respostas com Jev`. Cada etapa tem estado próprio: aguardando, em andamento, concluída, não aplicável ou erro.

Separar indicadores: enunciados aprovados, respostas produzidas e questões geradas/aprovadas. Ter 12 respostas produzidas não equivale a 12 questões concluídas.

Persistir e exibir diagnóstico útil: número da questão, etapa, categoria (`schema_validation_failed`, reprovação de conteúdo ou falha de provedor), campo, tipo esperado/recebido e tentativa. Em falhas externas, acrescentar HTTP, request ID e retryability quando disponíveis. Não expor credenciais ou dados sensíveis do provedor.

Exemplo de mensagem para este caso:

> Questão 2 — erro de formato no reparo das respostas: `solutionBlueprint` deve ser objeto ou nulo, mas veio como texto. O enunciado aprovado foi preservado. A retomada continuará na etapa de respostas.

A etapa da mensagem deve vir do contexto real da chamada; não declarar `reparo` se os logs não confirmarem esse contexto.

## 10. Ordem de implementação para o dev

### Entrega 1 — diagnóstico e proteção do contrato

Adicionar contexto de etapa aos erros de geração estruturada, rastrear a chamada que recebeu `solutionBlueprint` como texto e documentar a versão do worker. Corrigir o contrato de reparo para campos específicos, preservar campos protegidos e garantir validação tipada antes de gravar.

Aceite: uma alternativa reparada não consegue transformar uma ficha protegida em texto; erro de contrato aparece na etapa correta sem apagar o enunciado aprovado.

### Entrega 2 — geração exclusiva de respostas

Criar schemas objetivo/discursivo, remover instruções que permitem reescrever apoio/enunciado, montar a questão por código e unificar cinco alternativas A a E. Proteger enunciado e apoio por igualdade literal e versão.

Aceite: a geração de respostas não muda o enunciado nem o apoio e produz o tipo de resposta correto.

### Entrega 3 — auditoria Jev exclusiva de respostas

Criar contrato do juiz de respostas, seleção de critérios por tipo, decisão independente de alternativa correta, comparação posterior com gabarito e diagnóstico específico de respostas. Adaptar o bloqueio de aprovação para reconhecer esse novo parecer versionado. Manter compatibilidade de leitura com pareceres antigos.

Aceite: o segundo Jev recebe a questão individual, avalia respostas contra o enunciado e não solicita novas notas BNCC/turma.

### Entrega 4 — checkpoints e fluxo individual completo

Persistir resultados de etapa, implementar retomada e invalidação, limitar reparos e fazer imagens dependentes da solução precederem as respostas. Se necessário, adicionar a migration descrita na seção 8.

Aceite: após um timeout na etapa de respostas, a retomada não gera outro enunciado nem perde questões aprovadas.

### Entrega 5 — executor de três questões

Aplicar limite de três à tarefa completa, com reposição de vagas e falha isolada. Esperar as tarefas saudáveis terminarem antes de fechar o job com o resumo de pendências.

Aceite: no máximo três questões ativas; uma falha em Q2 não reinicia Q1 ou Q3 nem impede suas conclusões.

### Entrega 6 — modal e observabilidade

Atualizar rótulos, etapas, indicadores, erros e mensagens de retomada. Confirmar que o polling lê os estados persistidos, sem inferir aprovação a partir da mera presença de conteúdo.

Aceite: usuário distingue geração de enunciado, de respostas e aprovação final de cada questão.

## 11. Verificações para o usuário executar

- Reproduzir o caso de `solutionBlueprint` retornado como texto durante reparo: campo protegido permanece válido; campo autorizado inválido produz erro de formato claro.
- Conferir objetiva com uma correta, nenhuma correta, duas defensáveis, gabarito divergente e distrator numericamente incorreto.
- Conferir discursiva com resposta parcial, cálculo incorreto e rubrica que exige conteúdo não solicitado.
- Confirmar que o gabarito declarado não é enviado na decisão independente da objetiva.
- Confirmar que BNCC e adequação à turma não aparecem entre os critérios do segundo Jev.
- Confirmar que a geração/reparo de respostas não altera o enunciado aprovado.
- Confirmar cinco alternativas A a E no gerador, no schema, no reparo e nos metadados de saída.
- Simular três questões com tempos diferentes e medir que nunca existem mais de três tarefas completas ativas; a próxima começa assim que uma vaga é liberada.
- Simular erro em uma questão e verificar que as outras concluem sem reiniciar.
- Simular reinício do worker após cada checkpoint e conferir retomada da etapa correta.
- Conferir imagens necessárias antes da resolução e invalidar respostas quando os dados visuais mudarem.
- Executar verificações de tipos, lint e testes relevantes. O build/deploy fica com o usuário, conforme a preferência informada.

## 12. Resultado esperado

O usuário acompanha três questões em paralelo, cada uma percorrendo etapas próprias. `Gerando respostas` completa o enunciado já aprovado; `Validando respostas com Jev` verifica alternativas ou resposta esperada contra esse enunciado. Uma resposta malformada é tratada como erro de contrato na etapa correta, e o sistema preserva os resultados válidos para a retomada.
