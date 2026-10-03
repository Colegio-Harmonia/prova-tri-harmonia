# Onde paramos — leia isto primeiro

> Documento vivo. **Toda sessão (humana, Claude, Codex/GPT) que terminar um
> bloco de trabalho atualiza este arquivo no mesmo PR do código.**
> Última atualização: 03/10/2026 (teto de tokens da auditoria de qualidade no gpt-5-mini).

## 1. Fonte da verdade

| O quê | Onde |
| --- | --- |
| Repositório oficial | `https://github.com/Colegio-Harmonia/prova-tri-harmonia` |
| Branch de produção | `main` (único branch ativo) |
| Árvore que roda em produção | servidor `192.168.1.218`, `/home/eduardo/prova-tri`, em `main` sincronizado com `origin/main` |
| Deploy | Docker Compose. Para mudança só de app: `docker compose up -d --build web` (recria só o web; workers de geração/OCR não reiniciam). A imagem é construída da árvore de trabalho do servidor |
| Banco | container `prova-tri-postgres`; migrations em `drizzle/`, aplicadas à mão (`psql -f`), ver CLAUDE.md |
| CI | GitHub Actions `Quality`, em PR e push para `main`: lint, typecheck, vitest com cobertura, regressão (contratos por regex em `scripts/test-*`), build e orçamento de bundle |

**Repositório antigo `Colegio-Harmonia/prova-tri`: somente arquivo histórico.**
Não tem histórico em comum com o oficial e parou por volta de agosto/2026
(migration 0029). Não abrir PR nem fazer deploy a partir dele. O trabalho não
commitado que existia no Mac foi preservado no branch
`arquivo/wip-mac-2026-09-30` desse repositório antigo.

## 2. Regras para não perder trabalho de novo

1. **Nada fica rodando em produção sem commit.** Até 30/09/2026 havia 186
   arquivos (inclusive migrations já aplicadas) só na árvore do servidor.
2. Toda mudança vai em branch `feature/*`, `fix/*` ou `docs/*`, com PR para
   `main`, CI verde antes do merge, e este arquivo atualizado no mesmo PR.
3. Antes de mexer no servidor, rode `git status --short` e
   `git log --oneline -5`: mais de um agente de IA trabalha nessa árvore.
4. Cópias locais da árvore de produção **não são fonte de verdade**. Para
   trabalhar localmente, clone o repositório oficial.
5. Migration nova entra no mesmo PR que o código que depende dela.
6. Contratos de regressão (`scripts/test-*`) verificam trechos de código por
   regex: ao redesenhar uma tela, atualize o contrato para o arquivo novo em
   vez de apagar a verificação.
7. Orçamento de bundle (`scripts/test-performance-budget.ts`) é catraca: não
   subir limite sem registrar dívida em `docs/tech-debt.md`.
8. `.env.local` nunca vai para o git nem viaja entre máquinas. Chave nova em
   produção exige recriar o container.

## 2.1 Em andamento (02/10/2026): qualidade das questões geradas

Prova #391 saiu inviável (texto da planilha vazando para alternativas,
gabaritos e textos de apoio). Causa e correção em
`docs/GESTAO_QUALIDADE_QUESTOES_JEV.md`: contrato de ancoragem corrigido,
gate anti-vazamento determinístico e juiz de qualidade Jev no lugar do auditor
LLM. Branch `fix/qualidade-geracao-jev-juiz` — **ainda não promovido**; depois do
merge, rebuild de `web` e `worker` e reexecutar o teste de qualidade nas
provas/atividades pendentes de revisão.

## 2.2 Correção (02/10/2026): descritivas de Matemática barradas pelo Jev

Lote #268 (Matemática, 8º ano, 4º bim.) falhou na Questão 4 ("A resposta
esperada não responde ao enunciado…") e, depois do PR #27, ainda falhou
(Questão 2 em formato das alternativas; Questão 4 em `correcao_objetiva`).
Causas, em duas camadas (detalhe em `docs/GESTAO_QUALIDADE_QUESTOES_JEV.md`):

