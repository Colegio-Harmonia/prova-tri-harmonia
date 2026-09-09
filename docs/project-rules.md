# Regras Permanentes do Projeto

Este documento é a versão documental das regras em `.ai/PROJECT_RULES.md`. Para instruções de execução de IA, a pasta `.ai/` é a entrada obrigatória.

1. Backend, banco e autenticação existentes são fonte de verdade durante a reconstrução do front-end.
2. Toda mudança que altere contrato, dado persistido, permissão, integração externa ou segurança exige decisão registrada e aprovação humana antes de implementação.
3. Uma subtarefa é uma unidade de escopo, teste, commit e aprovação. Não iniciar a seguinte por conta própria.
4. O design system é obrigatório para telas novas; não criar estilos avulsos como solução final.
5. Estados de carregamento, vazio, erro, permissão e sucesso são parte do requisito funcional.
6. Dados pedagógicos exigem contexto, período e sinalização de amostra insuficiente.
7. Dados de aluno e credenciais são sensíveis. Minimizar exposição, evitar logs e nunca versionar segredos.
8. Dívidas fora do escopo são registradas em `docs/tech-debt.md`, não resolvidas incidentalmente.
9. `main` representa producao; `develop` representa homologacao; cada subtarefa usa uma branch `feature/*` ou `fix/*` criada de `develop`. Nenhuma subtarefa comeca diretamente em `main` ou `develop`. Ver `docs/git-workflow.md` para o fluxo completo de branches, Pull Request e ambientes.
10. Produção nunca é alterada a partir de uma branch `feature/*`. Todo merge em `main` exige validação prévia em DEV. Deploy de produção exige autorização expressa do responsável humano.
11. Cada subtarefa deve gerar commit, push e deploy somente em DEV — nunca deploy de produção como parte do fechamento de uma subtarefa.
