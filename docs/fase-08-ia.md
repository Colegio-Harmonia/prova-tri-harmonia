# Fase 8 - IA

## Subtarefa 8.1 - Diagnóstico e contrato de transparência

**Status:** Subtarefas 8.1 a 8.6 concluídas, documentadas e publicadas em DEV
e produção em 22/07/2026. A extensão 8.7 de governança de modelos foi
publicada em produção na v0.8.3 em 22/07/2026.

## Objetivo

Tornar os fluxos assistidos por IA compreensíveis, controláveis e seguros sem
atribuir decisão pedagógica, nota final ou diagnóstico individual ao modelo.
Esta subtarefa inventaria o comportamento atual e fixa o contrato para as
entregas posteriores; não altera endpoints, banco, autenticação nem envia uma
chamada real ao provedor.

## Inventário atual

| Fluxo | Serviço | Proteção atual | Decisão humana |
| --- | --- | --- | --- |
| Gerar prova | `exams/generate` | schema, validação curricular e até 2 tentativas | professor revisa antes de aprovar |
| Regenerar prova/questão | `exams/[examId]/regenerate*` | schema, validação e estado editável | revisor aceita, edita ou troca novamente |
| Sugerir nota discursiva | `corrections/.../suggest` | redação básica de PII e concorrência 2 | professor confirma ou altera nota final |
| Classificar SOLO observado | `soloObservedClassificationService` | schema, redação básica de PII e revisão posterior | classificação não sobrescreve revisão humana |
| Extrair dados para gráfico | `chartRender` | schema estruturado | imagem continua em revisão do professor |

## Contrato obrigatório

- IA é assistiva: nenhuma resposta pode aprovar prova, lançar nota ou definir
  diagnóstico individual sem ação humana explícita.
- Prompt, resposta bruta, chave, token de sessão, nome de aluno e resposta de
  aluno não podem entrar em telemetria, log ou documento de produto.
- Erros do provedor devem ser exibidos como falha operacional, nunca como erro
  pedagógico do aluno ou do professor.
- Conteúdo gerado precisa manter origem, modelo, versão do prompt, tentativas
  e aviso de reparo visíveis ao responsável quando aplicável.
- Explicações de desempenho continuam determinísticas enquanto não houver
  contrato específico de IA com revisão humana, orçamento e retenção.

## Baseline técnico

- O cliente DeepSeek usa timeout de 120 segundos, `max_tokens` de 32768 e
  resposta JSON estruturada.
- `structuredRepair` bloqueia persistência após até duas respostas inválidas.
- O provedor pode retornar `usage` (tokens de prompt, completion e total), mas
  o produto ainda não persiste nem consolida esses dados.
- A disponibilidade de `DEEPSEEK_API_KEY` é validada na geração; o DEV mantém
  essa chave desabilitada para não consumir crédito em smoke tests.

## Próximas subtarefas

| ID | Entrega | Critério de aceite |
| --- | --- | --- |
| 8.2 | telemetria privada de operações | concluída: `ai_operations` registra contexto, modelo, duração, tentativas, tokens retornados e falha, sem prompt/resposta/dados do aluno |
| 8.3 | painel operacional para coordenação/direção | concluída: `/ia` apresenta uso, falhas e reparos sem conteúdo pedagógico; professor não acessa os dados institucionais |
| 8.4 | transparência no fluxo | concluída: geração, revisão e sugestão de correção deixam explícita a origem assistida e a necessidade de decisão humana |
| 8.5 | orçamento e degradação segura | concluída e validada no DEV: limite diário configurável, falha legível e nenhuma persistência parcial quando IA indisponível |
| 8.6 | validação e promoção | concluída: testes sem chamada real, smoke DEV e produção, documentação de privacidade e limites registrados |
| 8.7 | governança de modelos e custos | concluída: perfis ativos por finalidade, consumo por versão e custo estimado no painel institucional |

## Limites e decisão pendente

Uma tabela de telemetria é alteração de banco e depende da decisão de
arquitetura a ser registrada antes da 8.2, pois a constituição atual do projeto
proíbe mudança de schema dentro de uma frente apenas visual. Até essa decisão,
o produto não deve prometer custo exato por usuário, aluno ou professor.

