# Especificação Original — Motor de Classificações Pedagógicas

> Texto original completo do pedido, recebido em 17/07/2026, salvo aqui pra continuidade entre
> sessões de IA. Não editar este arquivo — ele é o registro fiel do que foi pedido. Progresso e
> decisões tomadas ficam em `CLAUDE.md` e nos documentos gerados por cada subtarefa (ver
> `docs/HANDOFF_MOTOR_CLASSIFICACAO.md` pra saber exatamente onde retomar).

---

# PROJETO

## Motor de Classificações Pedagógicas

Implementação incremental, documentada, auditável e extensível.

---

# 1. OBJETIVO GERAL

Implementar um novo módulo de classificação pedagógica para o sistema de geração, importação, aplicação e análise de provas.

O sistema já possui mapeamentos relacionados a:

* BNCC;
* Taxonomia de Bloom;
* Eixos Cognitivos do INEP.

A nova implementação deverá ampliar essa estrutura para suportar:

* DOK — Depth of Knowledge;
* SOLO Expected;
* SOLO Observed;
* análises cruzadas entre taxonomias;
* perfil cognitivo do aluno;
* recomendações pedagógicas geradas a partir dos resultados.

A implementação deverá preservar integralmente as funcionalidades existentes.

Nenhuma alteração poderá quebrar:

* banco de questões;
* importação de questões do ENEM;
* geração de questões com IA;
* aplicação de provas;
* correção;
* dashboards existentes;
* relatórios;
* integrações;
* APIs;
* dados previamente cadastrados.

A arquitetura deverá ser extensível, desacoplada e preparada para receber novas taxonomias no futuro.

Nunca implementar taxonomias por meio de colunas rígidas ou regras espalhadas pelo código.

---

# 2. PRINCÍPIOS PEDAGÓGICOS

As taxonomias não deverão ser tratadas como sinônimas ou concorrentes diretas.

Cada uma possui uma finalidade distinta.

## 2.1 BNCC

Indica a habilidade curricular relacionada à questão.

A BNCC responde principalmente:

> Qual habilidade ou objeto curricular está sendo avaliado?

## 2.2 Taxonomia de Bloom

Indica o processo cognitivo predominante solicitado pela questão.

Categorias previstas:

* lembrar;
* compreender;
* aplicar;
* analisar;
* avaliar;
* criar.

Bloom responde principalmente:

> Qual operação cognitiva o aluno precisa realizar?

## 2.3 DOK — Depth of Knowledge

Indica a profundidade e a complexidade do raciocínio necessário para resolver a tarefa.

Níveis previstos:

* DOK 1 — Recordação e reprodução;
* DOK 2 — Habilidades e conceitos;
* DOK 3 — Pensamento estratégico;
* DOK 4 — Pensamento ampliado ou investigação prolongada.

DOK responde principalmente:

> Qual profundidade de raciocínio é necessária para resolver a tarefa?

O nível DOK não deverá ser determinado apenas pelo verbo usado no enunciado.

A classificação deverá considerar:

* quantidade de etapas cognitivas;
* necessidade de justificar;
* integração de informações;
* uso de evidências;
* tomada de decisão;
* transferência de conhecimento;
* duração e extensão da investigação.

## 2.4 Eixos Cognitivos do INEP

Categorias previstas:

* DL — Dominar Linguagens;
* CF — Compreender Fenômenos;
* SP — Enfrentar Situações-Problema;
* CA — Construir Argumentação;
* EP — Elaborar Propostas.

Os Eixos Cognitivos do INEP deverão ser utilizados como dimensão transversal da questão.

## 2.5 Taxonomia SOLO

A taxonomia SOLO deverá ser dividida em dois conceitos independentes.

### SOLO_EXPECTED

Representa o nível estrutural de compreensão que a questão foi projetada para mobilizar.

Poderá ser associado a:

* questões objetivas;
* questões discursivas;
* projetos;
* produções textuais;
* atividades práticas.

Categorias previstas:

* pré-estrutural;
* uniestrutural;
* multiestrutural;
* relacional;
* abstrato ampliado.

Em questões objetivas, SOLO_EXPECTED será apenas um metadado pedagógico da questão.