1. PR #27 (`finalize.ts`): o gabarito da descritiva `calculavel` era só o número
   e o critério era o texto padrão. Passou a ter resolução recalculada + rubrica.
2. Este PR (branch `fix/gabarito-descritivas-calculaveis-2`): o enunciado tem
   vários itens e o código descartava a resposta-modelo da IA, deixando só o
   número do domínio (cobria um item, às vezes outra coisa). Agora a resposta-modelo
   da IA é mantida, o validador exige que ela contenha o resultado recalculado
   (`answerProseContainsResult`), o prompt exige que o enunciado peça a grandeza
   calculada, e o gate `alternative_shape` tenta o reparo local dos distratores
   antes de reprovar a questão inteira.

Validação com IA e Jev reais (container descartável, 02/10/2026): descritivas de
Matemática 8º ano **5/5 aprovadas** (antes 0/4); `correcao_objetiva` 0,82–0,92.
**Ainda aberto:** objetivas `calculavel` com domínio `point_distance` (resultado
irracional exibido com 6 casas, enunciado pedindo expressão algébrica, gabarito
com duas respostas) reprovaram 0/3 na amostra, por defeitos de geração que não
são deste PR; o reparo local de formato não foi exercitado com IA real (só em teste
unitário).

## 2.3 Correção (03/10/2026): domínio calculável fora do assunto do capítulo

Lote #269 (Matemática, 8º ano, 4º bim.) travou na Questão 5. As 6 unidades eram
de geometria conceitual (coordenadas, sistemas, triângulos, quadriláteros,
circunferências, ângulos) e o plano de geração (`blueprint.ts`) mandou todas para
`calculavel` com um domínio do catálogo (distância entre pontos, proporção…) só
porque o capítulo "tem números". O código recalculava uma grandeza que não era a
da questão: divergência 3 vezes seguidas, enunciado com valores fora do
objeto-fonte ou gabarito errado (teorema da bissetriz saiu 10; o certo é 9, e só o
Jev barrou, `fatos_corretos` 0,19).

Correção: `domainFit.ts` + checagem em `validateAndEnrichBlueprint`. Se o capítulo
não trata do assunto do domínio escolhido (palavras-chave tolerantes, sem acento),
o slot é rebaixado para `fonte_ancorada` e passa pelo juiz Jev; o prompt do plano
também foi reforçado. Só os domínios de Matemática têm regra; Física e Química
seguem sem verificação.

Limite conhecido: as palavras-chave são heurística. Capítulo que trate do assunto
sem usar as palavras previstas perde a conferência por código e cai em
`fonte_ancorada` (ainda conferida pelo Jev). Se isso aparecer, ampliar
`DOMAIN_TOPICS`.

## 2.4 Correção (03/10/2026): gates que tratavam resposta matemática como prosa

Depois do PR #29 o lote #269 ainda travava na Questão 3 (capítulo "Gráfico e
interpretação geométrica"). Amostras reais (IA e Jev) mostraram quatro falsos
positivos de gates pensados para texto corrido, todos corrigidos sem afrouxar o
que importa (testes em `numberParsing.test.ts` e `mathGates.test.ts`):

1. `parseSingleNumber`/`comparableNumber` apagavam todo ponto: `0.5` virava 5 e
   `2.5` virava 25. Um distrator "0.5" colidia com a resposta "5"
   (`alternative_ambiguity`) e `2,5` ≡ `2.5` não era detectado. O ponto agora é
   milhar só quando forma grupos de 3 dígitos (`1.200`), senão é decimal.
2. `evidence_not_found`: a IA cita duas frases do apoio saltando a do meio. O gate
   passa a aceitar evidência em que **cada frase** é literal no apoio; frase fora
   do apoio (invenção) continua reprovando.
