# Diretrizes de UX/UI

## Princípios de fluxo

- Uma tela deve deixar claro onde o usuário está, o que pode fazer agora e o que acontecerá depois.
- Preservar progresso em tarefas longas, com autosave somente quando o contrato suportar persistência segura.
- Operações irreversíveis, como devolver notas ao Classroom, exigem confirmação com consequência explícita.
- Ações assíncronas mostram progresso, sucesso e falha no lugar onde foram disparadas; não usar apenas alertas genéricos.
- Usar linguagem direta: "Gerar prova", "Enviar notas", "Revisão concluída"; evitar jargão técnico na UI.

## Fluxos prioritários

1. Gerar prova: contexto curricular, configuração, prévia, geração, revisão e próximo passo.
2. Revisar prova: navegação por questão, evidência pedagógica, salvar alterações e transição de status.
3. Corrigir turma: seleção de prova, importação de alunos, correção, conferência e devolução de notas.
4. Desempenho: filtro, leitura de evidência, limitação da amostra e ação pedagógica sugerida.

## Acessibilidade

Meta mínima WCAG 2.2 AA. O fluxo completo deve funcionar por teclado, com ordem de foco previsível, contraste suficiente, rótulos programáticos, mensagens de erro anunciáveis e sem depender exclusivamente de animação ou cor.

## Movimento

Animação só esclarece mudança de contexto, progresso ou hierarquia. Respeitar `prefers-reduced-motion`; evitar transições que atrasem uma ação frequente.
