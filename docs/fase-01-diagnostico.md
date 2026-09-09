# Fase 1 - Diagnóstico do Front-end

## Escopo entregue

- inventário de rotas de tela, handlers HTTP e componentes principais;
- mapeamento dos fluxos de professor, coordenação e direção;
- registro da arquitetura atual e alvo;
- regras permanentes de produto, design, UX, Git, deploy e encerramento de subtarefa;
- registro de dívida técnica, decisões e roadmap.

## Fluxos mapeados

| Fluxo | Início | Resultado | Restrições críticas |
| --- | --- | --- | --- |
| Gerar prova | `/gerar` | prova criada em rascunho com metadados pedagógicos | currículo e banco ENEM, IA e validação de payload |
| Revisar e aprovar | `/gerar/[examId]/revisar` | status avança até aprovação/documentos | transições e papel são validados no servidor |
| Aplicar e corrigir | `/gerar/[examId]/corrigir` | respostas revisadas e nota calculada | só prova aplicada; professor não acessa prova de terceiro |
| Lançar no Classroom | `/turmas/[courseId]` | atividade e notas no Google Classroom | confirmação explícita; OAuth/scopes e comportamento de submissão |
| Acompanhar desempenho | `/desempenho` | agregados por taxonomia e perfil cognitivo | amostra e acesso por papel precisam ser preservados |
| Administrar contas | `/usuarios` | contas e cargos institucionais | só coordenação/direção; trava contra auto-bloqueio |

## Resultado do diagnóstico

O backend e os contratos já atendem aos fluxos atuais, mas a camada visual precisa de uma fundação própria e de migração gradual. A nova arquitetura não altera a aplicação existente na Fase 1; ela reduz o risco das próximas fases ao estabelecer dependências permitidas, contratos, critérios de aceite e dívidas conhecidas.

## Bloqueios para o ciclo completo

1. Não há remoto Git configurado localmente, portanto o push não pode ser executado.
2. Ainda não há infraestrutura de teste automatizado de UI no projeto; a Fase 11 deve formalizá-la, mas as próximas fases precisam de smoke tests manuais em DEV.

## Ambiente DEV provisionado

Em 18/07/2026 foi provisionado o ambiente interno
`http://192.168.1.218:3011`: processo PM2 `prova-tri-dev`, diretório
`/home/eduardo/prova-tri-dev` e banco `prova_tri_dev`. O build completo e
o smoke test de autenticação passaram. A primeira inicialização falhou porque
`npm start` fixa a porta 3010; a definição DEV foi corrigida para executar
o binário Next diretamente na porta 3011. Nenhum processo, banco ou dado de
produção foi modificado.

A validação também revelou que o projeto tinha script ESLint sem arquivo de
configuração. Foi adicionado `.eslintrc.json` com a regra `next/core-web-vitals`
e corrigidas seis aspas JSX sinalizadas pelo lint; a execução no DEV passou.

## Próximo passo

Após aprovação, informar o repositório GitHub privado autorizado para
configurar `origin` e concluir o push. Em seguida, iniciar a Fase 2 com uma
única subtarefa de fundação: decisão/upgrade de runtime e instalação
controlada das dependências aprovadas, sem migrar tela de negócio.
