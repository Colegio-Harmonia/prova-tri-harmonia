# Exportacao de tabelas Markdown

## Problema corrigido

O modelo pode retornar dados tabulares no `statement`, `supportText` ou nas
alternativas usando Markdown. A API do Google Docs nao interpreta Markdown;
antes desta correcao, os separadores `|` e `---` eram publicados como texto.

## Comportamento

1. O prompt instrui o gerador a emitir tabela Markdown completa: cabecalho,
   divisor e pelo menos uma linha de dados.
2. O exportador aceita tambem a variante legada sem divisor, desde que tenha
   cabecalho e ao menos duas linhas com o mesmo numero de colunas. Isso evita
   converter por engano uma frase comum que tenha um caractere `|`.
3. A tabela e renderizada localmente em PNG com cabecalho, bordas, quebra de
   texto e fundo pronto para impressao.
4. O PNG vai para o Drive de staging e entra como imagem inline no documento
   da Prova.
5. Se o renderer ou o Drive falhar, o texto Markdown original permanece no
   documento; a questao nunca e publicada vazia.

## Limites

- A conversao ocorre somente na exportacao do documento. Provas que ja foram
  aprovadas precisam ser reemitidas para trocar a versao antiga.
- Gabarito e Mapa nao repetem o texto de apoio, portanto nao recebem imagem de
  tabela.

## Testes

`npm run test:markdown-tables` cobre reconhecimento de tabela, rasterizacao
PNG e insercao da imagem no plano de operacoes do Google Docs. Lint,
TypeScript e build completo tambem sao obrigatorios antes de publicar.