Ele não deverá ser utilizado isoladamente para afirmar qual nível de compreensão o aluno efetivamente demonstrou.

### SOLO_OBSERVED

Representa o nível de compreensão demonstrado na resposta produzida pelo aluno.

Somente poderá ser utilizado quando houver material suficiente para analisar o raciocínio ou a estrutura da resposta, como:

* respostas discursivas;
* redações;
* justificativas;
* resolução aberta de problemas;
* projetos;
* produções orais transcritas;
* relatórios;
* portfólios.

SOLO_OBSERVED não deverá ser atribuído a uma questão objetiva apenas com base na alternativa selecionada.

SOLO_EXPECTED e SOLO_OBSERVED nunca deverão sobrescrever um ao outro.

---

# 3. MODO DE TRABALHO OBRIGATÓRIO

Toda a implementação deverá ser dividida em subtarefas pequenas.

Nunca executar uma grande alteração de uma única vez.

Nunca iniciar duas subtarefas simultaneamente.

Cada subtarefa deverá seguir este fluxo:

1. anunciar o início da subtarefa;
2. informar o objetivo;
3. informar os arquivos ou módulos previstos;
4. informar os riscos;
5. definir os critérios de conclusão;
6. implementar somente aquela subtarefa;
7. executar testes;
8. corrigir os problemas encontrados;
9. atualizar a documentação;
10. atualizar o arquivo `CLAUDE.md`;
11. informar a conclusão;
12. apresentar o resumo das alterações;
13. informar os testes executados;
14. informar pendências ou riscos;
15. anunciar qual será a próxima subtarefa.

Não iniciar a próxima subtarefa antes de concluir, testar e documentar a atual.

---

# 4. FORMATO DE COMUNICAÇÃO

Sempre iniciar uma subtarefa utilizando este formato:

```text
------------------------------------------------------

INICIANDO SUBTAREFA XX

Objetivo:
...

Escopo:
...

Arquivos ou módulos previstos:
...

Riscos identificados:
...

Critérios de conclusão:
...

------------------------------------------------------
```

Sempre finalizar uma subtarefa utilizando este formato:

```text
------------------------------------------------------

SUBTAREFA XX CONCLUÍDA

Resumo:
...

Arquivos alterados:
...

Testes executados:
...

Resultado dos testes:
...

Decisões arquiteturais:
...

Pendências:
...

Documentação atualizada:
- CLAUDE.md
- ...
- ...

Próxima subtarefa:
...

------------------------------------------------------
```

Ao iniciar uma nova subtarefa, avisar explicitamente que a anterior foi encerrada e que uma nova etapa está começando.

---

# 5. DOCUMENTAÇÃO OBRIGATÓRIA

Ao final de toda subtarefa, atualizar:

* `CLAUDE.md`;
* documentação técnica relacionada;
* histórico de decisões arquiteturais;
* documentação de APIs, quando aplicável;
* documentação do banco de dados, quando aplicável;
* documentação dos prompts de IA, quando aplicável;
* documentação dos critérios pedagógicos, quando aplicável.

Registrar no mínimo:

* o que foi feito;
* por que foi feito;
* arquivos alterados;
* estrutura criada;
* impacto no sistema;
* testes executados;
* riscos;
* limitações;
* decisões arquiteturais;
* pendências;
* próximos passos.

Nunca deixar decisões importantes registradas apenas na conversa.

---

# 6. REGRAS GERAIS DE IMPLEMENTAÇÃO

* Não quebrar funcionalidades existentes.
* Não apagar dados existentes.
* Não remover código sem justificativa.
* Não realizar refatorações amplas sem necessidade.
* Não alterar contratos de APIs sem estratégia de compatibilidade.
* Não criar classificações fixas diretamente nas tabelas de questões.
* Não espalhar prompts de classificação em diferentes arquivos.
* Não confiar exclusivamente na classificação produzida pela IA.
* Não sobrescrever classificação humana aprovada.
* Não sobrescrever histórico de classificação.
* Não utilizar apenas verbos para determinar Bloom ou DOK.
* Não tratar dificuldade como sinônimo de profundidade cognitiva.
* Não tratar uma questão longa como automaticamente complexa.
* Não tratar uma questão objetiva como automaticamente DOK 1.
* Não tratar SOLO_EXPECTED como evidência do desempenho observado do aluno.

