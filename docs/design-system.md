# Estratégia do Design System

## Objetivo

Construir uma linguagem visual própria para acompanhamento pedagógico, coerente em desktop e mobile, que reduza a carga cognitiva durante geração, revisão, correção e leitura de dados.

## Fundamentos a criar na Fase 2

| Fundação | Decisão de implementação | Critério de aceite |
| --- | --- | --- |
| Tokens | CSS variables semânticas integradas ao Tailwind | nenhuma tela nova depende de valores visuais repetidos |
| Cor | escala neutra, verde Harmonia como ação primária, cores de estado e dados | contraste AA e equivalência light/dark documentados |
| Tipografia | família expressiva e legível, escala de texto/linha/peso | títulos, dados e textos de formulário têm hierarquia consistente |
| Espaço | grade de 4/8 px e tamanhos semânticos | ritmo vertical consistente e densidade configurável |
| Elevação | superfícies, bordas e sombras por intenção | cards e overlays não competem visualmente |
| Movimento | duração/easing por intenção e redução de movimento | feedback claro sem bloquear tarefas |
| Tema | light e dark por tokens, não classes duplicadas por tela | preferência respeitada e contraste verificado |

## Uso em contexto pedagógico

- Verde comunica ação concluída ou estado saudável, não necessariamente desempenho alto.
- Situações de intervenção usam texto, ícone e rótulo junto de cor.
- O dado mais importante da página aparece antes de filtros e detalhes, com contexto de período e tamanho da amostra.
- Tabelas densas preservam cabeçalho, foco e alternativa móvel por cartões ou detalhes expansíveis.

## Não objetivos

Não definir tokens finais, trocar componentes existentes ou instalar dependências nesta Fase 1. A decisão de versão e biblioteca está registrada em `docs/decisions.md` e será executada isoladamente na Fase 2.

## Fase 2.1 - Fundacao entregue

- Tokens semanticos de superficie, conteudo, borda, acao, estado, foco, raio,
  elevacao e movimento vivem em `src/app/globals.css` e sao expostos ao
  Tailwind em `tailwind.config.ts`.
- O tema escuro usa o atributo `data-theme="dark"`; sem atributo, respeita
  `prefers-color-scheme`. A opcao explicita `data-theme="light"` preserva o
  tema claro.
- A grade usa incrementos de 4 px, com espacamentos mais frequentes em 8 px.
  A tipografia combina sans legivel para leitura com serif de exibicao para
  titulos curtos e dados de destaque.
- Primitives iniciais: `Button`, `Input`, `Field` e `Card`. Todas usam tokens,
  foco visivel, estados desabilitados e semantica acessivel. `Button` tambem
  oferece estado de carregamento; `Field` oferece mensagem de erro anunciavel.

Essas primitives ainda nao foram aplicadas a uma tela de negocio. A primeira
migracao visual ocorrera em subtarefa posterior, apos validacao da fundacao.

### Validacao em DEV

O commit `ee33500` foi compilado no DEV interno e executado pelo processo
`prova-tri-dev` em `3011`. O login respondeu `200`; a rota protegida de
dashboard redirecionou uma sessao anonima para login com `307`. Nenhuma rota,
contrato de API, banco ou autenticacao foi alterado nesta subtarefa.

## Fase 2.2 - Catalogo interno

A rota autenticada `/design-system` e visivel apenas para coordenacao e direcao.
Ela demonstra tokens de cor, tipografia, superficies, `Button`, `Input`,
`Field` e `Card`; tambem permite alternar entre tema claro, escuro e preferencia
do sistema. O catalogo e uma ferramenta de validacao, nao uma tela de negocio
ou item permanente de navegacao.

O catalogo foi publicado no DEV interno no commit `aaffead`. A validacao
automatizada confirmou build, processo online e bloqueio de visitante anonimo.
A validacao visual autenticada permanece manual: acessar a rota como coordenacao
ou direcao, alternar os tres temas e conferir foco, erro de campo e estado de
carregamento do botao.

## Fase 2.4 - Tema e acessibilidade da fundacao

### Preferencia de tema

- A escolha system, light ou dark e persistida no localStorage do navegador
  com a chave prova-tri-theme; nao e associada a conta nem enviada ao servidor.
