# Decisões Arquiteturais

## ADR-001 - Reconstrução incremental sobre contratos existentes

**Data:** 18/07/2026
**Problema:** a interface atual concentra telas grandes e estilos do MVP, mas a plataforma possui fluxos sensíveis já operacionais.
**Alternativas:** reescrever aplicação inteira; alterar backend junto com UI; migrar por jornada preservando contratos.
**Decisão:** criar nova arquitetura de front-end e migrar jornadas por subtarefa sobre as APIs atuais.
**Motivo:** reduz risco de regressão em geração, revisão, correção, Classroom e motor pedagógico; permite comparação direta com o comportamento existente.
**Consequência:** haverá coexistência temporária de componentes legados e novos, com adaptadores de API.

## ADR-002 - Design system antes da migração de telas

**Data:** 18/07/2026
**Problema:** telas novas feitas diretamente sobre CSS local repetiriam inconsistência atual.
**Alternativas:** migrar página a página e extrair depois; criar primitives, tokens e tema antes.
**Decisão:** Fase 2 entrega fundação visual e de interação antes de qualquer jornada de negócio.
**Motivo:** reduz retrabalho e permite validar acessibilidade, responsividade e tema uma vez.
**Consequência:** a Fase 2 não deve misturar redesign de dashboard ou geração.

## ADR-013 - Telemetria privada de IA

**Data:** 22/07/2026
**Problema:** custo, indisponibilidade e reparos de IA não são consultáveis;
logs de aplicação não são uma fonte segura para essa finalidade.
**Decisão:** criar `ai_operations` para guardar somente operação, provedor,
modelo, estado, duração, tokens retornados e categoria de falha.
**Limites:** não guardar prompt, saída bruta, mensagem de erro, aluno, resposta
de aluno, nota, token, sessão ou chave. Falha de telemetria não pode bloquear
o fluxo pedagógico.
**Consequência:** a migration é aditiva e precisa ser aplicada antes do
deploy; painel e orçamento ficam para subtarefas posteriores.

## ADR-003 - Contrato de API encapsulado em adaptadores de feature

**Data:** 18/07/2026
**Problema:** componentes atuais chamam rotas diretamente e interpretam respostas/erros localmente.
**Alternativas:** manter `fetch` em cada componente; criar gateway que altera as APIs; criar adaptadores de cliente internos.
**Decisão:** implementar clientes tipados em `src/lib/api` e hooks por feature, sem mudar handlers.
**Motivo:** centraliza erro, cache e serialização, mantendo compatibilidade integral.
**Consequência:** todo componente migrado consome interface de feature, não URL literal.

## ADR-004 - Upgrade de framework é uma subtarefa de fundação isolada

**Data:** 18/07/2026
**Problema:** a stack-alvo cita Next 15, enquanto o projeto está em Next 14.2.35 e React 18.3.1.
**Alternativas:** atualizar junto com qualquer tela; manter versões indefinidamente; atualizar de forma isolada e validada.
**Decisão:** atualizar durante a Fase 2 em commit próprio, sem migração de
telas, contratos HTTP, banco ou autenticação.
**Motivo:** mudanças de runtime podem afetar Auth.js, App Router, build e deploy.
**Consequência:** a Fase 2.3 atualizou Next.js de 14.2.35 para 15.5.20, React
e React DOM de 18.3.1 para 19.2.7 e os respectivos tipos/configuração de
lint. Os `params` de páginas e handlers dinâmicos passaram a ser aguardados,
e `serverComponentsExternalPackages` foi promovido para
`serverExternalPackages`. O build compartilhado cresceu de 87,4 kB para
103 kB; essa medição será tratada na fase de performance, sem otimização
oportunista nesta decisão.

**Status em 18/07/2026:** implementada e validada localmente; a evidência de
DEV é registrada em `docs/testing.md` e `docs/deployment.md`.

## ADR-006 - Remediacao de dependencias de producao por versao corrigida

**Data:** 19/07/2026
**Problema:** a auditoria de producao encontrou vulnerabilidade alta no Drizzle
ORM e vulnerabilidades moderadas no NextAuth, Google APIs e PostCSS transitivo
do Next.
**Decisao:** atualizar Drizzle ORM para 0.45.2, NextAuth para beta.31, Google
APIs para 173.0.0 e PostCSS para 8.5.20. O `overrides.postcss` fixa a mesma
versao corrigida abaixo de Next.
**Consequencia:** a auditoria de producao passou a retornar zero vulnerabilidades.
Build, rotas protegidas e login por senha foram validados no DEV. Avisos de
compatibilidade Edge do `jose` continuam registrados como TD-010; nao houve
mudanca de schema, API ou regra de autorizacao.

**Status revisado em 23/07/2026:** esse resultado era válido para as versões
então auditadas. A auditoria atual voltou a apontar duas vulnerabilidades altas
em Next.js e Sharp; a atualização disponível pode ser incompatível e foi
registrada como TD-014 para tratamento isolado.

## ADR-007 - Cliente JSON sem migração oportunista de telas

