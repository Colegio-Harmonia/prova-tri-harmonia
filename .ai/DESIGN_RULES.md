# Regras do Design System

## Direção visual

O Prova-TRI deve comunicar precisão pedagógica, acolhimento e controle. A interface não pode parecer um painel administrativo genérico: dados devem ter hierarquia, contexto e uma próxima ação clara.

## Tokens primeiro

Nenhuma cor, raio, sombra, espaço ou tamanho tipográfico novo deve ser repetido como valor arbitrário em telas. A Fase 2 definirá tokens semânticos para cor, tipografia, espaçamento, elevação, borda, estado e movimento, com equivalentes light e dark. Componentes consomem tokens semânticos como `surface`, `content-primary`, `action-primary`, `status-warning`; nunca nomes de cor como `green-600` como semântica de negócio.

## Componentes

- Construir componentes pequenos, acessíveis e compostos a partir de primitives do design system.
- Toda primitive interativa precisa de foco visível, estado desabilitado, loading, erro e texto acessível.
- Formulários usam label persistente, ajuda contextual e mensagem de erro associada ao campo.
- Ícones complementam, nunca substituem, um rótulo crítico sem `aria-label` ou tooltip.
- Estados vazios explicam o porquê e oferecem a próxima ação possível.

## Dados e gráficos

Gráficos precisam responder uma pergunta pedagógica, exibir unidade e período, e ter equivalente textual/tabela acessível. Cor não pode ser o único canal para distinguir série, nível ou situação. Para amostras baixas, mostrar a limitação antes de sugerir intervenção.

## Responsividade

Começar por telas estreitas. Navegação, tabelas, filtros e ações em lote precisam ter plano explícito para 320 px, tablet e desktop. Nenhuma informação essencial pode depender de hover.
