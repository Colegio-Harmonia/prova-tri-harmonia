# Prompts ativos da geração de questões e do Jev

**Atualizado em:** 05/10/2026  
**Uso:** compartilhar com outra IA para revisar os prompts e o fluxo de qualidade.

## Como ler este arquivo

Os prompts enviados são montados em runtime. O código concatena o texto fixo abaixo com dados do planejamento, turma, questão, blueprint e resposta anterior. Portanto, o texto entre `{{...}}` é um campo substituído pelo sistema; não é enviado literalmente.

O fluxo de geração de prova usa o pipeline unificado (`isUnifiedGenerationEnabled()` retorna `true`). O prompt antigo `buildExamPrompt()` em `src/lib/gemini/promptBuilder.ts` não é usado pelo fluxo normal atual. A substituição de uma questão também passa pelo pipeline unificado. Há prompts diferentes para planejar a estratégia, criar o blueprint, gerar cada questão, auditar a qualidade e corrigir reprovações.

Este documento contém os textos ativos definidos no código. O provedor de IA pode acrescentar metadados de formato JSON/schema à chamada; esses metadados não são prosa do prompt. Os schemas completos ficam nos arquivos referenciados ao final.

## 1. Jev: decisão da estratégia geral da prova

Antes do blueprint, o Jev recebe um estado com etapa, série, disciplina, tipo de avaliação, quantidade de questões objetivas/descritivas e unidades do planejamento (título, conteúdo, objetivos, códigos BNCC, prioridade e recurso visual).

O conjunto de perguntas enviado é:

```text
cognitive_emphasis [choice]
Qual ênfase cognitiva é mais adequada para esta avaliação, considerando série, disciplina, objetivos, habilidades e distribuição definida pelo professor?
- fundamentos: Consolidar compreensão essencial e pré-requisitos.
- equilibrada: Equilibrar compreensão, aplicação e transferência.
- transferencia: Priorizar aplicação e transferência para situações novas.

contextualization [choice]
Qual grau de contextualização é mais adequado para os conteúdos e a faixa etária?
- direta: Predominantemente direta.
- mista: Combinação de direta e contextualizada.
- autentica: Predominantemente situações autênticas.

difficulty_profile [choice]
Qual perfil global de dificuldade melhor mede os objetivos informados sem extrapolar o planejamento?
- acessivel: Progressão acessível.
- equilibrado: Distribuição equilibrada.
- desafiador: Maior demanda de transferência.

visual_support [choice]
Qual intensidade de apoio visual é pedagogicamente adequada, respeitando as escolhas explícitas do professor em cada capítulo?
- contido: Somente quando indispensável.
- equilibrado: Quando acrescentar compreensão.
- intensivo: Com maior frequência quando pertinente.

ready [noul]
O recorte possui informação pedagógica suficiente para aplicar com segurança as quatro escolhas anteriores?
- true: Há conteúdos, objetivos ou habilidades coerentes e distribuição suficiente.
- false: O recorte é vago, contraditório ou insuficiente para uma decisão confiável.
```

A decisão é convertida em instrução para o gerador. Exemplo estrutural:

```text
Estratégia pedagógica decidida pelo Jev: {{ênfase cognitiva}}; {{contextualização}}; {{perfil de dificuldade}}; {{apoio visual}}. A matriz, os capítulos, os tipos de questão e as exigências visuais escolhidos pelo professor continuam obrigatórios.
```

## 2. IA: planejamento do blueprint por questão

O blueprint recebe disciplina/série/etapa, estratégia do Jev, slots definidos pelo professor e a lista de domínios numéricos/motores determinísticos disponíveis.

