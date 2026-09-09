/**
 * Smoke test end-to-end da fila de geração (Subtarefa 1a) contra o banco
 * local: enqueue → claim → complete/fail com retry → cancel/retry manual →
 * recuperação de job órfão. Não chama IA nenhuma — testa só o ciclo de
 * vida na tabela generation_jobs.
 *
 * Rodar: npm run test:generation-queue (precisa do prova-tri-postgres up).
 * Cria um usuário temporário e apaga tudo no fim (inclusive em caso de erro).
 *
 * ⚠️ Ambiente com worker vivo: o worker faz poll a cada 3s e pode reclamar
 * um job do teste antes dele (o teste então falha em voz alta, o que é o
 * comportamento desejado — melhor falhar que corromper em silêncio). Por
 * isso a disciplina usada é PROPOSITALMENTE inexistente: se o worker
 * vencer a corrida, `getCurriculumForExam` falha na resolução da aba e o
 * job morre barato, sem chamar a IA e sem criar prova de verdade. Nunca
 * trocar por disciplina real aqui.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'

function loadDatabaseUrlFromLocalEnv() {
  if (process.env.DATABASE_URL) return
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('DATABASE_URL='))
  if (!line) return
  process.env.DATABASE_URL = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

async function main() {
  loadDatabaseUrlFromLocalEnv()
  const { db } = await import('../src/db/client')
  const { generationBatches, generationJobs, users } = await import('../src/db/schema')
  const { enqueueGerarProvaBatch } = await import('../src/lib/queue/enqueue')
  const { claimNextJob, completeJob, failJob, requeueStaleJobs, cancelJob, retryJob } = await import('../src/lib/queue/claim')

  const testEmail = `queue-smoke-${Date.now()}@test.invalid`
  const [tempUser] = await db.insert(users).values({ name: 'Smoke Test Fila', email: testEmail, role: 'professor' }).returning()

  let batchId: number | null = null
  try {
    // 1) Enqueue: 2 disciplinas → 1 batch + 2 jobs pendentes
    const enqueued = await enqueueGerarProvaBatch(
      {
        segment: 'anos-finais',
        gradeYear: 8,
        academicYear: 2026,
        classLabel: '8º Ano Smoke',
        // Disciplinas inexistentes de propósito — ver aviso no cabeçalho.
        subjects: ['ZZ Smoke Test A', 'ZZ Smoke Test B'],
        config: { bimester: 2, questionCount: 14 },
      },
      tempUser.id,
    )
    batchId = enqueued.batchId
    assert.equal(enqueued.jobs.length, 2, 'batch deve criar 2 jobs')
    console.log(`✓ enqueue: batch #${batchId} com ${enqueued.jobs.length} jobs`)

    // 2) Claim: pega o primeiro (ordem de id), attempts incrementa no claim
    const job1 = await claimNextJob()
    assert.ok(job1, 'claim deve retornar um job')
    assert.equal(job1.requestedBy, tempUser.id)
    assert.equal(job1.attempts, 1, 'attempts conta a tentativa em curso')
    console.log(`✓ claim: job #${job1.id} (attempts=${job1.attempts})`)

    // 3) Complete
    await completeJob(job1.id, { resultRef: { warnings: [] } })
    const done = await db.query.generationJobs.findFirst({ where: eq(generationJobs.id, job1.id) })
    assert.equal(done?.status, 'concluido')
    assert.ok(done?.finishedAt, 'concluido deve ter finishedAt')
    console.log(`✓ complete: job #${job1.id} concluído`)

    // 4) Fail com retry: 1ª falha volta pra pendente, 2ª vira erro
    const job2a = await claimNextJob()
    assert.ok(job2a, 'segundo job deve estar disponível')
    const after1 = await failJob(job2a, 'falha simulada 1')
    assert.equal(after1, 'pendente', '1ª falha (attempts=1 < max=2) reenfileira')
    const job2b = await claimNextJob()
    assert.ok(job2b && job2b.id === job2a.id, 'retry deve reclamar o mesmo job')
    assert.equal(job2b.attempts, 2)
    const after2 = await failJob(job2b, 'falha simulada 2')
    assert.equal(after2, 'erro', '2ª falha esgota as tentativas')
    const errored = await db.query.generationJobs.findFirst({ where: eq(generationJobs.id, job2a.id) })
    assert.equal(errored?.status, 'erro')
    assert.equal(errored?.errorMessage, 'falha simulada 2')
    console.log(`✓ fail/retry: job #${job2a.id} pendente após 1ª falha, erro após 2ª`)

    // 5) Retry manual do erro: zera attempts e volta pra fila
    assert.equal(await retryJob(job2a.id), true, 'retry de job em erro deve funcionar')
    const retried = await db.query.generationJobs.findFirst({ where: eq(generationJobs.id, job2a.id) })
    assert.equal(retried?.status, 'pendente')
    assert.equal(retried?.attempts, 0)
    assert.equal(await retryJob(job1.id), false, 'retry de job concluído deve ser recusado')
    console.log(`✓ retry manual: job #${job2a.id} reenfileirado com attempts=0`)

    // 6) Cancel: só pendente cancela
    assert.equal(await cancelJob(job2a.id), true, 'cancelar job pendente deve funcionar')
    assert.equal(await cancelJob(job1.id), false, 'cancelar job concluído deve ser recusado')
    console.log(`✓ cancel: job #${job2a.id} cancelado, job concluído protegido`)

    // 7) Job órfão: 'gerando' velho volta pra fila (attempts < max) ou vira
    //    erro (attempts esgotados)
    await db.update(generationJobs)
      .set({ status: 'gerando', attempts: 1, startedAt: sql`now() - interval '30 minutes'`, finishedAt: null })
      .where(eq(generationJobs.id, job2a.id))
    const swept = await requeueStaleJobs(15)
    assert.equal(swept.requeued, 1, 'job órfão com tentativa sobrando deve ser reenfileirado')
    const requeued = await db.query.generationJobs.findFirst({ where: eq(generationJobs.id, job2a.id) })
    assert.equal(requeued?.status, 'pendente')

    await db.update(generationJobs)
      .set({ status: 'gerando', attempts: 2, startedAt: sql`now() - interval '30 minutes'` })
      .where(eq(generationJobs.id, job2a.id))
    const swept2 = await requeueStaleJobs(15)
    assert.equal(swept2.failed, 1, 'job órfão sem tentativa restante deve virar erro')
    console.log('✓ requeueStaleJobs: órfão reenfileirado com tentativa sobrando, erro sem')

    console.log('\nSmoke test da fila: TUDO OK ✅')
  } finally {
    // Limpeza total (jobs → batch → usuário), mesmo com falha no meio.
    if (batchId !== null) {
      await db.delete(generationJobs).where(eq(generationJobs.batchId, batchId))
      await db.delete(generationBatches).where(eq(generationBatches.id, batchId))
    }
    await db.delete(users).where(eq(users.id, tempUser.id))
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Smoke test da fila FALHOU:', err)
  process.exit(1)
})
