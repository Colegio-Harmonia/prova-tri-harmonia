# Fase 6 - Relatórios Avançados

## Objetivo

Organizar a leitura institucional sem ampliar a visão de cada papel, padronizar
os resultados em percentual e permitir análise pontual de simulados ENEM sem
reter arquivos externos.

## Permissões confirmadas

`GET /api/analytics/performance` parte de correções `revisado` e aplica o
escopo no servidor antes da agregação:

- professor recebe apenas provas atribuídas a ele por `assignedTo`;
- coordenação e direção são superusuários e recebem a visão institucional;
- a origem da correção não é critério de visibilidade: tanto alunos
  importados do Google Classroom quanto alunos cadastrados manualmente entram
  quando pertencem a uma prova dentro do escopo;
- o filtro individual `student` é aplicado depois do mesmo escopo de prova,
  portanto não permite consultar aluno de outro professor por URL.

## Visões institucionais

Coordenação e direção possuem submenu em **Desempenho** e abas na tela para:

1. visão geral;
2. análise Bloom, com recomendações por nível abaixo de 60% e ao menos seis
   itens;
3. análise DOK, com recomendações por profundidade abaixo de 60% e ao menos
   seis itens;
4. análise BNCC, com recomendações para habilidades em intervenção;
5. perfis cognitivos, filtráveis por segmento, série, ano, bimestre, docente
   e nome do aluno.

Recomendações são regras transparentes e pedagogicamente revisáveis. Não
fazem diagnóstico, previsão ou classificação permanente de um aluno.

## Percentual e aprovação

A interface executiva exibe desempenho de `0%` a `100%`. A referência
institucional informada é **60%**. A nota original em escala 0-10 continua
existindo no dado de correção; o percentual é sua apresentação multiplicada
por dez. Esse limiar orienta leitura e intervenção, não altera automaticamente
o status acadêmico de um aluno.

## Relatório individual

Cada perfil possui **Abrir relatório**. A rota protegida apresenta o dossiê
individual e oferece **Imprimir / Salvar em PDF**, usando o diálogo nativo do
navegador. Não há link público, envio automático a responsáveis ou alteração
de dados. O compartilhamento é uma ação deliberada da equipe autorizada.

## Simulado ENEM externo

`/desempenho/simulado-enem` é restrito a coordenação e direção. O CSV é lido
somente no navegador e nunca enviado, persistido ou incluído no relatório
interno. O modelo aceita:

```text
nome;email;linguagens;matematica;natureza;humanas;redacao
```

Também aceita LC, MT, CN e CH. Notas entre 0 e 100 permanecem percentuais;
notas entre 0 e 1000 são divididas por dez para a leitura percentual. O
arquivo pode ser impresso ou salvo como PDF localmente.

## Limites

- Histórico de importações ENEM, consolidação com perfil interno e envio
  automático para responsáveis exigem política de retenção, consentimento e
  decisão de produto antes de persistir dados externos.
- O relatório individual agrupa por nome, pois aluno ainda não tem cadastro
  próprio no produto; homônimos continuam uma limitação conhecida.
- Relatórios continuam calculados na requisição; acompanhar TD-005 ao crescer
  o volume de correções.

## Validação e publicação

A extensão passou por lint, TypeScript, build e auditoria de dependências de
produção. Em DEV, uma sessão de coordenação validou todas as visões, a rota de
relatório individual, o simulador ENEM, o recorte por período e a rejeição de
bimestre inválido. Em produção, o candidato isolado e o smoke pós-corte
confirmaram login em 200, rotas protegidas em 307, PM2 online e log limpo.
A autenticação de produção não foi usada para teste funcional; a sessão
autenticada de referência foi validada no DEV isolado.
