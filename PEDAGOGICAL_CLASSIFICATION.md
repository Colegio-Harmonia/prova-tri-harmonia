# Manual de Classificação Pedagógica — Prova-TRI

**Versão:** 1.0
**Data:** 17/07/2026
**Responsável:** Eduardo (coordenação) + Claude (implementação)
**Status:** Normativo — fonte oficial de critérios pra toda classificação pedagógica do sistema

## Histórico de alterações

| Versão | Data | Motivo |
|---|---|---|
| 1.0 | 17/07/2026 | Criação inicial (Subtarefa 00 do Motor de Classificações Pedagógicas). Documenta o estado real das taxonomias já implementadas (BNCC, Bloom, Eixos Cognitivos do INEP) e normatiza os critérios pras taxonomias novas (DOK, SOLO_EXPECTED, SOLO_OBSERVED) antes de qualquer alteração de banco ou código. |

Toda classificação produzida pelo sistema (por IA, por professor, ou importada) deve registrar a versão deste manual usada. Mudar um critério aqui é uma decisão pedagógica, não cosmética — exige nova versão e justificativa nesta tabela.

---

## 1. Propósito e escopo

Este manual é a **fonte normativa única** de critérios de classificação pedagógica do Prova-TRI. Ele orienta:

- as instruções de classificação embutidas nos prompts de IA (geração de questão nova, classificação de questão importada, classificação de resposta discursiva);
- a revisão feita por professores e coordenação;
- a interpretação dos dashboards e dos relatórios de desempenho;
- a auditoria de qualquer classificação, humana ou automática.

Nenhuma classificação — de IA ou humana — deve contradizer os critérios aqui descritos sem justificativa registrada (ver seção I, Casos Ambíguos, e seção L, Processo de Aprovação).

Este documento **não altera nenhum código, schema ou fluxo em produção**. Ele é resultado exclusivo da Subtarefa 00 do Motor de Classificações Pedagógicas: mapear o que já existe, normatizar os critérios, e preparar o terreno pras subtarefas seguintes (que criarão a estrutura de dados extensível descrita na seção 8 do pedido original).

---

## 2. Estado atual do sistema (levantado antes de escrever este manual)

Importante: as classificações abaixo **já existem e estão em produção**. DOK, SOLO_EXPECTED e SOLO_OBSERVED são **novas**, ainda não implementadas em nenhuma tabela ou fluxo — este manual as normatiza *antes* da implementação, conforme pedido.

### 2.1 BNCC — já implementado

Campo por questão (`src/lib/gemini/examSchema.ts`, `examQuestionSchema`):

```ts
bnccCodes: string[]              // ex: ["EF08MA06"], pode ter mais de um código
bnccStatus: 'mapeado' | 'nao_mapeado'
bnccSummary: string | null       // resumo de 1 frase da habilidade, pro Mapa da Prova
```

Fonte: extraído da coluna "Habilidades" da planilha de currículo de cada série (nunca inventado pela IA quando a planilha não tem — ver `CLAUDE.md`, seção "Fonte de dados"). Regra crítica já em vigor: **nunca inventar código BNCC** quando a planilha de origem não tem a habilidade mapeada; nesse caso `bnccStatus:'nao_mapeado'` e a questão é gerada mesmo assim, só sem o código.

### 2.2 Bloom — já implementado

```ts
bloomLevel: 'lembrar' | 'compreender' | 'aplicar' | 'analisar' | 'avaliar' | 'criar'
```

Único nível por questão (não há classificação secundária hoje). Inferido pela IA na geração, ou inferido a partir do verbo dominante da coluna "Objetivos" da planilha de currículo (`src/config/bloomVerbs.ts`) quando a questão vem do banco/currículo. Pra questões do banco ENEM, reclassificado por IA (`bloom_level_source: 'deepseek-v2'` em `imported_question_classifications`).

### 2.3 Eixos Cognitivos do INEP — já implementado (só Ensino Médio / banco ENEM)

Tabelas reais: `enem_areas` (4 áreas) → `enem_competencies` (C1-C9 por área) → `enem_skills` (H1-H30 por área) → `enem_cognitive_axes` (DL/CF/SP/CA/EP, comuns a todas as áreas). Ligação em `imported_question_classifications`:

```ts
enemAreaId, enemCompetencyId, enemSkillId, enemCognitiveAxisId
enemClassificationSource: 'oficial' | 'ai' | 'pending'
```

`'oficial'` = casado contra os microdados reais do INEP (posição do item + gabarito, ~99% de cobertura nas 2.689 questões importadas). `'ai'` seria uma estimativa por IA quando não há microdado oficial disponível — hoje não usado na prática, todo o banco está `'oficial'`.

**Só existe pra Ensino Médio.** SAEB (Fundamental) não libera item completo publicamente, então não há equivalente pra anos iniciais/finais — ver `saeb` (seção 2.4) como o que cobre o Fundamental.

### 2.4 SAEB (equivalente parcial do Fundamental, já implementado)

```ts
saeb: {
  applicable: boolean
  source: 'novo_saeb' | 'classica' | 'enem' | null
  value: string | null            // ex: "D4" — código do descritor
  approximate: boolean            // true quando o ano/série não tem matriz exata
}
```

Só Língua Portuguesa e Matemática têm matriz oficial completa (2º/5º/9º ano exatos); Ciências Humanas/Natureza têm matriz só no 9º ano. Fora disso, `applicable:false` sempre — nunca inventado (gate mecânico em `src/config/saebApplicability.ts`, reforçado com hard-override no validador, nunca decidido só pela IA).

