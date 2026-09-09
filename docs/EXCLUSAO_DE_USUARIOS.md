# Exclusão administrativa de usuários

## Regra de uso

Coordenação e direção podem excluir uma conta pela tela **Usuários**. A ação
exige confirmação no navegador e não permite excluir a própria conta.

## Preservação de histórico

Uma conta que já possui evidências pedagógicas ou operacionais não é excluída:
o sistema abre uma etapa obrigatória para escolher uma conta ativa que receberá
o histórico. A transferência abrange provas, correções, filas de geração e
processamento de scans, classificações e demais registros que referenciam a
conta. Isso permite excluir a conta sem apagar provas ou quebrar a integridade
do banco.

O vínculo de Google Chat não é transferido: ele pertence à conta removida e é
revogado durante a exclusão. A auditoria registra a conta excluída, a conta que
recebeu o histórico e as quantidades transferidas.

Para contas sem histórico, a instalação vinculada do Google Chat é removida e
o evento `user_deleted` é gravado na auditoria. A migração `0026` configura a
referência do usuário-alvo para `ON DELETE SET NULL`, preservando o evento e os
dados anteriores (`previous_value`) após a exclusão.

## Resposta da tela

Quando há histórico e nenhum destino foi escolhido, o endpoint responde `409`
com as quantidades de registros e provas. A tela exibe o seletor de destino e
só confirma a exclusão após a escolha. Também trata a violação `23503` direta
ou encapsulada pelo driver sem tentar interpretar uma resposta vazia como JSON.

## Aplicação e reversão

Aplicar em cada ambiente antes de habilitar o endpoint:

```sql
ALTER TABLE "administrative_audit"
  DROP CONSTRAINT IF EXISTS "administrative_audit_target_user_id_fkey";
ALTER TABLE "administrative_audit"
  DROP CONSTRAINT IF EXISTS "administrative_audit_target_user_id_users_id_fk";
ALTER TABLE "administrative_audit"
  ADD CONSTRAINT "administrative_audit_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
```

Para reverter a regra de banco, restabelecer a constraint sem `ON DELETE SET
NULL`. Não há reversão automática de uma conta já excluída; nesse caso é
necessário cadastrá-la novamente pelo painel administrativo.
