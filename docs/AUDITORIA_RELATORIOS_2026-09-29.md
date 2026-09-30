# Auditoria dos relatórios — 29/09/2026

## Escopo e evidência

Revisão do workspace local e, em seguida, validação autenticada e somente leitura da produção em 29/09/2026. Foram inspecionados o painel publicado, a API/código presente no servidor e contagens agregadas do banco produtivo, sem alterar dados nem arquivos remotos. O diretório do servidor contém mudanças não commitadas; por isso, o comportamento visível e as consultas ao banco são a evidência principal, enquanto o hash Git isoladamente não descreve toda a versão ativa. Nenhum código funcional foi alterado nesta auditoria.

### Retrato confirmado em produção

- 1.485 correções estão marcadas como revisadas e presentes: 580 nos anos iniciais, 673 nos anos finais e 232 no ensino médio.
- O painel exibe 1.478 correções com alguma resposta efetivamente avaliada. Sete registros revisados não possuem resposta avaliada e são omitidos da média: três nos anos finais e quatro no ensino médio.
- Há 15 correções revisadas com respostas ainda pendentes: três nos anos iniciais, três nos anos finais e nove no ensino médio. Como a nota total mantém todas as questões no denominador, essas pendências podem reduzir a média exibida.
- O ensino médio publicado reúne 228 correções computáveis, 12 provas, 50 perfis e apenas o 3º bimestre de 2026 para 1º e 2º anos. O SAE possui importações do 3º ano para o 1º e o 2º bimestres, em fluxo separado.
- Todas as provas desse recorte têm turma vinculada e todas as correções do ensino médio têm identificador do Classroom. Ainda assim, os perfis são agrupados pelo texto do nome.
- Existe um nome associado a mais de um identificador do Classroom no conjunto institucional. Isso confirma risco real de fusão indevida por nome, sem afirmar que se trate necessariamente de homônimos; pode ser uma correção cadastral.

## Problemas encontrados

| Prioridade | Achado | Consequência e encaminhamento |
| --- | --- | --- |
| Resolvido na produção atual | A primeira leitura do dev encontrou `finalGrade` usado diretamente nas agregações pedagógicas. | A produção ativa já usa `answerGradeOnTen` e respeita o peso da questão. Manter teste de regressão para garantir que 2/2 continue aparecendo como 100%. |
| P0 | Perfis são agrupados por `studentName`, sem usar `classroomStudentId`. | Homônimos podem ser fundidos e grafias diferentes podem fragmentar o histórico. Criar identidade interna de estudante e vínculos externos; não requer conta de login. Não unir cadastros automaticamente apenas pelo nome. |
| P0 | Link individual envia apenas `aluno`; relatório consulta apenas `student`. | Ano, bimestre, turma, disciplina e segmento do painel não delimitam o documento individual. Preservar o recorte na URL, consulta e impressão. |
| P0 | Correções podem chegar a `revisado` com respostas não avaliadas. | Em produção há sete correções sem qualquer nota e quinze parcialmente avaliadas. Impedir a transição ou criar estado explícito de incompletude; excluir pendências da análise pedagógica sem escondê-las da cobertura operacional. |
| P1 | Filtro de turma existe na API somente para superusuários, mas não existe no painel. Professor não recebe nenhum controle de filtros na tela. | Adicionar filtros para todos os papéis, sempre como interseção com o escopo autorizado. Hoje o escopo docente é prova atribuída, não vínculo completo professor–turma–disciplina. |
| P1 | Série é agregada como `${gradeYear}º ano`, sem segmento. | 1º ano do fundamental e 1º do médio podem cair no mesmo grupo institucional. Usar chave segmento+série e opções dependentes do segmento. |
| P1 | O retorno antecipado de tela vazia remove os filtros. | Um recorte sem resultados impede limpar filtros pela própria interface e informa genericamente que não há correções. Manter controles e distinguir ausência global de ausência no recorte. |
| P1 | Contagens de respostas são chamadas de itens e determinam “confiabilidade alta” a partir de 15. | Uma questão respondida por 30 alunos pode parecer uma base de 30 questões. Exibir alunos únicos, questões únicas, respostas válidas e avaliações; substituir confiança heurística por suficiência de evidência claramente definida. |
| P1 | Nota ENEM externa maior que 100 é dividida por 10 no importador CSV. | A unidade é inferida por célula. Exigir escala declarada por coluna/importação e preservar pontos separados de percentual de acertos; redação deve manter sua unidade e critérios. |
| P2 | Média geral é média de correções; não há denominador de alunos previstos. | Alunos com mais provas pesam mais. Exibir política de agregação e distinguir estudantes, avaliações, participações e pendências. Não inferir ausência a partir da inexistência de uma correção. |
| P2 | Questões com mais erro excluem respostas sem `transcribedAnswer`. | O denominador pode divergir dos demais indicadores. Separar erro, branco, inválida, pendente e não aplicável. |
| P2 | CSV exporta apenas média geral e por disciplina. | Exportar o conteúdo da visão ativa com recorte, unidades, denominadores e data da geração. |