3. `alternative_ambiguity` por vocabulário: "y = -x + 2…coef. -1" vs "y = x +
   2…coef. 1" davam 82% de palavras em comum. Alternativas com dígitos cujo
   "esqueleto" matemático difere deixam de ser tratadas como a mesma resposta;
   prosa quase idêntica sem números continua barrada.
4. `tautological_answer`: resposta com número ou equação ("y = 2x - 1") não é
   "só repete os termos da pergunta".

Limite conhecido: `comparableNumber` ainda lê só o primeiro número de um texto
com vários; o juiz Jev segue sendo a barreira final de correção.

## 2.5 Correção (03/10/2026): barras da Análise SOLO mostravam nota, não participação

Em `/desempenho` (Análise SOLO), o percentual e a barra de cada nível usavam
`accuracyPercent` (nota média × 10) ao lado da contagem de itens. "Relacional
53% · 26" era lido como "53% das respostas", mas queria dizer "essas 26
respostas tiraram em média 53% da nota". Como o nível mais frequente
(Multiestrutural, 89 de 147) tinha nota média menor que o menos frequente, a
barra parecia contradizer a contagem.

Correção só de apresentação (`SoloLevelBars`, `DesempenhoPanel.tsx`): barra e
percentual passam a ser a participação do nível no total de itens do painel; a
nota média (com % da nota máxima) vai para a linha de apoio, com legenda
explicando a diferença. A API `/api/analytics/performance` não mudou. Bundle de
`/desempenho`: 133,6 → 133,9 KiB (limite 134), sem folga para novos acréscimos
nessa rota antes de resolver TD-018.

## 2.6 Correção (03/10/2026): auditoria de qualidade devolvia resposta vazia no gpt-5-mini

Sintoma: na aprovação, "Questão N: ausente do relatório final de qualidade" e
auditorias `exams/question-quality-test-*` falhando com `empty_response`
(prova #200, Inglês 2º ano; ~56% das chamadas desse tipo falharam em 3 dias,
e a questão 3 falhou 100% das tentativas).

Causa: `completionOptionsFor` (`structuredRepair.ts`) limitava a auditoria a
2.400 tokens. No `gpt-5-mini` os tokens de raciocínio contam contra
`max_completion_tokens`; essa auditoria gasta ~2,7 mil só raciocinando (~3,5 a
4,5 mil no total), então o JSON nunca chegava. O modelo não era o problema:
a mesma chamada com limite de 8.000 funcionou.

Correção: teto de 16.000 tokens para `question-quality-test`/`exam-quality-audit`
(é só um limite; o consumo real não muda). No DeepSeek o `max_tokens` fica
limitado a 8.000 (`llmClient.ts`), que é o máximo já usado até hoje, para não
quebrar se o perfil de `text_generation` voltar a ser DeepSeek.

Fica de fora (não alterado): `qualityReportNeedsRecompute` só considera
relatório *vazio*; uma prova com relatório parcial (só questões trocadas
manualmente) nunca é reauditada na aprovação. Outros contextos de IA com teto
baixo e que podem sofrer o mesmo problema em modelo de raciocínio:
`generation/stage3-5` (2.400), `generation/stage2` (1.600) e o padrão de
4.000 (inclui `exams/final-quality-audit`).

## 3. Estado verificado em 30/09/2026 (fim do dia)

