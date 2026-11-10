/** ENEM occupies part of the chosen total; it never adds extra questions. */
export function composeWithEnem(total: number, ids: Iterable<number>) {
  const bankIds = [...new Set(ids)].slice(0, total)
  return { bankIds, questionCount: total - bankIds.length }
}

export function selectEnemCount(selected: Iterable<number>, candidates: Iterable<number>, desired: number) {
  return [...new Set([...selected, ...candidates])].slice(0, desired)
}
