# Fila de transcrição de scans

## Objetivo

Processar respostas discursivas escaneadas sem manter o navegador esperando
por cada leitura manuscrita. A fila é indicada para turmas grandes: o
professor envia as leituras, pode sair da tela e volta para conferir as
sugestões assim que estiverem prontas.

## Fluxo

1. O professor importa e processa os scans normalmente.
2. Na correção, escolhe **Enviar respostas para OCR** para um aluno, ou
   **Ler com OCR** em uma questão específica.
3. A aplicação cria um job `transcrever_scan` em `generation_jobs`. O payload
   contém apenas `examId`, `pageId` e a lista `questionNumbers`; quando uma
   página tem uma única questão, o formato legado `questionNumber` continua
   aceito. Nunca a imagem nem o texto manuscrito entram no payload.
4. `ocr-worker` recupera os jobs com `FOR UPDATE SKIP LOCKED`,
   baixa a imagem privada, recorta a questão, arquiva o recorte e executa a
   transcrição.
5. A tela de correção recebe eventos do banco e consulta um resumo autorizado
   da fila. A lista mostra `Transcrevendo X/Y` por aluno e a correção aberta
   mostra o estado de cada resposta discursiva. Uma leitura só é considerada
   ativa quando existe um job `pendente` ou `gerando` que cobre a questão;
   um código antigo na leitura, sem job correspondente, vira pendência de
   revisão manual.
6. Uma transcrição legível é usada como preenchimento provisório da correção
   pendente, mas nunca substitui uma resposta ou nota já digitada pelo
   professor. A aprovação permanece bloqueada enquanto houver OCR ativo ou
   resposta sem leitura que ainda precise de revisão.

## Estados visíveis

- `OCR_QUEUED`: aguardando um worker.
- `OCR_PROCESSING`: worker lendo o manuscrito.
- `OCR_DEFERRED`/`AI_BUDGET_DEFERRED`: aguardando nova janela do provedor.
- transcrição sugerida: pronta para conferência e ajuste do professor.
- `OCR_UNREADABLE` ou falha do provedor: a imagem continua disponível e a
  leitura pode ser tentada novamente.

## Operação

O serviço `ocr-worker` do `docker-compose.yml` executa o worker de
transcrição. A concorrência é segura porque o claim atômico impede que duas
instâncias peguem o mesmo job. Cada job conserva o retry padrão da fila. Jobs
interrompidos por reinício são reenfileirados após 15 minutos, respeitando o
limite de tentativas. Quando o job termina sem resultado, as leituras não ficam
presas em `OCR_PROCESSING`: passam para `OCR_INTERRUPTED` e ficam disponíveis
para nova tentativa ou decisão manual.

Para diagnosticar em produção:

```bash
docker compose ps ocr-worker
docker compose logs --tail=100 ocr-worker
```

A entrega inclui as migrations `0040_scan_transcription_queue_indexes.sql` e
`0041_scan_transcription_liveness.sql`. A segunda separa o QR detectado de
outra prova da associação oficial, impede dois jobs ativos para a mesma página
e instala a proteção de integridade entre upload e correção. Para auditar ou
reparar estados antigos, use primeiro o modo de simulação e depois `--apply`:

```bash
npm run scan:reconcile
npm run scan:reconcile -- --apply
```

## Agrupamento e segurança

Questões discursivas da mesma página são recortadas localmente e enviadas em
uma única chamada visual. O retorno é separado por questão antes de salvar,
mantendo revisão, evidência e retry independentes. Uma resposta ilegível não
é inventada: permanece como pendência para conferência humana.
