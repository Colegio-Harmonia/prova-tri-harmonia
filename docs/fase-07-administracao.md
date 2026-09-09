# Fase 7 - Administração

## Escopo entregue

- A gestão de usuários continua exclusiva de coordenação e direção.
- O painel mostra totais de contas, estado ativo, cargos, criação de conta e
  ativação/desativação, em tabela para desktop e cartões para celular.
- Ações administrativas passam a registrar responsável, conta afetada, estado
  anterior e estado resultante em `administrative_audit`.
- A consulta da auditoria é protegida por sessão e pelo mesmo RBAC de
  superusuário usado na gestão de contas.

## Eventos auditados

| Ação | Registro |
| --- | --- |
| Cadastro de conta | `user_created` |
| Alteração de cargo | `user_updated` |
| Desativação | `user_deactivated` |
| Reativação | `user_activated` |

O sistema não exclui contas pela interface. A desativação é lógica e mantém o
histórico de acesso e auditoria. Um administrador também não pode desativar a
própria conta por essa tela.

## Migração

`drizzle/0009_administrative_audit.sql` cria a tabela e os índices por data e
conta afetada. Ela deve ser aplicada uma vez por banco, primeiro no DEV e
depois no banco de produção, antes de ativar o código que grava os eventos.

## Testes no DEV - 22/07/2026

- `npm run lint` e `npx tsc --noEmit`: aprovados.
- Smoke autenticado: uma coordenação de teste criou, desativou e reativou uma
  conta no banco DEV; os três eventos retornaram pela API, identificando autor
  e conta afetada.
- Controle de acesso: sem sessão recebeu `401`; um professor autenticado
  recebeu `403` em `/api/admin/audit` e `/api/users?all=1`.
- O script reutilizável `npm run test:admin-audit-runtime` exige as variáveis
  `TEST_BASE_URL`, `TEST_ADMIN_EMAIL` e `TEST_ADMIN_PASSWORD`; as variáveis de
  professor são opcionais para validar o bloqueio por papel. Credenciais não
  são versionadas.

## Limites

- A retenção de registros, exportação de auditoria e política de dados de
  desempenho externo seguem pendentes na TD-013.
- A validação visual autenticada em produção deve confirmar o painel de
  atividade após o corte da release.

## Produção - 22/07/2026

- A release `v0.7.0` foi publicada por troca atômica no processo PM2
  `prova-tri` em `3010`.
- A migração foi aplicada antes do corte; `administrative_audit` existe em
  produção e iniciou vazia, sem alteração de dados SAE.
- O smoke pós-corte confirmou login público em `200`, usuários anônimo em
  `307` e auditoria anônima em `401`. O processo ficou online e o log de erro
  não recebeu entrada nova.
- A validação autenticada de criação e alteração foi executada no DEV isolado
  para não criar contas de teste na base de produção. A inspeção visual do
  painel por uma coordenação em produção permanece recomendada.