Sempre:

* preservar compatibilidade;
* realizar alterações pequenas;
* criar migrations reversíveis;
* manter versionamento;
* criar trilha de auditoria;
* validar entradas e saídas;
* utilizar estruturas reutilizáveis;
* seguir o padrão arquitetural atual do projeto;
* evitar duplicação;
* escrever código testável;
* documentar decisões;
* permitir revisão humana.

---

# 7. SUBTAREFA 00 — MANUAL DE CLASSIFICAÇÃO PEDAGÓGICA

Esta subtarefa é obrigatória e deverá ser concluída antes de qualquer alteração estrutural ou implementação do novo módulo.

## 7.1 Objetivo

Criar um manual normativo que seja a fonte oficial de critérios para todas as classificações pedagógicas realizadas pelo sistema.

O manual deverá orientar:

* classificações feitas pela IA;
* revisões feitas por professores;
* auditorias pedagógicas;
* geração de novas questões;
* importação de questões existentes;
* construção dos dashboards;
* interpretação dos resultados.

## 7.2 Arquivo obrigatório

Criar o arquivo:

```text
PEDAGOGICAL_CLASSIFICATION.md
```

Caso o projeto já possua uma estrutura própria de documentação, o arquivo poderá ser colocado na pasta apropriada, desde que sua localização seja registrada no `CLAUDE.md`.

## 7.3 Conteúdo obrigatório do manual

O manual deverá conter:

### A. Definições

Definir claramente:

* BNCC;
* habilidade;
* competência;
* objeto de conhecimento;
* Bloom;
* DOK;
* Eixo Cognitivo do INEP;
* SOLO_EXPECTED;
* SOLO_OBSERVED;
* dificuldade;
* complexidade;
* confiança;
* classificação sugerida;
* classificação aprovada.

### B. Critérios para Bloom

Para cada categoria de Bloom, apresentar:

* definição;
* evidências no enunciado;
* evidências na operação exigida;
* exemplos positivos;
* exemplos negativos;
* erros comuns de classificação;
* critérios de desempate;
* diferenças em relação às categorias vizinhas.

Não classificar Bloom apenas pelo verbo.

Exemplo:

O verbo "analisar" no enunciado não garante automaticamente a categoria "analisar".

A classificação deverá considerar o processamento efetivamente exigido.

### C. Critérios para DOK

Para cada nível DOK, apresentar:

* definição;
* características;
* quantidade e natureza das etapas cognitivas;
* necessidade de justificativa;
* necessidade de integração de evidências;
* exemplos objetivos;
* exemplos discursivos;
* exemplos do contexto escolar;
* exemplos semelhantes aos utilizados pelo ENEM;
* casos que parecem complexos, mas continuam sendo DOK 1 ou DOK 2;
* critérios de desempate.

O manual deverá registrar explicitamente que:

* dificuldade não é igual a DOK;
* extensão do texto não é igual a DOK;
* quantidade de cálculos não é igual a DOK;
* questão objetiva pode atingir DOK 2 ou DOK 3;
* DOK 4 normalmente exige investigação ampliada e dificilmente será representado por uma questão objetiva isolada de prova.

### D. Critérios para Eixos Cognitivos do INEP

Para cada eixo, apresentar:

* código;
* nome completo;
* definição;
* evidências esperadas;
* exemplos;
* diferenças entre os eixos;
* regras para classificação principal;
* regras para classificações secundárias, caso o sistema permita mais de um eixo.

Categorias:

* DL;
* CF;
* SP;
* CA;
* EP.

### E. Critérios para BNCC

Definir como selecionar habilidades da BNCC.

A classificação deverá considerar:

* etapa de ensino;
* ano ou série;
* componente curricular;
* unidade temática;
* objeto de conhecimento;
* habilidade;
* aderência entre o item e o texto oficial da habilidade.

Não associar uma habilidade BNCC apenas porque o assunto é semelhante.

Registrar:

* habilidade principal;
* habilidades secundárias, quando justificadas;
* grau de aderência;
* justificativa;
* versão da BNCC ou referência utilizada.

### F. Critérios para SOLO_EXPECTED

Para cada nível, apresentar:

* definição;
* estrutura de compreensão esperada;
* exemplos de tarefas;
* exemplos de perguntas objetivas;
* exemplos de perguntas discursivas;
* limitações da classificação em itens objetivos;
* diferenças entre níveis vizinhos.

Registrar expressamente:

> Em questões objetivas, SOLO_EXPECTED descreve a estrutura cognitiva prevista no desenho do item, mas não demonstra o nível efetivamente alcançado pelo aluno.

### G. Critérios para SOLO_OBSERVED

Para cada nível, apresentar:

* características da resposta do aluno;
* evidências textuais;
* exemplos;
* contraexemplos;
* rubricas;
* critérios de desempate;
* tratamento de respostas parcialmente corretas;
* tratamento de respostas sem justificativa;
* tratamento de respostas copiadas ou sem relação com o problema.

SOLO_OBSERVED somente poderá ser calculado quando houver resposta analisável.

### H. Relação entre as taxonomias

O manual deverá explicar que as classificações são independentes.

Exemplos:

* uma questão pode ser Bloom "Aplicar" e DOK 1;
* uma questão pode ser Bloom "Aplicar" e DOK 3;
* uma questão pode ser Bloom "Analisar" e DOK 2;
* duas questões com a mesma habilidade BNCC podem possuir Bloom e DOK diferentes;
* SOLO_EXPECTED não deve ser inferido automaticamente a partir de Bloom;
* DOK não deve ser inferido automaticamente a partir da dificuldade.

### I. Casos ambíguos

Criar uma seção específica para situações ambíguas.

O manual deverá orientar:

* como escolher a classificação principal;
* quando admitir classificação secundária;
* quando reduzir o nível de confiança;
* quando encaminhar para revisão humana;
* quando marcar como "não classificável";
* quando registrar divergência entre classificadores.

### J. Exemplos calibrados

Incluir exemplos de questões classificadas, contendo:

* enunciado resumido;
* tipo da questão;
* etapa de ensino;
* disciplina;
* BNCC;
* Bloom;
* DOK;
* Eixo Cognitivo;
* SOLO_EXPECTED;
* justificativa;
* nível de confiança.

Incluir exemplos de:

* Educação Infantil, quando aplicável;
* Anos Iniciais;
* Anos Finais;
* Ensino Médio;
* questões no estilo ENEM;
* questões objetivas;
* questões discursivas.

Não copiar integralmente questões protegidas por direitos autorais.

Utilizar pequenos trechos, referências ou exemplos autorais equivalentes.

### K. Rubrica de confiança

Definir critérios para o campo `confidence`.

Sugestão:

* `0.90 a 1.00` — classificação altamente evidente;
* `0.75 a 0.89` — classificação consistente, com pequena margem de ambiguidade;
* `0.60 a 0.74` — classificação possível, mas requer revisão;
* abaixo de `0.60` — não aprovar automaticamente.

Os limites deverão ser configuráveis.

### L. Processo de aprovação

Definir os estados:

* sugerida;
* em revisão;
* aprovada;
* rejeitada;
* substituída;
* desatualizada.

Definir precedência:

1. classificação humana aprovada;
2. classificação importada de fonte oficial validada;
3. classificação de IA revisada;
4. classificação automática ainda não revisada.

### M. Versionamento do manual

O documento deverá possuir:

* versão;
* data;
* autor ou responsável;
* histórico de alterações;
* motivo de cada revisão.

As classificações deverão registrar a versão do manual utilizada.

## 7.4 Validação da Subtarefa 00

Antes de concluir esta subtarefa:

1. selecionar uma amostra de questões existentes;
2. aplicar o manual;
3. comparar as classificações;
4. identificar ambiguidades;
5. ajustar os critérios;
6. registrar exemplos no documento;
7. validar que o manual diferencia corretamente Bloom, DOK e dificuldade;
8. validar que SOLO_EXPECTED e SOLO_OBSERVED não estão sendo confundidos.

## 7.5 Restrições da Subtarefa 00

Nesta etapa:

* não alterar banco de dados;
* não criar migrations;
* não modificar APIs;
* não modificar dashboards;
* não alterar fluxos de produção;
* não executar reclassificação em massa;
* não alterar questões existentes.

A Subtarefa 00 é exclusivamente documental, analítica e preparatória.

