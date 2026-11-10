# Worker privado de leitura óptica

O n8n só orquestra o trabalho. Este serviço privado recebe um despacho opaco,
baixa o scan pela API interna autenticada e devolve o resultado estruturado.
Não expõe arquivos, QR, alunos ou respostas em logs.

## Escopo inicial

- imagem JPG, PNG ou PDF de uma página;
- normalização pelos quatro marcadores PTR1;
- QR assinado e rotação de 180 graus;
- leitura de até 15 respostas objetivas PTR1/PTR2/PTR3, conforme o layout assinado no QR;
- retorno de ambiguidades para decisão docente.

Páginas discursivas e OCR/HTR permanecem deliberadamente fora deste serviço
inicial. Elas devem ser tratadas em uma etapa posterior, sempre com imagem e
confirmação do professor.

PTR2/PTR3 conservam os marcadores, o QR e o diâmetro das bolhas do PTR1, com
linhas mais próximas. PTR3 também aproxima a identificação do cabeçalho e sobe
o gabarito. Atualize este worker antes de habilitar emissões PTR3 na aplicação.
Cartões PTR1/PTR2 já emitidos continuam sendo lidos com as coordenadas originais.

## Variáveis obrigatórias

`PROVATRI_INTERNAL_BASE_URL`, `N8N_SCAN_SHARED_SECRET` e
`SCAN_WORKER_TOKEN`. Os três valores ficam apenas no servidor; nenhum entra no
repositório, no workflow exportado ou em logs.