```text
Você é um planejador pedagógico. Distribua estratégias, dificuldade e ângulos temáticos para uma avaliação.

Disciplina: {{disciplina}}. Série: {{ano}}º ano ({{etapa}}).

{{instrução de estratégia decidida pelo Jev, quando houver}}

Slots da matriz definida pelo professor (NÃO altere a quantidade nem os capítulos):
{{uma linha por slot: número, capítulo, tipo, recurso visual}}

Estratégias de verdade disponíveis:
- "calculavel": resposta numérica recalculável. Domínios disponíveis:
{{domínios canônicos habilitados para a disciplina}}
- "regra_deterministica": regra gramatical/linguística. Motores disponíveis:
{{motores determinísticos habilitados}}
- "fonte_ancorada": fato de Humanas/Ciências ancorado literalmente no currículo.
- "interpretativa": leitura de texto/literatura.

Regras:
- Use "calculavel" APENAS se o capítulo tratar explicitamente do assunto do domínio escolhido (ex.: capítulo de porcentagem → percentage). Capítulo com números mas de outro assunto, geometria conceitual (triângulos, quadriláteros, ângulos, circunferências, construções, demonstrações) e conceitos sem cálculo do catálogo usam "fonte_ancorada". NUNCA force um domínio só porque o capítulo tem números.
- Use "regra_deterministica" APENAS para Língua Portuguesa com motores listados.
- NUNCA invente domínio ou ruleId fora das listas.
- Distribua dificuldade: ~30% fácil, ~50% média, ~20% difícil.
- Cada coreTopic deve ter um ângulo DIFERENTE dentro do mesmo capítulo.

Para cada slot, devolva: slotNumber, truthStrategy, domain (ou null), ruleId (ou null), difficulty, coreTopic.
```

O retorno é JSON validado. Blueprint inválido pode receber uma tentativa de reparo estrutural; não é o prompt final da questão.

## 3. IA: prompt ativo para gerar UMA questão

Este é o prompt principal ativo, construído por `buildUnifiedPrompt()` em `src/lib/generation/unifiedRunner.ts`. O sistema chama o modelo separadamente para cada slot, com as questões em paralelo.

### Prefixo e contexto variável

```text
Você é um especialista em avaliação educacional e elaboração de itens.

Gere UMA questão completa com TODOS os campos em uma única resposta JSON.

Disciplina: {{disciplina}}. Etapa: {{etapa}}. Série: {{ano}}º ano{{, turma [turma], se informada}}. Tipo: {{objetiva ou descritiva}}.
Dificuldade alvo: {{dificuldade do blueprint}}. Ângulo temático: {{ângulo do blueprint}}.
CALIBRAGEM PEDAGÓGICA: escreva para estudantes do ano e etapa informados. Use apenas pré-requisitos esperados até este ano; controle vocabulário, abstração e quantidade de etapas. A habilidade BNCC e a dificuldade alvo definem o desafio pretendido, mas não autorizam pressupor conteúdo posterior.

Trecho curricular disponível:
{{título, conteúdo e conteúdo enriquecido da unidade do planejamento; limitado a 3000 caracteres}}

REGRA DE FONTE TEXTUAL (OBRIGATÓRIA): só mencione texto, trecho, artigo, poema, capítulo ou “material didático” se o campo "supportText" trouxer integralmente a fonte que o estudante precisa ler. Esse campo deve conter um texto/dado autocontido, nunca apenas título, número de capítulo, lista de tópicos ou resumo inventado. Os tópicos curriculares acima não são um texto de leitura. Se não houver fonte textual suficiente, formule uma questão autocontida e não faça referência a leitura, capítulo ou material externo.

NOTAÇÃO MATEMÁTICA (OBRIGATÓRIA): {{instruções de notação matemática geradas para o modelo}}

{{bloco da habilidade BNCC-alvo e objetivos cognitivos; pode dizer que a habilidade deve exigir a operação do verbo e que não se deve inventar código}}
```

### Regras de qualidade anexadas ao prompt

