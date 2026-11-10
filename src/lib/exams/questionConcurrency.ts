// Cada vaga acompanha uma questão por todo o ciclo, da criação do enunciado à aprovação.
export const QUESTION_GENERATION_CONCURRENCY = 3

/** Processes ordered items in bounded batches and stops before starting later batches on error. */
export async function mapInBatches<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency = QUESTION_GENERATION_CONCURRENCY,
): Promise<R[]> {
  const width = Math.max(1, Math.floor(concurrency))
  const results: R[] = []
  for (let offset = 0; offset < items.length; offset += width) {
    const batch = await Promise.allSettled(items.slice(offset, offset + width).map(worker))
    const failure = batch.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
    results.push(...batch.map((result) => (result as PromiseFulfilledResult<R>).value))
  }
  return results
}

/** Pool contínuo: registra falhas por item e mantém as demais tarefas em execução. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = QUESTION_GENERATION_CONCURRENCY,
): Promise<PromiseSettledResult<R>[]> {
  const width = Math.min(items.length, Math.max(1, Math.floor(concurrency)))
  const results = new Array<PromiseSettledResult<R>>(items.length)
  let cursor = 0
  const runWorker = async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]!, index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: width }, runWorker))
  return results
}