## ENEM: por que o aviso aparece

O fluxo de desempenho só inclui correções `revisado` de `examKind = prova`. Para contar um resultado no painel INEP, exige simultaneamente:

1. Questão com `source = enem_bank`.
2. Referência `enemBankRef.questionId` válida.
3. Classificação importada de origem ENEM associada a eixo cognitivo.
4. Eixo entre DL, CF, SP, CA e EP.

Ser prova do ensino médio não satisfaz esses critérios. Questões autorais/IA ficam de fora mesmo quando carregam referência `saeb.source = enem`. A API não usa essa referência como matriz ENEM estruturada. Competências e habilidades já existem no esquema do banco importado, mas a consulta do desempenho só usa eixos. O campo de procedência da classificação é consultado, mas não é exposto no diagnóstico.

Na produção, a explicação é mais específica:

- As 12 provas do ensino médio contêm 149 questões: 130 geradas por IA com referência pedagógica ENEM, 13 sem essa referência e seis questões reais do banco oficial.
- As seis questões oficiais estão na mesma prova de Química do 2º ano. Todas mantêm referência válida, classificação oficial e eixo cognitivo CF.
- A única correção dessa prova está marcada como revisada, mas as seis questões oficiais estão sem `isCorrect` e sem nota. Por isso, o painel INEP mostra corretamente zero resultados computáveis, porém a mensagem “nenhuma questão apareceu” descreve a causa de forma errada.
- Os perfis repetem “Sem questões ENEM com eixo INEP” mesmo para alunos e disciplinas nos quais ENEM não era aplicável, transformando uma ausência de evidência em alerta genérico.

O estado correto dessa amostra seria: **“Há seis questões oficiais com eixo CF, mas nenhuma possui resultado corrigido neste recorte.”** As 130 questões de IA alinhadas ao ENEM devem ser apresentadas em uma camada separada, com sua procedência, sem serem chamadas de itens oficiais.

O resultado SAE persistido tem outra rota e não é integrado ao perfil interno. `scoreResult`, que armazena o resultado de pontuação e eventual estimativa TRI, também não é selecionado pela API de desempenho. São três lacunas diferentes: cobertura da matriz, integração de resultados e apresentação da pontuação.

Antes de qualquer correção histórica, levantar por prova, sem divulgar nomes: quantidade de questões por origem; referências ausentes; cobertura de área/competência/habilidade/eixo; classificação pendente; correções revisadas; situação de `scoreResult` e calibração. Isso distingue provas sem itens oficiais de vínculos quebrados ou classificações ausentes.

### Comportamento proposto

- Mostrar área → competência → habilidade e, separadamente, eixo cognitivo.
- Usar chave de habilidade composta por área e código; H1 isolado não identifica uma habilidade única entre áreas.
- Diferenciar origem do item, classificação pedagógica e disponibilidade de calibração.
- Permitir mapear questões autorais à matriz com justificativa, versão, procedência e revisão pedagógica, sem mudar sua origem para banco oficial.
- Separar percentual de acertos, nota ponderada, estimativa interna e estimativa TRI. Exibir cobertura, itens usados e incerteza conforme o método existente; não chamar estimativa local de nota oficial.
- Explicar estados vazios: “sem itens do banco oficial”, “itens oficiais aguardando classificação”, “referência inconsistente”, “sem respostas revisadas neste recorte” e “sem calibração disponível”.
- Não exibir uma limitação ENEM genérica em todo perfil quando a matriz não for pertinente ao recorte.

## Produto proposto

Navegação principal por público: Aluno, Turma, Coordenação e Escola. BNCC, ENEM, Bloom, DOK e SOLO tornam-se lentes dentro dessas visões, com explicação acessível e detalhe técnico expansível.

Filtros comuns: ano letivo, período, segmento, série, turma, disciplina/área, avaliação e aluno. Professor responsável para gestão. Origem/tipo da avaliação e estado da correção para diagnóstico de cobertura. Filtros dependentes, selecionáveis a partir de dados autorizados, persistidos na URL e mantidos ao abrir detalhes/exportar. Ano letivo atual como padrão explícito, com opção de histórico.

