# Cartão-resposta - importação privada do scan

**Status:** publicado em DEV. A migration `0021`, o staging privado e a raiz
do Drive foram configurados; a interface de professor em
`/gerar/:examId/corrigir/scans` permite selecionar vários arquivos e acompanhar
o arquivamento de cada um. Esta etapa não faz QR/OMR/OCR, não abre arquivos em URL pública
e não chama n8n até o workflow HMAC estar configurado.

## Endpoint e escopo

```text
POST /api/exams/:examId/scans
Content-Type: multipart/form-data
campo: scan
```

Somente professor atribuído, coordenação ou direção podem importar. A prova
precisa estar `aplicado` ou `corrigido`. O endpoint aceita PDF, PNG e JPEG
produzidos pelo scanner, até 50 MB. HEIC, fotos de celular, arquivo vazio,
assinatura desconhecida e imagens menores que 1200 px em qualquer lado são
rejeitados antes de chegar ao staging.

`GET /api/exams/:examId/scans` oferece à futura fila de revisão apenas estado,
hash, metadados técnicos e datas. Não expõe caminho de staging, `driveFileId`,
URL de preview ou bytes do scan.

Na interface, o professor pode selecionar de uma vez todas as páginas geradas
pelo scanner. O navegador as envia uma por vez ao mesmo endpoint: cada página
ganha seu próprio hash, registro de auditoria e objeto privado no Drive. Uma
falha é apresentada pelo nome do arquivo e não interrompe as demais páginas.

Depois, o professor só escolhe **Enviar para processamento** para cada arquivo
com estado `archived`. Isso evita que um arquivo ainda no staging ou com hash
não conferido alcance o n8n.

## Armazenamento e integridade

```text
browser autenticado
  -> staging privado (0600, nome opaco, SHA-256)
  -> tabela exam_scan_uploads + auditoria
  -> pasta privada no Drive
  -> download do próprio Drive e nova verificação SHA-256
  -> apagar staging
  -> estado archived
```

O Drive é uma raiz dedicada, não o serviço de imagens pedagógicas. O código
não cria `permissions`, links públicos ou previews. O nome do arquivo no Drive
usa somente ID de upload e prefixo do hash; nome/e-mail do aluno não entram no
arquivo, log ou caminho.

Se o arquivamento falhar, ou se o staging não puder ser expurgado após o hash
conferir, a linha fica `archive_failed`, recebe evento de auditoria e **não** é
enviada ao n8n. O staging só é removido depois da cópia remota conferir com o
mesmo SHA-256.

## Configuração necessária em DEV

```text
SCAN_STAGING_DIR=/diretorio-fora-do-publico/prova-tri-scans
SCAN_DRIVE_ROOT_FOLDER_ID=<id-da-pasta-ou-drive-restrito-de-scans>
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=<credencial-ja-usada-pelo-servidor>
```

`SCAN_DRIVE_ROOT_FOLDER_ID` deve ser uma pasta ou Drive compartilhado com
acesso restrito ao serviço e aos revisores autorizados. Não reutilizar a pasta
de imagens de questões: ela possui um fluxo que concede leitura pública para
previews e é incompatível com letra manuscrita de alunos.

## Dados persistidos

Migration `0021` adiciona:

- `exam_scan_uploads`: tipo, tamanho, SHA-256, chave opaca de staging, estado,
  referência privada do Drive e metadados técnicos;
- `exam_scan_audit_events`: upload, arquivamento, falha e expurgo, sem bytes,
  QR, transcrição ou URL.

As futuras tabelas de páginas, leituras OMR/HTR e decisão docente permanecem
separadas. Assim, nenhuma leitura de scanner altera `exam_corrections.answers`
ou uma nota nesta etapa.

## Validação

Os testes cobrem PNG válido, PDF assinado por bytes, rejeição de HEIC e imagem
pequena. Em DEV, a conta de serviço foi confirmada com permissão de criação na
raiz privada e o staging usa permissões `0700`. O primeiro scan real ainda
deve confirmar upload, hash no Drive, ausência de permissões públicas e
expurgo da cópia de staging antes de ativar o n8n.
