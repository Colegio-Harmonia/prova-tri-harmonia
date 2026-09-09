# Fase 6.12 a 6.19 - Importação e Diagnóstico ENEM-SAE

## Modelo validado

Foram validadas duas matrizes `Alunos X Questões` do 3º ano do Ensino Médio:

- `Alunos x Questões1.xlsx`: 1º bimestre;
- `Alunos x Questões2.xlsx`: 2º bimestre.

Cada arquivo contém 13 alunos e 185 colunas de item: 50 de Linguagens (`LC`)
e 45 em cada uma das áreas `CH`, `CN` e `MT`. Os cinco itens da língua
estrangeira não cursada ficam vazios, resultando em 180 respostas por aluno.

## Contrato de importação

`POST /api/analytics/enem-sae/import` aceita somente `.xlsx` até 5 MB e exige
coordenação ou direção. Para cada bimestre, recebe obrigatoriamente:

- `responses`: modelo `Alunos X Questões`, com `Nome` em `A2` e
  identificadores como `1-IN-LC`, `6-LC`, `46-CH`, `91-CN` e `136-MT`;
- `questionMatrix`: modelo `Questões por simulado`, com `Posição`, `Área`,
  `Disciplina`, `Competência`, `Habilidade`, `Tópico`, `Gabarito` e
  indicadores de acerto.

A importação só continua quando cada item respondido encontra um único item da
matriz pela posição, área e percentual de acerto da escola. Isso impede cruzar
uma habilidade com uma questão de outro simulado. Nos arquivos validados, os
180 itens respondidos em cada bimestre tiveram vínculo único. Os cinco itens
da língua estrangeira não cursada permanecem sem resposta e não entram no
diagnóstico.

O XLSX é lido somente em memória e descartado após o processamento. O sistema
persiste o snapshot analítico necessário para o dashboard (incluindo nomes e
resultados), por ano letivo, série e bimestre; não grava as planilhas brutas em
disco nem em banco de dados.

## Métricas

- percentual geral por aluno e bimestre;
- desempenho por `LC`, `CH`, `CN` e `MT`;
- itens com maior erro;
- evolução individual entre 1º e 2º bimestre;
- referência de 60% e recomendações por área abaixo desse limiar.

Com a matriz de questões, a leitura individual também inclui competência,
habilidade, tópico e disciplina. Para cada agrupamento, o relatório mostra
acerto do aluno, acerto da turma, base de itens e uma orientação. Agrupamentos
com um único item são exibidos como sinal inicial, não como diagnóstico
conclusivo.

Bloom, DOK, BNCC e eixo cognitivo não são inferidos: a matriz ENEM-SAE
fornecida não contém esses metadados. A variação entre bimestres não atribui
causa nem equipara a dificuldade de provas diferentes.

## Verificação com os arquivos fornecidos

| Métrica | 1º bimestre | 2º bimestre |
| --- | ---: | ---: |
| Desempenho geral | 44% | 44% |
| Linguagens | 51% | 52% |
| Ciências Humanas | 49% | 43% |
| Ciências da Natureza | 31% | 36% |
| Matemática | 46% | 44% |
| Alunos abaixo de 60% | 12 de 13 | 12 de 13 |

## Limites

Histórico permanente, associação segura com o perfil interno e
compartilhamento automático com responsáveis continuam condicionados à
política de retenção e consentimento de TD-013. Arquivos fora do modelo
validado são recusados para não produzir análise ambígua.

## Publicação e evidências

A extensão foi publicada na produção na release `v0.6.6` (commit `7041f84`).
O candidato passou por instalação limpa, lint, TypeScript, build e auditoria
de dependências de produção sem vulnerabilidades. Em DEV, os dois arquivos
fornecidos foram enviados em uma sessão autenticada e produziram as métricas
registradas acima. Em produção, as verificações anônimas confirmaram `/login`
em `200`, a página e a API protegidas em `307`, processo PM2 online e log sem
erro novo após a troca atômica.

O upload autenticado não foi repetido em produção: a conta usada para o teste
de DEV não existe no banco produtivo. A validação operacional em produção é o
upload manual dos dois arquivos por uma conta de coordenação ou direção.

## Verificação do diagnóstico pedagógico

Os quatro arquivos fornecidos foram processados diretamente, sem cópia para o
repositório. Em ambos os bimestres, a leitura confirmou 13 alunos, 2.340
respostas e 180 itens com competência, habilidade, tópico e disciplina
vinculados. Foram identificadas 120 habilidades distintas em cada matriz.

O próximo enriquecimento possível exige uma matriz do fornecedor com eixo
cognitivo e, caso desejado, códigos BNCC por item. Esses dados devem ser
fornecidos ou revisados pela equipe pedagógica antes de serem apresentados como
classificação oficial.

## Publicação do diagnóstico

O diagnóstico pedagógico foi publicado na produção na release `v0.6.7`
(commit `d758bc2`). O candidato isolado passou instalação limpa, lint,
TypeScript, build e auditoria de produção sem vulnerabilidades. Os dois pares
reais foram enviados em sessão autenticada ao candidato: cada um retornou 13
alunos, 2.340 respostas, 180 vínculos únicos e 120 habilidades. Um par trocado
foi recusado com `400`, como previsto pelo contrato.

Após a troca atômica, `/login` respondeu `200`, a página e a API protegidas
responderam `307` sem sessão, o processo PM2 ficou online e o log de erro ficou
vazio. O upload autenticado não foi repetido na produção ativa porque a conta
de teste é exclusiva do DEV; a evidência autenticada de produção é a do
candidato isolado antes do corte.

## Persistência SAE

A partir da extensão 6.20, o diagnóstico SAE é salvo como snapshot por ano
letivo, série e bimestre. A tela `Simulado ENEM` mostra os resultados já
salvos; `Simulado ENEM > SAE` recebe as planilhas. Uma nova importação do mesmo
período substitui somente o snapshot daquele período e registra importador e
data de atualização. Os arquivos XLSX brutos continuam descartados após a
leitura.

O fluxo anual aceita os quatro bimestres separadamente. Cada um exige o par
formado por respostas e matriz daquele simulado, pois a matriz valida o vínculo
pedagógico das questões. A visão anual mantém os quatro snapshots, apresenta a
evolução individual por aluno e um gráfico com as médias de Linguagens,
Humanas, Natureza e Matemática em cada aplicação. A comparação detalhada usa
sempre os dois períodos mais recentes disponíveis.

### Provisionamento e teste DEV

A tabela `enem_sae_imports` é criada pela migration aditiva
`drizzle/0008_enem_sae_imports.sql`. Como o journal legado do Drizzle não é
confiável neste projeto, a migration deve ser aplicada explicitamente no banco
do ambiente antes de ativar a versão que consulta os snapshots.

Em 20/07/2026, o candidato DEV foi validado com as planilhas do 1º bimestre:
login de coordenação, importação, gravação de um snapshot, leitura autenticada
pela API e renderização do aluno salvo após nova requisição da tela de
resultados. A importação encontrou 13 alunos e 180 questões vinculadas à
matriz.
