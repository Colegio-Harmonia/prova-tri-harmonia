# Fase 11 - Testes e Regressão

## Objetivo

Transformar os contratos já existentes em uma estratégia reproduzível de
unidade, integração e interface, sem usar dados de alunos, credenciais reais
ou chamadas externas durante a validação automática.

## Estado de entrada

- A Fase 10 está funcionalmente concluída em DEV e produção.
- A única pendência transferida é a validação assistida de teclado e leitor de
  tela em produção com uma conta autorizada. Ela é operacional, não representa
  defeito conhecido e será tratada na Subtarefa 11.4.
- As vulnerabilidades de dependências TD-014 e a ausência de um ambiente de
  staging formal continuam itens separados; não são mascarados pela suíte de
  testes nem bloqueiam a fundação 11.1.

## Subtarefa 11.1 - Fundação

### Entrega

- Vitest configurado para testes unitários TypeScript no ambiente Node.
- Cobertura V8 inicial para o módulo unitário migrado. Ela não é uma métrica
  global do produto; a ampliação por domínio será feita nas subtarefas 11.2 a
  11.5.
- Primeiro contrato migrado: instalação privada do Google Chat, incluindo
  eventos do app padrão e do complemento Workspace, rejeição de grupos e
  tokens de conexão.
- Comandos de tipo, unidade, cobertura e regressão centralizados no
  `package.json`.
- Workflow GitHub Actions que reproduz a bateria sem banco, autenticação ou
  fornecedores de IA. O build recebe heap Node de 4 GB apenas no runner, pois
  o App Router ultrapassa o padrão de 2 GB durante a checagem completa.

### O que esta subtarefa não faz

- Não testa interfaces autenticadas no navegador.
- Não cria usuários, não envia mensagens do Google Chat e não altera produção.
- Não substitui a evidência humana da Fase 10 com leitor de tela real.

## Evidência esperada antes de encerrar 11.1

1. `npm run lint` e `npm run typecheck` sem diagnósticos.
2. `npm run test:coverage` e `npm run test:regression` aprovados.
3. `npm run build` e `npm run test:performance-budget` aprovados.
4. Pull request para `develop` com workflow `Quality` verde.
5. DEV recompilado para assegurar que a dependência de desenvolvimento não
   interfere no runtime da aplicação.

## Subtarefa 11.2 - Regras de dominio

### Entrega

- Testes unitários Vitest para a política de papéis: apenas coordenação e
  direção são superusuários; professor permanece com visão restrita.
- Regras pedagógicas de DOK, SOLO esperado e faixas de confiança testadas nos
  limites e nos três níveis de complexidade.
- Parsing curricular testado sem banco ou arquivo XLSX real: sinônimos de
  cabeçalho, acentos, linhas vazias, habilidades BNCC, objetivos estimados e
  objetivos atitudinais.
- Mapa de área ENEM testado para preservar o agrupamento usado nas importações
  e impedir que uma disciplina sem mapeamento receba área inventada.
- Comando focado `npm run test:domain`, enquanto `npm run test` e
  `npm run test:coverage` continuam incluindo todos os contratos Vitest.

### Limites deliberados

- Não simula banco, autenticação, rotas HTTP, upload real nem APIs externas.
- Contratos de API e bloqueios por papel em ambiente segregado pertencem à
  Subtarefa 11.3; jornadas autenticadas no navegador pertencem à 11.4.

### Evidência local

- **23/07/2026:** `npm run test:domain` aprovou 12 cenários em quatro
  arquivos: papéis, heurísticas pedagógicas, importação curricular e mapa
  ENEM.
- **23/07/2026:** `npm run test:coverage` aprovou 16 testes Vitest. Nos nove
  módulos declarados para esta fundação, registrou 99,02% de linhas, 96,72%
  de statements, 100% de funções e 85,71% de branches. Não é cobertura global
  da aplicação.
- **23/07/2026:** regressão, lint, TypeScript e orçamento de performance
  passaram. O build local compilou com sucesso e gerou `BUILD_ID`; o executor
  não devolveu encerramento depois de iniciar a geração estática. A conclusão
  do build será confirmada no candidato DEV antes da promoção.

### Evidência DEV

- **23/07/2026:** o workflow Quality do PR #175 passou em instalação limpa,
  incluindo build completo. A candidata DEV repetiu `npm ci`, cobertura (16
  testes), regressão, lint, TypeScript, build de 36 rotas e orçamento de
  performance. Após a troca atômica, `/login` respondeu `200` e `/dashboard`
  anônimo respondeu `307`; o PM2 `prova-tri-dev` ficou online e `.env.local`
  preservou o mesmo hash. Rollback:
  `/home/eduardo/prova-tri-dev-rollback-pre-fase11-2-20260723-1523`.

### Evidência de produção

- **23/07/2026:** o PR #177 promoveu `develop` para `main` após dois
  workflows Quality verdes. A candidata de produção repetiu instalação limpa,
  cobertura (16 testes), regressão, lint, TypeScript, build de 36 rotas e
  orçamento. Após o corte atômico, login local e público responderam `200` e
  dashboard sem sessão respondeu `307`; o PM2 `prova-tri` ficou online e o
  hash de `.env.local` foi preservado. Rollback:
  `/home/eduardo/prova-tri-rollback-pre-fase11-2-20260723-1604`.

## Subtarefa 11.3 - Contratos de API e permissões

### Entrega

- Testes de handlers reais com sessão e banco simulados, sem conexão ou dados
  de aluno.
- Contratos de `401` sem sessão, `403` para professor em recursos
  administrativos e respostas de leitura permitidas para direção/coordenação.
- Validação de parâmetros de análise antes de consultas caras ou acesso a
  importações institucionais.
- Comando focado `npm run test:api-contracts`, incluído automaticamente por
  `npm run test` e pela cobertura Vitest.

### Limites deliberados

- Não chama um servidor HTTP nem banco físico; o ambiente segregado é o
  próprio harness de handler com `auth` e `db` simulados.
- Fluxos de navegador autenticado, upload e mutações ficam para a 11.4.

### Evidência local

- **23/07/2026:** `npm run test:api-contracts` aprovou 10 cenários de
  administração, perfis e operações de IA, usuários e análise ENEM-SAE.
  `npm run test:coverage` aprovou 26 testes no total. A métrica passou a
  incluir handlers parcialmente exercitados e não deve ser interpretada como
  cobertura global; limites formais permanecem para a 11.5.

## Evidência local

- **23/07/2026:** `npm run test:coverage` aprovou 4 testes e registrou 100%
  de linhas no módulo `googleChatInstallation`. O relatório não é usado como
  cobertura global, pois o restante dos módulos ainda não foi migrado.
- **23/07/2026:** `npm run test:regression`, `npm run lint`, `npm run
  typecheck`, `npm run build` e `npm run test:performance-budget` passaram.
  O orçamento manteve todas as oito rotas críticas dentro dos limites.
- **23/07/2026:** o workflow `Quality` do PR #170 passou em runner Linux com
  instalação limpa. A candidata DEV também passou a bateria e foi promovida
  por troca atômica; `/login` respondeu `200` e `/dashboard` sem sessão,
  `307`. O rollback é
  `/home/eduardo/prova-tri-dev-rollback-pre-fase11-20260723-1034`.
- **23/07/2026:** a promoção para `main` no PR #172 passou o workflow Quality.
  A candidata de produção repetiu a bateria e, após o corte atômico, login
  local e público responderam `200`, enquanto dashboard sem sessão respondeu
  `307`. O rollback é
  `/home/eduardo/prova-tri-rollback-pre-fase11-20260723-1455`.