## Telemetria 8.2

`ai_operations` guarda uma linha por tentativa do modelo, com `operation`,
provedor, modelo, estado (`succeeded`, `rejected` ou `failed`), tentativa,
tokens retornados, duração e uma categoria de erro. O estado `rejected`
significa que a resposta chegou, mas foi bloqueada pelo schema ou pela
validação semântica e seguiu para reparo; ele não indica erro do professor.

O cliente direto de extração de dados para gráfico e todos os fluxos que usam
`structuredRepair` são cobertos. A tabela não possui prompt, resposta,
identificador de aluno, nome, nota, chave ou mensagem bruta do provedor.

A gravação é observabilidade de melhor esforço: falha na tabela não interrompe
geração, correção ou revisão. A migration `0010_ai_operations.sql` deve ser
aplicada uma vez em cada banco antes de ativar o código.

### Validação DEV

O candidato compilou as 32 páginas, a tabela foi criada vazia no banco DEV e a
troca atômica manteve login em `200`, dashboard anônimo em `307` e geração
anônima em `307`. A chave de IA segue desabilitada no DEV; portanto nenhum
crédito foi consumido e uma linha real de telemetria não foi fabricada só para
teste.

### Produção

A v0.8.0 foi publicada por troca atômica. A migration criou `ai_operations`
vazia, login público respondeu `200`, dashboard sem sessão respondeu `307` e
o PM2 permaneceu online sem nova entrada no log de erro. Não foi feita chamada
ao DeepSeek apenas para povoar a tabela; o primeiro evento deve decorrer de
uma operação pedagógica real e revisável.

## Painel operacional 8.3

`/ia` é restrito à coordenação/direção superusuária. Exibe, para as últimas
operações, o tipo de fluxo, provedor, modelo, estado, tentativa, tokens,
duração, categoria de erro e data. Não retorna prompt, resposta, identificador
de aluno, nome, nota nem texto pedagógico. Professor recebe bloqueio de
permissão na API e não possui entrada de navegação para o painel.

## Transparência 8.4

- A confirmação anterior à geração declara que a IA produz um rascunho e exige
  revisão de enunciado, gabarito, dificuldade e imagens antes da aprovação.
- A tela de revisão contém um aviso persistente sobre conferência de
  alternativas, habilidades e imagens; imagens conservam a indicação de
  origem e a ação explícita de aprovação ou rejeição.
- A sugestão de nota discursiva usa aviso destacado de que não é nota final e
  orienta conferir a resposta antes de salvar.
- Não houve alteração na regra de aprovação, na nota persistida, no RBAC ou no
  conteúdo enviado ao provedor.

### Produção v0.8.1

A publicação ocorreu por candidato isolado e troca atômica. O build compilou
34 rotas com lint e TypeScript aprovados; login público respondeu `200`,
dashboard e `/ia` sem sessão responderam `307`, e a API administrativa sem
sessão respondeu `401`. O PM2 permaneceu online sem nova linha de erro. A
validação visual autenticada do painel e dos avisos continua uma conferência
operacional por papel, pois o smoke de produção não usa conta real.

## Orçamento e degradação 8.5

- `AI_DAILY_OPERATION_BUDGET` define o máximo diário de chamadas externas de
  IA por processo de produto. O padrão é `50`, contado em UTC; `0` só desativa
  o teto quando configurado explicitamente no ambiente.
- O contador usa as tentativas persistidas em `ai_operations` e reserva a vaga
  em memória antes da chamada, evitando que requisições concorrentes excedam
  o limite no mesmo processo. Uma recusa por orçamento é registrada sem
  consumir a cota e sem expor conteúdo.
- Geração, regeneração, troca de questão, sugestão de nota, extração de dados
  para gráfico, geração de imagem e validação visual passam pelo mesmo limite.
- Limite atingido responde `429`; indisponibilidade do provedor responde
  `503`. Ambos deixam explícito que nada foi salvo.
- Sugestões de nota são atômicas: se qualquer questão falhar, nenhuma nova
  sugestão é persistida. Nota final, aprovação e conteúdo já existente nunca
  são modificados pela falha.
