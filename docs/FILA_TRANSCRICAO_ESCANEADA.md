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
   contém apenas `examId`, `pageId` e `questionNumber`; nunca a imagem nem o
   texto manuscrito.
4. `prova-tri-scan-worker` recupera os jobs com `FOR UPDATE SKIP LOCKED`,
   baixa a imagem privada, recorta a questão, arquiva o recorte e executa a
   transcrição.
5. A tela de correção consulta o progresso a cada quatro segundos enquanto
   existir trabalho pendente e atualiza a evidência da correção aberta.
6. A sugestão aparece no campo da questão, ao lado do recorte. O professor
   ainda deve conferir e usar **Confirmar e usar na correção**; a fila não
   altera resposta formal, nota sugerida ou nota final.

## Estados visíveis

- `OCR_QUEUED`: aguardando um worker.
- `OCR_PROCESSING`: worker lendo o manuscrito.
- transcrição sugerida: pronta para conferência do professor.
- `OCR_UNREADABLE` ou falha do provedor: a imagem continua disponível e a
  leitura pode ser tentada novamente.

## Operação

O `ecosystem.config.js` inicia duas instâncias de `prova-tri-scan-worker` em
produção; o arquivo de DEV mantém duas instâncias equivalentes. A concorrência
é segura porque o claim atômico impede que duas instâncias peguem o mesmo job.
Cada job conserva o retry padrão da fila. Jobs interrompidos por reinício são
reenfileirados após 15 minutos, respeitando o limite de tentativas.

Para diagnosticar em produção:

```bash
pm2 status prova-tri-scan-worker
pm2 logs prova-tri-scan-worker --lines 100
```

Não há migration nesta entrega: `generation_jobs.job_type` é uma coluna de
texto; a adição de `transcrever_scan` atualiza a enumeração TypeScript e o
handler do worker.

## Limite desta etapa

Esta primeira versão paraleliza por resposta discursiva. O próximo ganho de
performance, se o volume/limite do provedor justificar, é agrupar os recortes
da mesma página em uma única chamada visual, mantendo a separação e a revisão
por questão.