## 7.6 Critérios de conclusão

A Subtarefa 00 somente poderá ser considerada concluída quando:

* `PEDAGOGICAL_CLASSIFICATION.md` estiver criado;
* todas as taxonomias estiverem definidas;
* houver exemplos positivos e negativos;
* houver critérios para casos ambíguos;
* houver rubrica de confiança;
* houver regras de aprovação;
* houver versionamento;
* uma amostra de questões tiver sido analisada;
* o `CLAUDE.md` estiver atualizado;
* nenhuma alteração funcional tiver sido realizada.

---

# 8. ARQUITETURA DO MÓDULO

Criar um módulo desacoplado com nome sugerido:

```text
Pedagogical Classification Engine
```

O nome final deverá seguir o padrão do projeto.

O módulo será responsável por:

* cadastro de taxonomias;
* cadastro de categorias;
* classificação de questões;
* classificação de respostas;
* versionamento;
* auditoria;
* aprovação humana;
* confiança;
* justificativas;
* integração com IA;
* integração com importações;
* integração com geração de questões;
* disponibilização de dados para dashboards.

A lógica pedagógica não deverá ficar diretamente acoplada:

* ao modelo de questão;
* ao dashboard;
* ao provedor de IA;
* ao fluxo de importação;
* ao fluxo de correção.

---

# 9. MODELO DE DADOS

Antes de criar migrations, analisar o banco atual.

Não presumir tecnologia, ORM ou padrão de nomes sem verificar o projeto.

A estrutura deverá suportar entidades conceitualmente equivalentes a:

## 9.1 Taxonomia

Campos sugeridos:

```text
id
code
name
description
version
is_active
created_at
updated_at
```

Exemplos de `code`:

```text
BNCC
BLOOM
DOK
INEP_COGNITIVE_AXIS
SOLO_EXPECTED
SOLO_OBSERVED
```

## 9.2 Categoria da taxonomia

Campos sugeridos:

```text
id
taxonomy_id
code
name
description
order
metadata
is_active
created_at
updated_at
```

## 9.3 Classificação pedagógica

Campos sugeridos:

```text
id
classifiable_type
classifiable_id
taxonomy_id
category_id
classification_code
confidence
source
status
explanation
evidence
manual_version
model_provider
model_name
prompt_version
version
supersedes_id
created_by
approved_by
approved_at
created_at
updated_at
```

O uso de relação polimórfica deverá ser avaliado conforme o padrão atual do projeto.

A classificação poderá estar vinculada a:

* questão;
* resposta do aluno;
* atividade;
* projeto;
* redação;
* outro objeto classificável no futuro.

## 9.4 Histórico de auditoria

Registrar:

```text
id
classification_id
action
previous_value
new_value
reason
performed_by
created_at
```

## 9.5 Regras obrigatórias

* Permitir múltiplas classificações por questão.
* Permitir uma classificação principal e classificações secundárias.
* Não apagar histórico.
* Não sobrescrever classificação aprovada.
* Permitir inativação.
* Permitir substituição versionada.
* Registrar origem.
* Registrar confiança.
* Registrar justificativa.
* Registrar evidências.
* Registrar versão do manual.
* Registrar versão do prompt.
* Registrar modelo de IA utilizado.

---

# 10. ORIGEM DAS CLASSIFICAÇÕES

Toda classificação deverá possuir origem identificável.

Exemplos:

```text
AI
TEACHER
PEDAGOGICAL_REVIEW
ENEM_IMPORT
MANUAL_IMPORT
SYSTEM_RULE
OFFICIAL_SOURCE
```

Os valores deverão seguir a convenção atual do projeto.

A origem deverá ser auditável.

---

# 11. CLASSIFICAÇÃO DE QUESTÕES EXISTENTES

Para questões existentes, incluindo itens importados do ENEM, a IA poderá sugerir:

* Bloom;
* DOK;
* Eixo Cognitivo do INEP;
* BNCC;
* SOLO_EXPECTED.

Não criar SOLO_OBSERVED para questões.

Antes de classificar em massa:

1. criar um modo de simulação;
2. selecionar amostra;
3. validar resultados;
4. medir confiança;
5. identificar divergências;
6. permitir revisão humana;
7. aprovar o processo;
8. somente depois executar processamento em lote.

