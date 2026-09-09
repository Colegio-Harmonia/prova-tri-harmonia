/**
 * Espelha localmente o acervo público INEP que corresponde ao banco ENEM
 * importado: microdados completos e cadernos/gabaritos da aplicação regular.
 *
 * Por padrão, baixa 2009–2025 em referencias/inep/enem-archive/.
 * Não baixa variantes ampliadas, braile/ledor, Libras, digital ou PPL, para
 * evitar duplicar o mesmo conteúdo pedagógico em dezenas de formatos.
 *
 * Uso:
 *   npm run download-inep-enem-archive
 *   YEARS=2022,2023 npm run download-inep-enem-archive
 *   DEST_DIR=/caminho/externo npm run download-inep-enem-archive
 */
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const years = (process.env.YEARS ?? '2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter(Number.isInteger)
const destination = process.env.DEST_DIR ?? 'referencias/inep/enem-archive'
// Em 2025, D3/D4 correspondem à aplicação específica de Belém e D5/D6 à
// reaplicação; o acervo base usa a aplicação nacional D1/D2.
const ignoredVariant = /ampliad|superampliad|braile|ledor|libras|reaplica|ppl|digital|_D[3-6]_CD/i
const run = promisify(execFile)

async function download(url: string, filePath: string) {
  if (existsSync(filePath)) return 'preservado'
  const temporaryPath = `${filePath}.partial`
  try {
    await run('curl', ['-Lsk', '--fail', '--retry', '3', '--retry-delay', '2', '-o', temporaryPath, url], { maxBuffer: 1024 * 1024 })
    renameSync(temporaryPath, filePath)
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    throw error
  }
  return 'baixado'
}

async function officialRegularLinks(year: number) {
  const page = `https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem/provas-e-gabaritos/${year}`
  const { stdout: html } = await run('curl', ['-Lsk', '--fail', '--retry', '3', '--retry-delay', '2', page], { maxBuffer: 1024 * 1024 * 20 })
  const all = [...html.matchAll(/href="(https?:\/\/download\.inep\.gov\.br\/[^"?#]+\.pdf)"[^>]*>(?:\s|&nbsp;)*(Prova|Gabarito)/gi)]
    .map((match) => match[1].replace(/^http:/, 'https:'))
    .filter((url) => !ignoredVariant.test(url))
  return [...new Set(all)]
}

async function main() {
  for (const year of years) {
    const yearDir = join(destination, String(year))
    const microdataDir = join(yearDir, 'microdados')
    const proofsDir = join(yearDir, 'provas-gabaritos-regular')
    mkdirSync(microdataDir, { recursive: true })
    mkdirSync(proofsDir, { recursive: true })

    const microdataUrl = `https://download.inep.gov.br/microdados/microdados_enem_${year}.zip`
    const microdataPath = join(microdataDir, `microdados_enem_${year}.zip`)
    try {
      console.log(`${year}: microdados ${await download(microdataUrl, microdataPath)}`)
    } catch (error) {
      console.warn(`${year}: microdados indisponíveis — ${error instanceof Error ? error.message : error}`)
    }

    try {
      const links = await officialRegularLinks(year)
      let downloaded = 0
      let preserved = 0
      for (const link of links) {
        const outcome = await download(link, join(proofsDir, basename(new URL(link).pathname)))
        if (outcome === 'baixado') downloaded++
        else preserved++
      }
      console.log(`${year}: ${downloaded} prova(s)/gabarito(s) baixado(s), ${preserved} preservado(s)`)
    } catch (error) {
      console.warn(`${year}: cadernos/gabaritos indisponíveis — ${error instanceof Error ? error.message : error}`)
    }
  }
}

main().catch((error) => {
  console.error('Falha ao baixar acervo ENEM do INEP:', error)
  process.exit(1)
})
