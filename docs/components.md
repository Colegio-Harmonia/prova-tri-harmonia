# Inventário de Componentes e Plano de Evolução

## Inventário atual

| Área | Componentes atuais | Diagnóstico |
| --- | --- | --- |
| Shell | `src/app/(app)/layout.tsx` | header simples, navegação horizontal e sem breadcrumb/responsividade dedicada |
| Dashboard | `DashboardStats`, `EnemDashboard`, `ProfessorHome`, `ApexBarChart`, `RechartsBarChart`, `Tabs` | `DashboardStats` usa query tipada e cache compartilhado; “Por segmento” é a avaliação inicial de gráfico declarativo, enquanto os demais gráficos mantêm ApexCharts |
| Geração | `CurriculumPreview` | configura currículo, busca banco ENEM e gera prova em um componente de 530 linhas |
| Revisão | `RevisarExam` | fluxo central de 689 linhas; merece seções por questão, status e ações |
| Correção | `CorrigirExam` | 444 linhas de estado, respostas e nota sugerida |
| Desempenho | `DesempenhoPanel` | 1.000 linhas e oito subdashboards no mesmo arquivo |
| Turmas | `MinhasTurmas`, `TurmaDetail` | funções claras, mas dados e comunicação HTTP ficam acoplados ao render |
| Administração | `UsuariosList` | CRUD simples com estado manual |

## Biblioteca alvo da Fase 2

### Primitives

`Button`, `IconButton`, `Input`, `Select`, `Textarea`, `Checkbox`, `RadioGroup`, `Dialog`, `Popover`, `Tooltip`, `Tabs`, `Table`, `Badge`, `Card`, `Skeleton`, `EmptyState`, `Alert`, `Toast`, `Progress`, `Breadcrumb` e `Pagination`.

Cada primitive deve ter API pequena, variantes semânticas, estados acessíveis e exemplos de uso. A implementação preferencial é shadcn/ui como base editável, não uma dependência de componentes opaca.

### Componentes compostos

- `AppShell`, `Sidebar`, `MobileNavigation`, `PageHeader`, `PageActions`, `FilterBar`.
- `MetricCard`, `InsightCard`, `ChartCard`, `DataTable`, `SampleSizeNotice`.
- `AsyncState`, `ErrorState`, `PermissionState`, `EmptyState`.
- `StatusBadge` para fluxo de prova, sem duplicar regras de transição do backend.

## Regras de composição

- Um componente apresenta um conceito; uma feature orquestra dados e ações; a página compõe a feature.
- Componentes visuais recebem dados já formatados sempre que isso não esconder regra de domínio importante.
- Não passar objetos de sessão, objetos de banco ou respostas HTTP inteiras por várias camadas.
- Elementos de gráfico têm tabela/resumo textual adjacente para uso por leitor de tela e exportação futura.

## Estado de servidor

- `src/app/providers.tsx` mantém uma instância estável do `QueryClient`.
- Defaults compartilhados ficam em `src/lib/query/client.ts`; componentes não
  criam clientes próprios.
- Chaves, tipos e funções de consulta pertencem à feature, como
  `src/features/analytics/queries/dashboard-stats.ts`.
- Componentes consomem `queryOptions` tipadas e preservam estados explícitos
  de carregamento, erro e vazio.