**Data:** 19/07/2026
**Problema:** cada tela interpreta respostas, erros e falhas de rede de forma
própria, sem uma base verificável para adoção gradual.
**Alternativas:** migrar todas as chamadas de uma vez; adotar uma biblioteca de
cache sem caso de uso; criar um cliente JSON pequeno e testável primeiro.
**Decisão:** introduzir `apiRequest` e `ApiError` em `src/lib/api/client.ts`,
sem modificar handlers, URLs, payloads ou componentes nesta subtarefa.
**Motivo:** permite validar a normalização de respostas antes de tocar jornadas
pedagógicas, mantendo rollback e diagnóstico simples.
**Consequência:** a próxima adoção deve escolher uma consulta somente de leitura
e preservar seu contrato. Loading, cache e invalidação serão decididos por
feature, não inferidos pelo cliente base.

## ADR-008 - Primeira adoção do cliente HTTP no dashboard de leitura

**Data:** 19/07/2026
**Problema:** a fundação HTTP precisava de uma adoção real antes de ser usada em
fluxos de geração, revisão ou correção.
**Decisão:** migrar somente o GET de estatísticas de
`DashboardStats` para `apiRequest<Stats>`.
**Consequência:** endpoint, payload, estado visual de carregamento e tela
permanecem iguais; falhas HTTP agora usam a mensagem normalizada de
`ApiError`. As demais chamadas permanecem fora do escopo.

## ADR-009 - Ícone semântico incremental no dashboard do professor

**Data:** 20/07/2026
**Problema:** links informativos ainda usam caracteres decorativos, sem uma
biblioteca de ícones consistente para evolução do design system.
**Decisão:** introduzir `lucide-react` e trocar somente a seta textual do
link “Ver todas” do dashboard do professor por `ArrowRight` decorativo.
**Consequência:** o texto acessível e o destino do link são preservados; não
há mudança de fluxo, rota, permissão ou ação de negócio.

## ADR-010 - Movimento de entrada com redução explícita

**Data:** 20/07/2026
**Problema:** a fundação define duração e easing, mas não havia adoção
verificável de movimento que demonstrasse respeito à preferência do usuário.
**Decisão:** introduzir Framer Motion e aplicar uma única entrada de 180 ms
na seção informativa “Minhas Provas” do dashboard do professor. Quando
prefers-reduced-motion estiver ativo, a animação inicial não é criada.
**Consequência:** dados, carregamento, links e ações continuam disponíveis
imediatamente; nenhuma transição de fluxo de negócio recebe animação.

## ADR-011 - Avaliação isolada de gráfico declarativo

**Data:** 20/07/2026
**Problema:** os gráficos atuais dependem de ApexCharts e ainda não havia uma
comparação prática com uma biblioteca declarativa na arquitetura alvo.
**Decisão:** introduzir Recharts somente para “Por segmento” em
DashboardStats. A mesma query, os mesmos valores e a mesma agregação são
reutilizados; todos os demais gráficos continuam em ApexCharts.
**Consequência:** a comparação pode ser validada sem migrar o dashboard
inteiro. A animação do gráfico fica desativada nesta etapa e um resumo textual
é associado ao SVG para leitores de tela.

## ADR-012 - Reconstrução do dashboard por perfil e contrato existente

**Data:** 20/07/2026
**Problema:** `/dashboard` reúne experiências diferentes para gestão e
professor, enquanto os componentes atuais misturam consulta, transformação e
visualização. Uma troca integral aumentaria o risco de alterar permissões,
valores ou contratos durante o redesign.
**Alternativas:** substituir todo o dashboard em uma única entrega; criar novos
endpoints para adaptar a interface; migrar progressivamente por perfil, pergunta
e seção usando os contratos atuais.
**Decisão:** preservar a escolha de perfil no servidor e reconstruir a página
por subtarefas incrementais. Queries tipadas mantêm URLs e payloads; seletores
puros preparam os dados; componentes de seção respondem perguntas documentadas.
Novos agregados ou filtros de período exigem aprovação separada de backend.
**Motivo:** mantém RBAC e backend como fonte da verdade, permite comparar cada
valor com a interface atual e oferece rollback pequeno.
**Consequência:** a Fase 4 não afirmará evolução, causalidade ou intervenção por
aluno com os agregados acumulados atuais. Essa limitação está registrada em
`TD-011`. `DashboardStats`, `EnemDashboard` e `ProfessorHome` serão substituídos
somente depois que cada seção equivalente passar em testes e validação no DEV.

## ADR-005 - Produção não substitui ambiente DEV

**Data:** 18/07/2026
**Problema:** só foi identificado o host público atual; não há DEV descrito no repositório.
**Alternativas:** usar produção como DEV; interromper toda documentação; definir ambiente separado antes de mudança funcional.
**Decisão:** registrar o bloqueio e impedir deploy funcional até DEV e rollback serem explicitamente definidos.
**Motivo:** reduz risco para dados escolares, autenticação e integrações externas.
**Consequência:** a Fase 1 pode validar documentação e build local/remoto, mas não declara "deploy DEV" concluído.

**Atualização em 18/07/2026:** o bloqueio operacional foi resolvido com o DEV
interno isolado em `192.168.1.218:3011`, processo `prova-tri-dev` e banco
`prova_tri_dev`. A decisão permanece ativa: producao nunca substitui DEV, e
todo deploy funcional continua dependendo da branch `develop` e de validacao
no ambiente interno.
