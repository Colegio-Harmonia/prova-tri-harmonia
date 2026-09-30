/** Mantém o upload rápido sem abrir conexões ilimitadas no navegador. */
export async function runWithConcurrency<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  const workerCount = Math.min(Math.max(1, limit), items.length)
  let nextIndex = 0
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) return
      await task(items[index])
    }
  }))
}