Nenhuma reclassificação em massa deverá ser executada sem mecanismo de retomada, logs e idempotência.

---

# 12. GERAÇÃO DE NOVAS QUESTÕES COM IA

Ao gerar uma questão, o serviço deverá solicitar resposta estruturada.

A resposta deverá conter, conforme o tipo da questão:

```text
question
question_type
statement
supporting_text
alternatives
correct_answer
answer_explanation
bncc
bloom
dok
inep_cognitive_axis
solo_expected
estimated_time
difficulty
classification_justification
classification_confidence
```

Cada classificação deverá possuir sua própria:

* categoria;
* confiança;
* justificativa;
* evidência.

Não utilizar uma confiança única para todas as taxonomias.

Exemplo conceitual:

```json
{
  "bloom": {
    "code": "APPLY",
    "confidence": 0.91,
    "justification": "..."
  },
  "dok": {
    "level": 2,
    "confidence": 0.84,
    "justification": "..."
  }
}
```

Validar a resposta da IA com schema.

Caso a resposta seja inválida:

* não salvar parcialmente sem controle;
* registrar erro;
* tentar reparo controlado;
* respeitar limite de tentativas;
* encaminhar para revisão quando necessário.

---

# 13. CLASSIFICAÇÃO DE RESPOSTAS DISCURSIVAS

Quando houver resposta discursiva, o sistema poderá gerar SOLO_OBSERVED.

A análise deverá considerar:

* conteúdo da resposta;
* relações estabelecidas;
* quantidade de elementos relevantes;
* integração entre conceitos;
* generalização;
* coerência;
* justificativa;
* evidências;
* aderência à pergunta.

A classificação deverá retornar:

```text
solo_observed
confidence
justification
evidence
limitations
requires_human_review
```

SOLO_OBSERVED não deverá substituir:

* nota;
* rubrica;
* correção do professor;
* classificação Bloom da questão;
* DOK da questão;
* SOLO_EXPECTED.

---

# 14. DASHBOARD DO ALUNO

O dashboard deverá ser desenvolvido progressivamente.

Não criar todos os gráficos simultaneamente.

## 14.1 Desempenho por Bloom

Exibir:

* quantidade de questões;
* quantidade de acertos;
* percentual de acertos;
* evolução no tempo;
* nível de confiança da análise;
* tamanho da amostra.

Categorias:

* lembrar;
* compreender;
* aplicar;
* analisar;
* avaliar;
* criar.

Não apresentar conclusões fortes quando a amostra for insuficiente.

## 14.2 Desempenho por DOK

Exibir:

* DOK 1;
* DOK 2;
* DOK 3;
* DOK 4;
* taxa de acerto;
* quantidade de itens;
* evolução;
* distribuição por disciplina.

DOK 4 deverá ser apresentado apenas quando houver atividades adequadas para medi-lo.

## 14.3 Desempenho por BNCC

Agrupar por:

* componente curricular;
* unidade temática;
* habilidade;
* ano ou série;
* período;
* domínio;
* desenvolvimento;
* necessidade de intervenção.

## 14.4 Desempenho por Eixo Cognitivo do INEP

Exibir:

* DL;
* CF;
* SP;
* CA;
* EP.

Utilizar os nomes completos na interface e os códigos como identificadores.

## 14.5 Matriz Bloom × DOK

Criar matriz cruzando:

* processo cognitivo;
* profundidade;
* quantidade de questões;
* percentual de acerto;
* tamanho da amostra.

Exemplo de interpretação:

> O aluno apresenta bom desempenho em tarefas de aplicação até DOK 2, mas demonstra queda em tarefas de aplicação classificadas como DOK 3.

Não gerar conclusões quando houver número insuficiente de itens em determinada célula.

## 14.6 Análise SOLO

Exibir separadamente:

* SOLO_EXPECTED das atividades;
* SOLO_OBSERVED das respostas discursivas.

Nunca apresentar SOLO_EXPECTED como se fosse desempenho observado.

---

# 15. PERFIL COGNITIVO

O perfil cognitivo deverá ser produzido a partir de regras transparentes e dados disponíveis.

Poderá conter:

* pontos fortes;
* pontos em desenvolvimento;
* habilidades BNCC com maior domínio;
* habilidades BNCC que necessitam de intervenção;
* desempenho por Bloom;
* profundidade DOK sustentada;
* desempenho por Eixo Cognitivo;
* evolução;
* inconsistências;
* recomendações de estudo;
* sugestões pedagógicas.

Toda conclusão deverá informar:

* período analisado;
* tamanho da amostra;
* disciplinas consideradas;
* nível de confiança;
* limitações.

Evitar rótulos permanentes.

Não afirmar:

> O aluno não sabe analisar.

Preferir:

> Na amostra analisada, o aluno apresentou menor desempenho em questões classificadas na categoria "Analisar", especialmente em itens DOK 3.

---

# 16. AUDITORIA E VERSIONAMENTO

Toda classificação deverá ser auditável.

Registrar:

* classificação anterior;
* classificação nova;
* motivo;
* responsável;
* data;
* origem;
* confiança;
* versão do manual;
* versão do prompt;
* modelo de IA;
* aprovação;
* rejeição;
* substituição.

Nunca apagar uma classificação anterior apenas porque uma nova foi criada.

---

# 17. REVISÃO HUMANA

Criar mecanismo para revisão pedagógica.

O revisor deverá poder:

* aprovar;
* rejeitar;
* editar;
* substituir;
* comentar;
* solicitar nova análise;
* visualizar justificativa;
* visualizar evidências;
* visualizar confiança;
* visualizar histórico.

Priorizar revisão para:

* confiança baixa;
* divergência entre modelos;
* divergência entre IA e professor;
* habilidades BNCC ambíguas;
* itens com múltiplas classificações possíveis;
* questões utilizadas em avaliações de alto impacto.

---

# 18. EXTENSIBILIDADE

A arquitetura deverá permitir adicionar futuramente:

* Taxonomia de Marzano;
* Taxonomia de Fink;
* Anderson e Krathwohl;
* rubricas próprias;
* competências socioemocionais;
* níveis de letramento;
* matrizes de vestibulares;
* classificações institucionais.

Novas taxonomias não deverão exigir novas colunas na tabela principal de questões.

---

# 19. ROADMAP DE SUBTAREFAS

## Subtarefa 00

Criar o Manual de Classificação Pedagógica.

Entregável principal:

```text
PEDAGOGICAL_CLASSIFICATION.md
```

Nenhuma alteração funcional nesta etapa.

## Subtarefa 01

Mapear a arquitetura existente.

Analisar:

* tecnologias;
* banco;
* modelos;
* serviços;
* rotas;
* geração por IA;
* importação ENEM;
* dashboards;
* testes;
* documentação.

Nenhuma alteração funcional.

## Subtarefa 02

Projetar a arquitetura do novo módulo.

Criar documento de decisão arquitetural.

Nenhuma migration nesta etapa.

## Subtarefa 03

Modelar as entidades e relacionamentos.

Apresentar o modelo antes de implementar.

## Subtarefa 04

Criar migrations reversíveis.

Executar testes de aplicação e rollback.

## Subtarefa 05

Criar entidades, models ou repositories.

Seguir os padrões existentes.

## Subtarefa 06

Criar catálogo de taxonomias e categorias.

Popular os dados iniciais de maneira idempotente.

## Subtarefa 07

Criar camada de serviços.

Implementar regras de criação, substituição, aprovação e consulta.

## Subtarefa 08

Criar APIs internas.

Documentar contratos e validações.

## Subtarefa 09

Criar versionamento das classificações.

Não sobrescrever histórico.

## Subtarefa 10

Criar auditoria.

Registrar todas as alterações relevantes.

## Subtarefa 11

Criar mecanismo de revisão humana.

Implementar estados e precedência.

## Subtarefa 12

Integrar classificação de questões importadas do ENEM.

Começar por modo de simulação e amostra.

## Subtarefa 13

Integrar classificação de questões existentes.

Não executar lote total sem validação.

## Subtarefa 14

Integrar geração de novas questões com metadados pedagógicos.

Utilizar saída estruturada e schema.

## Subtarefa 15

Implementar validação e reparo das respostas da IA.

Registrar falhas e limitar tentativas.

## Subtarefa 16