### 2.5 DOK, SOLO_EXPECTED, SOLO_OBSERVED — ainda não implementados

Não existe nenhum campo, tabela ou prompt para essas três classificações hoje. Este manual normatiza os critérios **antes** da implementação (Subtarefas 01+ do roadmap do Motor de Classificações Pedagógicas), pra que o schema e os prompts sejam desenhados já em cima de critérios claros, não inventados durante a implementação.

---

## A. Definições

**BNCC (Base Nacional Comum Curricular)** — documento normativo federal que define as aprendizagens essenciais que todo aluno deve desenvolver em cada etapa da educação básica, organizadas por componente curricular, unidade temática e habilidade.

**Habilidade (BNCC)** — a menor unidade de aprendizagem codificada na BNCC (ex: `EF08MA06`), descrevendo uma competência específica e observável.

**Competência (BNCC)** — conjunto mais amplo de conhecimentos, habilidades, atitudes e valores mobilizados pra resolver demandas complexas; a habilidade é a expressão operacional da competência num contexto específico.

**Objeto de conhecimento** — o conteúdo/tema específico associado a uma habilidade (ex: "operações com frações algébricas" é o objeto de `EF08MA06`).

**Bloom (Taxonomia de Bloom revisada)** — classificação do **processo cognitivo predominante** que a questão exige do aluno, numa escala ordinal de complexidade: lembrar → compreender → aplicar → analisar → avaliar → criar.

**DOK (Depth of Knowledge, Webb)** — classificação da **profundidade de raciocínio** exigida pra resolver a tarefa, numa escala de 4 níveis. Independente de Bloom (ver seção H).

**Eixo Cognitivo do INEP** — dimensão transversal usada pela Matriz de Referência do ENEM (DL, CF, SP, CA, EP), descrevendo o tipo de operação mental exigida numa perspectiva de larga escala, historicamente calibrada contra milhões de respondentes reais.

**SOLO (Structure of Observed Learning Outcomes, Biggs & Collis)** — taxonomia que descreve a **estrutura da compreensão**, não o processo cognitivo isolado: quantos elementos o aluno relaciona e com que grau de integração.

**Dificuldade** — no Prova-TRI, um julgamento subjetivo do professor revisor sobre o quão difícil a questão é pros alunos daquela turma específica (`review.difficulty: 'facil'|'adequada'|'dificil'`, já implementado em `examQuestionSchema`). **Não é sinônimo de DOK nem de complexidade** — ver seção C.

**Complexidade** — neste manual, usado como termo genérico pra "quanto raciocínio a tarefa exige"; operacionalizado formalmente por DOK, nunca solto.

**Confiança (`confidence`)** — número de 0 a 1 que expressa o grau de certeza de uma classificação automática. Ver rubrica na seção K.

**Classificação sugerida** — produzida por IA ou por regra automática, ainda não revisada por humano. Não deve ser tratada como definitiva em nenhum relatório ou dashboard sem indicar sua origem.

**Classificação aprovada** — revisada e confirmada por um humano com autoridade pedagógica (professor da disciplina ou coordenação). Nunca sobrescrita silenciosamente por uma nova sugestão de IA (ver seção L).

---

## B. Critérios para Bloom

Regra geral, já em vigor no sistema e reforçada aqui: **o verbo do enunciado não determina Bloom sozinho.** A classificação considera o que o aluno precisa *fazer de fato* pra responder, não a palavra usada.