| Visão | Pergunta central | Entrega proposta |
| --- | --- | --- |
| Aluno | O que aprendeu e qual o próximo passo? | Linha do tempo por disciplina, desempenho e cobertura por habilidade, evidências de respostas, comparação com turma na mesma avaliação, até três prioridades de estudo e acompanhamento da retomada. |
| Turma | O que precisa ser retomado em sala? | Participação e revisão, distribuição de desempenho, matriz aluno×habilidade, dificuldades coletivas, distratores e brancos, grupos temporários de apoio e plano de retomada. |
| Coordenação | Onde apoiar o trabalho pedagógico? | Comparação de turmas comparáveis, cobertura curricular, equilíbrio das avaliações, pendências de aplicação/correção, prioridades por disciplina e intervenções com responsável e prazo. |
| Escola | Estamos avançando e atendendo quem precisa? | Síntese por segmento, cobertura de avaliação, distribuição e evolução contextualizada, alunos com evidência de dificuldade recorrente, alcance e resultado de intervenções. Abrir indicador até turma, aluno e evidência. |

Comparações devem explicitar avaliação, composição do grupo, amostra e cobertura. Bimestres com provas diferentes geram variação descritiva, não demonstração automática de ganho de aprendizagem. Média por professor não deve se tornar ranking de qualidade docente.

## Base de dados necessária

- Estudante interno, turma, matrícula por ano e vínculo docente–turma–disciplina.
- Aplicação de avaliação separada do modelo de prova: o vínculo atual de uma turma por prova limita aplicações em múltiplas salas.
- Identidade externa Classroom como vínculo; entradas manuais devem ter conciliação revisável e rastreável.
- Snapshot da matrícula/turma e classificação na aplicação, para mudanças posteriores não reescreverem o histórico silenciosamente.
- Associação explícita entre estudante interno e importações SAE. O índice atual é ano+série+bimestre, sem turma/aplicação; revisar antes de suportar várias salas e simulados no mesmo período.
- Camada compartilhada de filtros, escopo e métricas. Não começar por materialização: medir tempo, volume e tamanho de resposta; paginar detalhes e pré-agregar apenas quando necessário.

## Sequência de implantação e aceite

1. **Confiabilidade dos números:** normalização, identidade, manutenção do recorte, estados vazios e diagnóstico ENEM. Aceite: 2/2 pontos = 100% em todas as lentes; homônimos separados; PDF reproduz o recorte; ausência de classificação tem motivo correto.
2. **Turma e aluno:** filtros, vínculos/matrículas, distribuição, matriz de habilidades, histórico e exportação útil. Aceite: docente filtra somente seu escopo, inclusive por URL; alunos sem evidência suficiente ficam identificados; navegação preserva filtros.
3. **Coordenação e escola:** cobertura, comparações contextualizadas e acompanhamento de intervenção. Aceite: contagens de estudantes únicos e participação reconciliadas; grupos comparados e denominadores explícitos.
4. **ENEM ampliado:** matriz completa, classificação autoral revisável, integração SAE e apresentação de TRI quando disponível. Aceite: procedência visível, habilidade identificada por área, unidades preservadas e nenhum cálculo inventado para dados ausentes.

Na implementação, validar com casos sintéticos e uma amostra autorizada de provas reais: pesos distintos, nomes iguais, séries iguais em segmentos diferentes, provas sem vínculo de turma, correções parciais, itens sem classificação, fontes ENEM/IA/SAE e períodos diferentes. A auditoria estática não substitui essa reconciliação com dados reais.

## Arquivos principais revisados

- `src/app/api/analytics/performance/route.ts`
- `src/app/(app)/desempenho/DesempenhoPanel.tsx`
- `src/app/(app)/desempenho/relatorio/student-report.tsx`
- `src/app/(app)/desempenho/simulado-enem/simulator-import.tsx`
- `src/app/api/analytics/enem-sae/route.ts`
- `src/lib/analytics/enemSae.ts`
- `src/lib/corrections/totalGrade.ts`
- `src/lib/corrections/gradeNormalization.ts`
- `src/lib/scoring/scoringPolicy.ts`
- `src/lib/gemini/examSchema.ts`
- `src/db/schema.ts`

Os documentos anteriores de fase 6 têm diferenças sobre retenção do SAE em relação ao código atual. Atualizá-los junto com a implantação, tomando os fluxos efetivamente implementados como evidência do comportamento.
