# Roadmap de Reconstrução do Front-end

**Responsável atual:** arquitetura de software.
**Regra de avanço:** cada fase é composta por subtarefas aprovadas individualmente. Não iniciar a próxima sem aprovação humana e sem checklist completo.

| Fase | Objetivo | Status | Data | Critério de aceite |
| --- | --- | --- | --- | --- |
| 1. Diagnóstico | inventário, fluxos, APIs, arquitetura atual/alvo e governança | Concluída | 18/07/2026 | documentos, DEV interno, remoto Git e protecao de `main`/`develop` validados — ver `docs/git-workflow.md` |
| 2. Fundação | tokens, design system, temas, tipografia, grid e biblioteca base | Concluída | 20/07/2026 | tokens, primitives, tema, Next 15/React 19, cliente HTTP, TanStack Query, formulário tipado, Lucide, Framer Motion e avaliação inicial de Recharts entregues; adoções futuras ficam condicionadas a um caso de uso por fase |
| 3. Layout global | shell, sidebar, header, footer, breadcrumb, menus e responsividade | Concluída | 20/07/2026 | subtarefas 3.1 a 3.5 aceitas e publicadas na produção v0.3.3; rollback e evidências registrados |
| 4. Dashboard | KPIs, gráficos, insights e storytelling | Concluída | 20/07/2026 | subtarefas 4.1 a 4.7 publicadas na produção v0.5.0; validações autenticadas de viewport, teclado e estados continuam registradas como acompanhamento operacional |
| 5. Avaliações | wizard, autosave, progresso, histórico e navegação | Concluída | 20/07/2026 | wizard, revisão, histórico e decisão explícita de não prometer autosave sem contrato seguro concluídos |
| 6. Relatórios | comparações, evolução, exportação e explicação por IA | Concluída | 22/07/2026 | relatórios pedagógicos, histórico SAE-ENEM, evolução anual, exportação, projeção TRI e recomendações individuais foram publicados; ver documentos da Fase 6 |
| 7. Administração | gestão operacional e permissões | Concluída | 22/07/2026 | painel de contas, RBAC e auditoria de criação, alteração e ativação publicados na produção v0.7.0 |
| 8. IA | experiência, segurança e transparência de IA | Concluída | 22/07/2026 | subtarefas 8.1 a 8.7 publicadas até v0.8.3: revisão humana, telemetria privada, painel restrito, orçamento, degradação segura e perfis configuráveis de modelo com consumo e custo estimado |
| 9. Performance | medição, otimização e orçamento | Concluída | 23/07/2026 | baseline gzip por rota, orçamento automatizado, consultas analíticas paralelas, cancelamento de filtro obsoleto e medição de duração publicados em DEV e produção com troca atômica e rollback |
| 10. Acessibilidade | auditoria e correções WCAG AA | Concluída com acompanhamento operacional | 23/07/2026 | rótulos, foco, semântica, anúncios de estado e contrato automatizado publicados em DEV e produção; o roteiro autenticado de produção foi transferido para a regressão de interface da Fase 11 |
| 11. Testes | cobertura automatizada e regressão | Em andamento | 23/07/2026 | Subtarefas 11.1 e 11.2: Vitest, CI, regras pedagógicas, RBAC e importação curricular cobertos sem dados reais; contratos HTTP e E2E continuam pendentes |
| 12. Revisão final | QA, segurança, documentação e lançamento | Pendente | - | checklist integral, rollback e aceite humano |

## Próxima fase

**Fase 11.3 - Contratos de API e permissões:** validar respostas e bloqueios
por papel em ambiente segregado. A pendência operacional de acessibilidade da
Fase 10 entra na Subtarefa 11.4; ela não bloqueia a continuidade da Fase 11.
# Matriz de Avaliação Pedagógica — concluída em 09/09/2026

- Implementada matriz por planejamento/bimestre com quantidade, prioridade e requisito visual por capítulo.
- Mantida compatibilidade do payload final das provas, exportação e cartões-resposta.
- Próximo passo operacional: piloto pedagógico com 9º ano, 1º EM e 2º EM antes de ampliar para todas as turmas.
