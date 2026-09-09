# Banco ENEM oficial, TRI e imagens

Atualizado em 26/07/2026.

## Contrato de pontuação

- A nota TRI é calculada exclusivamente com itens reais do banco ENEM que
  tenham os parâmetros oficiais INEP `a`, `b` e `c` importados dos
  microdados.
- O resultado também informa quantos itens calibrados entraram no cálculo;
  o percentual geral continua incluindo todas as objetivas válidas.
- Questões autorais ou geradas por IA não recebem parâmetros inventados nem
  influenciam a TRI INEP. Quando houver uma estimativa pedagógica interna,
  ela é declarada como aproximação e não como nota oficial do ENEM.
- O SAE ENEM externo é apenas ferramenta de análise visual: não integra
  geração, correção, banco ou calibração.

## Fonte e cobertura publicada

| Recorte | Fonte | Conteúdo |
| --- | --- | --- |
| 2009-2023 | banco ENEM e microdados INEP já importados | itens e parâmetros oficiais disponíveis conforme o casamento item-gabarito |
| 2024 | PDFs e microdados oficiais INEP | 122 questões textuais, mais 56 questões visuais com recorte oficial; parâmetros 3PL importados quando publicados |
| 2025 | PDFs e microdados oficiais INEP | 116 questões textuais, mais 41 questões visuais com recorte revisado; parâmetros 3PL importados quando publicados |

Os recortes não substituem o PDF oficial: `raw_json` preserva ano, índice,
URL e página de origem. Itens sem um recorte individual verificável ficam
fora até serem revisados, nunca são publicados com imagem improvisada.

## Imagens ENEM

Os recortes revisados ficam no Drive compartilhado, organizados por ano em
`Imagens ENEM/<ano>` (41 em 2025 e 56 em 2024). Configure
`DRIVE_ENEM_IMAGES_FOLDER_ID` com o ID da pasta canônica `Imagens ENEM`; assim,
os importadores gravam diretamente em `<pasta canônica>/<ano>` e não criam uma
segunda pasta homônima. Cada arquivo é público apenas
para a exibição da questão. O banco guarda a URL de thumbnail e o identificador
do arquivo; não duplica os binários no PostgreSQL. Isso permite que prova,
revisão e documentos usem o mesmo ativo.

O script `npm run import-enem-official-visuals` é o vínculo idempotente entre
o PDF, o gabarito e esses ativos. Sem `APPLY=true`, ele apenas valida a
extração. Com `APPLY=true`, faz insert/update das 41 questões visuais. O
manifesto de IDs está no próprio script para tornar a publicação auditável.

Para um ano cujas imagens vêm diretamente dos PDFs oficiais, usar
`npm run import-enem-official-pdf-crops`. Ele gera os recortes, envia-os ao
Drive e faz o upsert somente depois de obter o ID do arquivo. Quando as cinco
alternativas forem gráficos ou desenhos sem texto extraível, o importador cria
um recorte integral da questão, na ordem das colunas do caderno, e mantém o
gabarito oficial — sem OCR inventado para as opções visuais.

## Recorte na atividade de reforço

A tela **Reforço ENEM** permite selecionar `Ano das questões ENEM`. Em
`Todos os anos`, a seleção continua ampla; escolhendo, por exemplo, `2025`,
todas as questões vêm exclusivamente daquela edição. O filtro considera
também os recortes visuais oficiais, para que mapas, gráficos e tiras possam
ser usados na atividade e na revisão.

## Rotina de importação por ano

1. Baixar o material oficial no diretório ignorado
   `referencias/inep/enem-archive/<ano>/provas-gabaritos-regular` e os
   microdados do mesmo ano.
2. Validar, sem escrever: `YEARS=<ano> npm run import-enem-official-pdfs`.
3. Importar o texto: `APPLY=true YEARS=<ano> npm run import-enem-official-pdfs`.
4. Extrair e revisar visualmente gráficos, mapas, tabelas, tiras e figuras.
   Salvar no Drive em `Imagens ENEM/<ano>` antes de vinculá-los ao banco.
5. Importar parâmetros: `APPLY=true YEARS=<ano> npm run import-tri-params`.
6. Executar o importador visual do ano somente depois da revisão humana dos
   recortes. Para 2025, `APPLY=true npm run import-enem-official-visuals`; para
   recortes extraídos diretamente do PDF, `APPLY=true YEARS=<ano> npm run import-enem-official-pdf-crops`.
7. Conferir contagem, URLs de thumbnail, gabarito e uma atividade gerada.

### Correção de extração de caderno (26/07/2026)

O extrator recorta cada questão na sua posição física de coluna e página antes
de identificar as alternativas. Essa regra impede que o rodapé do caderno ou
o início de outra questão se tornem parte da alternativa E. A validação de
2024 e 2025 verifica que nenhuma alternativa contém cabeçalhos `ENEM`,
`CADERNO` ou um texto anormalmente longo.

Para corrigir conteúdo já importado sem criar item visual ainda não revisado,
usar o modo de atualização preservando os arquivos que já estavam associados:

```bash
APPLY=true REFRESH_EXISTING_VISUAL=true YEARS=2024,2025 npm run import-enem-official-pdfs
APPLY=true npm run import-enem-official-visuals
```

Todo item marcado como visual só pode ser selecionado para uma atividade se
tiver arquivo oficial associado. Portanto, a correção nunca entrega um gráfico
ou mapa sem seu recorte no Drive.

## Segurança e rollback

- PDFs, microdados, credenciais e `.env.local` não são versionados.
- Os imports são upserts pela restrição `uq_question`; reexecutá-los não
  duplica questões.
- Para reverter um lote de ano, primeiro exportar as linhas afetadas e então
  remover somente `source='enem' AND year=<ano>` após autorização explícita.
  Nunca restaurar a base inteira de produção para desfazer um import.
- Migrações do projeto legado são aplicadas manualmente com `psql` no
  container PostgreSQL, pois o journal do Drizzle não é confiável neste
  repositório.