- `main` = `45c0b12` (PR #14), sincronizado com produção. O PR #13 atualizou
  este documento para os Blocos 7 e 8; o PR #14 tornou explícito o rótulo
  "Domínio no bimestre" sem alterar a regra pedagógica.
- Produção: `prova-tri-web` saudável; `TYPESAFE_API_KEY` carregada; migrations
  **até 0046** aplicadas (0046 aplicada à mão via `psql` antes do deploy do
  Bloco 8); 50 habilidades salvas em `curriculum_plan_skills`, todas com
  descrição (backfill do texto oficial BNCC aplicado).
- Checkout local oficial: `prova-tri-harmonia`, com remoto
  `Colegio-Harmonia/prova-tri-harmonia`. O checkout antigo e a antiga cópia
  `.prod-reporting-candidate` não são usados para desenvolvimento ou deploy.
- Infraestrutura central do Jev: cliente tipado comum para Noul, Choice e
  Score; timeout, parsing estrito, fallback explícito, cache em memória e
  persistente, telemetria e auditoria sem armazenar o estado textual. A
  conferência BNCC do planejamento já usa essa infraestrutura. Migration
  `0047_jev_decision_infrastructure.sql`.
- Etapa 3 do Jev: antes do blueprint de uma prova, o Jev escolhe ênfase
  cognitiva, contextualização, perfil de dificuldade e intensidade de apoio
  visual a partir do recorte curricular e da matriz definida pelo professor.
  Quantidades, capítulos, tipos de questão, exigências visuais, permissões e
  validações continuam determinísticos. Falha ou baixa segurança não interrompe
  a fila: aplica estratégia equilibrada ou sinaliza conferência na revisão.
- Suíte: 81 arquivos / 391 testes, incluindo 3 de integração com Postgres
  real em memória (PGlite).
- Dívida aberta relevante: **TD-018** (bundle de `/desempenho` 133,6 KiB,
  meta 125; `/desempenho/relatorio` 124,9, meta 120; `/gerar/[id]/revisar`
  139,1, meta 130), ver `docs/tech-debt.md`. As duas últimas estão a menos
  de 1 KiB do limite: qualquer acréscimo nelas exige code-splitting antes.

## 4. Relato dos branches de 30/09/2026 (todos mergeados em `main` e apagados)

### PR #1 — `feature/consolidacao-producao-2026-09-30`
Versionou os 186 arquivos que rodavam em produção sem commit (migrations
0033–0045, pipeline de geração, fila de scans/OCR, auth, relatórios e
planejamento). Para o CI passar: 2 contratos de regressão desatualizados
foram apontados para as telas atuais (TD-015 resolvida), cores fixas
viraram tokens em 5 telas e o orçamento de bundle de 3 rotas foi registrado
como TD-018.

### PR #2 — `feature/jev-verificacao-habilidades-planejamento`
Na prévia de `/planejamento` ("Conferir planilha"), cada habilidade com
descrição digitada na planilha é comparada ao texto oficial do código pelo
**Jev** (TypeSafe, pergunta Noul): ≥ 0,8 "Confere com a BNCC"; ≤ 0,2 "Não
confere com o código" (mostra o texto oficial); entre elas "Conferir". Não
bloqueia a importação e falha aberta (sem chave ou com erro vira "não
verificado"). Código: `src/lib/curriculum/skillDescriptionCheck.ts`; rota
`POST /api/curriculum/plans/preview`, separada de `/api/curriculum/preview`
para não pesar em `/gerar` e `/atividades`. Texto oficial vem de
`api.bncc.dev` (`src/lib/curriculum/bnccDescriptions.ts`). Teste de
calibração: 74/74 casos sintéticos certos.

### PR #3 — `feature/bloco-4-dominio-individual`
`GET /api/curriculum/student-mastery`. Aproveitamento por habilidade =
pontos obtidos ÷ possíveis, com peso da questão e nota parcial das
discursivas; `itemCount` (questões distintas) e `assessmentCount` (provas
distintas). Níveis: `sem_evidencia`, `evidencia_insuficiente`,
`em_desenvolvimento`, `proximo_do_dominio`, `dominio`. Regras em
`MASTERY_RULES` (`src/lib/curriculum/studentMastery.ts`): menos de 3 itens =
evidência insuficiente; domínio exige ≥ 80%, ≥ 4 itens e ≥ 2 avaliações,
senão `proximo_do_dominio` com `limitedBySample: true`. Consolidação por
disciplina/bimestre e por disciplina no ano.

### PR #4 — `feature/bloco-5-graficos-relatorio`
Gráficos no relatório individual (`/desempenho/relatorio`), em SVG próprio
sem biblioteca, carregados sob demanda: teia por disciplina com meta de
100%, teia por habilidade, marcadores por formato (círculo cheio = dominada,
triângulo = em desenvolvimento, círculo vazado = não avaliada, tracejado =
preliminar), tabela de evidências ao lado, filtro ano/bimestre, mapa de
calor para teias com mais de 12 eixos ou visão anual, interpretação textual
e impressão com todas as disciplinas. Arquivos:
`src/lib/curriculum/masteryCharts.ts` e `MasterySection`, `MasteryCharts`,
`MasteryRadar` em `src/app/(app)/desempenho/relatorio/`. Corrigiu a
impressão do relatório individual, que saía em branco (classe
`.print-report` em `globals.css`).

### PR #5 — `feature/bloco-6-evolucao`
`GET /api/curriculum/trajectory` (aluno: `studentId`/`student`; turma:
`classroomCourseId`). Motor puro em `src/lib/curriculum/trajectory.ts`
(`TRAJECTORY_RULES`): comparação entre bimestres; habilidades que
avançaram/estáveis/regrediram (≥ 10 p.p. e ≥ 2 itens por lado, por aluno na
turma), senão "sem base"; decomposição "variação total = mesmas habilidades
+ efeito da troca de conteúdo"; cobertura acumulada do planejamento;
intervenções com resultado antes/depois da data de registro (descritivo,
não causal). Carregamento de evidências compartilhado em
`src/lib/curriculum/masteryData.ts` (a rota do Bloco 4 também usa). UI:
seção "Evolução ao longo do ano" no relatório do aluno e página
`/desempenho/trajetoria`, com botão "Trajetória da turma" em `/turmas/[id]`.

### PR #7 — `feature/relatorio-individual-abas`
Relatório individual (`/desempenho/relatorio`) dividido em abas: **Resumo**
(indicadores, pontos fortes/para acompanhar, próximos passos, limitações),
**Habilidades** (gráficos do Bloco 5, domínio e destaques BNCC), **Evolução**
(trajetória do Bloco 6) e **Avaliações** (contexto, evidência, tabela por
avaliação). Aba ativa na URL (`?aba=`), navegação por setas/Home/End, barra
fixa no topo ao rolar. Na impressão/PDF saem todas as abas, cada uma com seu
título. Componente: `src/app/(app)/desempenho/relatorio/ReportTabs.tsx`.
Bundle da página: 124,9/125 KiB (sem folga — próximo acréscimo precisa de
code-splitting, ver TD-018).

### PR #8 — `fix/reforco-variacao-bloom`
O CI do `main` falhou após o PR #7 por um teste instável (~17%) do reforço
ENEM, sem relação com as abas. Defeito real em `distributeAcrossSkills`
(`src/lib/reinforcement/selectQuestions.ts`): a variação de Bloom só
procurava alternativa na fila de um ano por vez e repetia o nível quando
aquele ano não tinha outro. Agora a ordem sorteada por ano é mantida e uma
passada garante nível diferente enquanto houver no banco. 0 falhas em 100
execuções.

### PR #9 — `fix/versionar-rota-cobertura`
A regra `coverage/` do `.gitignore` ignorava `src/app/api/curriculum/coverage/`:
a rota do painel de cobertura existia só no servidor. Regra passou a
`/coverage/` e a rota entrou no repositório.

### PR #10 — `feature/bloco-7-planejamento-interno` (Bloco 7)
Planejamento pedagógico interno (Prova TRI como fonte oficial).
- `/planejamento`: lista com filtros (professor vê só os atribuídos),
  "Novo planejamento" (do zero), "Copiar ano anterior" (versões aprovadas →
  rascunhos do ano seguinte, com responsáveis, sem sobrescrever), "Encerrar
  bimestre" e aba "Importar planilha" (a importação agora recusa criar versão
  se já houver rascunho/revisão aberto).
- `/planejamento/[id]`: editor de unidades, conteúdos, objetivos e
  habilidades (código, descrição — em branco usa o texto oficial — e meta),
  responsáveis, histórico, exportação CSV (`;` + BOM) e PDF
  (`/planejamento/[id]/imprimir`).
- Fluxo: rascunho → em revisão (professor/gestão) → aprovado ou devolvido com
  justificativa (gestão) → encerrado (gestão). Aprovado/encerrado não se edita:
  alteração = nova versão com o conteúdo oficial, que passa por revisão. Após
  encerrar o bimestre, só a gestão abre nova versão, com justificativa.
- Versão oficial = aprovada/encerrada mais recente; cobertura e relatórios
  usam a oficial, ou a mais recente quando ainda não há aprovada (2026).
- Código: `planningPolicy.ts` (regras puras), `planningService.ts` (todas as
  escritas), `planningRoute.ts`, rotas em `src/app/api/curriculum/plans/**`
  e `plan-versions/**`. Teste de integração com Postgres real em memória
  (`planningService.integration.test.ts`, PGlite como devDependency).
- Entrega operacional (criar e aprovar 2027) fica com a coordenação — ver
  Pendências.

### PR #12 — `feature/bloco-8-operacao-institucional` (Bloco 8)
Reaberto do #11, que o GitHub fechou ao apagar o branch base (Bloco 7).
Liga planejamento, avaliação e intervenção. Migration
`drizzle/0046_planning_operations.sql` (intervenções ganham
`skill_codes`/`bimester`; nova tabela `pedagogical_decision_log`) **já
aplicada em produção** em 30/09, antes do deploy. Em outro ambiente, aplicar
antes de subir o código: sem ela, intervenções e trajetória quebram.
1. Aviso na revisão da prova (`/gerar/[id]/revisar`) quando ela não cobre
   habilidades planejadas do bimestre (server component, sem JS extra).
   API: `GET /api/exams/[id]/plan-coverage`.
2. Habilidades ainda não avaliadas no bimestre: seção "Operação do bimestre"
   em `/planejamento/[id]` (cobertura + aproveitamento da turma por habilidade).
3. Sugestões: "avaliar" (planejadas sem evidência) e "retomar" (turma < 60%
   com ≥ 2 itens por aluno, sem intervenção aberta), com atalho para
   registrar intervenção já preenchida. Pré-preencher `/gerar`/`/atividades`
   com as habilidades ainda não existe (as telas escolhem por capítulo).
4. Intervenções ligadas a habilidades (`skillCodes`); na trajetória (Bloco
   6) o antes/depois passa a olhar só essas habilidades.
5. Indicadores: aba "Indicadores" em `/planejamento` (professor: seus
   planejamentos; gestão: escola, por segmento e disciplina) — aprovação,
   cobertura do planejado, intervenções abertas/atrasadas.
   API: `GET /api/curriculum/indicators`.
6. Histórico de decisões (`pedagogical_decision_log`): criação, edição (com
   habilidades +/−), transições, responsáveis, cópia de ano, intervenções.
- Código: `operations.ts` (puro), `operationsData.ts`, `decisionLog.ts`.
  Testes de integração com PGlite usando `src/test/pgliteDb.ts`, que aplica
  as migrations e completa as colunas que `schema.ts` declara e a cadeia de
  migrations não cria.

### Etapa 3 — Jev na estratégia de geração de provas
`src/lib/ai/examGenerationDecision.ts` usa Choice para decidir ênfase
cognitiva, contextualização, dificuldade e apoio visual, e Noul para medir se
o recorte sustenta a decisão. A orientação entra no blueprint sem alterar a
matriz do professor. A decisão usa `evaluateWithJev`, cache de 7 dias,
telemetria, auditoria e fallback equilibrado.

### Etapa 4 — Jev nas atividades formativas e de recuperação
`src/lib/ai/activityGenerationDecision.ts` usa Choice para decidir abordagem,
progressão, apoio e evidência de aprendizagem, e Noul para medir se o recorte
sustenta a decisão. Atividades abertas pelo relatório individual carregam a
intenção `recuperacao`; criações livres usam `formativa`. O Jev recebe somente
o recorte pedagógico, nunca nome ou resposta do aluno. Habilidades, quantidade
e matriz BNCC continuam determinísticas. A decisão entra no blueprint, fica
registrada nos metadados da atividade e usa cache, telemetria, auditoria e
fallback de retomada guiada.

### Etapa 5 — Jev na seleção do Reforço ENEM
`src/lib/ai/reinforcementSelectionDecision.ts` usa Choice para decidir a
alocação entre habilidades, o perfil de Bloom e a mistura de anos, e Noul para
medir se a oferta do banco sustenta a estratégia. O relatório continua
pré-selecionando habilidades localmente; nome, ID, respostas, tentativas e taxas
de erro não são enviados ao Jev. A decisão usa somente série, disciplina,
habilidades escolhidas e metadados anônimos dos itens oficiais elegíveis. A
execução permanece determinística, nunca inventa item e respeita ano, quantidade
e competências da disciplina. A estratégia fica nos metadados, com cache,
auditoria, telemetria e fallback equilibrado.

### Etapa 6 — Jev na organização semântica dos resultados
`src/lib/ai/resultOrganizationDecision.ts` usa Choice para escolher a lente
principal, a política de prioridade e o próximo passo pedagógico, e Noul para
medir se os sinais sustentam a organização. A integração é sob demanda nas
visões Turma, Coordenação, Escola e no relatório individual. O Jev recebe
somente faixas categóricas anônimas, códigos e descrições BNCC e sinais
agregados; nomes, IDs, respostas, notas e percentuais individuais exatos não
são enviados. O sistema mantém todos os cálculos e permissões, produz os textos
em português por regras fixas e usa cache, auditoria, telemetria e fallback
centrado em cobertura.
Em 01/10, a orientação passou a separar explicitamente amostra pequena,
participações incompletas e indisponibilidade do Jev, mostrando os denominadores
reais do recorte. O fallback agora usa lacunas BNCC ou exigência cognitiva
quando a evidência é suficiente, em vez de sempre recomendar ampliar amostra.
Pendências de até 5% são informadas sem bloquear a leitura geral; acima desse
limiar, a cobertura volta a ser a prioridade antes de comparar resultados.

### Etapa 7 — observabilidade e calibração do Jev
O painel administrativo `/ia` agrega as decisões por operação e período:
volume, chamadas ao provedor, cache, contingência e decisões que pedem revisão.
A API não retorna estado, hash, contexto nem respostas estruturadas; expõe
somente contagens agregadas e mantém o acesso restrito à gestão. A tabela pode
ser filtrada e ordenada. A leitura é limitada às 500 decisões mais recentes e
avisa quando o período foi truncado.

### Decisão 30/09/2026 — regra de domínio individual
Mantida a regra rigorosa (≥ 80% em ≥ 4 questões de ≥ 2 avaliações), com o
nome explícito **"Domínio no bimestre"** (e **"Domínio no ano"** na visão
anual dos gráficos, onde os bimestres se somam). Lembrete fixo da regra
(`src/components/pedagogy/MasteryRuleReminder.tsx`, texto gerado de
`MASTERY_RULES`) no topo da aba Habilidades do relatório individual, para
todos os perfis e também na impressão. Não mudar a regra sem nova decisão
pedagógica.

### Validação com dados reais (só leitura, agregados, 30/09/2026)
- 1.786 correções revisadas, 322 alunos, 83 turmas, 14.563 respostas com
  BNCC, 0 linhas inválidas.
- **Nenhum aluno ou turma tem correção em mais de um bimestre ainda**: a
  comparação do Bloco 6 só aparece com dados reais a partir do próximo
  bimestre corrigido; até lá a tela explica isso.

## 5. Pendências (em ordem)

1. Painel `/desempenho` (visão BNCC) usa **outra regra** também chamada
   "Domínio": ≥ 80% com ≥ 3 respostas somando todos os alunos
   (`bnccDevelopmentStatus` em `api/analytics/performance/route.ts`). É leitura
   coletiva, diferente do domínio individual. Decidir se renomeia (ex.:
   "Domínio da turma") para não confundir com "Domínio no bimestre" — a rota
   está no limite do orçamento de bundle (TD-018).
2. **Entrega do Bloco 7 (ação da coordenação na tela):** criar e aprovar o
   planejamento de 2027 em `/planejamento`. Os planejamentos de 2026 foram
   importados e nunca aprovados, então "Copiar ano anterior" vai pular todos;
   para 2027, criar do zero ou importar a planilha de 2027, revisar e aprovar.
3. Auditoria de relatórios (`docs/AUDITORIA_RELATORIOS_2026-09-29.md`):
   - Etapa 1: conferir os aceites com dados reais (2/2 = 100%, homônimos
     separados, PDF reproduz o recorte, motivo correto para ausência de ENEM).
   - Etapa 2: filtros para professor, chave segmento+série, manter filtros
     com recorte vazio, contagens honestas (alunos/questões/respostas).
   - Etapas 3 e 4 (coordenação/escola, ENEM ampliado): não iniciadas.
4. TD-018: code-splitting para voltar as 3 rotas às metas de bundle.
5. Conferir no navegador, logado: relatório individual (abas, gráficos,
   evolução, PDF), trajetória de uma turma, `/planejamento` (lista, editor,
   fluxo de revisão, exportação, operação do bimestre, indicadores) e o aviso
   de cobertura na revisão da prova. A validação de 30/09 foi por testes
   (inclusive integração com PGlite), prévias renderizadas e dados
   agregados, não pela tela logada.
6. Sugestões de avaliação/retomada do Bloco 8 levam a `/gerar` e
   `/atividades`, que ainda escolhem conteúdo por capítulo da planilha: falta
   aceitar habilidades BNCC pré-preenchidas.

## 6. Já entregue antes de 30/09 (frente de relatórios, Codex/GPT 29–30/09)

- Intervenções pedagógicas (ação, responsável, prazo, status) por
  série/disciplina: `drizzle/0044_*`, `src/app/api/analytics/interventions/`,
  bloco em `src/app/(app)/desempenho/DesempenhoPanel.tsx`.
- Planejamento curricular versionado (rascunho → em_revisao → aprovado →
  encerrado): `drizzle/0045_*`, `src/lib/curriculum/planningPolicy.ts`.
- Página `/planejamento` (só coordenação/direção): importação da planilha e
  painel de cobertura BNCC (`src/app/(app)/planejamento/`,
  `src/app/api/curriculum/{plans/import,coverage}`).
- P0 da auditoria tratados no código: perfil identificado por
  `classroomStudentId` (fallback: nome), link do relatório individual levando
  o recorte do painel, validação de correção incompleta
  (`src/lib/corrections/{examCompletion,gradeValidation}.ts`).

## 7. Branches do repositório antigo com trabalho não mergeado

Consultar antes de reimplementar qualquer coisa. Pode ser que o código já
exista no oficial, que foi copiado da árvore do servidor.

| Branch (repo `prova-tri`) | Assunto |
| --- | --- |
| `codex/ai-governance` | governança de IA |
| `codex/enem-text-integrity` | integridade de texto ENEM |
| `codex/security-first5` | correções de segurança |
| `codex/fase-8-transparencia` | transparência de IA |
| `codex/batch-all-scan-transcriptions` | transcrição de scans em lote |
| `claude/prova-tri-enem-filters-1b1c86`, `claude/peaceful-austin-3a95f4` | filtros/rótulos ENEM no reforço |
| `hotfix/question-image-proxy` | proxy de imagem de questão |
| `arquivo/wip-mac-2026-09-30` | snapshot do WIP do Mac (21/09 + auditoria) |

## 8. Como atualizar este documento

Ao terminar uma sessão: registre o que foi feito em "Relato dos branches",
atualize "Estado verificado" e "Pendências", ajuste a data no topo e faça
commit no mesmo PR do código.
