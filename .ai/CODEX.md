# Instruções para Codex

Leia `.ai/PROJECT_RULES.md` e a checklist antes de editar. O backend existente é a fonte da verdade. A primeira entrega de uma área é sempre mapeamento e adaptadores de compatibilidade; componentes novos não podem chamar SQL, depender de segredos ou duplicar regra de autorização.

Use componentes pequenos e tipados. Em telas cliente, encapsule comunicação HTTP por domínio e normalize os erros sem alterar o contrato de origem. Não faça upgrade de framework ou instale dependências de fundação junto com uma migração de tela: essas decisões pertencem à Fase 2 e exigem aprovação.

No encerramento, registre comandos e resultados reais. Se push ou deploy DEV não estiverem disponíveis, documente o bloqueio e aguarde definição de infraestrutura, sem substituir DEV por produção.