Implementar SOLO_OBSERVED em respostas discursivas.

Não aplicar a questões objetivas.

## Subtarefa 17

Criar dashboard Bloom.

## Subtarefa 18

Criar dashboard DOK.

## Subtarefa 19

Criar dashboard BNCC.

## Subtarefa 20

Criar dashboard dos Eixos Cognitivos do INEP.

## Subtarefa 21

Criar matriz Bloom × DOK.

## Subtarefa 22

Criar análise de SOLO.

Separar esperado de observado.

## Subtarefa 23

Criar perfil cognitivo do aluno.

Incluir amostra, confiança e limitações.

## Subtarefa 24

Executar testes integrados e validação pedagógica.

## Subtarefa 25

Realizar revisão de segurança, desempenho e custos de IA.

## Subtarefa 26

Concluir documentação técnica, pedagógica e operacional.

---

# 20. TESTES OBRIGATÓRIOS

Criar testes para:

* criação de taxonomia;
* criação de categoria;
* classificação de questão;
* classificação de resposta;
* múltiplas taxonomias no mesmo item;
* versionamento;
* substituição;
* aprovação;
* rejeição;
* auditoria;
* confiança;
* classificação principal;
* classificação secundária;
* importação;
* geração por IA;
* resposta inválida da IA;
* idempotência;
* rollback de migration;
* compatibilidade com dados existentes;
* preservação de classificação humana;
* separação entre SOLO_EXPECTED e SOLO_OBSERVED.

---

# 21. SEGURANÇA E PRIVACIDADE

Ao enviar respostas de alunos para serviços de IA:

* minimizar dados pessoais;
* evitar enviar nome completo quando desnecessário;
* utilizar identificadores internos;
* registrar o provedor utilizado;
* observar requisitos da LGPD;
* documentar retenção de dados;
* proteger logs;
* não incluir dados sensíveis em mensagens de erro;
* respeitar a política de privacidade existente.

---

# 22. CUSTOS E DESEMPENHO

Antes de classificar grandes volumes:

* estimar quantidade de itens;
* estimar tokens;
* estimar custo;
* implementar lotes;
* implementar retomada;
* implementar cache quando aplicável;
* evitar reclassificação desnecessária;
* respeitar classificações aprovadas;
* registrar falhas;
* controlar concorrência;
* observar limites do provedor.

---

# 23. CRITÉRIOS GERAIS DE SUCESSO

O projeto será considerado concluído quando:

* nenhuma funcionalidade existente tiver sido quebrada;
* o manual pedagógico estiver documentado e versionado;
* as taxonomias estiverem desacopladas;
* novas taxonomias puderem ser adicionadas sem alteração estrutural significativa;
* classificações tiverem origem, confiança, justificativa e versão;
* classificações humanas aprovadas forem preservadas;
* houver auditoria completa;
* importação ENEM estiver integrada;
* geração de questões estiver integrada;
* SOLO_EXPECTED e SOLO_OBSERVED estiverem separados;
* dashboards apresentarem tamanho de amostra;
* análises evitarem conclusões sem dados suficientes;
* `CLAUDE.md` estiver atualizado;
* documentação técnica e pedagógica estiver completa;
* testes automatizados estiverem passando.

---

# 24. PRIMEIRA AÇÃO

Comece exclusivamente pela Subtarefa 00.

Antes de qualquer implementação:

1. leia o projeto e a documentação atual;
2. identifique as classificações já existentes;
3. localize os campos atuais de BNCC, Bloom e INEP;
4. não altere nenhum arquivo funcional;
5. crie o `PEDAGOGICAL_CLASSIFICATION.md`;
6. construa o manual com critérios objetivos;
7. selecione uma pequena amostra de questões para calibração;
8. registre ambiguidades encontradas;
9. atualize o `CLAUDE.md`;
10. apresente o relatório de conclusão da Subtarefa 00.

Não avance para a Subtarefa 01 antes de concluir e documentar integralmente a Subtarefa 00.

Caso encontre uma decisão pedagógica que não possa ser resolvida com segurança, registre:

* a dúvida;
* as alternativas;
* os impactos;
* a recomendação técnica e pedagógica.

Não realize mudanças estruturais de alto impacto sem documentar previamente a necessidade.