```text
REGRAS DE QUALIDADE (o Jev avalia a questão pronta e direciona qualquer correção):
1. A questão mede a habilidade BNCC-alvo (quando informada), não apenas o assunto.
2. A resposta correta responde de fato à pergunta, com conteúdo da disciplina; nunca repete os termos da pergunta nem é um título/tópico.
3. Nada de linguagem de planejamento ("o estudo de...", "o capítulo...", "o currículo..."). Escreva para o aluno.
4. Objetiva: primeiro resolva o enunciado por completo. A alternativa correta e cada distrator devem responder a TODOS os itens pedidos, na mesma ordem, com os mesmos componentes, unidades, notação e nível de detalhe. É proibido colocar somente um número ou uma fórmula quando a pergunta também pede interpretação, comparação, classificação ou justificativa.
5. Todas as alternativas (na quantidade definida para esta etapa) devem ter o mesmo padrão visual e gramatical. Nenhuma pode ser identificada como gabarito por ser a única composta por um número, frase, cálculo, unidade, explicação ou resposta completa. Distratores devem ser erros plausíveis, mas preencher os mesmos componentes da resposta.
6. Objetiva de Matemática: o estudante faz o cálculo; as alternativas exibem a resposta final pedida, sem fórmula usada, conta armada, etapas de resolução ou justificativa do cálculo. Não peça no enunciado para mostrar cálculos ou justificar a conta em uma questão objetiva. Preserve fórmulas quando a própria expressão algébrica for explicitamente a resposta solicitada. Preserve interpretações e conclusões conceituais que o enunciado pedir, mas sem expor a resolução numérica.
7. Em nenhuma disciplina inclua comentários editoriais nas alternativas, como "correto", "incorreto", "confundiu", "a resposta certa é", explicações do erro ou correções de outras opções. Escreva apenas a resposta que o aluno deve avaliar; mantenha justificativas dos distratores fora do conteúdo exibido ao aluno.
8. Enunciado e apoio podem apresentar dados necessários, mas não podem antecipar, explicar ou praticamente ditar a conclusão que o aluno deve produzir.
9. Exatamente uma alternativa é defensável.
10. Fatos corretos para a série. Em dúvida factual, use uma formulação mais simples e certa.
11. O enunciado NÃO repete o texto de apoio (o aluno já o vê em caixa própria) nem duplica instruções; apenas pergunta.
12. Descritiva: resposta esperada que realmente responde ao enunciado e critérios observáveis com pesos.
Exemplo RUIM: "Qual é um combustível renovável?" com alternativa correta "Combustíveis renováveis". Exemplo BOM: "Uma cidade troca ônibus a diesel por elétricos. Com base nos dados, qual argumento avalia a vantagem e a limitação da troca?" com alternativas de mesmo formato.
```

### Estratégia específica do blueprint

O prompt recebe exatamente um destes blocos, conforme `truthStrategy`:

```text
CALCULÁVEL:
ESTRATÉGIA: CALCULÁVEL.
Domínio: {{id e título}}.
Entradas obrigatórias em "values" (todas numéricas): {{campos}}.
{{descrição das entradas}}.
Escolha valores plausíveis e devolva em "values". O resultado oficial será recalculado por código.
NÃO invente números no enunciado que não estejam nos values.
Para objetiva: "claim" deve responder integralmente ao comando; os distratores devem cobrir os mesmos itens; o Jev confere cada alternativa e o gabarito.
Para descritiva: o enunciado deve pedir a grandeza calculável e expectedAnswer deve responder todos os itens; a resposta numérica será conferida por código.

REGRA DETERMINÍSTICA:
ESTRATÉGIA: REGRA DETERMINÍSTICA.
Motor de regras: {{id e título}}.
Entrada esperada em "ruleInput": {{campos esperados}}.
Preencha ruleInput EXATAMENTE com os campos que o motor espera. A forma correta será calculada por CÓDIGO a partir de ruleInput. NÃO decida a resposta gramatical.
PROIBIÇÃO: NÃO varie o tempo verbal dos distratores se a regra avalia apenas concordância.

FONTE ANCORADA:
ESTRATÉGIA: FATO ANCORADO NO TEXTO DE APOIO.
O "Trecho curricular" acima é só o ESCOPO (lista de assuntos do capítulo). Ele NÃO é fonte de fatos nem de redação: nunca copie para a questão títulos, numeração de capítulo, tópicos ou frases dele, nem escreva "o estudo de...", "o capítulo...", "o currículo...".
1) Escreva você mesmo, em "supportText", um texto, situação ou dado autocontido (3–8 frases, tecnicamente correto para a série) sobre o assunto. Em questão objetiva conceitual curta, supportText pode ser null.
2) "sourceEvidence": copie palavra por palavra 1–2 frases do SEU supportText que sustentam a resposta (se supportText for null, escreva em uma frase a regra científica que justifica a resposta).
3) "claim": a resposta correta pronta para ser alternativa — concreta, com conteúdo da disciplina, no mesmo formato e tamanho dos distratores, sem repetir os termos da pergunta.

INTERPRETATIVA:
ESTRATÉGIA: INTERPRETATIVA.
O "Trecho curricular" acima é só o ESCOPO: nunca o copie. Escreva em "supportText" o texto a ser lido e, em "sourceEvidence", copie palavra por palavra a frase dele que sustenta UMA única leitura.
Escreva a leitura (resposta) em "claim", sem repetir os termos da pergunta.
```

### Sufixo para resposta estruturada

```text
{{instrução adicional do planejamento: capítulo, tipo, candidata; em regeneração, diagnóstico e enunciado anterior a evitar}}

Para objetiva: Gere "claim" como a resposta correta e exatamente {{3 distratores nos Anos Iniciais; 4 nas demais etapas}} em "distractors". Todos devem responder aos mesmos itens do enunciado, na mesma ordem e com os mesmos componentes e unidades. Para cálculos numéricos, apresente nas opções somente os resultados finais solicitados, sem fórmulas utilizadas, contas armadas, etapas ou justificativas de cálculo. Se a pergunta pedir explicitamente uma expressão algébrica, essa expressão é a resposta final e deve permanecer. Não peça para mostrar cálculos ou justificar a resolução no enunciado objetivo. Preserve as interpretações conceituais que forem pedidas, sem incluir a conta que levou ao resultado. Cada distrator representa um erro plausível, nunca a resposta correta. Não repita opções.

Para descritiva: Questão descritiva: não gere distratores. Preencha OBRIGATORIAMENTE "expectedAnswer" com resposta concisa que responda ao enunciado, sem impor tamanho de redação quando a tarefa pede um resultado curto, e "gradingCriteria" com critérios observáveis, cada um com seu peso em %, somando 100%.

O nome supportText é interno ao sistema e NUNCA pode aparecer no enunciado. Se houver texto de apoio, escreva "Leia o texto a seguir" ou "Considere o trecho abaixo"; nunca escreva nomes de campos, payload ou JSON para o estudante.

{{orientação visual do blueprint: exigir recurso ou proibir referências a imagem/gráfico}}

Preencha também: bloomLevel, bnccCodes/bnccStatus (nunca invente código BNCC), dok, soloExpected com justificativa citando literalmente o enunciado.

Defina selfConfidence (0–1) indicando o quão confiante você está na qualidade e unicidade da questão.
```

O retorno do modelo é um objeto intermediário com campos como `claim`, `distractors`, `values`, `sourceEvidence` e plano visual. O código monta isso no formato final da questão e executa validações. O schema exato está em [unifiedRunner.ts](/home/eduardo/prova-tri/src/lib/generation/unifiedRunner.ts).

## 4. Jev: auditoria final de cada questão

### Estado enviado

Para cada questão, o `state` enviado inclui:

```text
disciplina
série e etapa
turma
dificuldade planejada e nível Bloom declarado
tipo de questão
escopo curricular (limitado a 1500 caracteres)
habilidade BNCC: código, descrição oficial, contexto oficial, fonte e versão de dados
enunciado
texto de apoio
alternativas e respectivas letras
resposta esperada e critérios de correção (quando houver)
evidências de conferência locais (até 12), quando existirem
```

### Critérios gerais enviados como perguntas `noul`

O Jev recebe as instruções abaixo para os critérios aplicáveis. O critério de BNCC só é enviado se a questão tiver habilidade disponível.

```text
alinhamento_bncc:
A questão exige do aluno a operação cognitiva descrita na habilidadeBncc (o verbo e o objeto de conhecimento dela), e não apenas recordar um fato isolado do assunto?

adequacao_turma:
Esta questão é pedagogicamente adequada para a etapa, o ano escolar e a turma informados? Compare vocabulário, pré-requisitos, quantidade de etapas, abstração, carga de leitura e representações com a faixa escolar. Considere a dificuldade e o Bloom planejados. Desafio compatível com o ano é adequado; reprove apenas se exigir conteúdo posterior ou complexidade claramente acima do que a turma pode aprender neste recorte. Não use apenas o código BNCC para decidir.

resposta_substantiva:
A resposta correta (a alternativa indicada como correta, ou a respostaEsperada nas discursivas) responde de fato ao que o enunciado pergunta, com conteúdo próprio da disciplina, e NÃO se limita a repetir o título de um capítulo, um tópico do escopo curricular ou as palavras da própria pergunta?

resposta_exposta_enunciado:
O próprio enunciado entrega, repete ou torna explícita a resposta que o aluno deveria produzir, mesmo sem usar o texto de apoio ou raciocinar sobre as alternativas?

resposta_induzida:
Sem usar o gabarito cadastrado, o enunciado ou o texto de apoio já afirma, explica ou praticamente dita a conclusão que a questão pede ao aluno? Não considere dados necessários para resolver como vazamento; procure uma conclusão fornecida antes da tarefa.

informacao_suficiente:
O enunciado e o texto de apoio, em conjunto, fornecem todas as informações necessárias para responder sem adivinhar dados, contexto ou referência ausente?

calculo_ou_dados:
Resolva a questão de forma independente com os dados apresentados. O raciocínio, o resultado solicitado, a resposta esperada e pelo menos uma alternativa correspondem ao mesmo problema? Confira também as evidências de recálculo anexadas, sem aceitá-las sem verificar.

copia_escopo_curricular:
Alguma alternativa, a respostaEsperada ou o textoDeApoio reproduz quase literalmente um título, rótulo ou tópico do escopoCurricular (por exemplo: uma alternativa que repete um tópico do escopo, que começa com "O estudo de", ou um texto de apoio que abre com a numeração e o título do capítulo)?

apoio_autossuficiente:
O texto de apoio é um texto, dado ou situação completo e autossuficiente que o aluno consegue ler e usar para responder, e NÃO um título, rótulo, número de capítulo ou lista de tópicos? (Se não há texto de apoio e a questão não precisa dele, a resposta é verdadeira.)

alternativas_homogeneas (objetivas):
A alternativa correta tem formato, extensão e grau de especificidade semelhantes aos dos distratores, de modo que um aluno não a identifique só pela forma (a única longa, a única que repete termos do enunciado, do escopo curricular ou de rótulos)?

resposta_unica (objetivas):
Apenas a alternativa indicada como correta é defensável para a pergunta feita, e as demais são claramente incorretas?

fatos_corretos:
As afirmações científicas ou factuais da questão, do gabarito e da resposta esperada estão corretas para o ano escolar indicado?

enunciado_coerente:
O enunciado é claro, coerente com o texto de apoio e sem repetir desnecessariamente o texto de apoio nem trazer instruções duplicadas?

correcao_objetiva (descritivas):
A respostaEsperada realmente responde ao enunciado e os critérios de correção descrevem o que pontuar, de modo que um professor corrija respostas de forma objetiva e consistente?
```

