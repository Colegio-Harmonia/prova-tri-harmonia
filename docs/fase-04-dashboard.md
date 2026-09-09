# Fase 4 - Dashboard

## Status

- **Fase:** concluída na produção v0.5.0.
- **Início:** 20/07/2026.
- **Pré-condição atendida:** Fase 3 publicada em produção na release v0.3.3.
- **Release final:** `main` no commit `37c0fd6`, promovido pelo PR #68 em
  20/07/2026.

Este documento inicia a Fase 4. Ele define limites, perguntas, arquitetura e
critérios de aceite antes de qualquer reconstrução visual.

## Objetivo

Transformar `/dashboard` em uma visão orientada a decisões, mantendo a
separação atual por perfil:

- coordenação e direção recebem indicadores institucionais;
- professores recebem provas atribuídas e turmas próprias;
- dados, permissões e filtros continuam definidos pelo backend.

O dashboard deve explicar o que merece atenção, dar contexto ao número exibido
e oferecer um próximo passo. Quantidade de cards e gráficos não é critério de
qualidade.

## Restrições

- Não alterar APIs, banco, autenticação, RBAC ou integrações.
- Não inferir métricas ausentes nem combinar populações incompatíveis.
- Não apresentar causalidade, evolução ou comparação temporal quando o
  contrato disponível contém apenas valores acumulados.
- Não expor dados de aluno no dashboard de gestão sem contrato e autorização
  específicos.
- Não migrar `/desempenho` incidentalmente. Essa rota possui escopo e risco
  próprios, registrados para as Fases 4 e 6.
- Cada subtarefa deve preservar a rota e o comportamento autorizado existente.

Qualquer necessidade real de novo agregado, filtro de período ou dado de aluno
deve ser documentada e submetida à aprovação antes de alterar o backend.

## Inventário atual

### Entrada e perfis

`src/app/(app)/dashboard/page.tsx` consulta a sessão no servidor. O papel do
usuário determina qual experiência é renderizada:

- superusuário: `DashboardStats` e `EnemDashboard`;
- demais usuários: `ProfessorHome`.

Essa decisão permanece no servidor. O cliente não pode selecionar ou simular
um perfil.

### Contratos disponíveis

| Fonte | Dados disponíveis | Decisões suportadas |
| --- | --- | --- |
| `GET /api/stats/dashboard` | total, status, segmento, série, disciplina, Bloom, questões, cobertura BNCC e imagens | volume, fila operacional e equilíbrio do acervo gerado |
| `GET /api/stats/enem` | ano, área, Bloom, matriz, competências, habilidades, fonte da classificação e eixos | cobertura e composição do banco ENEM |
| `GET /api/exams` | provas autorizadas para o usuário, com assunto, série, bimestre e status | prioridades do professor e acesso à revisão |
| dados de turmas já consumidos por `MinhasTurmas` | turmas permitidas pelo Classroom | acesso do professor às próprias turmas |

Os contratos acima são somente de leitura no dashboard.

## Perguntas que a interface deve responder

### Coordenação e direção

1. Quantas provas existem e em que etapa do fluxo elas estão?
2. Existe acúmulo aguardando revisão, aprovação ou conclusão?
3. Quais segmentos, séries e disciplinas concentram a produção?
4. Qual é a cobertura BNCC das questões geradas?
5. A distribuição de Bloom está concentrada em níveis cognitivos baixos?
6. Quantas questões dependem de imagem e quantas imagens foram aprovadas?

### Banco ENEM

1. Qual é o tamanho do banco e como ele se distribui por ano e área?
2. Qual parcela possui classificação cognitiva?
3. As classificações de habilidade são oficiais, estimadas ou pendentes?
4. Quais competências e habilidades têm maior ou menor disponibilidade?
5. Há concentração entre área e nível de Bloom?

### Professor

1. Quais provas atribuídas ainda exigem ação?
2. Qual é o status de cada prova?
3. Qual ação ou rota deve ser acessada em seguida?
4. Quais turmas estão disponíveis para o professor autenticado?

### Perguntas ainda não suportadas

As perguntas abaixo não podem ser respondidas com rigor pelos contratos atuais:

- qual habilidade mais evoluiu em um período;
- quais alunos precisam de intervenção;
- quais turmas estão acima ou abaixo de uma média comparável;
- se um indicador melhorou ou piorou desde a medição anterior.

Essas perguntas dependem de período, coorte, tamanho de amostra e agregados de
desempenho. A lacuna está registrada como `TD-011`. Até existir contrato
aprovado, a interface deve declarar que os dados são acumulados e não usar
linguagem de evolução.

## Arquitetura alvo

```text
src/features/analytics/
  components/
    management/
    enem/
    shared/
  model/
    dashboard-selectors.ts
    dashboard-presenters.ts
  queries/
    dashboard-stats.ts
    enem-stats.ts
  types/
    dashboard.ts

src/features/teacher-dashboard/
  components/
  model/
  queries/

src/app/(app)/dashboard/
  page.tsx
```

### Responsabilidades