- Um script minimo no layout raiz aplica a escolha explicita antes da
  hidratacao, evitando um flash do tema incorreto. A preferencia system remove
  o atributo e volta a respeitar prefers-color-scheme.
- O catalogo informa esse escopo ao usuario e continua sendo o local interno
  de validacao da fundacao.

### Contraste verificado

Razoes calculadas com WCAG relative luminance. Texto normal exige ao menos
4.5:1; todos os pares abaixo atendem AA.

| Par semantico | Claro | Escuro |
| --- | ---: | ---: |
| content-primary em surface | 15.70:1 | 11.85:1 |
| content-secondary em surface | 8.28:1 | 8.56:1 |
| content-muted em surface | 4.90:1 | 5.68:1 |
| action-primary-foreground em action-primary | 4.66:1 | 6.33:1 |
| content-inverse em action-danger | 6.21:1 | 5.98:1 |
| content-inverse em status-success | 4.99:1 | 7.89:1 |
| content-inverse em status-warning | 4.61:1 | 8.54:1 |
| content-inverse em status-info | 5.75:1 | 7.67:1 |

### Tints de status

Alem da cor cheia de status, cada intencao expoe `status-<tom>-surface`,
`status-<tom>-content` e `status-<tom>-border` em `src/app/globals.css`, com
equivalentes claro e escuro. Eles substituem os tints literais do Tailwind
(`bg-amber-50`, `text-red-700`) em alertas, faixas e cartoes de ocorrencia,
que nao mudavam de cor no tema escuro.

| Par semantico | Claro | Escuro |
| --- | ---: | ---: |
| status-success-content em status-success-surface | 5.59:1 | 8.52:1 |
| status-warning-content em status-warning-surface | 6.37:1 | 9.13:1 |
| status-danger-content em status-danger-surface | 6.80:1 | 8.12:1 |
| status-info-content em status-info-surface | 7.15:1 | 8.45:1 |

Os quatro pares atendem AA nos dois temas; a verificacao automatizada vive em
`npm run test:theme-tokens`.

### Matriz de primitives

| Primitive | Estados e semantica garantidos |
| --- | --- |
| Button | foco visivel global, tamanho minimo de 36/40/48 px, desabilitado, loading com aria-busy e rotulo legivel |
| Input | label externo persistente, foco visivel, desabilitado, placeholder de baixo contraste e aria-invalid verdadeiro somente em erro |
| Field | label associado por htmlFor, obrigatoriedade visual, hint e erro com role alert |
| Card | superficie semantica, borda, elevacao moderada e secao HTML para agrupar conteudo relacionado |

O proximo passo da Fase 2 e criar o cliente HTTP tipado para resolver TD-002,
sem migrar jornada de negocio nesta fundacao.

Validacao DEV em 19/07/2026: tema escuro persistiu apos recarregar uma sessao
de coordenacao no catalogo; login, bloqueio anonimo, processo e logs tambem
passaram. O commit validado foi 2b8b2b7.

## Fase 2.10 - Movimento com propósito

- Framer Motion é adotado inicialmente no dashboard do professor, apenas na
  entrada da seção informativa “Minhas Provas”.
- A entrada usa 180 ms e o easing produtivo dos tokens, sem bloquear leitura,
  clique ou carregamento de dados.
- useReducedMotion remove o estado inicial animado quando o sistema indica
  prefers-reduced-motion; a regra global de CSS continua reduzindo
  transições e animações remanescentes.

## Fase 3.1 - Adoção da marca Harmonia

- A referência visual oficial passa a ser o material fornecido em
  `Harmonia Design System`: Roboto, verde `#008649`, verde de interação
  `#006A3A`, grafite `#3C424F`, branco, verde claro `#E8F5EE` e borda
  `#E5E7EB`.
- Os ativos versionados em `public/brand/` são o ícone e as versões colorida
  e branca da marca. O shell usa o ícone acompanhado pelo nome do produto
  para preservar legibilidade em navegação compacta.
- A escala preserva a grade de 4/8 px já exposta pelo Tailwind. Raios e
  sombras foram alinhados às intenções da marca: 4/6/8/12 px e elevação
  discreta.
- O tema escuro segue suportado por tokens semânticos; o manual externo não
  definiu uma paleta escura própria, portanto os equivalentes acessíveis da
  Fase 2 permanecem a fonte de verdade para esse tema.