| Nível | Definição | Evidência no enunciado | Evidência na operação exigida | Exemplo positivo (real, do sistema) | Exemplo negativo (verbo engana) |
|---|---|---|---|---|---|
| **Lembrar** | Recuperar informação da memória, sem transformação | "identifique", "cite", "qual é" | Resposta é reprodução direta de fato/definição já apresentado | — (ver nota abaixo: o sistema hoje proíbe até "lembrar" nu, precisa de contexto — seção C explica por quê isso não muda o nível de Bloom) | Uma questão que pede "identifique" mas exige comparar duas situações não é Lembrar, é no mínimo Analisar |
| **Compreender** | Explicar/reorganizar uma ideia com as próprias palavras, sem aplicá-la | "explique", "qual a função de", "para que serve" | Aluno parafraseia ou interpreta sem usar o conceito num caso novo | "Leia o texto sobre o gato... Para que serve o texto que você leu?" (exam #7, 2º ano, `EF12LP17`) — pede função social do texto, não fato isolado | "Explique o Teorema de Pitágoras" sem pedir aplicação é Compreender; se pedir pra calcular um lado, vira Aplicar |
| **Aplicar** | Usar um procedimento/conceito conhecido numa situação nova mas do mesmo tipo já treinado | "calcule", "resolva", "determine" | Aluno executa um procedimento conhecido com dados novos | "Um resistor de 10 Ω é percorrido por uma corrente de 2 A. Qual a tensão?" (exam #10, EM, Lei de Ohm direta) | Uma questão de "calcule" que exige escolher entre 2 fórmulas concorrentes e justificar a escolha já é Analisar, não Aplicar |
| **Analisar** | Decompor, comparar, relacionar partes de uma informação complexa | "compare", "diferencie", "qual a relação entre" | Aluno separa componentes e identifica padrões/relações não explícitas | Questão ENEM real (id 330): compara taxas de aumento de vendas entre duas redes sociais a partir de uma tabela — exige decompor e comparar variação de grandezas | Uma questão "compare X e Y" onde X e Y já vêm com a diferença explicada no enunciado é Compreender disfarçada de Analisar |
| **Avaliar** | Julgar com critério, defender uma posição com base em evidência | "avalie", "justifique se", "qual a melhor opção e por quê" | Aluno formula um julgamento fundamentado, não só descreve | Questão ENEM real (id 2235): avalia por que a baixa quantidade de hemácias é um risco no processo de produção de soro antiofídico | "Avalie o texto" que na prática só pede resumo é Compreender travestida |
| **Criar** | Produzir algo novo — sintetizar elementos numa estrutura original | "elabore", "proponha", "construa uma solução" | Aluno gera uma resposta original, não escolhe entre alternativas dadas | Questão ENEM real (id 391) exige interpretar uma reportagem sobre design de mobiliário e reconstruir a relação entre estética, cultura e identidade — vai além de reconhecer fatos, monta uma leitura própria do fenômeno | Uma questão objetiva de múltipla escolha *raramente* atinge Criar de verdade — checar com cuidado antes de marcar |

### Erros comuns de classificação

1. **Confundir o verbo com o nível.** "Analise a imagem e identifique o animal" é Lembrar (é reconhecimento direto), não Analisar, apesar do verbo.
2. **Superestimar questões objetivas.** Múltipla escolha pode chegar a Analisar/Avaliar com facilidade (ver exemplos ENEM acima), mas Criar é raro — desconfiar de qualquer objetiva marcada Criar.
3. **Subestimar questões curtas.** Uma pergunta de uma linha pode ser Analisar se exigir comparação implícita; extensão do enunciado não indica nível (ver seção C, mesmo princípio vale pra Bloom).

### Critérios de desempate

Quando a questão parece estar entre dois níveis adjacentes: classificar pelo nível **mais alto que a resposta correta realmente exige**, não pelo nível que a pergunta *poderia* admitir com uma resposta mais simples. Se a resposta esperada (campo `expectedAnswer`, em questões descritivas) só demonstra o nível mais baixo, usar o nível mais baixo.

---

## C. Critérios para DOK (Depth of Knowledge)

DOK **não é dificuldade, não é extensão do texto, não é quantidade de cálculo**. É profundidade de raciocínio — quantas etapas cognitivas distintas, se exige integração de evidências, se exige justificativa, se exige transferência pra um contexto novo.

| Nível | Definição | Etapas cognitivas | Exige justificativa? | Exige integrar evidências? | Exemplo real |
|---|---|---|---|---|---|
| **DOK 1 — Recordação e reprodução** | Reproduzir fato, executar procedimento rotineiro de 1 passo | 1 etapa | Não | Não | "Marque a alternativa que explica a regra correta sobre o uso de S/SS" (exam #7) — é aplicação de regra memorizada, 1 passo, mesmo sendo objetiva |
| **DOK 2 — Habilidades e conceitos** | Aplicar um procedimento de múltiplos passos, ou relacionar 2 conceitos | 2+ etapas sequenciais, sem ramificação de decisão | Às vezes (justificar 1 passo) | Parcial (1-2 fontes) | "Resolva (2x/3)+(x/4) e simplifique" (exam #21) — 2 etapas (encontrar denominador comum, simplificar), sem decisão estratégica |
| **DOK 3 — Pensamento estratégico** | Planejar e executar uma estratégia entre várias possíveis, justificar escolhas, integrar informações de fontes diferentes | Múltiplas etapas com decisão sobre qual caminho seguir | Sim, exigida | Sim, múltiplas fontes/dados | Questão ENEM real (id 330): decompor uma tabela de duas redes sociais, calcular taxas de variação distintas, comparar e concluir — exige decidir *como* comparar, não só executar uma fórmula dada |
| **DOK 4 — Pensamento ampliado / investigação prolongada** | Investigação extensa, conectando múltiplas disciplinas/fontes ao longo do tempo, sem resposta única pré-determinada | Processo aberto, iterativo | Sim, extensa | Sim, extensa e diversificada | Difícil de representar numa questão isolada de prova — ver nota abaixo |

### Regras explícitas (obrigatórias, conforme especificação)

- **Dificuldade ≠ DOK.** Uma questão pode ser "fácil" pra uma turma (todos acertam) e ainda assim DOK 3, se a estrutura de raciocínio exigida for de fato estratégica — dificuldade é sobre a turma, DOK é sobre a tarefa.
- **Extensão do texto ≠ DOK.** Um enunciado de 5 linhas pode ser DOK 1 (só reproduz uma definição num contexto florido); um enunciado de 1 linha pode ser DOK 3 se exigir decisão estratégica implícita.
- **Quantidade de cálculos ≠ DOK.** Resolver 4 equações do mesmo tipo em sequência continua DOK 1-2 (repetição de procedimento), não DOK 3 — DOK sobe quando há *decisão sobre qual procedimento usar*, não quando há mais contas.
- **Questão objetiva pode atingir DOK 2 ou DOK 3.** Ver exemplo ENEM id 330 acima — múltipla escolha, DOK 3 real.
- **DOK 4 dificilmente é representado por 1 questão objetiva isolada de prova.** Normalmente exige um projeto, uma investigação de várias etapas ao longo de dias/semanas, ou uma redação/produção extensa. Em avaliações de prova única, DOK 4 deve ser usado com extrema cautela — na dúvida, classificar como DOK 3.

### Casos que parecem complexos mas continuam DOK 1-2

- Uma conta longa e trabalhosa (ex: multiplicação de números grandes) é DOK 1 — é reprodução de procedimento, só com mais dígitos.
- Um problema com "história" longa mas que se resolve com 1 fórmula direta, sem decisão, é DOK 1-2, não DOK 3 — a complexidade narrativa não é complexidade cognitiva.
- Reconhecer um padrão já visto em sala, mesmo que em contexto levemente diferente, é DOK 2, não DOK 3, se o procedimento pra resolver for o mesmo já treinado.

### Critérios de desempate DOK 2 × DOK 3

A pergunta decisiva: **existe mais de um caminho válido pra resolver, e o aluno precisa escolher e justificar qual usar?** Se sim, DOK 3. Se o caminho é único e conhecido (mesmo que em várias etapas), DOK 2.

---

## D. Critérios para Eixos Cognitivos do INEP

Os 5 eixos são **comuns a todas as áreas do ENEM** e descrevem, numa perspectiva de avaliação em larga escala, o tipo de operação mental exigida. São usados hoje como classificação **principal única** por questão (`enemCognitiveAxisId`), não múltipla — este manual mantém essa convenção, mas documenta quando uma classificação secundária seria justificável (ver "regras pra classificação secundária" abaixo), pra decisão futura.

| Código | Nome completo | Definição | Evidências esperadas | Diferença dos vizinhos |
|---|---|---|---|---|
| **DL** | Dominar Linguagens | Dominar a norma culta e as linguagens matemática, artística, científica; compreender e usar sistemas simbólicos de diferentes áreas | Interpretação de texto, notação técnica, terminologia própria da área | Diferente de CF: DL é sobre o *código*, CF é sobre o *fenômeno* que o código descreve |
| **CF** | Compreender Fenômenos | Construir e aplicar conceitos de várias áreas pra compreender fenômenos naturais, sociais, produtivos | Explicar *por que* algo acontece, usando conceito de área | Diferente de SP: CF explica, SP resolve/decide |
| **SP** | Enfrentar Situações-Problema | Selecionar, organizar, relacionar dados pra enfrentar situações-problema de diferentes áreas | Aplicar procedimento/estratégia pra chegar numa solução concreta | Diferente de CA: SP resolve um problema técnico, CA constrói um argumento sobre um tema |
| **CA** | Construir Argumentação | Relacionar informações, construir argumentação consistente | Defender uma tese com dados/evidências | Diferente de EP: CA argumenta sobre o que É, EP propõe o que DEVERIA SER |
| **EP** | Elaborar Propostas | Elaborar proposta de intervenção pra um problema, respeitando valores humanos e diversidade | Propor solução/ação concreta pra um problema real | O único eixo orientado explicitamente pra ação/intervenção, não só análise |

### Exemplos reais (banco ENEM, classificação oficial)

- Questão id 330 (Matemática, variação de grandezas) → **DL** — mobiliza a linguagem/notação matemática pra interpretar a tabela.
- Questão id 2235 (Biologia, produção de soro antiofídico) → **DL** — nota-se que boa parte do banco classificado como "oficial" cai em DL quando a questão é fundamentalmente sobre dominar o vocabulário/conceito técnico da área antes de qualquer segunda operação.

### Regras para classificação principal

Escolher o eixo que melhor descreve **a operação final exigida pra responder**, não qualquer operação intermediária. Se a questão pede pra interpretar um gráfico (DL) e depois decidir uma ação (EP), o eixo principal é o da operação que efetivamente determina a resposta certa/errada.

### Regras para classificação secundária (não implementada hoje, documentado pra decisão futura)

Uma classificação secundária só se justifica quando a questão claramente pede **duas operações de peso comparável** (ex: interpretar dado técnico E propor intervenção). Antes de implementar essa possibilidade, decidir formalmente se o modelo de dados permite múltiplos eixos por questão (ver seção 9.3 do pedido original, "classificação principal e secundárias") — hoje o schema (`imported_question_classifications`) só tem 1 coluna `enem_cognitive_axis_id`, então isso é uma decisão de implementação pra Subtarefa 03, não coberta por este manual sozinho.

---

## E. Critérios para BNCC

A seleção de habilidade BNCC já segue um processo rígido em produção (`CLAUDE.md`, seção "Fonte de dados"): **nunca inventar um código**, extrair sempre da planilha de currículo oficial da escola, nunca do "assunto parecido".

### O que considerar antes de associar uma habilidade

- Etapa de ensino (Fundamental 1, Fundamental 2, Ensino Médio) — determina o prefixo do código (`EF` vs `EM13`).
- Ano/série — determina o agrupamento numérico do código, que **varia por componente** (ver tabela em `CLAUDE.md`: Educação Física agrupa 2 anos, Geografia usa ano individual).
- Componente curricular.
- Unidade temática e objeto de conhecimento (quando disponíveis na planilha).
- **Aderência real entre o item e o texto oficial da habilidade** — não a similaridade de assunto. Uma questão sobre "frações" não é automaticamente `EF08MA06` só por falar de frações; precisa bater com o verbo/operação descrita no texto oficial da habilidade.

### Registro obrigatório

```ts
bnccCodes: string[]        // 1 código principal + secundários quando genuinamente justificado
bnccStatus: 'mapeado' | 'nao_mapeado'
bnccSummary: string        // resumo de 1 frase, usado no Mapa da Prova
```

Quando a planilha de origem não tem a coluna "Habilidades" preenchida pra aquele capítulo, ou tem um placeholder (`SAE +`), o sistema **já** trata como `nao_mapeado` e sinaliza — nunca inventa. Este manual reforça que essa regra vale igualmente pra qualquer classificação nova (DOK, SOLO): sem evidência suficiente, marcar como não-classificável, nunca aproximar por semelhança de assunto.

### Não associar habilidade só por assunto semelhante — exemplo negativo

Uma questão sobre "a Revolução Industrial" não deve ganhar automaticamente qualquer código de História que mencione "revolução" — precisa verificar se o texto oficial da habilidade realmente cobre o recorte temporal/conceitual exato da questão (causas? consequências? comparação com outro processo?). Se a aderência for parcial, reduzir a confiança (seção K) em vez de forçar o código mais próximo.

---

## F. Critérios para SOLO_EXPECTED

**Ainda não implementado.** Normatizado aqui pra orientar a Subtarefa 03+ (modelagem) e os prompts futuros.

SOLO_EXPECTED descreve a estrutura de compreensão que **o item foi desenhado pra mobilizar** — é um metadado de design da questão, não uma medida do aluno.

| Nível | Definição | Estrutura esperada | Exemplo de tarefa objetiva | Exemplo de tarefa discursiva |
|---|---|---|---|---|
| **Pré-estrutural** | Resposta sem relação lógica com a pergunta | Não há estrutura — é ruído, cópia, ou tangencial | Não se projeta uma questão *pra* gerar pré-estrutural — esse nível só existe em SOLO_OBSERVED (resposta real), nunca em SOLO_EXPECTED |
| **Uniestrutural** | Usa 1 dado/aspecto relevante isoladamente | Aluno identifica 1 elemento correto | "Marque a alternativa que apresenta uma frase escrita corretamente" (exam #7) — 1 critério (singular/plural) aplicado | "Cite uma causa de X" |
| **Multiestrutural** | Usa vários dados/aspectos, mas sem integrá-los | Aluno lista/aborda vários elementos separadamente | Questão de múltipla escolha com alternativas que testam vários subtópicos distintos, sem exigir conexão entre eles | "Liste 3 causas de X" (sem pedir relação entre elas) |
| **Relacional** | Integra múltiplos aspectos numa estrutura coerente | Aluno relaciona os elementos entre si e com o todo | Questão ENEM id 330 — compara variação entre 2 redes sociais de forma integrada | "Explique como as causas de X se relacionam entre si" |
| **Abstrato ampliado** | Generaliza pra além do caso dado, transfere pra novo domínio, teoriza | Aluno abstrai um princípio geral aplicável a outros contextos | Raro em objetiva | "A partir do caso de X, formule um princípio geral aplicável a Y" |

### Limitações explícitas (obrigatório registrar sempre)

> Em questões objetivas, SOLO_EXPECTED descreve a estrutura cognitiva prevista no desenho do item, mas não demonstra o nível efetivamente alcançado pelo aluno.

Uma questão objetiva desenhada como "Relacional" pode ser respondida corretamente por adivinhação, eliminação de alternativas, ou memorização de padrão — SOLO_EXPECTED nunca deve ser citado como prova de que o aluno raciocinou naquele nível. Isso é papel exclusivo de SOLO_OBSERVED (seção G), e mesmo assim só quando há material analisável.

---

## G. Critérios para SOLO_OBSERVED

SOLO_OBSERVED mede a estrutura **real** demonstrada na resposta do aluno — só se aplica quando existe material suficiente pra analisar o raciocínio (respostas discursivas, redações, justificativas, projetos, portfólios). **Nunca em questão objetiva**, mesmo sabendo qual alternativa foi marcada.

Implementação atual (Subtarefa 16, 17/07/2026): respostas discursivas salvas
como `revisado` são classificadas como `exam_correction_answer` no motor
pedagógico, usando `exam_corrections.id` + `questionNumber`. A classificação é
uma sugestão (`status:"sugerida"`) e não bloqueia a correção do professor.

| Nível | Evidência textual na resposta | Contraexemplo |
|---|---|---|
| **Pré-estrutural** | Resposta não relacionada à pergunta, cópia do enunciado, ou vazia | — |
| **Uniestrutural** | Usa 1 informação correta, ignora o resto do que foi pedido | Resposta que cita 1 fórmula certa mas não conclui o problema |
| **Multiestrutural** | Usa várias informações corretas, mas cada uma isolada, sem conectar | Lista passos de um cálculo mas não explica por que aquele caminho foi escolhido |
| **Relacional** | Conecta as informações numa explicação coerente e completa | Resposta de exam #21 (volume do cilindro): aplica fórmula, converte unidade, e justifica cada etapa em sequência lógica |
| **Abstrato ampliado** | Generaliza o raciocínio pra um princípio aplicável além do caso specific | Resposta que, além de resolver, discute quando a fórmula usada deixaria de valer |

### Tratamento de casos especiais

- **Resposta parcialmente correta**: classificar pela estrutura do raciocínio demonstrado, não pela nota. Uma resposta com erro de conta mas estrutura relacional completa continua Relacional.
- **Resposta sem justificativa** (só o resultado final, sem explicação): classificar como Uniestrutural ou Multiestrutural, nunca Relacional/Abstrato ampliado — sem justificativa visível não há evidência de integração, mesmo que o aluno tenha "pensado certo" internamente.
- **Resposta copiada ou sem relação com o problema**: Pré-estrutural, sempre, independente de conter termos técnicos corretos soltos.

### Campos de saída obrigatórios

```text
solo_observed
confidence
justification
evidence          -- trecho da resposta que sustenta a classificação
limitations
requires_human_review
```

SOLO_OBSERVED **nunca substitui** nota, rubrica, correção do professor, Bloom da questão, DOK da questão ou SOLO_EXPECTED — é uma camada adicional de análise, não uma nota alternativa.

---

## H. Relação entre as taxonomias

As classificações são **independentes entre si** — nenhuma deve ser inferida automaticamente a partir de outra.

- Uma questão pode ser Bloom "Aplicar" e DOK 1 (fórmula de 1 passo) — ex.: exam #10, tensão elétrica via Lei de Ohm.
- Uma questão pode ser Bloom "Aplicar" e DOK 3 (múltiplos passos com decisão estratégica) — ex.: questão ENEM id 330 é fundamentalmente "aplicar" um raciocínio de variação de grandezas, mas em DOK 3 porque exige decidir *como* comparar dois conjuntos de dados.
- Uma questão pode ser Bloom "Analisar" e DOK 2 (decompor 2 elementos conhecidos, sem decisão estratégica adicional).
- Duas questões com a mesma habilidade BNCC podem ter Bloom e DOK completamente diferentes — a habilidade descreve *o quê*, Bloom/DOK descrevem *como* a mente processa aquilo.
- SOLO_EXPECTED não deve ser inferido a partir de Bloom — uma questão Bloom "Compreender" pode ser desenhada como SOLO Multiestrutural (várias facetas da compreensão) ou Uniestrutural (1 faceta só), dependendo de como o item foi escrito, não do nível de Bloom.
- DOK não deve ser inferido a partir da dificuldade percebida pelo professor — ver seção C.
- Eixo Cognitivo do INEP é ortogonal a Bloom/DOK: descreve o *tipo* de operação (linguagem, fenômeno, problema, argumento, proposta), não a *profundidade* nem o *processo* cognitivo isolado.

Quando duas taxonomias parecerem apontar em direções contraditórias numa mesma questão, isso **não é erro** — é esperado, porque medem dimensões diferentes. Registrar as duas classificações com suas justificativas próprias, nunca "ajustar" uma pra combinar com a outra.

---

## I. Casos ambíguos

### Como escolher a classificação principal

Quando mais de uma categoria parece plausível: escolher a que descreve **a operação que efetivamente determina se a resposta está certa ou errada**, não qualquer operação secundária/preparatória.

### Quando admitir classificação secundária

Só quando duas operações de peso comparável são exigidas E a estrutura de dados permitir (hoje, só BNCC permite múltiplos códigos — `bnccCodes: string[]`; Bloom, Eixo Cognitivo e, quando implementados, DOK/SOLO_EXPECTED são campo único por decisão de escopo atual, revisitável na Subtarefa 03).

### Quando reduzir o nível de confiança

- Quando a aderência entre a questão e a habilidade/categoria é parcial, não exata.
- Quando o enunciado é curto demais pra ter certeza da profundidade real exigida (DOK especialmente sensível a isso).
- Quando duas categorias vizinhas (ex: Compreender/Aplicar, DOK 2/DOK 3) são igualmente defensáveis.
- Quando a questão foi gerada por IA e ainda não passou por nenhuma revisão humana.

### Quando encaminhar pra revisão humana

- Confiança abaixo de 0,60 (ver seção K).
- Divergência entre a classificação da IA e uma classificação humana anterior pra questão semelhante.
- Toda questão usada em avaliação de alto impacto (aprovação/reprovação, ENEM simulado) antes da primeira aplicação.
- Habilidades BNCC ambíguas (planilha com mais de uma leitura possível do código aplicável).

### Quando marcar como "não classificável"

Quando não há evidência suficiente no enunciado/resposta pra sustentar nenhuma categoria com confiança mínima (ver seção K) — nunca forçar uma classificação só pra preencher o campo. Melhor um campo vazio e sinalizado do que um dado errado silencioso (mesmo princípio já em vigor pra BNCC `nao_mapeado`).

### Quando registrar divergência entre classificadores

Quando IA e professor discordam, ou quando duas rodadas de classificação por IA (ex: reclassificação) produzem resultados diferentes: registrar as duas classificações no histórico de auditoria (seção 9.4 do pedido original), nunca sobrescrever silenciosamente — a divergência em si é um dado pedagógico relevante (pode indicar um item mal escrito, não só um erro de classificação).

---

## J. Exemplos calibrados

Todos os exemplos abaixo são **reais**, extraídos do banco de questões ENEM (2.689 itens, classificação oficial via microdados INEP) e de provas já geradas e aplicadas pelo Colégio Harmonia — nenhum foi inventado pra este manual. DOK e SOLO são classificações novas, aplicadas retroativamente aqui só como calibração (não persistidas em nenhuma tabela ainda).

### Anos Iniciais — 2º ano, Língua Portuguesa (exam #7, aplicada e corrigida)

> "Leia o texto abaixo sobre o gato: GATO. O gato é um animal mamífero e doméstico... Para que serve o texto que você leu?"

| Taxonomia | Classificação | Justificativa | Confiança |
|---|---|---|---|
| BNCC | `EF12LP17`, `EF15LP01` | Extraído da planilha de currículo do 2º ano, aderência direta ("função social do texto") | 0,95 (mapeado) |
| Bloom | Compreender | Pede a função do texto, não reprodução de fato isolado nem aplicação | 0,88 |
| DOK | 2 | Exige relacionar gênero textual (verbete) com sua função social — mais que reprodução direta, sem decisão estratégica | 0,75 |
| Eixo INEP | N/A | Não aplicável fora do Ensino Médio (matriz ENEM não cobre Fundamental 1) | — |
| SOLO_EXPECTED | Uniestrutural | O item foi desenhado pra testar 1 aspecto (função social), não integração de múltiplos aspectos | 0,7 |

### Anos Iniciais — 2º ano, Língua Portuguesa (mesmo exam, questão de regra ortográfica)

> "Na frase: O pássaro voa alto e pousa no sino da igreja... Marque a alternativa que explica a regra correta sobre o uso dessas letras [S/SS]."

| Taxonomia | Classificação | Justificativa | Confiança |
|---|---|---|---|
| Bloom | Lembrar | Reconhecimento direto de regra ortográfica memorizada, apesar de estar embutida numa frase | 0,8 |
| DOK | 1 | Reprodução de regra fixa, 1 etapa, sem decisão | 0,85 |
| SOLO_EXPECTED | Uniestrutural | 1 critério isolado (a regra), sem integração | 0,8 |

**Nota de calibração:** esta questão é um exemplo real do tipo que o Prova-TRI já identificou como problemático em outra frente (ver `CLAUDE.md`, regra de contextualização universal — "nenhuma questão de definição nua, nem em nível Lembrar"). Bloom/DOK baixos não são um problema pedagógico *por si só* (Lembrar/DOK 1 são níveis legítimos), mas a ausência de contextualização real (a "frase-veículo" não cria uma situação genuína de uso da regra) é uma dimensão *diferente* de qualidade, já coberta por outra regra do sistema — este manual não a duplica, só reforça que Bloom/DOK baixo não justifica dispensar contextualização.

### Anos Finais — 8º ano, Matemática (exam #21, aprovada)

> "Um reservatório de água tem a forma de um cilindro reto com raio da base medindo 3 m e altura medindo 5 m... determine o volume máximo de água, em litros."

| Taxonomia | Classificação | Justificativa | Confiança |
|---|---|---|---|
| BNCC | `EF08MA20`, `EF08MA21` | Volume de cilindro + conversão de unidades, 2 habilidades genuinamente mobilizadas | 0,9 |
| Bloom | Aplicar | Usa fórmula conhecida (V = πr²h) num caso novo | 0,85 |
| DOK | 2 | Múltiplas etapas (calcular volume, converter unidade), mas caminho único e conhecido, sem decisão estratégica | 0,8 |
| SOLO_EXPECTED | Multiestrutural | Integra 2 procedimentos (volume + conversão) mas de forma sequencial, não relacional entre si | 0,7 |
| SOLO_OBSERVED (na resposta real do aluno) | Aplica-se só se houver resposta discursiva analisável — ver seção G | — | — |

### Ensino Médio — 1º/2º ano, Física (exam #10, aprovada)

> "Um resistor de 10 Ω é percorrido por uma corrente de 2 A. Qual é a tensão elétrica entre seus terminais?"

| Taxonomia | Classificação | Justificativa | Confiança |
|---|---|---|---|
| BNCC | `EM13CNT101` | Aplicação direta de grandezas e relações da Física | 0,85 |
| Bloom | Aplicar | Fórmula de 1 passo (V = R·i) | 0,9 |
| DOK | 1 | Reprodução de procedimento único, 1 etapa | 0,9 |
| Eixo INEP | SP (Enfrentar Situações-Problema) | Aplica dado técnico pra resolver um problema concreto, não só "dominar a linguagem" da eletricidade | 0,7 (ambíguo com DL, ver nota) |

**Nota de ambiguidade real:** esta questão poderia ser lida como DL (domina a fórmula/notação) ou SP (resolve o problema). Critério de desempate aplicado (seção D): a operação que determina certo/errado é o *cálculo* (resolver), não só reconhecer a fórmula — por isso SP prevalece, mas a confiança fica reduzida (0,7) por ser um caso limítrofe real, não um exagero de exemplo didático.

### Ensino Médio — banco ENEM real, classificação oficial (id 330, Matemática 2022)

> Tabela com resultados de 2 divulgações de anúncio em redes sociais A e B; pergunta pede o aumento percentual de compradores na segunda divulgação em relação à primeira.

| Taxonomia | Classificação oficial/calibrada | Justificativa | Confiança |
|---|---|---|---|
| Eixo INEP (oficial, microdados) | DL | Classificação oficial do INEP — mobiliza linguagem matemática (variação de grandezas) | 1,0 (fonte oficial) |
| Competência oficial | C4 | "Construir noções de variação de grandezas para a compreensão da realidade..." | 1,0 (fonte oficial) |
| Habilidade oficial | H17 | "Analisar informações envolvendo a variação de grandezas..." | 1,0 (fonte oficial) |
| Bloom (calibração deste manual) | Analisar | Decompor 2 séries de dados e comparar taxas — não é só aplicar 1 fórmula | 0,85 |
| DOK (calibração deste manual) | 3 | Exige decidir *como* comparar (variação relativa, não absoluta) — decisão estratégica real, não só executar conta | 0,75 |

Este exemplo mostra explicitamente a independência entre taxonomias (seção H): o eixo oficial INEP é DL, mas Bloom calibrado é Analisar e DOK é 3 — três leituras válidas e não-contraditórias da mesma questão, cada uma respondendo uma pergunta diferente.

### Cobertura de segmentos nesta calibração

- ✅ Anos Iniciais (2º ano)
- ✅ Anos Finais (8º ano)
- ✅ Ensino Médio (Física + banco ENEM oficial)
- ⚠️ Educação Infantil: não aplicável — o Prova-TRI não atende esse segmento (confirmado em `CLAUDE.md`, só Fundamental 1 ao Ensino Médio)
- ⚠️ Questão discursiva com resposta de aluno real (pra calibrar SOLO_OBSERVED de verdade, não só SOLO_EXPECTED): **não disponível ainda** — o módulo de correção (Subtarefa 4 do plano de Gestão Pedagógica) só armazena `finalGrade`/`finalFeedback` por questão, não o texto da resposta discursiva do aluno em si de forma extensa o bastante pra essa calibração. Registrado como pendência (seção "Pendências" abaixo).

---

## K. Rubrica de confiança

| Faixa | Interpretação | Ação |
|---|---|---|
| 0,90 – 1,00 | Classificação altamente evidente, pouca ou nenhuma ambiguidade | Pode ser aceita automaticamente (sujeita a amostragem de auditoria) |
| 0,75 – 0,89 | Consistente, com pequena margem de ambiguidade | Aceita automaticamente, mas sinalizada pra revisão oportunista (não bloqueante) |
| 0,60 – 0,74 | Possível, mas com ambiguidade real | Requer revisão humana antes de uso em relatório/dashboard com peso |
| < 0,60 | Não confiável | **Nunca aprovar automaticamente** — obrigatório revisão humana ou marcar "não classificável" |

Os limites são **configuráveis** (não hardcoded) — quando implementados (Subtarefa 07+), devem viver em configuração, não espalhados em prompt/código, pra poderem ser ajustados sem deploy de código.

Confiança é **por taxonomia**, nunca uma confiança única pra toda a questão — ver exemplo do id 330 acima, onde eixo/competência/habilidade oficiais têm confiança 1,0 (fonte oficial) mas Bloom/DOK calibrados têm confiança menor (são inferência nova, não fonte oficial).

---

## L. Processo de aprovação

### Estados

```text
sugerida → em_revisao → aprovada
                      → rejeitada
aprovada → substituida (nova classificação aprovada por cima, versão anterior preservada)
sugerida/aprovada → desatualizada (manual mudou de versão, classificação antiga precisa revisão)
```

### Precedência (da mais forte pra mais fraca)

1. **Classificação humana aprovada** — nunca sobrescrita automaticamente por nova sugestão de IA.
2. **Classificação importada de fonte oficial validada** — ex: eixo cognitivo/competência/habilidade do banco ENEM via microdados INEP (`enemClassificationSource:'oficial'`).
3. **Classificação de IA revisada** por humano, mesmo sem "aprovação" formal registrada.
4. **Classificação automática ainda não revisada** — a mais fraca, tratada como sugestão pura em qualquer relatório.

Esta precedência já é parcialmente respeitada hoje (`bloomLevelSource`, `enemClassificationSource` distinguem origem) — este manual formaliza o princípio pra toda taxonomia nova.

---

## M. Versionamento do manual

Ver tabela no topo deste documento. Toda classificação registrada no sistema (quando a estrutura de dados da seção 9 do pedido original for implementada) deve gravar `manual_version` — a versão exata deste documento usada no momento da classificação. Mudar um critério aqui (ex: redefinir a fronteira entre DOK 2 e DOK 3) exige nova versão, nunca edição silenciosa da versão vigente, porque classificações antigas passam a ser auditáveis contra a versão que as gerou.

---

## Pendências identificadas nesta subtarefa

1. **Sem exemplo real de SOLO_OBSERVED calibrado** — a Subtarefa 16 já
   implementou a classificação automática em respostas discursivas, mas ainda
   falta consolidar exemplos reais aprovados por revisão humana para calibrar
   cada nível no manual.
2. **Classificação secundária de Eixo Cognitivo** — o schema atual (`imported_question_classifications`) só suporta 1 eixo por questão; a seção D documenta os critérios pra quando/se isso for expandido, mas a decisão de expandir ou não é da Subtarefa 03 (modelagem), não deste manual.
3. **DOK 4** — nenhum exemplo real calibrado foi encontrado no banco atual (esperado — DOK 4 raramente aparece em prova de múltipla escolha ou item isolado). Fica documentado que exemplos de DOK 4 provavelmente só aparecerão quando o sistema suportar avaliação de projetos/produções extensas, fora do escopo de "questão de prova" atual.

## Ambiguidades encontradas na calibração (item 7.4 da especificação)

- **DL vs. SP** no exemplo de Física (Lei de Ohm) — documentado na própria seção J como caso limítrofe real, resolvido por critério de desempate explícito (a operação que determina certo/errado).
- **Bloom "Lembrar" com contextualização mínima** — a questão de regra ortográfica (seção J) é Bloom/DOK legitimamente baixos, mas isso não a exime da regra de contextualização já em vigor no sistema (`buildContextualizationInstruction`); o manual deixa claro que essas são dimensões de qualidade diferentes, pra evitar que uma classificação DOK/Bloom baixa seja usada como desculpa pra aceitar uma questão descontextualizada.

## Validação realizada (item 7.4)

- ✅ Amostra de 6 questões reais analisadas (3 segmentos do Fundamental/Médio + 3 do banco ENEM oficial).
- ✅ Comparação entre classificações mostrou taxonomias genuinamente independentes (seção H, exemplo id 330).
- ✅ Manual diferencia corretamente Bloom, DOK e dificuldade (seção C, regras explícitas).
- ✅ SOLO_EXPECTED e SOLO_OBSERVED mantidos conceitualmente separados em toda a calibração — nenhum exemplo atribuiu SOLO_OBSERVED a uma questão objetiva.