- `page.tsx`: autenticação no servidor e escolha da experiência por perfil.
- `queries`: contratos tipados e cache; nenhuma transformação visual.
- `model`: seletores puros, ordenação, rótulos e estados derivados.
- `components/shared`: primitives de indicador, gráfico, legenda e estado.
- `components/management`: narrativa institucional e fluxo de provas.
- `components/enem`: cobertura do banco e matriz pedagógica.
- `teacher-dashboard`: fila individual e turmas sem métricas institucionais.

Componentes devem receber dados preparados. Fetch, transformação e renderização
não devem voltar a coexistir em um componente monolítico.

## Hierarquia de informação

### Gestão

1. **Resumo:** total de provas, questões, cobertura BNCC e pendências.
2. **Atenção agora:** gargalo do fluxo e questões/imagens que exigem ação.
3. **Composição:** segmento, série e disciplina.
4. **Qualidade pedagógica:** Bloom e cobertura.
5. **Banco ENEM:** visão resumida com aprofundamento progressivo.

### Professor

1. **Próximas ações:** provas não concluídas, ordenadas por prioridade segura.
2. **Contexto:** disciplina, série, bimestre e status.
3. **Turmas:** acesso direto às turmas autorizadas.
4. **Histórico:** link para todas as provas, sem duplicar a página de status.

## Estados obrigatórios

Cada seção assíncrona deve possuir:

- skeleton estável, sem deslocamento brusco;
- vazio com explicação e ação aplicável;
- erro com mensagem clara e nova tentativa quando segura;
- sucesso com período/amostra ou indicação de dado acumulado;
- ausência parcial de classificação explicitada, nunca convertida em zero;
- acessibilidade por teclado e resumo textual equivalente ao gráfico.

## Visualizações

- KPI só existe quando responde uma pergunta e informa sua unidade.
- Barras são preferidas para comparação entre categorias.
- Cores de Bloom mantêm ordem cognitiva e não dependem apenas de cor.
- Gráficos devem ter título literal, resumo textual e valores acessíveis.
- Tooltips complementam; informação essencial não pode depender de hover.
- Recharts é a direção preferencial para novas visualizações. A migração de
  ApexCharts será incremental e medida por subtarefa.
- Animações são discretas, respeitam `prefers-reduced-motion` e não atrasam a
  leitura dos dados.

## Subtarefas propostas

| ID | Escopo | Entrega | Critério de aceite | Status |
| --- | --- | --- | --- | --- |
| 4.0 | abertura e arquitetura | especificação, decisão e roadmap | limites, perguntas e contratos documentados | Concluída |
| 4.1 | modelo de decisão da gestão | tipos, seletores puros e arquitetura de informação | mesmos payloads geram indicadores verificáveis, sem mudar API | Concluída |
| 4.2 | resumo e atenção agora | cabeçalho, KPIs contextualizados e gargalo do fluxo | coordenação identifica volume e pendência sem interpretar gráfico | Concluída |
| 4.3 | composição da produção | segmento, série e disciplina | comparações acessíveis, responsivas e com estados completos | Concluída |
| 4.4 | qualidade pedagógica | BNCC, Bloom e imagens | cobertura, ausência e amostra ficam explícitas | Concluída |
| 4.5 | banco ENEM | decomposição de `EnemDashboard` e consulta tipada | áreas, anos, fonte, competências e habilidades preservam valores atuais | Concluída |
| 4.6 | dashboard do professor | fila de provas e turmas orientadas a ação | professor não recebe métrica institucional nem perde acesso atual | Concluída |
| 4.7 | consolidação | regressão, acessibilidade, responsividade e performance | fluxos por perfil aprovados no DEV e documentação fechada | Concluída |

Uma subtarefa só começa após a anterior cumprir gates, deploy DEV e aprovação.

## Estratégia de teste

- testes de contrato para query keys, tipos e URLs existentes;
- testes unitários para seletores, ordenação e estados derivados;
- renderização estática para resumos acessíveis de gráficos;
- ESLint, TypeScript e build em toda subtarefa;
- inspeção autenticada de superusuário e professor;
- viewports mínimos de 320 px, 768 px e desktop;
- teclado, foco, contraste, redução de movimento, loading, vazio e erro;
- comparação dos valores exibidos com respostas reais dos endpoints no DEV.

## Critério de encerramento da fase

A Fase 4 termina quando:

- os dois perfis mantêm as permissões atuais;
- nenhuma API, payload, autenticação ou tabela foi alterada sem aprovação;
- cada indicador responde uma pergunta documentada;
- contexto acumulado, ausência e amostra ficam explícitos;
- gráficos possuem alternativa textual e funcionam em 320 px;
- componentes monolíticos do dashboard foram reduzidos por fronteiras reais;
- gates locais, deploy DEV e publicação em produção foram concluídos;
- documentação, decisões, dívida técnica e roadmap estão atualizados.

As inspeções autenticadas de 320 px, 768 px, teclado, foco e estados de dados
reais continuam como acompanhamento operacional: elas não foram simuladas pela
verificação anônima da publicação final.