- O painel operacional continua exibindo apenas metadados da tentativa. A
  telemetria não armazena prompt, resposta, imagem, nome ou resposta de aluno.

### Produção v0.8.2

O candidato compilou 34 rotas com os testes, lint e TypeScript aprovados. Após
a troca atômica, login público respondeu `200`, dashboard e `/ia` sem sessão
responderam `307`, a API administrativa sem sessão respondeu `401` e o PM2
permaneceu online sem nova linha de erro. O teto padrão está ativo; não houve
chamada artificial aos provedores para consumir a cota ou gerar telemetria.

## Validação final 8.6

- As entregas 8.1 a 8.5 passaram por lint, TypeScript, build, smoke em
  candidato isolado e troca atômica em DEV e produção.
- A telemetria, o painel e o orçamento foram verificados sem gravar prompts,
  respostas, imagens ou dados de aluno e sem fabricar uma chamada paga.
- A chave de IA segue desabilitada no DEV. A validação autenticada de uma
  chamada real, do bloqueio diário e da visualização do painel deve usar uma
  chave segregada, com orçamento próprio, antes de qualquer teste de carga.
- A Fase 8 não transforma IA em decisão pedagógica: aprovação de prova e nota
  final continuam dependendo de ação humana explícita.

## Governança de modelos e custos 8.7

- A migration aditiva `0011_ai_model_governance.sql` cria `ai_model_profiles`.
  Cada perfil define finalidade, provedor, versão, estado ativo, limite de
  tokens e preços estimados de entrada, saída ou imagem.
- O painel `/ia`, acessível apenas à gestão, permite cadastrar e ativar o
  perfil de texto, geração de imagem ou validação visual. Credenciais continuam
  exclusivamente em variáveis de ambiente e nunca são exibidas ou persistidas.
- As operações passam a registrar o perfil selecionado e o custo estimado. O
  valor é uma estimativa dependente da tabela de preços configurada, não uma
  cobrança do provedor.
- A publicação v0.8.3 cadastrou quatro perfis, sendo três ativos. Um perfil
  Claude permanece desativado até a instalação de adaptador e chave válidos;
  não há promessa de geração de imagem Claude sem esse suporte.

### Produção v0.8.3

O candidato recebeu a migration, compilou com teste de telemetria, lint,
TypeScript e build aprovados. Após a troca atômica, `/login` respondeu `200`,
`/dashboard` e `/ia` sem sessão responderam `307`, e a API de modelos anônima
respondeu `403`. O banco confirmou quatro perfis e a aplicação pública seguiu
respondendo normalmente. Nenhuma chamada paga foi criada para popular consumo
ou custo.

## Provedores OpenAI 8.8

- `gpt-4.1-mini` é disponibilizado como perfil de reserva para geração de
  texto estruturado. Quando ativado, usa a API de chat da OpenAI e conserva a
  validação JSON/Zod, limite diário e telemetria já existentes.
- `dall-e-3` e `chatgpt-images-2-0` são disponibilizados como perfis de
  reserva para geração de imagens didáticas. O prompt continua proibindo texto
  instrucional dentro da arte e o resultado segue para o validador visual antes
  da revisão docente.
- O adaptador envia `response_format=b64_json` somente para DALL·E. Perfis GPT
  Image retornam base64 pelo contrato padrão e rejeitam esse parâmetro legado;
  isso evita que uma imagem obrigatória interrompa a criação da atividade.
- Ambos requerem `OPENAI_API_KEY` somente no ambiente. A gestão deve informar
  o preço contratado no perfil antes de ativá-lo para que o painel estime o
  custo por operação.

## Qualidade de imagens com texto 8.9

- Imagens que precisam conter texto literal só seguem para geração quando o
  revisor informa o texto exato. O fluxo exige perfil OpenAI/DALL-E ativo e
  ignora busca externa, pois ela não garante a redação solicitada.
- Claude é integrado como visão para validar o resultado, não como gerador de
  imagem. A aprovação automática exige painel completo, texto legível e
  correspondência com o texto pedido; qualquer falha retém a imagem fora da
  revisão docente.
- MCP Inspector é ferramenta local de desenvolvimento para testar servidores
  MCP; ele não participa da decisão de qualidade em produção.