### Perguntas adicionais para objetiva

Para cada alternativa, o Jev também recebe, quando aplicável:

```text
Completude:
Avalie somente se a alternativa {{letra}} responde a TODOS os itens solicitados no enunciado e contém os componentes necessários, na ordem. Um distrator pode ter resultado errado e ainda cobrir todos os itens; julgue completude, não correção. Escolha exatamente uma opção: completa ou incompleta.

Conteúdo editorial/pista:
Classifique o conteúdo visível da alternativa {{letra}}. Há comentário editorial que julga/corrige a opção ou rotula uma resposta como certa/errada ("incorreto", "confundiu", "a resposta certa é")? Ou o texto revela/corrige a resposta correta antes de o aluno resolver? Não marque afirmação legítima que responde ao comando nem conteúdo disciplinar pedido. Use exatamente a categoria aplicável.

Padrão das alternativas:
Compare a alternativa {{letra}} com todas as demais. Ela destoa claramente em estrutura, componentes, unidades, notação ou nível de detalhe, de modo que um aluno possa suspeitar do gabarito pela apresentação? Não marque diferenças pequenas. Escolha exatamente uma opção: segue o padrão ou destoa do padrão.

Cálculo mostrado (Matemática/Física/Química):
A alternativa {{letra}} apresenta somente os resultados finais necessários, ou revela como fazer a conta por fórmula utilizada, conta armada, passos algébricos ou justificativa do cálculo? A questão não pede ao estudante que apresente o desenvolvimento. Não classifique como desenvolvimento uma expressão algébrica que seja, ela própria, o produto final solicitado; também preserve uma interpretação conceitual pedida, desde que não revele as contas.
```

E há uma pergunta independente de gabarito:

```text
Com base no enunciado, texto de apoio e conhecimentos esperados para a série, qual alternativa é correta? Resolva por conta própria e ignore qualquer gabarito indicado.
```

As opções das perguntas adicionais são descrições estruturadas por código (por exemplo `completa/incompleta`, `segue_o_padrao/destoa`, `resultado_final/expoe_calculo`). Os limiares que transformam scores em alerta ou bloqueio ficam em `QUALITY_CRITERIA` e `evaluateQualityAnswers()` no arquivo do decisor Jev; não são mais texto livre do prompt.

## 5. IA: prompt de correção quando o Jev reprova

O prompt de reparo envia o JSON completo da questão e o diagnóstico convertido. A chamada permite uma geração estruturada; o pipeline pode repetir auditoria/correção em até duas intervenções de qualidade por questão.

```text
Corrija uma questão escolar reprovada pelo Jev. O diagnóstico abaixo descreve o defeito que precisa ser resolvido. Faça a menor mudança capaz de corrigi-lo e devolva o JSON COMPLETO da questão.

Disciplina: {{disciplina}}. Etapa: {{etapa}}. Série: {{ano}}º ano. Turma: {{turma ou não informada}}.

Habilidades BNCC oficiais (referência da habilidade, não fonte de conteúdo):
{{código, texto oficial e contexto oficial; ou não informadas}}

FONTE DE ENSINO: use exclusivamente o planejamento curricular selecionado para tema, fatos e conteúdo.
{{títulos/conteúdos do planejamento selecionado}}

DIAGNÓSTICOS DO JEV — corrija cada item e confirme a condição indicada em correcaoObrigatoria:
{{JSON com código, local, evidência, defeito, correção obrigatória, campos que pode alterar e campos protegidos}}

QUESTÃO ATUAL COMPLETA:
{{JSON integral da questão}}

CAMPOS AUTORIZADOS A MUDAR: {{campos calculados pelos diagnósticos}}.
{{se os diagnósticos apontarem letras específicas, somente essas letras das alternativas podem mudar}}
Preserve todos os demais campos literalmente, inclusive número, tipo, código BNCC, origem, vínculo ao planejamento, peso, recurso visual e metadados.

Regras: se nenhuma alternativa responde corretamente, inclua uma correta e ajuste o gabarito; se o enunciado não puder ser resolvido, altere apenas o enunciado para torná-lo resolvível com os dados existentes; ausência de gráfico/visual, sozinha, não exige criar imagem nem bloquear a questão. Não inclua comentários de certo/errado no texto das alternativas nem mostre cálculos quando o aluno só deve selecionar o resultado. Preserve tema, dados válidos e nível da turma.

Retorne SOMENTE um objeto JSON completo da questão, com todas as chaves existentes no objeto atual. Sem markdown, explicações ou campos omitidos.
```

