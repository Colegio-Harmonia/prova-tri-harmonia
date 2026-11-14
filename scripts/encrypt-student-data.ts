/**
 * Converte os dados de aluno já gravados para cifra (ver
 * docs/CRIPTOGRAFIA_DADOS_ALUNO.md). Por padrão é só um ENSAIO: conta o que
 * seria convertido e não grava nada. Para gravar: APPLY=true.
 *
 *   npm run encrypt-student-data              # ensaio
 *   APPLY=true npm run encrypt-student-data   # converte, numa transação
 *
 * Exige STUDENT_DATA_KEY e DATABASE_URL (lidos do ambiente ou do .env.local).
 * Idempotente. FAÇA BACKUP DO BANCO ANTES de rodar com APPLY=true.
 */
import fs from 'node:fs'
import path from 'node:path'

function loadFromLocalEnv(names: string[]) {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (!match || !names.includes(match[1]) || process.env[match[1]]) continue
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
}

async function main() {
  loadFromLocalEnv(['DATABASE_URL', 'STUDENT_DATA_KEY'])
  const apply = process.env.APPLY === 'true'
  const { db } = await import('../src/db/client')
  const { backfillStudentData } = await import('../src/lib/security/studentDataBackfill')

  const report = await db.transaction((tx) => backfillStudentData(tx, { apply }))
  console.log(apply ? 'CONVERSÃO APLICADA' : 'ENSAIO (nada foi gravado; use APPLY=true para converter)')
  for (const table of report.tables) {
    console.log(`  ${table.table}: ${table.rows} linhas | a cifrar ${table.valuesEncrypted} | já cifrados ${table.valuesAlreadyEncrypted} | índices a atualizar ${table.hashesUpdated}`)
  }
  console.log(`Valores ainda em texto puro no banco: ${report.plaintextRemaining}`)
  if (apply && report.plaintextRemaining > 0) {
    console.error('Sobrou texto puro depois da conversão: rode de novo e investigue antes de considerar concluído.')
    process.exitCode = 1
  }
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((error) => {
  // A mensagem não inclui valores de aluno.
  console.error('Falha na conversão:', error instanceof Error ? error.message : error)
  process.exit(1)
})
