# Fase 9 - Performance

## Objetivo e limite

Reduzir trabalho desnecessário nas consultas de desempenho e criar uma linha
de base reproduzível para o bundle, sem alterar contratos HTTP, banco,
autorização, regras pedagógicas ou dados de alunos.

## Entregas

1. A API `GET /api/analytics/performance` executa em paralelo as leituras
   independentes de eixos INEP/taxonomias e das classificações DOK, SOLO e
   professores. A ordem e o conteúdo do JSON permanecem iguais.
2. Cada prova monta um índice `numero da questão -> questão`; respostas não
   percorrem mais toda a lista de questões para localizar seu enunciado.
3. A resposta autenticada informa `Server-Timing: analytics;dur=...`, para
   que DEV e produção possam observar a duração real sem incluir dados de
   aluno no log.
4. O filtro textual de disciplina em `/desempenho` usa valor adiado e cancela
   a solicitação anterior quando o recorte muda. Isso evita resposta antiga
   substituir o resultado mais recente.
5. `npm run test:performance-budget` mede chunks gzip do manifesto Next após
   `npm run build`. Os limites iniciais são deliberadamente próximos ao
   baseline e cobrem as oito rotas críticas.

## Baseline local de 23/07/2026

| Rota | gzip observado | Limite |
| --- | ---: | ---: |
| `/dashboard` | 268,5 KiB | 300 KiB |
| `/desempenho` | 112,1 KiB | 125 KiB |
| `/desempenho/relatorio` | 105,4 KiB | 120 KiB |
| `/desempenho/simulado-enem` e `/sae` | 218,0 KiB | 240 KiB |
| `/gerar` | 104,9 KiB | 120 KiB |
| `/gerar/[id]/revisar` | 116,1 KiB | 130 KiB |
| `/status` | 118,1 KiB | 130 KiB |

O build reportou 102 kB de JavaScript compartilhado. O tamanho é uma soma
gzip dos chunks necessários a cada rota, útil para detectar regressão; não é
uma medição de rede substituta para RUM.

## Critérios de aceite

- `npm run lint`, `npm run build` e `npm run test:performance-budget` passam.
- A API preserva autorização e retorna os mesmos campos JSON.
- Trocar filtros rapidamente não apresenta resultado fora do último recorte.
- Em sessão autenticada, a API retorna `Server-Timing` com duração positiva.
- DEV e produção recebem o mesmo commit por troca atômica, com smoke de
  login, rota protegida, processo PM2 e log limpo.

## Limite conhecido

Não foi criada tabela pré-agregada. O volume atual foi considerado adequado
para cálculo em tempo de requisição; com crescimento sustentado de dados,
usar `Server-Timing` para decidir uma evolução isolada de agregação ou índice
de banco, sem alterar a leitura pedagógica atual.

## Publicação em 23/07/2026

- DEV: candidato isolado compilado, validado e promovido para
  `prova-tri-dev`; login retornou `200`, dashboard anônimo `307` e uma sessão
  autenticada recebeu `200` da API com `Server-Timing: analytics;dur=18.1`.
  Rollback: `/home/eduardo/prova-tri-dev-rollback-pre-fase9-20260723-065347`.
- Produção: candidato isolado compilado, validado e promovido para
  `prova-tri`; login local e HTTPS público retornaram `200`, dashboard
  anônimo retornou `307` e PM2 permaneceu online. Rollback:
  `/home/eduardo/prova-tri-rollback-pre-fase9-20260723-065622`.
- Sem migração, alteração de banco, credencial ou contrato JSON. O build dos
  dois ambientes repetiu o aviso transitivo do NextAuth para runtime Edge;
  isso permanece em TD-010 e não bloqueia o runtime Node/PM2 atual.
- A auditoria de produção posterior encontrou duas vulnerabilidades altas em
  Next.js e Sharp. A atualização exige avaliação isolada por ser
  potencialmente incompatível; o item foi registrado como TD-014 e não foi
  aplicado como efeito colateral desta fase.
