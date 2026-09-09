# Processo Obrigatório de Deploy

## Ambientes

`DEV`, homologação e produção são ambientes distintos. O endereço público `prova.colegioharmonia.com.br` é produção e não pode ser tratado como DEV. Só realizar deploy de DEV quando houver host, URL, credenciais e estratégia de rollback identificados.

## Pré-deploy

1. Confirmar commit exato, status limpo e variáveis necessárias no ambiente de destino.
2. Executar lint, type check, build e testes definidos em `docs/testing.md`.
3. Validar que o artefato não contém `.env.local` ou segredos.
4. Registrar a versão, data e responsável em `docs/deployment.md`.

## Pós-deploy

1. Confirmar o processo online e a resposta HTTP da rota de saúde ou login.
2. Executar o smoke test autenticado dos fluxos afetados.
3. Consultar logs de erro novos, não apenas a existência de logs históricos.
4. Registrar resultado, evidências e rollback necessário em `docs/deployment.md` e `docs/testing.md`.

## Rollback

O rollback deve apontar para um commit/artefato anterior conhecido, não para uma cópia local não versionada. Se não houver mecanismo documentado de rollback, o deploy está bloqueado para mudanças de aplicação.