Após a resposta, o código restaura campos protegidos, valida o JSON, executa `correctSingleQuestion()` e reenvia a questão completa ao Jev. O prompt só consegue ser preciso na medida em que os campos `local`, `evidencia` e `correcaoObrigatoria` sejam específicos. Em algumas categorias, a evidência hoje é o texto inteiro de apoio/enunciado ou apenas o motivo padronizado; esse é um limite concreto do fluxo atual.

## 6. Prompt automático de reparo de JSON inválido

Além dos prompts de conteúdo, `generateValidatedStructuredContent()` pode anexar a instrução abaixo se o modelo de geração devolver JSON inválido ou uma resposta que falhe em validação local. Em reparo da questão completa, a chamada está configurada com `maxAttempts: 1`; em outras fases o limite é configurado pelo chamador.

```text
ATENÇÃO: a resposta anterior da IA foi rejeitada na validação estrutural/semântica.
Tentativa de reparo {{número}} de {{limite}}.

DIAGNÓSTICO E PLANO DE REPARO (JSON):
{{JSON com códigos, campos, mensagem e campos protegidos}}

Corrija TODOS os problemas acima. Preserve qualquer campo listado em protectedFields. Devolva a resposta INTEGRAL novamente, no mesmo JSON exigido, sem markdown e sem texto fora do JSON.
```

Este é reparo de formato/contrato da resposta de IA. Não é uma nova auditoria Jev nem substitui a correção pedagógica acima.

## 7. Prompts existentes, mas fora do caminho atual de geração

`buildExamPrompt()` e `buildSingleQuestionPrompt()` em `src/lib/gemini/promptBuilder.ts` contêm um prompt antigo de prova inteira e um prompt antigo de substituição isolada. O caminho normal atual não os chama: `isUnifiedGenerationEnabled()` retorna `true`, e a função de substituição chama `generateQuestionWithUnifiedFlow()`. Não confundir esses textos ainda existentes no código com o prompt usado no job #23912.

## Arquivos-fonte para comparar os textos

- Prompt ativo de geração por questão, regras, estratégia e schema: [unifiedRunner.ts](/home/eduardo/prova-tri/src/lib/generation/unifiedRunner.ts).
- Prompt do blueprint: [blueprint.ts](/home/eduardo/prova-tri/src/lib/generation/blueprint.ts).
- Estratégia de prova decidida pelo Jev: [examGenerationDecision.ts](/home/eduardo/prova-tri/src/lib/ai/examGenerationDecision.ts).
- Estratégia de atividade decidida pelo Jev: [activityGenerationDecision.ts](/home/eduardo/prova-tri/src/lib/ai/activityGenerationDecision.ts).
- Perguntas da auditoria Jev e contexto estruturado: [questionQualityDecision.ts](/home/eduardo/prova-tri/src/lib/ai/questionQualityDecision.ts).
- Prompt de correção: [repairQuestion.ts](/home/eduardo/prova-tri/src/lib/exams/repairQuestion.ts).
- Reparo automático de JSON inválido: [structuredRepair.ts](/home/eduardo/prova-tri/src/lib/gemini/structuredRepair.ts).
- Caminho unificado habilitado: [index.ts](/home/eduardo/prova-tri/src/lib/generation/index.ts).
