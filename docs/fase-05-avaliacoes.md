# Fase 5 - Fluxo de Avaliações

## Status

- **Início:** 20/07/2026.
- **Fase:** concluída no DEV interno.
- **Subtarefa final:** 5.7 - consolidação e validação DEV.
- **Pré-condição atendida:** Fase 4 publicada na produção v0.5.0.

## Objetivo

Evoluir a jornada de criação, revisão e acompanhamento de uma avaliação sem
alterar contratos de API, banco, autenticação, autorizações ou o fluxo de
status já aplicado em produção. A experiência deve tornar explícitos o estado
atual, o próximo passo autorizado e o que já foi persistido.

## Fluxo existente mapeado

1. Em `/gerar`, o usuário seleciona segmento, série, ano letivo, disciplina,
   bimestre opcional, quantidade e questões ENEM; a prévia curricular é
   consultada antes da geração.
2. `POST /api/exams/generate` gera e persiste uma prova no estado `rascunho`;
   em caso de sucesso, a interface navega para `/gerar/[examId]/revisar`.
3. Coordenação ou direção atribui a revisão. A pessoa atribuída inicia e
   conclui a revisão; coordenação ou direção aprova e gera documentos.
4. Depois de aprovada, a prova avança por impressão, aplicação, correção e
   consulta em `/status`.

### Máquina de estados preservada

`rascunho` -> `atribuido` -> `em_andamento` -> `revisao_concluida` ->
`aprovado` -> `impresso` -> `aplicado` -> `corrigido`.

As transições são validadas em `POST /api/exams/[examId]/status`. Atribuir,
aprovar e marcar impressão pertencem à coordenação/direção. Iniciar ou
concluir revisão, marcar aplicação e marcar correção também podem ser feitos
pela pessoa atribuída. A UI não pode antecipar, contornar ou ampliar essas
regras.

## Contratos e permissões

| Área | Contratos atuais | Regra que não pode mudar |
| --- | --- | --- |
| Geração | `POST /api/curriculum/preview`, `GET /api/enem-bank/search`, `GET /api/enem-bank/skills`, `POST /api/exams/generate` | a geração persiste somente após validação do servidor e retorna `examId` |
| Revisão | `GET /api/exams/[examId]`, notas, regeneração e imagens | `authorizeExamAccess` permite professor apenas em prova criada por ele ou atribuída a ele |
| Andamento | `POST /api/exams/[examId]/status` | estado e papel são revalidados no servidor, inclusive contra conflito entre abas |
| Histórico | `GET /api/exams` e `GET /api/exams/filters` | lista e filtros restringem professor no servidor; `/status` é a visão de acompanhamento existente |
| Correção | rotas em `/api/exams/[examId]/corrections` | só fica disponível depois de `aplicado` e mantém autorização própria |

## Autosave: limite confirmado

Não existe endpoint para salvar um rascunho do formulário de geração. Os
valores de `/gerar` vivem em estado de cliente até `POST /api/exams/generate`;
uma tentativa de autosave nessa tela exigiria decisão de produto e contrato de
backend próprios. Criar uma prova parcialmente preenchida ou gravar no
`localStorage` sem política aprovada poderia deixar dados desatualizados ou
simular persistência que não existe.

Na revisão, cada nota de questão é salva explicitamente por
`POST /api/exams/[examId]/review-note`. Textos ainda digitados e não enviados
continuam apenas no cliente. A Fase 5 pode melhorar feedback de salvamento e
navegação a partir desse contrato, mas não chamará isso de autosave enquanto
não houver persistência segura e confirmada.

## Subtarefas

| ID | Escopo | Critério de aceite | Status |
| --- | --- | --- | --- |
| 5.1 | inventário, contratos, permissões e limites | fluxo, máquina de estados, endpoints e ausência de autosave documentados | Concluída |
| 5.2 | estrutura do wizard de geração | etapas usam os mesmos campos e requisições; voltar e avançar não geram prova | Concluída |
| 5.3 | progresso e estados da geração | progresso, loading, erro e sucesso são claros sem prometer persistência inexistente | Concluída |
| 5.4 | revisão orientada a etapas | status, ações autorizadas e retorno a `/status` ficam legíveis em desktop e mobile | Concluída |
| 5.5 | histórico e retomada | a lista existente informa situação e próximo acesso sem expor provas de terceiros | Concluída |
| 5.6 | decisão de autosave | somente após contrato e aprovação; define escopo, expiração, conflito e recuperação | Concluída: decisão registrada |
| 5.7 | consolidação | regressão de geração, revisão, permissões, responsividade e acessibilidade | Concluída no DEV |

## Critérios da Fase 5

- Nenhuma alteração de rota, payload, status, banco ou autorização sem decisão
  registrada e aprovação humana.
- Geração só ocorre após ação explícita e resposta bem-sucedida do servidor.
- Toda etapa informa loading, erro, vazio quando aplicável e o que foi ou não
  salvo.
- Professores não veem nem operam avaliações de terceiros.
- Os fluxos funcionam em 320 px, 768 px e desktop, por teclado e com foco
  visível.
- Cada subtarefa passa por lint, TypeScript, build, teste aplicável, DEV e
  validação manual autenticada antes de promoção.

## Próximo passo

A Subtarefa 5.2 entregou o wizard em `/gerar`: contexto curricular,
composição e conferência. Os campos, a prévia curricular, a seleção ENEM e
`POST /api/exams/generate` foram preservados; autosave não faz parte dessa
entrega. As subtarefas 5.3 a 5.5 tornaram o andamento explícito, anunciaram
transições e preservaram `/status` como histórico autorizado. A 5.6 decidiu
que autosave permanece fora do produto até haver contrato de backend para
rascunho, expiração, conflito e recuperação. A 5.7 validou build, sessão por
credenciais de coordenação, geração e histórico no DEV. A promoção para
produção exige aprovação humana específica.
