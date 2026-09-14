# Gate de fidelidade pedagógica da geração

**Status:** entrega inicial, reversível por configuração

## Objetivo

Garantir que uma questão nova só seja persistida quando a classificação de
`DOK` e `SOLO_EXPECTED` estiver sustentada pelo próprio item, e que um item
que pediu recurso visual não seja salvo sem esse recurso.

O gate não transforma automaticamente uma classificação em verdade
pedagógica. Ele reduz a falsa precisão: uma classificação aceita passa por
uma segunda revisão cega, evidencia o trecho que a sustenta e permanece uma
sugestão auditável até a revisão humana quando necessária.

## Fluxo

1. O modelo de geração cria a questão e declara DOK/SOLO esperado.
2. A resposta passa pelo schema e pelas regras estruturais já existentes.
3. Com o gate ativo, uma segunda chamada recebe apenas o enunciado, apoio,
   alternativas, resposta esperada e critérios. Ela **não recebe** os rótulos
   declarados na geração.
4. A revisão cega devolve DOK, SOLO, confiança e uma citação literal do item.
5. Confiança abaixo de `0,72`, evidência inventada ou DOK 4 em questão isolada
   fazem o parecer cego ser reparado; se persistirem, a geração é rejeitada.
6. A classificação cega substitui a justificativa e a evidência que serão
   persistidas no Motor de Classificações Pedagógicas. Se ela divergir do
   rótulo original, a divergência é registrada como aviso — não se força uma
   concordância artificial entre duas chamadas probabilísticas.

Essa separação impede que o mesmo rótulo gerado seja aceito sem confronto.
Ela não substitui aprovação humana para casos ambíguos; os critérios oficiais
continuam em `PEDAGOGICAL_CLASSIFICATION.md`.

## Recursos visuais obrigatórios

Com o gate ativo, `needsImage:true` é um contrato:

- a resolução tenta a cadeia existente (gráfico determinístico, Wikimedia e
  ilustração validada) até duas vezes;
- se nenhuma tentativa retorna um arquivo válido, a prova nova não é salva e
  uma regeneração não substitui a prova anterior;
- não há conversão silenciosa de `needsImage:true` para `false`.

O professor continua aprovando ou rejeitando a imagem na revisão. O gate só
garante que o recurso pedido exista e tenha passado pelo controle técnico de
qualidade antes de chegar à revisão.

## Ativação controlada

O comportamento é protegido por uma única variável de ambiente, desligada por
padrão:

```text
PEDAGOGICAL_QUALITY_GATE_ENABLED=true
```

Ela deve ser configurada individualmente em DEV e produção, nunca copiada
entre `.env.local`. Como a geração também pode acontecer pelo worker da fila,
aplicações web e worker do mesmo ambiente precisam ser recriados após alterar
a variável.

## Operação e evidências

Os contextos de telemetria relevantes são:

- `exams/generate` e `exams/regenerate`: geração e eventual reparo;
- `pedagogical/blind-generation-review`: segunda revisão cega;
- `images/validate-generated-image`: validação visual de imagem gerada.

Falha de classificação faz a geração retornar erro controlado depois das
tentativas limitadas, sem salvar uma prova parcial. Falha visual retorna 502
com os números das questões que não receberam imagem; uma regeneração mantém
o payload anterior intacto.

### Diagnóstico de falha visual

`images/generate-illustration` e `images/validate-generated-image` devem ser
consultados separadamente. Uma imagem pode ser gerada com sucesso e ainda ser
rejeitada se o validador visual estiver indisponível ou reprovar o arquivo.
Antes de desativar o gate, confirme em **IA → Quem faz o quê** que o perfil
ativo de **Conferência visual** responde no ambiente. O parser aceita tanto
JSON puro quanto JSON em bloco Markdown, mas qualquer resposta que não seja
um objeto JSON válido continua sendo recusada.

Para o perfil Gemini, a chamada declara também o schema estrutural completo
do parecer. Isso evita que uma justificativa com aspas ou Markdown produza um
JSON malformado e faça uma imagem válida parecer indisponível.

Na substituição de uma única questão, o número real do item é preservado
antes da revisão cega. Identificadores provisórios não chegam ao avaliador,
pois cada parecer precisa referir-se a uma questão existente e positiva.

Para trocar o validador com segurança, selecione um perfil já cadastrado,
faça uma geração de teste em DEV e confira os dois eventos de telemetria. A
troca de perfil é lida a cada operação; não exige migration nem reinício. Se
o novo perfil não responder, selecione o perfil anterior ou aplique o rollback
imediato abaixo.

## Rollback imediato

Não há migration, conversão de dados ou alteração irreversível nesta entrega.
Para desligar a exigência sem trocar código:

1. Ajustar apenas o `.env.local` do ambiente alvo para
   `PEDAGOGICAL_QUALITY_GATE_ENABLED=false`.
2. No ambiente alvo, recriar `web` e `worker` com Docker Compose. Os workers
   de OCR não precisam ser reiniciados.
4. Executar os smokes de login e das rotas protegidas.

Exemplo de produção:

```bash
docker compose up -d --build web worker
```

Se for necessário reverter também o código, usar `git revert` do commit desta
entrega via Pull Request e repetir build, restart e smokes. Não usar reset ou
force push nas branches compartilhadas.

## Limites conhecidos

- A revisão é cega em relação ao rótulo original, mas usa o perfil de texto
  configurado no ambiente. Uma futura evolução pode selecionar um provedor
  diferente para ampliar a independência de modelo.
- DOK e SOLO continuam sendo classificações de desenho da tarefa, não medida
  observada de dificuldade da turma.
- O gate não usa cotas inseridas pelo professor. A exigência segue série,
  segmento, currículo e os critérios normativos do sistema.
