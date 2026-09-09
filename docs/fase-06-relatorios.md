# Fase 6 - Relatórios

## Status

- **Início e conclusão:** 20/07/2026.
- **Ambientes alvo:** DEV interno e produção.
- **Escopo:** comparações autorizadas, evolução por período, exportação do
  recorte e leitura orientada por métricas.

## Fonte de verdade e permissões

O relatório usa somente correções com estado `revisado`, consultadas por
`GET /api/analytics/performance`. A autorização é aplicada no servidor antes
da agregação: coordenação e direção podem usar os filtros institucionais;
professor recebe exclusivamente provas atribuídas a ele, mesmo que altere a
query string no navegador.

Os filtros de `academicYear` e `bimester` também são processados pelo servidor.
Ano aceita inteiros entre 2000 e 2100, e bimestre somente de 1 a 4. Valores
inválidos respondem `400`, em vez de ampliar ou corromper o recorte.

## Entregas

| ID | Entrega | Critério de aceite | Status |
| --- | --- | --- | --- |
| 6.1 | inventário de dados, permissões e limites | fonte revisada e RBAC documentados | Concluída |
| 6.2 | comparações institucionais | disciplina, série e professor respeitam o recorte autorizado | Concluída |
| 6.3 | evolução por período | ano letivo e bimestre filtram a fonte e os painéis preservam série temporal disponível | Concluída |
| 6.4 | indicadores pedagógicos | Bloom, DOK, BNCC, INEP, SOLO, questões e perfis usam amostra e confiança | Concluída |
| 6.5 | exportação | CSV baixa o agregado do recorte ativo, sem respostas ou identificadores de alunos | Concluída |
| 6.6 | explicação assistida | leitura automática exibe média, amostra e comparações apenas quando a amostra permite | Concluída |
| 6.7 | validação e promoção | lint, tipos, build, smoke DEV e produção registrados | Concluída em DEV e produção |

## Leitura orientada

O bloco **Leitura orientada do recorte** é determinístico e explicável: usa a
média geral e as disciplinas com pelo menos três correções revisadas. Ele não
é uma resposta de IA generativa e não deve ser apresentado como diagnóstico,
causa de desempenho, previsão ou recomendação individual. Com menos de três
correções, a interface informa que o recorte é apenas registro.

A explicação por modelo generativo, com orçamento, retenção, proteção contra
prompt injection e revisão humana, pertence à Fase 8. Esta separação evita
atribuir a uma IA conclusões que os dados ainda não sustentam.

## Exportação

O botão **Exportar CSV do recorte** produz um arquivo local com média e amostra
geral, seguido da agregação por disciplina já retornada para a sessão atual.
Não envia dados adicionais ao servidor, não inclui respostas, notas individuais
ou nomes de estudantes, e usa ponto e vírgula para abrir corretamente em
planilhas configuradas para português.

## Limites conhecidos

- Evolução só é interpretável quando há períodos comparáveis e amostra
  suficiente; o produto não afirma causalidade.
- A agregação ainda é feita em tempo de requisição; acompanhar TD-005 antes de
  escalar volume de correções.
- Exportações mais amplas (PDF, planilha por aluno ou compartilhamento externo)
  exigem uma decisão específica de privacidade, retenção e permissão.

## Validação operacional

Lint, TypeScript, build, auditoria de dependências de produção, smoke das
rotas públicas/protegidas, processo PM2 e logs foram registrados em
`docs/testing.md` e `docs/deployment.md`. A validação autenticada de produção
não foi concluída: as credenciais de teste válidas no DEV foram recusadas pelo
banco de produção, sem relação detectada com a release. O fluxo autenticado e
os filtros foram validados no DEV antes da promoção.

## Correção de apresentação - 23/07/2026

O container compartilhado das visões **Visão geral**, **Análise Bloom**,
**Análise DOK**, **Análise BNCC** e **Perfis cognitivos** passou a aplicar
espaçamento vertical consistente entre seus blocos. A correção preserva as
grades internas e a responsividade, mas impede que cartões, gráficos e listas
de relatórios apareçam encostados. O contrato `npm run test:performance-layout`
protege esse espaçamento nas regressões futuras.
