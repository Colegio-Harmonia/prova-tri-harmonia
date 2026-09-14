# Dívida Técnica

## Registro ativo

| ID | Descrição | Motivo | Impacto | Prioridade | Estimativa | Destino |
| --- | --- | --- | --- | --- | --- | --- |
| TD-001 | Componentes de fluxo e dashboard monolíticos | estado, fetch e visualização coexistem | regressões e baixa testabilidade | Alta | 3-5 subtarefas | Fases 4-6 |
| TD-002 | Comunicação HTTP manual por componente | cliente HTTP tipado criado na Fase 2.5; migração gradual das telas ainda será planejada por feature | base de erro e serialização agora consistente; loading e cache permanecem responsabilidade da adoção por tela | Em tratamento | Fase 2.6+ | fundação concluída em 19/07/2026 |
| TD-003 | Bibliotecas de feature da stack-alvo ainda ausentes | runtime já está em Next 15/React 19, mas shadcn/ui, TanStack Query, React Hook Form, Framer Motion, Recharts e Lucide ainda não têm adoção validada | fundação atende parcialmente à missão; instalação sem uso aumentaria bundle e manutenção | Média | uma subtarefa por capacidade necessária | Fases 2-6 |
| TD-004 | Layout sem navegação responsiva/breadcrumb | shell inicial do MVP | orientação e uso móvel insuficientes | Média | 1-2 subtarefas | Fase 3 |
| TD-005 | Agregação de desempenho em handler extenso | cálculo síncrono na requisição | consultas independentes foram paralelizadas e a busca de questões passou a indexada; ainda não há agregação materializada para grande escala | Média | acompanhar `Server-Timing`; reavaliar com crescimento de dados | Operação contínua |
| TD-007 | Cobertura automatizada de UI não foi encontrada | projeto não possui framework de teste configurado | regressões só aparecem em validação manual | Alta | 1-2 subtarefas | Fase 11, com smoke mínimo antes |
| TD-010 | Compatibilidade Edge do NextAuth não demonstrada | builds DEV e produção da Fase 9 repetiram avisos de `CompressionStream` e `DecompressionStream` no `jose` transitivo; o produto roda em Node/Docker e não foi validado em runtime Edge | mudança futura de infraestrutura pode exigir investigação específica | Média | investigar antes de adotar runtime Edge ou plataforma serverless Edge | Antes de migração de infraestrutura |
| TD-011 | Parte dos indicadores do dashboard de gestão não possui período, coorte ou tamanho de amostra no contrato | `GET /api/stats/dashboard` retorna agregados acumulados; a Fase 6 usa `GET /api/analytics/performance` para relatórios revisados com período e amostra | não reutilizar os cartões acumulados do dashboard para afirmar evolução ou intervenção por aluno | Média | alinhar os dois contratos antes de unificar dashboards | Fases 7 e 9 |
| TD-012 | Não existe contrato de autosave para a geração e rascunhos de revisão | `/gerar` mantém campos somente no cliente até `POST /api/exams/generate`; anotações não enviadas da revisão também não são persistidas | não é seguro prometer recuperação após recarga, conflito entre abas ou retomada de edição | Alta | decisão de produto e contrato de backend antes de implementar | Fase 5.6 |
| TD-013 | Snapshots SAE passam a reter nomes e desempenho externo, mas ainda não têm política formal de retenção nem vínculo seguro com perfil interno | o diagnóstico estruturado é salvo por ano/série/bimestre; XLSX bruto não é armazenado | histórico ainda não associa aluno externo ao perfil interno nem envia relatórios automaticamente a responsáveis | Alta | definir consentimento, retenção, identificador de aluno e auditoria de acesso antes de ampliar o compartilhamento | Fase 12; a Fase 7 passou a auditar administração de contas, não acesso aos dados SAE |
| TD-014 | Auditoria de produção aponta vulnerabilidades em Next.js e Sharp | `npm audit --omit=dev` de 23/07/2026 apontou duas vulnerabilidades altas; a correção disponível atualiza `sharp` para versão breaking | exposição depende do uso dos vetores afetados, mas não deve permanecer sem avaliação | Alta | atualizar em subtarefa isolada, validar geração de imagens e App Router em DEV antes de produção | Próxima manutenção de segurança |
| TD-015 | Contratos de regressão pré-existentes falhando fora do tema | `src/lib/classroom/classroomClient.test.ts` (mock de `axios.create`), `test:accessibility-contract` (`CorrigirExam` sem `htmlFor="classroom-course"`) e `test:assessment-collections` (`TurmaDetail` sem `fetch('/api/exams?examKind=prova')`) já falhavam antes da frente de contraste do tema escuro | `npm test` e `test:regression` param no primeiro erro e podem mascarar novos problemas | Alta | reconciliar contrato e tela em subtarefa isolada | Fase 11.3/11.4 |
| TD-017 | 26 telas ainda usam cores fixas fora dos tokens | a frente de contraste cobriu fundação, gráficos, Desempenho e Dashboard; `scripts/audit-theme-colors.ts` mantém a allowlist das demais | telas pendentes seguem com contraste incorreto no tema escuro | Média | migrar uma tela por subtarefa e remover o caminho da allowlist | Fases D-F |

## Regra de tratamento

Nenhum item acima deve ser resolvido por efeito colateral de outra subtarefa. Ao ser atacado, criar decisão, critério de aceite e testes próprios; depois manter este registro com status, data e evidência.

## Resolvidas

| ID | Descricao | Resolucao | Data | Evidencia |
| --- | --- | --- | --- | --- |
| TD-006 | Ausencia de ambiente DEV e remoto Git identificados | DEV interno isolado em `192.168.1.218:3011`, remoto oficial configurado e `main`/`develop` protegidas | 18/07/2026 | `docs/deployment.md` e `docs/git-workflow.md` |
| TD-008 | Vulnerabilidades de dependencias de producao | Drizzle ORM 0.45.2, NextAuth beta.31, Google APIs 173.0.0 e PostCSS 8.5.20, inclusive abaixo de Next via `overrides` | 19/07/2026 | auditoria de producao em zero; build e login por senha validados no DEV |
| TD-009 | Ausência de orçamento de bundle após upgrade de runtime | `scripts/test-performance-budget.ts` mede bytes gzip dos oito caminhos críticos usando o manifesto do build; limites iniciais registrados em 23/07/2026 | 23/07/2026 | `npm run test:performance-budget` |
| TD-016 | Orçamento de bundle de `/(app)/gerar` excedido | o gráfico de planejamento foi reescrito como barra interativa nativa (sem `recharts` em `CurriculumPreview`), unificando a matriz em um único controle de arraste/teclado | 11/09/2026 | `/(app)/gerar` caiu de ~216 KiB para 111,3 KiB gzip; `npm run test:performance-budget` aprovado |
